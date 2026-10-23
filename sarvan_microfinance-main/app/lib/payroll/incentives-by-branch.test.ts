import { beforeEach, describe, expect, it, vi } from 'vitest';

const incentive = vi.hoisted(() => ({ getIncentiveReportData: vi.fn() }));
vi.mock('@/app/lib/services/incentive-report.service', () => incentive);
vi.mock('@/app/lib/db', () => ({ prisma: {} }));

import { resolveComputedIncentivesByBranch } from './calculation';

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('resolveComputedIncentivesByBranch', () => {
    it('runs the incentive engine once per branch (not once per FDO) and merges every FDO', async () => {
        incentive.getIncentiveReportData.mockImplementation(async (p: { branchId: string }) => ({
            data: p.branchId === 'b1' ? [{ fdoId: 'f1', finalIncentive: 100 }, { fdoId: 'f2', finalIncentive: 200 }] : [{ fdoId: 'f3', finalIncentive: 300 }],
        }));
        const { incentives, coveredBranchIds } = await resolveComputedIncentivesByBranch(9, 2026, ['b1', 'b1', 'b2', 'b1']);
        expect(incentive.getIncentiveReportData).toHaveBeenCalledTimes(2);
        expect(Object.fromEntries(incentives)).toEqual({ f1: 100, f2: 200, f3: 300 });
        expect([...coveredBranchIds].sort()).toEqual(['b1', 'b2']);
    });

    it('asks for the whole month of that branch only, with no paging cap', async () => {
        incentive.getIncentiveReportData.mockResolvedValue({ data: [] });
        await resolveComputedIncentivesByBranch(2, 2028, ['b1']);
        expect(incentive.getIncentiveReportData).toHaveBeenCalledWith(expect.objectContaining({
            fromDate: '2028-02-01', toDate: '2028-02-29', branchId: 'b1', scopedBranchIds: null, page: 1, pageSize: 100000,
        }));
    });

    it('a failing branch is left uncovered (so callers fall back) and the other branches still succeed', async () => {
        incentive.getIncentiveReportData.mockImplementation(async (p: { branchId: string }) => {
            if (p.branchId === 'bad') throw new Error('engine down');
            return { data: [{ fdoId: 'f1', finalIncentive: 50 }] };
        });
        const { incentives, coveredBranchIds } = await resolveComputedIncentivesByBranch(9, 2026, ['bad', 'good']);
        expect([...coveredBranchIds]).toEqual(['good']);
        expect(incentives.get('f1')).toBe(50);
    });

    it('never runs more branches at once than the concurrency limit', async () => {
        let running = 0;
        let peak = 0;
        incentive.getIncentiveReportData.mockImplementation(async () => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((r) => setTimeout(r, 3));
            running--;
            return { data: [] };
        });
        await resolveComputedIncentivesByBranch(9, 2026, Array.from({ length: 12 }, (_, i) => `b${i}`), 3);
        expect(peak).toBe(3);
    });

    it('with no branches does nothing', async () => {
        const { incentives, coveredBranchIds } = await resolveComputedIncentivesByBranch(9, 2026, []);
        expect(incentive.getIncentiveReportData).not.toHaveBeenCalled();
        expect(incentives.size + coveredBranchIds.size).toBe(0);
    });
});
