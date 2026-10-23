import { prisma } from '@/app/lib/prisma';

const MAX_ATTEMPTS = 5;

/**
 * 6-digit sequential display ID for ReportRequest, e.g. "000042" — follows
 * the same no-sequence-table, retry-on-collision precedent as
 * generateLoanNumber() (app/lib/services/loan.service.ts), but looks up only
 * the current max via `findFirst` (desc order) instead of scanning every row,
 * since a fixed-width zero-padded string sorts identically to its numeric value.
 */
export async function generateReportRequestId(attempt = 0): Promise<string> {
    const last = await prisma.reportRequest.findFirst({
        orderBy: { requestId: 'desc' },
        select: { requestId: true },
    });
    const lastNum = last && /^\d+$/.test(last.requestId) ? parseInt(last.requestId, 10) : 0;
    const requestId = (lastNum + 1).toString().padStart(6, '0');

    const exists = await prisma.reportRequest.findUnique({ where: { requestId }, select: { id: true } });
    if (exists) {
        if (attempt >= MAX_ATTEMPTS) {
            throw new Error('Failed to generate a unique report request ID after multiple attempts');
        }
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 100));
        return generateReportRequestId(attempt + 1);
    }
    return requestId;
}
