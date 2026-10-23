import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { checkCenterAccess } from '@/app/lib/filters/fdo-center-scope';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/gold-transactions - List gold transactions
// Query params: type=TAKE|GIVE, status=PENDING|APPROVED|REJECTED, loanId, branchId, centerId, search
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const type = searchParams.get('type') as 'TAKE' | 'GIVE' | null;
            const status = searchParams.get('status') as 'PENDING' | 'APPROVED' | 'REJECTED' | null;
            const loanId = searchParams.get('loanId');
            const branchIdParam = searchParams.get('branchId');
            const centerIdParam = searchParams.get('centerId');
            const search = searchParams.get('search')?.trim();

            const where: Record<string, unknown> = {};
            if (type) where.type = type;
            if (status) where.status = status;
            if (loanId) where.loanId = loanId;

            // Branch scoping — branchIdParam only ever narrows within a role's
            // existing permitted scope, never widens it.
            const loanWhere: Record<string, unknown> = {};
            if (user.role === 'BRANCH_MANAGER' || user.role === 'FDO') {
                loanWhere.branchId = user.branchId;
            } else if (user.role === 'AREA_MANAGER') {
                const assignedBranchIds = user.assignedBranchIds || [];
                if (branchIdParam && assignedBranchIds.includes(branchIdParam)) {
                    loanWhere.branchId = branchIdParam;
                } else if (assignedBranchIds.length > 0) {
                    loanWhere.branchId = { in: assignedBranchIds };
                }
            } else if (user.role === 'ADMIN' && branchIdParam) {
                loanWhere.branchId = branchIdParam;
            }

            if (centerIdParam) {
                const center = await prisma.center.findUnique({
                    where: { id: centerIdParam },
                    select: { branchId: true, fdoId: true },
                });
                if (!center || (await checkCenterAccess(user, center))) {
                    return successResponse(
                        searchParams.has('page')
                            ? { data: [], totalCount: 0, totalPages: 0, page: 1, pageSize: 25 }
                            : [],
                        'Gold transactions fetched successfully'
                    );
                }
                loanWhere.centerId = centerIdParam;
            }

            if (Object.keys(loanWhere).length > 0) where.loan = loanWhere;

            if (search) {
                where.OR = [
                    { loan: { loanNumber: { contains: search, mode: 'insensitive' } } },
                    {
                        loan: {
                            client: {
                                OR: [
                                    { firstName: { contains: search, mode: 'insensitive' } },
                                    { lastName: { contains: search, mode: 'insensitive' } },
                                    { clientId: { contains: search, mode: 'insensitive' } },
                                    ...memberIdSearchConditions(search),
                                ],
                            },
                        },
                    },
                    { loan: { center: { name: { contains: search, mode: 'insensitive' } } } },
                    { loan: { branch: { name: { contains: search, mode: 'insensitive' } } } },
                ];
            }

            // Special filter: activeOnly=true returns TAKE loans with no GIVE already
            // approved or still pending approval — a loan with a pending return
            // shouldn't offer a second "Return Gold" action until that one is
            // resolved (approved or rejected).
            const activeOnly = searchParams.get('activeOnly') === 'true';
            if (activeOnly) {
                const returnedLoanIds = await prisma.goldTransaction.findMany({
                    where: { type: 'GIVE', status: { in: ['PENDING', 'APPROVED'] } },
                    select: { loanId: true },
                });
                const returnedIds = returnedLoanIds.map((r) => r.loanId);
                where.type = 'TAKE';
                where.status = 'APPROVED';
                if (returnedIds.length > 0) {
                    where.loanId = { notIn: returnedIds };
                }
            }

            const include = {
                loan: {
                    select: {
                        loanNumber: true,
                        amount: true,
                        disbursedByBMAt: true,
                        branchId: true,
                        client: { select: { firstName: true, lastName: true, clientId: true } },
                        center: { select: { name: true } },
                        branch: { select: { name: true } },
                        goldLoanDetail: {
                            select: { karatType: true, gramCount: true, goldTakenValue: true, cashGiven: true },
                        },
                    },
                },
                initiatedBy: { select: { firstName: true, lastName: true } },
                approvedBy: { select: { firstName: true, lastName: true } },
                rejectedBy: { select: { firstName: true, lastName: true } },
                returnPhotos: { select: { id: true, photoUrl: true, photoKey: true } },
            } as const;

            // Pagination is opt-in via the `page` param — used by the Gold Return
            // module's Active (activeOnly=true) and Completed (status=APPROVED) tabs.
            // The Pending-approval tab (a self-clearing approval queue) never sends
            // `page`, so it keeps the original unpaginated bare-array response.
            if (searchParams.has('page')) {
                const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
                const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

                const [totalCount, transactions] = await Promise.all([
                    prisma.goldTransaction.count({ where }),
                    prisma.goldTransaction.findMany({
                        where,
                        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                        skip: (page - 1) * pageSize,
                        take: pageSize,
                        include,
                    }),
                ]);

                return successResponse(
                    { data: transactions, totalCount, totalPages: Math.ceil(totalCount / pageSize), page, pageSize },
                    'Gold transactions fetched successfully'
                );
            }

            const transactions = await prisma.goldTransaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include,
            });

            return successResponse(transactions, 'Gold transactions fetched successfully');
        } catch (error) {
            console.error('Error fetching gold transactions:', error);
            return errorResponse('Failed to fetch gold transactions', 500);
        }
    })(request);
}

// POST /api/gold-transactions - BM initiates gold return (GIVE)
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await req.json();
            const {
                loanId, gramCount, goldValue, remarks,
                photos,
                recipientName, recipientMobile, recipientRelation,
                recipientPhotoUrl, recipientPhotoKey,
            } = body;

            if (!loanId) return errorResponse('loanId is required', 400);
            if (!gramCount || Number(gramCount) <= 0) return errorResponse('Valid gramCount is required', 400);
            if (!goldValue || Number(goldValue) <= 0) return errorResponse('Valid goldValue is required', 400);
            if (!Array.isArray(photos) || photos.length === 0 || photos.some((p: any) => !p?.photoUrl)) {
                return errorResponse('At least one photo of the returned gold is required', 400);
            }
            if (!recipientName?.trim()) return errorResponse('Recipient name is required', 400);
            if (!recipientMobile?.trim()) return errorResponse('Recipient mobile number is required', 400);
            if (!recipientRelation?.trim()) return errorResponse('Recipient relationship to client is required', 400);
            if (!recipientPhotoUrl) return errorResponse('A photo of the recipient is required', 400);

            // Get the loan with its gold detail
            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                include: {
                    goldLoanDetail: true,
                    goldTransactions: { where: { type: 'GIVE', status: { in: ['PENDING', 'APPROVED'] } } },
                },
            });

            if (!loan) return errorResponse('Loan not found', 404);
            if (!loan.goldLoanDetail) return errorResponse('This is not a gold loan', 400);
            const existingGive = loan.goldTransactions[0];
            if (existingGive?.status === 'APPROVED') return errorResponse('Gold has already been returned for this loan', 409);
            if (existingGive?.status === 'PENDING') return errorResponse('A gold return is already pending approval for this loan', 409);

            const grams = Number(gramCount);
            const value = Number(goldValue);

            const transaction = await prisma.goldTransaction.create({
                data: {
                    loanId,
                    type: 'GIVE',
                    gramCount: grams,
                    goldValue: value,
                    status: 'PENDING',
                    initiatedById: user.userId,
                    remarks: remarks || null,
                    recipientName: recipientName.trim(),
                    recipientMobile: recipientMobile.trim(),
                    recipientRelation: recipientRelation.trim(),
                    recipientPhotoUrl,
                    recipientPhotoKey: recipientPhotoKey || null,
                    returnPhotos: {
                        create: photos.map((p: { photoUrl: string; photoKey?: string }) => ({
                            photoUrl: p.photoUrl,
                            photoKey: p.photoKey || null,
                        })),
                    },
                },
                include: {
                    loan: { select: { loanNumber: true } },
                    initiatedBy: { select: { firstName: true, lastName: true } },
                    returnPhotos: true,
                },
            });

            return successResponse(transaction, 'Gold return initiated. Pending AM approval.', 201);
        } catch (error) {
            console.error('Error initiating gold return:', error);
            return errorResponse('Failed to initiate gold return', 500);
        }
    })(request);
}
