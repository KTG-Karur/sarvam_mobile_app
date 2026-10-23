import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { addMonths, format } from 'date-fns';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function deriveLoanStatus(
    disbursementStatus: string,
    applicationStatus: string,
    closedDate: Date | null,
    hasPreclosureTxn: boolean
): string {
    if (applicationStatus === 'REJECTED' || disbursementStatus === 'REJECTED') return 'Rejected';
    if (disbursementStatus === 'DISBURSED' && closedDate) {
        return hasPreclosureTxn ? 'Preclosed' : 'Completed';
    }
    if (disbursementStatus === 'DISBURSED') return 'Active';
    if (
        disbursementStatus === 'PENDING_LEVEL1' ||
        disbursementStatus === 'APPROVED_LEVEL1' ||
        disbursementStatus === 'PENDING_LEVEL2' ||
        disbursementStatus === 'APPROVED_LEVEL2'
    ) return 'Pending';
    return 'Unknown';
}

/**
 * GET /api/collections/member-collection-details/search
 * Search for a member and return all their loans with aggregated financial data.
 *
 * Query params:
 *   searchType  - phone | aadhaar | memberId
 *   searchValue - the search string (required)
 *   productTypeId - optional filter on LoanProductType.id
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const searchType = searchParams.get('searchType');
            let searchValue = (searchParams.get('searchValue') || '').trim();

            // Aadhaar is stored as digits only (no spaces, dashes); normalize before matching
            if (searchType === 'aadhaar') {
                searchValue = searchValue.replace(/\D/g, '');
            }

            const productTypeId = searchParams.get('productTypeId') || undefined;

            if (!searchType || !searchValue) {
                return errorResponse('searchType and searchValue are required', 400);
            }

            if (!['phone', 'aadhaar', 'memberId'].includes(searchType)) {
                return errorResponse('Invalid searchType. Use: phone, aadhaar, memberId', 400);
            }

            // Build client search criteria — NO branch scope on the client query.
            // Branch scope is applied on loanApplications below (same pattern as single-collection).
            const clientWhere: Record<string, unknown> = {};
            if (searchType === 'phone') {
                clientWhere.OR = [
                    { mobileNumber: { contains: searchValue, mode: 'insensitive' } },
                    { phone: { contains: searchValue, mode: 'insensitive' } },
                ];
            } else if (searchType === 'aadhaar') {
                clientWhere.otherIdNo = { contains: searchValue, mode: 'insensitive' };
            } else {
                clientWhere.clientId = { contains: searchValue, mode: 'insensitive' };
            }

            const clients = await prisma.client.findMany({
                where: clientWhere as any,
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    otherIdNo: true,
                    loanAdvance: true,
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branch: { select: { name: true } },
                        },
                    },
                    groupMemberships: {
                        select: { group: { select: { name: true } } },
                        take: 1,
                    },
                    loanApplications: {
                        where: {
                            disbursementStatus: 'DISBURSED' as any,
                            ...(productTypeId
                                ? { loanProduct: { loanProductTypeId: productTypeId } }
                                : {}),
                        },
                        orderBy: { createdAt: 'desc' },
                        select: {
                            id: true,
                            loanNumber: true,
                            indexId: true,
                            amount: true,
                            principalPaid: true,
                            interestPaid: true,
                            disbursementStatus: true,
                            applicationStatus: true,
                            closedDate: true,
                            disbursedLevel1At: true,
                            disbursedByBMAt: true,
                            tenureMonths: true,
                            frequency: true,
                            loanIndex: { select: { indexNo: true } },
                            loanProduct: {
                                select: {
                                    productName: true,
                                    loanProductType: { select: { name: true } },
                                },
                            },
                            schedules: {
                                select: {
                                    installmentNo: true,
                                    dueDate: true,
                                    interestDue: true,
                                    interestPaid: true,
                                    status: true,
                                },
                                orderBy: { installmentNo: 'asc' },
                            },
                            transactions: {
                                where: {
                                    type: 'PRECLOSURE' as any,
                                    isReversed: false,
                                    status: { in: ['PENDING', 'APPROVED'] as any },
                                },
                                select: { id: true },
                                take: 1,
                            },
                            deathMarking: {
                                where: { isReversed: false },
                                select: {
                                    deceasedPersonType:  true,
                                    deceasedPersonName:  true,
                                    deathReason:         true,
                                    deathDate:           true,
                                    placeOfDeath:        true,
                                    demandRequired:      true,
                                    deathCertificateUrl: true,
                                    deathCertificateName: true,
                                }
                            },
                        },
                    },
                },
                take: 20,
            });

            const result = clients.map((client) => {
                const loans = client.loanApplications.map((loan) => {
                    const outstandingBalance =
                        Math.max(0, Number(loan.amount) - Number(loan.principalPaid));

                    const dueInterest = loan.schedules.reduce((sum, s) => {
                        if (s.status === 'PAID' || s.status === 'WAIVED') return sum;
                        return sum + Math.max(0, Number(s.interestDue) - Number(s.interestPaid));
                    }, 0);

                    const disbursementAt = loan.disbursedByBMAt ?? loan.disbursedLevel1At;
                    const ldDate = disbursementAt
                        ? format(disbursementAt, 'dd/MM/yyyy')
                        : null;

                    const startDate = loan.schedules.length > 0
                        ? format(new Date(loan.schedules[0].dueDate), 'dd/MM/yyyy')
                        : null;

                    let endDate: string | null = null;
                    if (loan.schedules.length > 0) {
                        const last = loan.schedules[loan.schedules.length - 1];
                        endDate = format(new Date(last.dueDate), 'dd/MM/yyyy');
                    } else if (disbursementAt) {
                        endDate = format(
                            addMonths(disbursementAt, loan.tenureMonths),
                            'dd/MM/yyyy'
                        );
                    }

                    const hasPreclosureTxn = loan.transactions.length > 0;
                    const loanStatus = deriveLoanStatus(
                        loan.disbursementStatus,
                        loan.applicationStatus,
                        loan.closedDate,
                        hasPreclosureTxn
                    );

                    const activeDeathMarking = loan.deathMarking[0] ?? null;

                    return {
                        id: loan.id,
                        loanNumber: loan.loanNumber,
                        loanIndex: loan.loanIndex?.indexNo ?? null,
                        amount: Number(loan.amount),
                        outstandingBalance,
                        dueInterest: parseFloat(dueInterest.toFixed(2)),
                        loanStatus,
                        disbursementStatus: loan.disbursementStatus,
                        isClosed: loan.closedDate !== null,
                        ldDate,
                        startDate,
                        endDate,
                        productTypeName: loan.loanProduct?.loanProductType?.name ?? null,
                        productName: loan.loanProduct?.productName ?? null,
                        frequency: loan.frequency ?? null,
                        isDead: !!activeDeathMarking,
                        deathMarking: activeDeathMarking
                            ? {
                                deceasedPersonType:  activeDeathMarking.deceasedPersonType,
                                deceasedPersonName:  activeDeathMarking.deceasedPersonName,
                                deathDate:           activeDeathMarking.deathDate.toISOString(),
                                placeOfDeath:        activeDeathMarking.placeOfDeath,
                                deathReason:         activeDeathMarking.deathReason,
                                demandRequired:      activeDeathMarking.demandRequired,
                                deathCertificateUrl: activeDeathMarking.deathCertificateUrl ?? null,
                                deathCertificateName: activeDeathMarking.deathCertificateName ?? null,
                              }
                            : null,
                    };
                });

                return {
                    id: client.id,
                    clientId: client.clientId,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    fullName: `${client.firstName} ${client.lastName}`,
                    phone: client.phone ?? null,
                    mobileNumber: client.mobileNumber ?? null,
                    otherIdNo: client.otherIdNo ?? null,
                    loanAdvance: Number(client.loanAdvance),
                    centerId: client.center?.id ?? null,
                    centerName: client.center
                        ? `${client.center.code} - ${client.center.name}`
                        : '',
                    branchName: client.center?.branch?.name ?? '',
                    groupName: client.groupMemberships[0]?.group?.name ?? null,
                    loans,
                };
            });

            return successResponse({ clients: result }, `Found ${result.length} member(s)`);
        } catch (error: any) {
            console.error('Member collection details search error:', error);
            return errorResponse(error.message || 'Search failed', 500);
        }
    })(request);
}
