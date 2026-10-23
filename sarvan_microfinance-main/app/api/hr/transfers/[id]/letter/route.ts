import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { buildTransferLetterPdf } from '@/app/lib/reports/transfer-letter-pdf';
import { toDisplayDate } from '@/app/lib/date-format';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/hr/transfers/[id]/letter
 * Generates and streams the Transfer Letter PDF directly to the browser on demand.
 * Avoids persistent cloud storage consumption.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-transfer', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const transfer = await prisma.employeeTransfer.findUnique({
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
                fromBranch: { select: { name: true } },
                toBranch: { select: { name: true } },
                fromArea: { select: { name: true } },
                toArea: { select: { name: true } },
                fromRegion: { select: { name: true } },
                toRegion: { select: { name: true } },
                fromDepartment: { select: { name: true } },
                toDepartment: { select: { name: true } },
            },
        });

        if (!transfer) {
            return errorResponse('Transfer request not found', 404);
        }

        if (transfer.status !== 'APPROVED') {
            return errorResponse('Transfer letter is only available for approved requests', 400);
        }

        let fromLocation = 'Previous Posting';
        let toLocation = 'New Posting';

        if (transfer.transferType === 'DEPARTMENT') {
            fromLocation = transfer.fromDepartment?.name ?? 'Previous Department';
            toLocation = transfer.toDepartment?.name ?? 'New Department';
        } else if (transfer.transferType === 'BRANCH') {
            fromLocation = transfer.fromBranch?.name ?? 'Previous Branch';
            toLocation = transfer.toBranch?.name ?? 'New Branch';
        } else if (transfer.transferType === 'AREA') {
            fromLocation = transfer.fromBranch?.name
                ? `${transfer.fromBranch.name} (${transfer.fromArea?.name ?? 'Area'})`
                : (transfer.fromArea?.name ?? 'Previous Area');
            toLocation = transfer.toBranch?.name
                ? `${transfer.toBranch.name} (${transfer.toArea?.name ?? 'Area'})`
                : (transfer.toArea?.name ?? 'New Area');
        } else if (transfer.transferType === 'REGION') {
            fromLocation = transfer.fromBranch?.name
                ? `${transfer.fromBranch.name} (${transfer.fromRegion?.name ?? 'Region'})`
                : (transfer.fromRegion?.name ?? 'Previous Region');
            toLocation = transfer.toBranch?.name
                ? `${transfer.toBranch.name} (${transfer.toRegion?.name ?? 'Region'})`
                : (transfer.toRegion?.name ?? 'New Region');
        }

        const effectiveDateStr = toDisplayDate(transfer.effectiveDate);
        const issueDateStr = transfer.completedAt
            ? toDisplayDate(transfer.completedAt)
            : toDisplayDate(new Date());

        const pdfBuffer = await buildTransferLetterPdf({
            refNo: `TRN-${transfer.id.slice(-8).toUpperCase()}`,
            issueDate: issueDateStr,
            transferType: transfer.transferType,
            effectiveDate: effectiveDateStr,
            fromLocation,
            toLocation,
            reason: transfer.reason,
            recipient: {
                employeeName: `${transfer.employee.firstName} ${transfer.employee.lastName}`,
                employeeCode: transfer.employee.employeeId ?? 'N/A',
                designation: transfer.employee.designation?.name ?? 'N/A',
                department: transfer.fromDepartment?.name ?? transfer.employee.department?.name ?? 'N/A',
                branchName: transfer.fromBranch?.name ?? transfer.employee.branch?.name ?? 'N/A',
            },
        });

        const safeEmpCode = (transfer.employee.employeeId || transfer.id).replace(/[^a-zA-Z0-9_-]/g, '_');

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="transfer-letter-${safeEmpCode}.pdf"`,
            },
        });
    } catch (error: unknown) {
        console.error('Error streaming transfer letter:', error);
        const msg = error instanceof Error ? error.message : 'Failed to generate transfer letter';
        return errorResponse(msg, 500);
    }
}

