// app/api/loan-indexes/[indexId]/top-sheet/route.ts
import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { compareMemberIds } from '@/app/lib/member-id-sort';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/loan-indexes/[indexId]/top-sheet
 * Get details for the top sheet of a loan index
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ indexId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { indexId } = await params;

            const loanIndex = await prisma.loanIndex.findUnique({
                where: { id: indexId },
                include: {
                    branch: {
                        select: {  
                            id: true,
                            name: true,
                            code: true
                        }
                    },
                    center: {
                        select: {
                            code: true,
                            name: true,
                            address: true,
                            meetingDay: true,
                            meetingPlace: true,
                            fdo: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    mobileNumber: true,
                                }
                            },
                            centerLeader: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                }
                            }
                        }
                    },
                    loans: {
                        where: { isActive: true },
                        include: {
                            client: {
                                select: {
                                    clientId: true,
                                    firstName: true,
                                    lastName: true,
                                    dateOfBirth: true,
                                    highmarkReports: {
                                        orderBy: { pulledAt: 'desc' },
                                        take: 1,
                                        select: { creditScore: true, status: true },
                                    },
                                    kycDocuments: {
                                        where: {
                                            documentType: 'client_photo',
                                            isDeleted: false,
                                            fileUrl: { not: null },
                                        },
                                        orderBy: { createdAt: 'desc' },
                                        take: 1
                                    }
                                }
                            },
                            loanPurpose: {
                                select: { name: true }
                            },
                        }
                    }
                }
            });

            if (!loanIndex) {
                return errorResponse('Loan index not found', 404);
            }

            // Natural member-ID order (29-96-1-2 before 29-96-1-10); createdAt order stays the tiebreaker (stable sort).
            loanIndex.loans.sort((a, b) => compareMemberIds(a.client.clientId, b.client.clientId));

            const [bmUser, amUser] = await Promise.all([
                prisma.user.findFirst({
                    where: {
                        isActive: true,
                        OR: [
                            { role: 'BRANCH_MANAGER', branchId: loanIndex.branchId },
                            {
                                userRoles: {
                                    some: {
                                        branchId: loanIndex.branchId,
                                        isActive: true,
                                        role: { slug: 'branch-manager', isActive: true },
                                    },
                                },
                            },
                        ],
                    },
                    select: { firstName: true, lastName: true, mobileNumber: true },
                }),
                prisma.user.findFirst({
                    where: {
                        isActive: true,
                        OR: [
                            {
                                areaManagerBranches: {
                                    some: { branchId: loanIndex.branchId },
                                },
                            },
                            {
                                userRoles: {
                                    some: {
                                        branchId: loanIndex.branchId,
                                        isActive: true,
                                        role: { slug: 'area-manager', isActive: true },
                                    },
                                },
                            },
                        ],
                    },
                    select: { firstName: true, lastName: true, mobileNumber: true },
                }),
            ]);

            // Calculate age from dateOfBirth
            const calculateAge = (dateOfBirth: Date | null): number | null => {
                if (!dateOfBirth) return null;
                const today = new Date();
                const birthDate = new Date(dateOfBirth);
                let age = today.getFullYear() - birthDate.getFullYear();
                const monthDiff = today.getMonth() - birthDate.getMonth();
                
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                return age;
            };

            // Resolve product names
            const productIds = Array.from(new Set(loanIndex.loans.map(l => l.loanProductId).filter(Boolean))) as string[];
            let productMap: Record<string, string> = {};

            if (productIds.length > 0) {
                const products = await prisma.loanProduct.findMany({
                    where: { id: { in: productIds } },
                    select: { id: true, productName: true }
                });
                products.forEach(p => productMap[p.id] = p.productName);
            }

            // Batch: loan cycle per client
            const clientIdsForCycle = loanIndex.loans.map(l => l.clientId);
            const disbursedForCycle = await prisma.loan.findMany({
                where: {
                    clientId: { in: clientIdsForCycle },
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                },
                select: { clientId: true }
            });
            const disbursedCountByClient = new Map<string, number>();
            disbursedForCycle.forEach(l => {
                disbursedCountByClient.set(l.clientId, (disbursedCountByClient.get(l.clientId) || 0) + 1);
            });

            // kycDocuments.fileUrl is a private GCS object key (or a legacy Supabase
            // https:// URL) — the storage bucket has no public read access, so an
            // <img> pointed straight at the raw key fails to load. Resolve each
            // distinct key to a short-lived signed URL the browser can actually fetch.
            const photoKeys = Array.from(
                new Set(
                    loanIndex.loans
                        .map(loan => loan.client.kycDocuments[0]?.fileUrl)
                        .filter((key): key is string => !!key)
                )
            );
            const signedPhotoUrlByKey = new Map<string, string>();
            await Promise.all(
                photoKeys.map(async key => {
                    try {
                        signedPhotoUrlByKey.set(key, await getSignedReadUrl(key));
                    } catch (photoErr) {
                        console.error('Failed to resolve client photo for top sheet:', photoErr);
                    }
                })
            );

            const loans = loanIndex.loans.map(loan => {
                const photoKey = loan.client.kycDocuments[0]?.fileUrl || null;
                const latestHm = (loan.client as any).highmarkReports?.[0];
                return {
                    id: loan.id,
                    clientId: loan.client.clientId,
                    clientName: `${loan.client.firstName} ${loan.client.lastName}`,
                    clientPhoto: photoKey ? signedPhotoUrlByKey.get(photoKey) ?? null : null,
                    highmarkScore: latestHm?.creditScore ?? null,
                    highmarkStatus: latestHm?.status || 'N/A',
                    age: calculateAge(loan.client.dateOfBirth),
                    purpose: loan.loanPurpose?.name || 'N/A',
                    amount: Number(loan.amount),
                    product: (loan.loanProductId && productMap[loan.loanProductId]) || loan.loanProductId || 'N/A',
                    frequency: loan.frequency || 'N/A',
                    tenureMonths: loan.tenureMonths,
                    interestRate: Number(loan.interestRate),
                    loanCycle: (disbursedCountByClient.get(loan.clientId) || 0) + 1,
                };
            });

            // Format date to DD-MM-YYYY
            const date = new Date(loanIndex.indexDate);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const formattedDate = `${day}/${month}/${year}`;

            // Safe access for branch name with fallback
            const branchName = loanIndex.branch?.name || 'N/A';
            const centerCode = loanIndex.center?.code || 'N/A';
            const centerName = loanIndex.center?.name || 'N/A';
            const centerAddress = loanIndex.center?.address || '';
            const centerMeetingDay = loanIndex.center?.meetingDay || 'FRIDAY';
            const centerMeetingPlace = loanIndex.center?.meetingPlace || loanIndex.center?.address || 'SEMMANATHAM';

            const data = {
                indexNo: loanIndex.indexNo,
                indexDate: formattedDate,
                branchName: branchName,
                centerCode: centerCode,
                centerName: centerName,
                centerAddress: centerAddress,
                centerMeetingDay: centerMeetingDay,
                centerMeetingPlace: centerMeetingPlace,
                centerLeader: (loanIndex.center as any).centerLeader ?
                    `${(loanIndex.center as any).centerLeader.firstName} ${(loanIndex.center as any).centerLeader.lastName}` : 'N/A',
                totalApps: loanIndex.totalApps,
                totalAmount: Number(loanIndex.totalAmount),
                frequency: loanIndex.frequency,
                bmName: bmUser ? `${bmUser.firstName} ${bmUser.lastName}` : null,
                bmMobile: bmUser?.mobileNumber ?? null,
                amName: amUser ? `${amUser.firstName} ${amUser.lastName}` : null,
                amMobile: amUser?.mobileNumber ?? null,
                fdoName: loanIndex.center.fdo ? `${loanIndex.center.fdo.firstName} ${loanIndex.center.fdo.lastName}` : null,
                fdoMobile: loanIndex.center.fdo?.mobileNumber ?? null,
                loans,
            };

            return successResponse(data, 'Top sheet data retrieved successfully');
        } catch (error) {
            console.error('Error fetching top sheet:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch top sheet',
                500
            );
        }
    })(request);
}