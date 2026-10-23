import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// ─── Row builder ──────────────────────────────────────────────────────────────

function classifyLoan(
    transactions: { type: string }[]
): 'Written Off' | 'Preclosed' | 'Closed' {
    if (transactions.some((t) => t.type === 'WRITEOFF')) return 'Written Off';
    if (transactions.some((t) => t.type === 'PRECLOSURE')) return 'Preclosed';
    return 'Closed';
}

// closureRec.reason ('DEAD' | 'WRITEOFF' | 'OTHERS') -> display label.
// All three reasons share the same 'WRITEOFF'-type audit transaction, so the
// bucket from classifyLoan() alone can't distinguish them.
const CLOSURE_REASON_LABEL: Record<string, string> = {
    DEAD: 'Dead',
    OTHERS: 'Others',
    WRITEOFF: 'Written Off',
};

export function buildRow(loan: Awaited<ReturnType<typeof queryLoans>>[number], sNo: number) {
    const client = loan.client;
    const center = loan.center;
    const branch = center.branch;
    const area = branch.areas[0] ?? null;
    const division = area?.division ?? null;
    const region = division?.region ?? null;

    const schedules = loan.schedules;
    const txns = loan.transactions;
    const foreclosure = loan.foreclosureRequests[0] ?? null;

    // Internal bucket — drives OS/waiver calc + reason fallback below.
    // DEAD / OTHERS / WRITEOFF closures all share the same 'WRITEOFF'-type
    // audit transaction and closure-record paid/waiver amounts.
    const closureBucket = classifyLoan(txns);
    const isClosureRecordClosure = closureBucket === 'Written Off';

    const preClosureTx = txns.find((t) => t.type === 'PRECLOSURE') ?? null;
    const writeOffTx = txns.find((t) => t.type === 'WRITEOFF') ?? null;
    const lastRepaymentTx = [...txns]
        .filter((t) => t.type === 'REPAYMENT')
        .sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime())[0] ?? null;

    // Dates
    const firstEmiDate = schedules.length > 0 ? schedules[0].dueDate : null;
    const maturityDate = schedules.length > 0 ? schedules[schedules.length - 1].dueDate : null;
    const preCloseDate = preClosureTx?.transactionDate ?? null;
    const closeDate = loan.closedDate;
    const lastEmiDate = loan.lastPaymentDate ?? lastRepaymentTx?.transactionDate ?? null;

    // Tenure
    const totalTenure = schedules.length;

    // Next installment number (first non-PAID schedule)
    const nextInstNo = schedules.find((s) => s.status !== 'PAID')?.installmentNo ?? null;

    // Interest totals from schedules
    const totalInterest = schedules.reduce((sum, s) => sum + Math.max(0, Number(s.interestDue)), 0);
    const unpaidScheduleInterest = schedules
        .filter((s) => s.status !== 'PAID')
        .reduce((sum, s) => sum + Math.max(0, Number(s.interestDue) - Number(s.interestPaid)), 0);

    // Loan amount = principal + total schedule interest
    const loanPrincipal = Number(loan.amount);
    const loanAmount = loanPrincipal + totalInterest;

    // LoanClosureRecord data (populated for write-off closures)
    const closureRec = loan.loanClosureRecord?.[0] ?? null;
    const paidPrincipalAtClose = closureRec ? Number(closureRec.paidPrincipal) : 0;
    const paidInterestAtClose = closureRec ? Number(closureRec.paidInterest) : 0;
    const principalWaiver = closureRec ? Number(closureRec.principalWaiver) : 0;
    const interestWaiver = closureRec ? Number(closureRec.interestWaiver) : 0;
    const penaltyAmount = closureRec ? Number(closureRec.penaltyAmount) : 0;
    const penaltyPaid = closureRec ? Number(closureRec.penaltyPaid) : 0;

    // OS Principal Before Close
    let osPrincipalBeforeClose: number;
    if (closureBucket === 'Preclosed') {
        osPrincipalBeforeClose = foreclosure
            ? Number(foreclosure.principalAmount)
            : Math.max(0, loanPrincipal - Number(loan.principalPaid));
    } else if (isClosureRecordClosure) {
        // Outstanding before close = paid at closure + waived (all outstanding was settled)
        osPrincipalBeforeClose = paidPrincipalAtClose + principalWaiver;
    } else {
        osPrincipalBeforeClose = Math.max(0, loanPrincipal - Number(loan.principalPaid));
    }

    // OS Interest Before Close
    let osInterestBeforeClose: number;
    if (closureBucket === 'Preclosed') {
        osInterestBeforeClose = foreclosure
            ? Number(foreclosure.interestAmount)
            : unpaidScheduleInterest;
    } else if (isClosureRecordClosure) {
        osInterestBeforeClose = paidInterestAtClose + interestWaiver;
    } else {
        osInterestBeforeClose = unpaidScheduleInterest;
    }

    // Waiver Interest = total unpaid schedule interest - what was actually recorded as outstanding
    const closeLoanWaiverInterest = Math.max(0, unpaidScheduleInterest - osInterestBeforeClose);

    // Amount Outstanding = OS Principal + OS Interest
    const amountOutstanding = osPrincipalBeforeClose + osInterestBeforeClose;

    // Write-off amounts (paid amounts at closure)
    const writeOffPrincipal = paidPrincipalAtClose;
    const writeOffInterest = paidInterestAtClose;

    // Reason column
    let reason = '';
    if (closureBucket === 'Preclosed') {
        reason = foreclosure?.remarks ?? '';
    } else if (isClosureRecordClosure) {
        reason = closureRec?.reason ?? writeOffTx?.description ?? '';
    }

    // Display label — distinguish DEAD / OTHERS / WRITEOFF closures, which
    // otherwise all collapse into the same 'Written Off' bucket above.
    const loanType = isClosureRecordClosure
        ? (CLOSURE_REASON_LABEL[closureRec?.reason ?? 'WRITEOFF'] ?? 'Written Off')
        : closureBucket;

    // FDO name
    const fdoName = center.fdo
        ? `${center.fdo.firstName} ${center.fdo.lastName}`.trim()
        : '';

    return {
        sNo,
        regionName: region?.name ?? '',
        divisionName: division?.name ?? '',
        areaName: area?.name ?? '',
        branchId: branch.code,
        branchName: branch.name,
        centerId: center.code,
        centerName: center.name,
        fdoName,
        loanId: loan.loanNumber,
        loanType,
        memberId: client.clientId,
        memberName: `${client.firstName} ${client.lastName}`.trim(),
        reason,
        fundingName: loan.funder?.funderName ?? '',
        loanDisbursementDate: loan.disbursedByBMAt,
        firstEmiDate,
        loanMaturityDate: maturityDate,
        preCloseDate,
        closeDate,
        lastEmiDate,
        totalTenure,
        osPrincipalBeforeClose,
        osInterestBeforeClose,
        closeLoanWaiverInterest,
        loanAmount,
        amountOutstanding,
        interest: totalInterest,
        writeOffPrincipal,
        writeOffInterest,
        // Write-off closure waiver fields
        paidPrincipalAtClose,
        paidInterestAtClose,
        principalWaiver,
        interestWaiver,
        penaltyAmount,
        penaltyPaid,
        interestPercent: Number(loan.interestRate),
        nextInstNo,
        isDead: loan.deathMarking.length > 0,
        deceasedPersonType:   loan.deathMarking[0]?.deceasedPersonType ?? null,
        deceasedPersonName:   loan.deathMarking[0]?.deceasedPersonName ?? null,
        deathCertificateUrl:  loan.deathMarking[0]?.deathCertificateUrl ?? null,
        deathCertificateName: loan.deathMarking[0]?.deathCertificateName ?? null,
        approvalDocumentName: closureRec?.approvalDocumentName ?? null,
        approvalDocumentUrl:  closureRec?.approvalDocumentUrl ?? null,
    };
}

// ─── Query helper (typed so buildRow can infer the loan shape) ────────────────

export async function queryLoans(where: Prisma.LoanWhereInput, skip?: number, take?: number) {
    return prisma.loan.findMany({
        where,
        orderBy: [
            { closedDate: 'desc' },
            { loanNumber: 'asc' },
        ],
        skip,
        take,
        select: {
            loanNumber: true,
            amount: true,
            interestRate: true,
            principalPaid: true,
            interestPaid: true,
            lastPaymentDate: true,
            closedDate: true,
            disbursedByBMAt: true,
            loanClosureRecord: {
                where: { isReversed: false },
                select: {
                    paidPrincipal: true,
                    paidInterest: true,
                    principalWaiver: true,
                    interestWaiver: true,
                    penaltyAmount: true,
                    penaltyPaid: true,
                    reason: true,
                    approvalDocumentName: true,
                    approvalDocumentUrl: true,
                },
            },
            client: {
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                },
            },
            center: {
                select: {
                    id: true,
                    name: true,
                    code: true,
                    fdo: { select: { firstName: true, lastName: true } },
                    branch: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            areas: {
                                take: 1,
                                select: {
                                    name: true,
                                    division: {
                                        select: {
                                            name: true,
                                            region: { select: { name: true } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            loanProduct: {
                select: {
                    productName: true,
                    loanProductType: { select: { name: true } },
                },
            },
            funder: { select: { funderName: true } },
            deathMarking: {
                where: { isReversed: false },
                select: {
                    deceasedPersonType:  true,
                    deceasedPersonName:  true,
                    deathCertificateUrl: true,
                    deathCertificateName: true,
                },
            },
            schedules: {
                orderBy: { installmentNo: 'asc' },
                select: {
                    installmentNo: true,
                    dueDate: true,
                    principalDue: true,
                    interestDue: true,
                    principalPaid: true,
                    interestPaid: true,
                    status: true,
                },
            },
            transactions: {
                where: {
                    isReversed: false,
                    status: 'APPROVED',
                    type: { in: ['PRECLOSURE', 'WRITEOFF', 'REPAYMENT'] },
                },
                orderBy: { transactionDate: 'asc' },
                select: {
                    type: true,
                    transactionDate: true,
                    principalAmount: true,
                    interestAmount: true,
                    description: true,
                    remarks: true,
                },
            },
            foreclosureRequests: {
                where: { status: 'APPROVED' },
                orderBy: { reviewedAt: 'desc' },
                take: 1,
                select: {
                    principalAmount: true,
                    interestAmount: true,
                    reviewedAt: true,
                    remarks: true,
                },
            },
        },
    });
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);

            const fromDate = searchParams.get('fromDate');
            const tillDate = searchParams.get('tillDate');

            if (!fromDate || !tillDate) {
                return errorResponse('fromDate and tillDate are required', 400);
            }

            // IST-aware date boundaries
            const from = new Date(`${fromDate}T00:00:00+05:30`);
            const till = new Date(`${tillDate}T23:59:59+05:30`);

            const branchId = searchParams.get('branchId') || undefined;
            const regionId = searchParams.get('regionId') || undefined;
            const divisionId = searchParams.get('divisionId') || undefined;
            const areaId = searchParams.get('areaId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;
            const productTypeId = searchParams.get('productTypeId') || undefined;
            const loanProductId = searchParams.get('loanProductId') || undefined;
            const funderId = searchParams.get('funderId') || undefined;
            const closureType = searchParams.get('closureType') || 'all';
            const search = searchParams.get('search') || undefined;
            const exportAll = searchParams.get('exportAll') === 'true';
            const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

            // AM restriction: scope to their assigned branches only
            let allowedBranchIds: string[] | undefined;
            if (user.role === 'AREA_MANAGER') {
                allowedBranchIds = await getAreaManagerBranchIds(user.userId);
                if (allowedBranchIds.length === 0) {
                    return successResponse(
                        { data: [], total: 0, page: 1, pageSize, totalPages: 0 },
                        'No branches assigned to this Area Manager'
                    );
                }
                if (branchId && !allowedBranchIds.includes(branchId)) {
                    return errorResponse('Unauthorized branch access', 403);
                }
            }

            // Hierarchy filter
            const branchWhere: Prisma.BranchWhereInput = {};
            if (branchId) {
                branchWhere.id = branchId;
            } else if (allowedBranchIds) {
                branchWhere.id = { in: allowedBranchIds };
            }
            if (areaId) {
                branchWhere.areas = { some: { id: areaId } };
            } else if (divisionId) {
                branchWhere.areas = { some: { division: { id: divisionId } } };
            } else if (regionId) {
                branchWhere.areas = { some: { division: { region: { id: regionId } } } };
            }

            // Product filter
            const loanProductWhere: Prisma.LoanProductWhereInput = {};
            if (productTypeId) loanProductWhere.loanProductTypeId = productTypeId;
            if (loanProductId) loanProductWhere.productId = loanProductId;

            // Date range: closedDate OR PRECLOSURE/WRITEOFF transactionDate
            const andClauses: Prisma.LoanWhereInput[] = [
                {
                    OR: [
                        { closedDate: { gte: from, lte: till } },
                        {
                            transactions: {
                                some: {
                                    type: 'PRECLOSURE',
                                    status: 'APPROVED',
                                    isReversed: false,
                                    transactionDate: { gte: from, lte: till },
                                },
                            },
                        },
                        {
                            transactions: {
                                some: {
                                    type: 'WRITEOFF',
                                    status: 'APPROVED',
                                    isReversed: false,
                                    transactionDate: { gte: from, lte: till },
                                },
                            },
                        },
                    ],
                },
            ];

            // Closure type filter
            if (closureType === 'PRECLOSED') {
                andClauses.push({
                    transactions: { some: { type: 'PRECLOSURE', status: 'APPROVED', isReversed: false } },
                });
            } else if (closureType === 'WRITTEN_OFF') {
                andClauses.push({
                    transactions: { some: { type: 'WRITEOFF', status: 'APPROVED', isReversed: false } },
                });
            } else if (closureType === 'CLOSED') {
                andClauses.push({
                    NOT: {
                        transactions: {
                            some: {
                                type: { in: ['PRECLOSURE', 'WRITEOFF'] },
                                status: 'APPROVED',
                                isReversed: false,
                            },
                        },
                    },
                });
            }

            // Search filter
            if (search) {
                andClauses.push({
                    OR: [
                        { loanNumber: { contains: search, mode: 'insensitive' } },
                        { client: { clientId: { contains: search, mode: 'insensitive' } } },
                        { client: { firstName: { contains: search, mode: 'insensitive' } } },
                        { client: { lastName: { contains: search, mode: 'insensitive' } } },
                        ...loanMemberIdSearchConditions(search),
                    ],
                });
            }

            const where: Prisma.LoanWhereInput = {
                isActive: false,
                disbursementStatus: { in: ['DISBURSED', 'CLOSED'] },
                ...(centerId && { centerId }),
                ...(funderId && { funderId }),
                ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
                ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
                AND: andClauses,
            };

            if (exportAll) {
                const EXPORT_LOAN_CAP = 5000;
                const loanCount = await prisma.loan.count({ where });
                if (loanCount > EXPORT_LOAN_CAP) {
                    return errorResponse(
                        `Export matched ${loanCount} records, which exceeds the ${EXPORT_LOAN_CAP} export limit. Narrow the branch, center, or date filters and try again.`,
                        400
                    );
                }
                const loans = await queryLoans(where, undefined, EXPORT_LOAN_CAP);
                const rows = loans.map((loan, i) => buildRow(loan, i + 1));
                return successResponse(
                    { data: rows, total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 },
                    'Closed loan report export fetched successfully'
                );
            }

            const [total, loans] = await Promise.all([
                prisma.loan.count({ where }),
                queryLoans(where, (page - 1) * pageSize, pageSize),
            ]);

            const offset = (page - 1) * pageSize;
            const rows = loans.map((loan, i) => buildRow(loan, offset + i + 1));

            return successResponse(
                {
                    data: rows,
                    total,
                    page,
                    pageSize,
                    totalPages: Math.ceil(total / pageSize),
                },
                'Closed loan report fetched successfully'
            );
        } catch (error) {
            console.error('[ClosedLoanReport] Error:', error);
            return errorResponse('Failed to fetch closed loan report', 500);
        }
    })(request);
}
