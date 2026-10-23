import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { buildConfirmationLetterPdf } from '@/app/lib/reports/confirmation-letter-pdf';
import { toDisplayDate } from '@/app/lib/date-format';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/hr/confirmations/[id]/letter
 * Generates and streams the Confirmation Letter PDF directly to the browser on demand.
 * Avoids persistent cloud storage consumption.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-confirmation', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const confirmation = await prisma.employeeConfirmation.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        employeeId: true,
                        designation: { select: { name: true } },
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
            },
        });

        if (!confirmation) {
            return errorResponse('Confirmation request not found', 404);
        }

        if (confirmation.status !== 'APPROVED') {
            return errorResponse('Confirmation letter is only available for approved requests', 400);
        }

        const confirmationDateStr = toDisplayDate(confirmation.proposedConfirmationDate);
        const issueDateStr = confirmation.reviewedAt
            ? toDisplayDate(confirmation.reviewedAt)
            : toDisplayDate(new Date());

        const pdfBuffer = await buildConfirmationLetterPdf({
            refNo: `CNF-${confirmation.id.slice(-8).toUpperCase()}`,
            issueDate: issueDateStr,
            confirmationDate: confirmationDateStr,
            recipient: {
                employeeName: `${confirmation.employee.firstName} ${confirmation.employee.lastName}`,
                employeeCode: confirmation.employee.employeeId ?? 'N/A',
                designation: confirmation.employee.designation?.name ?? 'N/A',
                department: confirmation.employee.department?.name ?? 'N/A',
                branchName: confirmation.employee.branch?.name ?? 'N/A',
            },
        });

        const safeEmpCode = (confirmation.employee.employeeId || confirmation.id).replace(/[^a-zA-Z0-9_-]/g, '_');

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="confirmation-letter-${safeEmpCode}.pdf"`,
            },
        });
    } catch (error: unknown) {
        console.error('Error streaming confirmation letter:', error);
        const msg = error instanceof Error ? error.message : 'Failed to generate confirmation letter';
        return errorResponse(msg, 500);
    }
}

