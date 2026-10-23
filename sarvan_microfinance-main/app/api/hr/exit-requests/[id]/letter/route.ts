import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { buildRelievingLetterPdf } from '@/app/lib/reports/relieving-letter-pdf';
import { toDisplayDate } from '@/app/lib/date-format';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/hr/exit-requests/[id]/letter
 * Generates and streams the Relieving Letter PDF directly to the browser on demand.
 * Avoids persistent cloud storage consumption.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-exit', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const exitRequest = await prisma.employeeExitRequest.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        employeeId: true,
                        dateOfJoining: true,
                        designation: { select: { name: true } },
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
            },
        });

        if (!exitRequest) {
            return errorResponse('Exit request not found', 404);
        }

        if (exitRequest.status !== 'HR_APPROVED' && exitRequest.status !== 'COMPLETED') {
            return errorResponse('Relieving letter is only available for approved exit requests', 400);
        }

        const dojStr = exitRequest.employee.dateOfJoining
            ? toDisplayDate(exitRequest.employee.dateOfJoining)
            : 'N/A';
        const lwdStr = toDisplayDate(exitRequest.lastWorkingDate);
        const issueDateStr = exitRequest.finalHrApprovedAt
            ? toDisplayDate(exitRequest.finalHrApprovedAt)
            : toDisplayDate(new Date());

        const pdfBuffer = await buildRelievingLetterPdf({
            refNo: `REL-${exitRequest.id.slice(-8).toUpperCase()}`,
            issueDate: issueDateStr,
            dateOfJoining: dojStr,
            lastWorkingDate: lwdStr,
            exitTypeLabel: exitRequest.exitType.replace('_', ' '),
            recipient: {
                employeeName: `${exitRequest.employee.firstName} ${exitRequest.employee.lastName}`,
                employeeCode: exitRequest.employee.employeeId ?? 'N/A',
                designation: exitRequest.employee.designation?.name ?? 'N/A',
                department: exitRequest.employee.department?.name ?? 'N/A',
                branchName: exitRequest.employee.branch?.name ?? 'N/A',
            },
        });

        const safeEmpCode = (exitRequest.employee.employeeId || exitRequest.id).replace(/[^a-zA-Z0-9_-]/g, '_');

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="relieving-letter-${safeEmpCode}.pdf"`,
            },
        });
    } catch (error: unknown) {
        console.error('Error streaming relieving letter:', error);
        const msg = error instanceof Error ? error.message : 'Failed to generate relieving letter';
        return errorResponse(msg, 500);
    }
}

