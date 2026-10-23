import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { loanMemberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export function buildRows(
    loans: ReturnType<typeof mapLoan>[],
    offset: number,
    today: Date
) {
    return loans.map((loan, index) => {
        const client = loan.client;
        const center = loan.center;
        const branch = center.branch;
        const area = branch.areas[0] ?? null;
        const division = area?.division ?? null;
        const region = division?.region ?? null;
        const schedules = loan.schedules;

        const loanPrincipal = Number(loan.amount);
        const totalInterest = schedules.reduce((s, sch) => s + Number(sch.interestDue), 0);
        const loanAmount = loanPrincipal + totalInterest;

        const osPrincipal = Math.max(0, loanPrincipal - Number(loan.principalPaid));
        const osInterest = schedules.reduce(
            (s, sch) => s + Math.max(0, Number(sch.interestDue) - Number(sch.interestPaid)),
            0
        );
        const osTotal = osPrincipal + osInterest;

        const overdueSchedules = schedules.filter(
            (sch) => new Date(sch.dueDate) < today && sch.status !== 'PAID'
        );
        const arrearPrincipal = overdueSchedules.reduce(
            (s, sch) => s + Math.max(0, Number(sch.principalDue) - Number(sch.principalPaid)),
            0
        );
        const arrearInterest = overdueSchedules.reduce(
            (s, sch) => s + Math.max(0, Number(sch.interestDue) - Number(sch.interestPaid)),
            0
        );
        const arrearTotal = arrearPrincipal + arrearInterest;

        const firstEmiDate = schedules.length > 0 ? schedules[0].dueDate : null;
        const maturityDate = schedules.length > 0 ? schedules[schedules.length - 1].dueDate : null;
        const fdoName = center.fdo
            ? `${center.fdo.firstName} ${center.fdo.lastName}`.trim()
            : '';

        return {
            sNo: offset + index + 1,
            regionName: region?.name ?? '',
            divisionName: division?.name ?? '',
            areaName: area?.name ?? '',
            branchId: branch.code,
            branchName: branch.name,
            centerId: center.code,
            centerName: center.name,
            fdoName,
            productType: loan.loanProduct?.loanProductType?.name ?? '',
            loanId: loan.loanNumber,
            memberId: client.clientId,
            memberName: `${client.firstName} ${client.lastName}`.trim(),
            nomineeName: client.nomineeName ?? '',
            address: client.permanentAddress ?? '',
            district: client.district ?? '',
            phoneNumber: client.mobileNumber ?? client.phone ?? '',
            aadhaarNumber: client.otherIdNo ?? '',
            loanDisbursementDate: loan.disbursedByBMAt,
            firstEmiDate,
            loanMaturityDate: maturityDate,
            loanPrincipal,
            loanInterest: totalInterest,
            loanAmount,
            osPrincipal,
            osInterest,
            osTotal,
            arrearPrincipal,
            arrearInterest,
            arrearTotal,
            interestRate: Number(loan.interestRate),
            fundingName: loan.funder?.funderName ?? '',
            isDead: loan.deathMarking.length > 0,
            deceasedPersonType: loan.deathMarking[0]?.deceasedPersonType ?? null,
            deceasedPersonName: loan.deathMarking[0]?.deceasedPersonName ?? null,
        };
    });
}

// Dummy type to satisfy TypeScript inference for mapLoan
function mapLoan(l: Awaited<ReturnType<typeof queryLoans>>[number]) {
    return l;
}

export async function queryLoans(
    where: Prisma.LoanWhereInput,
    skip?: number,
    take?: number
) {
    return prisma.loan.findMany({
        where,
        orderBy: [
            { disbursedByBMAt: 'desc' },
            { loanNumber: 'asc' },
        ],
        skip,
        take,
        select: {
            loanNumber: true,
            amount: true,
            interestRate: true,
            principalPaid: true,
            disbursedByBMAt: true,
            client: {
                select: {
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    nomineeName: true,
                    permanentAddress: true,
                    district: true,
                    otherIdNo: true,
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
                                select: {
                                    id: true,
                                    name: true,
                                    division: {
                                        select: {
                                            id: true,
                                            name: true,
                                            region: { select: { id: true, name: true } },
                                        },
                                    },
                                },
                                take: 1,
                            },
                        },
                    },
                },
            },
            loanProduct: {
                select: {
                    productId: true,
                    productName: true,
                    loanProductType: { select: { name: true } },
                },
            },
            funder: { select: { funderName: true } },
            deathMarking: {
                where: { isReversed: false },
                select: {
                    deceasedPersonType: true,
                    deceasedPersonName: true,
                    deathDate: true,
                },
            },
            schedules: {
                orderBy: { dueDate: 'asc' },
                select: {
                    dueDate: true,
                    principalDue: true,
                    interestDue: true,
                    principalPaid: true,
                    interestPaid: true,
                    status: true,
                },
            },
        },
    });
}

export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);

            const regionId = searchParams.get('regionId') || undefined;
            const divisionId = searchParams.get('divisionId') || undefined;
            const areaId = searchParams.get('areaId') || undefined;
            const branchId = searchParams.get('branchId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;
            const productTypeId = searchParams.get('productTypeId') || undefined;
            const loanProductId = searchParams.get('loanProductId') || undefined;
            const funderId = searchParams.get('funderId') || undefined;
            const search = searchParams.get('search') || undefined;
            const exportAll = searchParams.get('exportAll') === 'true';
            const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

            // Hierarchy filter via branch many-to-many Area
            const branchWhere: Prisma.BranchWhereInput = {};
            if (branchId) branchWhere.id = branchId;
            if (areaId) {
                branchWhere.areas = { some: { id: areaId } };
            } else if (divisionId) {
                branchWhere.areas = { some: { division: { id: divisionId } } };
            } else if (regionId) {
                branchWhere.areas = { some: { division: { region: { id: regionId } } } };
            }

            // Product filter (type and/or product code)
            const loanProductWhere: Prisma.LoanProductWhereInput = {};
            if (productTypeId) loanProductWhere.loanProductTypeId = productTypeId;
            if (loanProductId) loanProductWhere.productId = loanProductId;

            // Search filter
            const searchWhere: Prisma.LoanWhereInput['OR'] = search
                ? [
                      { loanNumber: { contains: search, mode: 'insensitive' } },
                      { client: { firstName: { contains: search, mode: 'insensitive' } } },
                      { client: { lastName: { contains: search, mode: 'insensitive' } } },
                      { client: { clientId: { contains: search, mode: 'insensitive' } } },
                      { client: { phone: { contains: search, mode: 'insensitive' } } },
                      { client: { mobileNumber: { contains: search, mode: 'insensitive' } } },
                      ...loanMemberIdSearchConditions(search),
                  ]
                : undefined;

            const where: Prisma.LoanWhereInput = {
                disbursementStatus: 'DISBURSED',
                ...(centerId && { centerId }),
                ...(funderId && { funderId }),
                ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
                ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
                ...(searchWhere && { OR: searchWhere }),
            };

            const today = new Date();
            today.setHours(0, 0, 0, 0);

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
                const rows = buildRows(loans.map(mapLoan), 0, today);
                return successResponse(
                    { data: rows, total: rows.length, page: 1, pageSize: rows.length, totalPages: 1 },
                    'Client portfolio export fetched successfully'
                );
            }

            const [total, loans] = await Promise.all([
                prisma.loan.count({ where }),
                queryLoans(where, (page - 1) * pageSize, pageSize),
            ]);

            const rows = buildRows(loans.map(mapLoan), (page - 1) * pageSize, today);

            return successResponse(
                {
                    data: rows,
                    total,
                    page,
                    pageSize,
                    totalPages: Math.ceil(total / pageSize),
                },
                'Client portfolio report fetched successfully'
            );
        } catch (error) {
            console.error('[ClientPortfolioReport] Error:', error);
            return errorResponse('Failed to fetch client portfolio report', 500);
        }
    })(request);
}
