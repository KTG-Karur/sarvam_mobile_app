import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Shared query + row-shaping, used by the live GET below and by the
 * Request-Queue export adapter (app/lib/reports/report-registry.ts).
 * `branchIds: null` means unrestricted (already resolved by the caller).
 */
export async function queryDeathMemberRows(params: {
    fromDate: string;
    toDate: string;
    branchIds: string[] | null;
    centerId?: string | null;
    areaId?: string | null;
    divisionId?: string | null;
    regionId?: string | null;
}) {
    const startDate = new Date(params.fromDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(params.toDate);
    endDate.setHours(23, 59, 59, 999);

    const branchWhere: Record<string, unknown> = {};
    if (params.branchIds) {
        branchWhere.id = params.branchIds.length === 1 ? params.branchIds[0] : { in: params.branchIds };
    }
    if (params.areaId) {
        branchWhere.areas = { some: { id: params.areaId } };
    } else if (params.divisionId) {
        branchWhere.areas = { some: { division: { id: params.divisionId } } };
    } else if (params.regionId) {
        branchWhere.areas = { some: { division: { region: { id: params.regionId } } } };
    }

    const deathMarkings = await prisma.loanDeathMarking.findMany({
                where: {
                    isReversed: false,
                    deathDate: { gte: startDate, lte: endDate },
                    loan: {
                        centerId: params.centerId || undefined,
                        center: {
                            branch: Object.keys(branchWhere).length > 0 ? branchWhere : undefined,
                        },
                    },
                },
                include: {
                    loan: {
                        include: {
                            client: {
                                select: {
                                    clientId: true,
                                    firstName: true,
                                    lastName: true,
                                    phone: true,
                                    mobileNumber: true,
                                    otherIdNo: true,
                                    permanentAddress: true,
                                    district: true,
                                    nomineeName: true,
                                },
                            },
                            center: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                    fdo: {
                                        select: { firstName: true, lastName: true },
                                    },
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
                                                            region: {
                                                                select: { id: true, name: true },
                                                            },
                                                        },
                                                    },
                                                },
                                                take: 1,
                                            },
                                        },
                                    },
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
                            loanProduct: {
                                select: {
                                    productName: true,
                                    loanProductType: { select: { name: true } },
                                },
                            },
                            funder: { select: { funderName: true } },
                        },
                    },
                },
                orderBy: { deathDate: 'desc' },
            });

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const rows = deathMarkings.map((dm, index) => {
                const loan = dm.loan;
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
                    sNo: index + 1,
                    regionName: region?.name ?? '',
                    divisionName: division?.name ?? '',
                    areaName: area?.name ?? '',
                    branchId: branch.code,
                    branchName: branch.name,
                    centerId: center.code,
                    centerName: center.name,
                    fdoName,
                    dateOfDeath: dm.deathDate,
                    deathPerson: dm.deceasedPersonType,
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
                    interestRate:         Number(loan.interestRate),
                    fundingName:          loan.funder?.funderName ?? '',
                    deathCertificateUrl:  dm.deathCertificateUrl ?? null,
                    deathCertificateName: dm.deathCertificateName ?? null,
                };
            });

    return rows;
}

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDate = searchParams.get('fromDate');
            const toDate = searchParams.get('toDate');
            const regionId = searchParams.get('regionId') || undefined;
            const divisionId = searchParams.get('divisionId') || undefined;
            const areaId = searchParams.get('areaId') || undefined;
            const branchId = searchParams.get('branchId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;

            if (!fromDate || !toDate) {
                return errorResponse('fromDate and toDate are required', 400);
            }

            // AM restriction: only their assigned branches
            let allowedBranchIds: string[] | undefined;
            if (user.role === 'AREA_MANAGER') {
                allowedBranchIds = await getAreaManagerBranchIds(user.userId);
                if (allowedBranchIds.length === 0) {
                    return successResponse([], 'No branches assigned to this Area Manager');
                }
                if (branchId && !allowedBranchIds.includes(branchId)) {
                    return errorResponse('Unauthorized branch access', 403);
                }
            }

            const branchIds = branchId ? [branchId] : allowedBranchIds ?? null;

            const rows = await queryDeathMemberRows({
                fromDate,
                toDate,
                branchIds,
                centerId,
                areaId,
                divisionId,
                regionId,
            });

            return successResponse(rows, 'Death member report fetched successfully');
        } catch (error) {
            console.error('[DeathMemberReport] Error:', error);
            return errorResponse('Failed to fetch death member report', 500);
        }
    })(request);
}
