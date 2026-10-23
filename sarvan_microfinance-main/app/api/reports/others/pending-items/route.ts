import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { startOfDay, endOfDay, format } from 'date-fns';
import { withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { getMeetingDayName, buildMeetingDayVariantOrFilter } from '@/app/lib/collections/meeting-day';
import { computeNextMeetingDateYmd, formatYmdToDmy } from '@/app/lib/collections/next-meeting-date';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
    try {
        const { searchParams } = new URL(req.url);
        const requestedBranchId = searchParams.get('branchId') || undefined;

        // This report's queries are all single-branch (scalar branchId, not an
        // `{ in: [...] }` scan across branches), so unlike other reports there's no
        // "all branches" aggregate — a branch must always be resolved to exactly one.
        const permitted = await getPermittedBranchIds(user);
        let branchId: string | null = null;
        if (permitted === null) {
            // Unrestricted Head Office ADMIN — must explicitly pick a branch.
            if (!requestedBranchId) {
                return NextResponse.json({ error: 'Please select a branch.' }, { status: 400 });
            }
            branchId = requestedBranchId;
        } else if (permitted.length === 1) {
            branchId = permitted[0];
        } else if (permitted.length > 1) {
            // AREA_MANAGER with multiple assigned branches — never default to an
            // arbitrary one, and never honor a branchId outside their assignment.
            if (!requestedBranchId) {
                return NextResponse.json({ error: 'Please select a branch.' }, { status: 400 });
            }
            if (!permitted.includes(requestedBranchId)) {
                return NextResponse.json({ error: 'Branch not permitted.' }, { status: 403 });
            }
            branchId = requestedBranchId;
        }
        if (!branchId) {
            return NextResponse.json({ error: 'No branch context found.' }, { status: 400 });
        }

        const issueType = searchParams.get('issueType');

        if (!issueType) {
            return NextResponse.json({ error: 'Issue type is required.' }, { status: 400 });
        }

        // Get Current Working Date
        const branchLock = await prisma.branchLock.findUnique({
            where: { branchId }
        });
        const workingDate = branchLock ? startOfDay(new Date(branchLock.currentWorkingDate)) : startOfDay(new Date());
        const dayStart = startOfDay(workingDate);
        const dayEnd = endOfDay(workingDate);

        let results: any[] = [];

        switch (issueType) {
            case 'center_meeting': {
                // Centers scheduled for today (by meeting day, matched case/variant-insensitively)
                const meetingDayName = getMeetingDayName(getKolkataCalendarYmd(workingDate));
                const scheduledCenters = await prisma.center.findMany({
                    where: {
                        branchId,
                        isActive: true,
                        status: 'APPROVED',
                        ...buildMeetingDayVariantOrFilter(meetingDayName),
                    },
                    include: {
                        fdo: {
                            select: { firstName: true, lastName: true }
                        }
                    }
                });

                const centerIds = scheduledCenters.map(c => c.id);

                // Centers that HAVE transactions today
                const centersWithTransactions = await prisma.loanTransaction.findMany({
                    where: {
                        centerId: { in: centerIds },
                        transactionDate: { gte: dayStart, lte: dayEnd },
                        type: { in: ['REPAYMENT', 'INTEREST_POSTING'] }
                    },
                    select: { centerId: true },
                    distinct: ['centerId']
                });

                const centersWithActionIds = new Set(centersWithTransactions.map(t => t.centerId));

                results = scheduledCenters
                    .filter(c => !centersWithActionIds.has(c.id))
                    .map(c => ({
                        centerId: c.code,
                        centerName: c.name,
                        fdo: c.fdo ? `${c.fdo.firstName} ${c.fdo.lastName}` : 'Unassigned',
                        meetingDay: c.meetingDay,
                        meetingTime: c.meetingTime,
                        nextMeetingDate: (() => {
                            const ymd = computeNextMeetingDateYmd(c.meetingDay, workingDate);
                            return ymd ? formatYmdToDmy(ymd) : 'N/A';
                        })()
                    }));
                break;
            }

            case 'center_approval': {
                const pendingCenters = await prisma.center.findMany({
                    where: { branchId, status: 'PENDING_APPROVAL' },
                    include: {
                        createdBy: { select: { firstName: true, lastName: true } }
                    }
                });

                results = pendingCenters.map(c => ({
                    centerId: c.code,
                    centerName: c.name,
                    fdo: `${c.createdBy.firstName} ${c.createdBy.lastName}`,
                    meetingDay: c.meetingDay,
                    meetingTime: c.meetingTime,
                    nextMeetingDate: c.createdAt ? format(c.createdAt, 'dd/MM/yyyy') : 'N/A'
                }));
                break;
            }

            case 'member_approval': {
                const pendingClients = await prisma.client.findMany({
                    where: {
                        center: { branchId },
                        verificationStatus: 'PENDING_VERIFICATION'
                    },
                    include: {
                        center: true,
                        enrolledBy: true
                    }
                });

                results = pendingClients.map(c => ({
                    centerId: c.clientId,
                    centerName: c.firstName + ' ' + c.lastName,
                    fdo: `${c.enrolledBy.firstName} ${c.enrolledBy.lastName}`,
                    meetingDay: c.center?.name,
                    meetingTime: 'N/A',
                    nextMeetingDate: c.createdAt ? format(c.createdAt, 'dd/MM/yyyy') : 'N/A'
                }));
                break;
            }

            case 'loan_disbursement': {
                const pendingLoans = await prisma.loan.findMany({
                    where: {
                        branchId,
                        disbursementStatus: { in: ['PENDING_LEVEL1', 'PENDING_LEVEL2'] }
                    },
                    include: {
                        client: true,
                        center: true
                    }
                });

                results = pendingLoans.map(l => ({
                    centerId: l.loanNumber,
                    centerName: l.client.firstName + ' ' + l.client.lastName,
                    fdo: l.center?.name,
                    meetingDay: new Intl.NumberFormat('en-IN').format(l.amount.toNumber()),
                    meetingTime: l.disbursementStatus,
                    nextMeetingDate: l.createdAt ? format(l.createdAt, 'dd/MM/yyyy') : 'N/A'
                }));
                break;
            }

            case 'session_out': {
                // Type cast to any due to Prisma sync issues resolving include types
                const activeSessions: any[] = await prisma.attendance.findMany({
                    where: {
                        date: { gte: dayStart, lte: dayEnd },
                        status: { in: ['PRESENT', 'HALF_DAY'] },
                        checkOut: null,
                        user: { branchId }
                    },
                    include: {
                        user: true
                    }
                });

                results = activeSessions.map(s => ({
                    centerId: s.user.email.split('@')[0], // Using email prefix as ID if no employee ID
                    centerName: `${s.user.firstName} ${s.user.lastName}`,
                    fdo: s.user.role,
                    meetingDay: s.checkIn ? format(s.checkIn, 'hh:mm a') : 'N/A',
                    meetingTime: s.status,
                    nextMeetingDate: format(s.date, 'dd/MM/yyyy')
                }));
                break;
            }

            case 'preclosure_approval': {
                // Implementation for preclosure approval if tracked
                results = []; // Placeholder
                break;
            }

            default:
                results = [];
        }

        return NextResponse.json({ success: true, data: results });

    } catch (error: any) {
        console.error('Pending Items Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
    })(request);
}
