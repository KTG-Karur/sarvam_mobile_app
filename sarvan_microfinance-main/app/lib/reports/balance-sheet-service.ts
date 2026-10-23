import { prisma } from '@/app/lib/prisma';
import { computeTrialBalanceRows } from '@/app/api/reports/trial-balance/route';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { buildBalanceSheet, type BalanceSheetMode, type BalanceSheetReport } from '@/app/lib/reports/balance-sheet';
import { ProfitLossBranchError } from '@/app/lib/reports/profit-loss-service';

/**
 * Single source for the web view, PDF and Excel. Uses the Trial Balance engine in AS_ON mode
 * (approved + active vouchers, per-branch opening-date cut-over, seeded opening balances,
 * Cash/Bank self-account bridging) and reads its cumulative closing balances.
 *
 * `branchIds: null` = unrestricted (already authorised by the caller).
 */
export async function computeBalanceSheetReport(params: {
    asOnDate: string;
    mode: BalanceSheetMode;
    branchIds: string[] | null;
}): Promise<BalanceSheetReport> {
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
        computeTrialBalanceRows({ reportType: 'AS_ON', asOnDateStr: params.asOnDate, scopedBranchIds: params.branchIds }),
        getActiveBrandNames(),
    ]);

    return buildBalanceSheet(rows, {
        companyName: brand.companyNameFull,
        branchLabel,
        branchCode,
        mode: params.mode,
        asOnDate: params.asOnDate,
        generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    });
}
