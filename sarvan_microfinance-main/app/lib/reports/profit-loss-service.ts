import { prisma } from '@/app/lib/prisma';
import { computeTrialBalanceRows } from '@/app/api/reports/trial-balance/route';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import {
    buildProfitLoss,
    resolveProfitLossWindow,
    type ProfitLossReport,
    type ProfitLossReportMode,
} from '@/app/lib/reports/profit-loss';

export class ProfitLossBranchError extends Error {}

/**
 * Single source for the web view and all three downloads. Reuses the Trial Balance engine's
 * RANGE mode (approved + active vouchers only, per-branch opening-date cut-over, self-account
 * bridges) and reads only its period Dr/Cr movement, so the P&L reconciles with the Trial
 * Balance for the same branch and window.
 *
 * `branchIds: null` = unrestricted (already authorised by the caller).
 */
export async function computeProfitLossReport(params: {
    mode: ProfitLossReportMode;
    fromDate?: string | null;
    toDate?: string | null;
    asOnDate?: string | null;
    branchIds: string[] | null;
}): Promise<ProfitLossReport> {
    const window = resolveProfitLossWindow(params);

    let branchLabel = 'All Branches';
    let branchCode = 'ALL';
    if (params.branchIds && params.branchIds.length === 1) {
        const branch = await prisma.branch.findUnique({
            where: { id: params.branchIds[0] },
            select: { code: true, name: true },
        });
        if (!branch) throw new ProfitLossBranchError('Selected branch was not found');
        branchLabel = `${branch.code} - ${branch.name}`;
        branchCode = branch.code;
    }

    const [rows, brand] = await Promise.all([
        computeTrialBalanceRows({
            reportType: 'RANGE',
            fromDateStr: window.fromDate,
            toDateStr: window.toDate,
            scopedBranchIds: params.branchIds,
        }),
        getActiveBrandNames(),
    ]);

    return buildProfitLoss(rows, {
        companyName: brand.companyNameFull,
        branchLabel,
        branchCode,
        mode: params.mode,
        fromDate: window.fromDate,
        toDate: window.toDate,
        asOnDate: params.mode === 'AS_ON' ? window.toDate : undefined,
        generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    });
}
