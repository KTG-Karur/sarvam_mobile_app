import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { buildPromotionLetterPdf } from '@/app/lib/reports/promotion-letter-pdf';
import { toDisplayDate } from '@/app/lib/date-format';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/hr/promotions/[id]/letter
 * Generates and streams the Promotion Letter PDF directly to the browser on demand.
 * Avoids persistent cloud storage consumption.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-promotion', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const promotion = await prisma.employeePromotion.findUnique({
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
                fromDesignation: { select: { name: true } },
                toDesignation: { select: { name: true } },
            },
        });

        if (!promotion) {
            return errorResponse('Promotion request not found', 404);
        }

        if (promotion.status !== 'APPROVED') {
            return errorResponse('Promotion letter is only available for approved requests', 400);
        }

        const effectiveDateStr = toDisplayDate(promotion.effectiveDate);
        const issueDateStr = promotion.reviewedAt
            ? toDisplayDate(promotion.reviewedAt)
            : toDisplayDate(new Date());

        const pdfBuffer = await buildPromotionLetterPdf({
            refNo: `PRM-${promotion.id.slice(-8).toUpperCase()}`,
            issueDate: issueDateStr,
            toDesignationName: promotion.toDesignation.name,
            effectiveDate: effectiveDateStr,
            recipient: {
                employeeName: `${promotion.employee.firstName} ${promotion.employee.lastName}`,
                employeeCode: promotion.employee.employeeId ?? 'N/A',
                designation: promotion.fromDesignation?.name ?? promotion.employee.designation?.name ?? 'N/A',
                department: promotion.employee.department?.name ?? 'N/A',
                branchName: promotion.employee.branch?.name ?? 'N/A',
            },
        });

        const safeEmpCode = (promotion.employee.employeeId || promotion.id).replace(/[^a-zA-Z0-9_-]/g, '_');

        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="promotion-letter-${safeEmpCode}.pdf"`,
            },
        });
    } catch (error: unknown) {
        console.error('Error streaming promotion letter:', error);
        const msg = error instanceof Error ? error.message : 'Failed to generate promotion letter';
        return errorResponse(msg, 500);
    }
}

