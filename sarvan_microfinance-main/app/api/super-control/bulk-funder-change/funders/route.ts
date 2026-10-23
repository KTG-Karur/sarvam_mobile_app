import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { legacyLedgerLoanIds } from '@/app/lib/services/legacy-ledger-loans';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const norm = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * GET /api/super-control/bulk-funder-change/funders?branchId=
 * EVERY funder (active or not, uncached) with how many live/closed loans of the branch it finances,
 * plus any older / misspelt names its GL principal ledger carries (e.g. "OWN FUND GOLD" for
 * "Own Fund - Gold"), so the admin can pick the right source funder.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const branchId = (new URL(req.url).searchParams.get('branchId') || '').trim();
            const [funders, counts, ledgers] = await Promise.all([
                prisma.funder.findMany({
                    select: { id: true, funderId: true, funderName: true, isActive: true },
                    orderBy: { funderName: 'asc' },
                }),
                branchId
                    ? prisma.loan.groupBy({
                          by: ['funderId'],
                          where: { branchId, funderId: { not: null }, disbursementStatus: { in: ['DISBURSED', 'CLOSED'] } },
                          _count: { _all: true },
                      })
                    : Promise.resolve([]),
                prisma.accountLedger.findMany({ where: { ledgerName: { endsWith: 'PRINCIPAL', mode: 'insensitive' } }, select: { ledgerName: true } }),
            ]);
            const countBy = new Map(counts.map((c) => [c.funderId, c._count._all]));
            const result = [];
            for (const f of funders) {
                const aliases = [
                    ...new Set(
                        ledgers
                            .map((l) => l.ledgerName.replace(/\s*PRINCIPAL\s*$/i, ''))
                            .filter((n) => norm(n) === norm(f.funderName) && n.toUpperCase() !== f.funderName.toUpperCase())
                    ),
                ];
                let loanCount = countBy.get(f.id) ?? 0;
                const aliasCounts: Record<string, number> = {};
                if (branchId) {
                    for (const a of aliases) {
                        aliasCounts[a] = (await legacyLedgerLoanIds(branchId, null, a)).size;
                        loanCount -= (await legacyLedgerLoanIds(branchId, f.id, a)).size;
                    }
                }
                result.push({ ...f, loanCount: Math.max(0, loanCount), aliases, aliasCounts });
            }
            return successResponse(result);
        } catch (error) {
            console.error('[super-control bulk-funder-change/funders] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch funders', 500);
        }
    })(request);
}
