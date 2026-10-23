import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { endOfDay } from 'date-fns';
import { cookies } from 'next/headers';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * Cookie-free core, split out of the GET handler below so the Request Report queue's
 * PDF renderer (app/lib/reports/center-master-summary-pdf-queue.ts) can call it directly
 * without a request/session context. Takes an already-resolved branchId (the live route's
 * role-based branch resolution/AM-access check stays in GET below, since it needs `user`).
 */
export async function computeCenterMasterSummary(branchId: string, reportDateStr: string) {
    const reportDate = endOfDay(new Date(reportDateStr));
    if (isNaN(reportDate.getTime())) {
        throw new Error('Invalid date format');
    }

    const centers = await prisma.center.findMany({
        where: {
            branchId,
            isActive: true,
            status: 'APPROVED',
        },
        include: {
            branch: {
                select: { id: true, code: true, name: true },
            },
            fdo: {
                select: { id: true, firstName: true, lastName: true },
            },
            centerLeader: {
                select: { id: true, firstName: true, lastName: true },
            },
        },
        orderBy: { code: 'asc' },
    });

    // Fetch loans separately for each center to avoid complex nested queries
    const reportData = await Promise.all(centers.map(async (center) => {
        // Get all clients in this center
        const clients = await prisma.client.findMany({
            where: {
                centerId: center.id,
                isActive: true,
            },
            select: {
                id: true,
                loanApplications: {
                    where: {
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        createdAt: { lte: reportDate },
                    },
                    select: {
                        id: true,
                        amount: true,
                        principalPaid: true,
                        interestPaid: true,
                        disbursementStatus: true,
                        schedules: {
                            where: { dueDate: { lte: reportDate } },
                            select: {
                                status: true,
                                principalDue: true,
                                principalPaid: true,
                                interestDue: true,
                                interestPaid: true,
                            },
                        },
                    },
                },
            },
        });

        let noOfMember = clients.length;
        let activeClients = 0;
        let waitingBorrower = 0;
        let osPrincipal = 0;
        let arrearMembers = 0;
        let arrearAmount = 0;
        let arrearMemOS = 0;

        for (const client of clients) {
            const activeLoans = client.loanApplications ?? [];

            if (activeLoans.length > 0) {
                activeClients++;
            } else {
                waitingBorrower++;
            }

            let clientOS = 0;
            let clientArrear = 0;

            for (const loan of activeLoans) {
                const loanOS = Math.max(0, Number(loan.amount) - Number(loan.principalPaid ?? 0));
                clientOS += loanOS;
                osPrincipal += loanOS;

                for (const sch of loan.schedules ?? []) {
                    if (sch.status !== 'PAID') {
                        const unpaidPri = Math.max(0, Number(sch.principalDue) - Number(sch.principalPaid ?? 0));
                        const unpaidInt = Math.max(0, Number(sch.interestDue) - Number(sch.interestPaid ?? 0));
                        clientArrear += unpaidPri + unpaidInt;
                    }
                }
            }

            if (clientArrear > 0) {
                arrearMembers++;
                arrearAmount += clientArrear;
                arrearMemOS += clientOS;
            }
        }

        const par = osPrincipal > 0 ? (arrearMemOS / osPrincipal) * 100 : 0;

        const fdo = center.fdo;
        const fdoName = fdo ? `${fdo.firstName} ${fdo.lastName}`.trim() : 'Unassigned';

        return {
            ourBranchID: center.branch.code,
            centreID: center.code,
            centreName: center.name,
            visitDate: center.nextMeetingDate
                ? new Date(center.nextMeetingDate).toISOString().split('T')[0]
                : reportDateStr,
            fdoName,
            meetingDay: center.meetingDay || '-',
            meetingTime: center.meetingTime || '-',
            fromBranch: center.branch.name,
            fromDO: fdoName,
            contactPerson: center.contactPerson ?? '',
            contactPersonNumber: center.contactNumber ?? '',
            kmFromBranch: center.kmFromBranch ?? null,
            noOfMember,
            activeClients,
            osPrincipal: Math.round(osPrincipal),
            arrearMembers,
            arrearAmount: Math.round(arrearAmount),
            arrearMemOS: Math.round(arrearMemOS),
            waitingBorrower,
            par: parseFloat(par.toFixed(2)),
        };
    }));

    return reportData;
}

/**
 * GET /api/reports/portfolio/center-master
 * Center Master Report – per-center portfolio statistics, filtered by branch.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const reportDateStr = searchParams.get('date');
            let branchId = searchParams.get('branchId') || '';

            if (!reportDateStr) {
                return errorResponse('Report date is required', 400);
            }
            if (isNaN(endOfDay(new Date(reportDateStr)).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            // Branch resolution
            if (user.role === 'BRANCH_MANAGER') {
                branchId = user.branchId ?? '';
            } else if (user.role === 'ADMIN' || user.role === 'AREA_MANAGER') {
                if (!branchId) {
                    const cookieStore = await cookies();
                    const activeBranch = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
                    if (activeBranch) branchId = activeBranch;
                }
            }

            if (!branchId) {
                return errorResponse('Branch selection is required', 400);
            }

            // Validate AM branch access
            if (user.role === 'AREA_MANAGER') {
                const amBranches = await prisma.areaManagerBranch.findMany({
                    where: { userId: user.userId },
                    select: { branchId: true },
                });
                const allowedIds = amBranches.map(b => b.branchId);
                if (!allowedIds.includes(branchId)) {
                    return errorResponse('Branch not allocated to this Area Manager', 403);
                }
            }

            const reportData = await computeCenterMasterSummary(branchId, reportDateStr);

            return successResponse(reportData, 'Center master report retrieved successfully');
        } catch (error) {
            console.error('Center master report error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch center master report',
                500
            );
        }
    })(request);
}
