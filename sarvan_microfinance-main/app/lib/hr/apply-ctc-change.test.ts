import { describe, expect, it, vi } from 'vitest';
import { applyCtcChange } from './apply-ctc-change';

function makeTx() {
    return {
        employeeCtcMaster: { findUnique: vi.fn(), upsert: vi.fn() },
        employeeCtcHistory: { create: vi.fn() },
    } as any;
}

describe('applyCtcChange', () => {
    it('creates the first-ever CTC master row and a null-from history row (Onboarding case)', async () => {
        const tx = makeTx();
        tx.employeeCtcMaster.findUnique.mockResolvedValue(null);

        const changed = await applyCtcChange(tx, {
            employeeId: 'emp1', newMonthlyCtc: 30000, source: 'ONBOARDING',
            effectiveDate: new Date('2026-01-01'), actorUserId: 'actor1',
        });

        expect(changed).toBe(true);
        expect(tx.employeeCtcMaster.upsert).toHaveBeenCalledExactlyOnceWith({
            where: { employeeId: 'emp1' },
            update: { monthlyCtc: 30000, updatedById: 'actor1' },
            create: { employeeId: 'emp1', monthlyCtc: 30000, updatedById: 'actor1' },
        });
        expect(tx.employeeCtcHistory.create).toHaveBeenCalledExactlyOnceWith({
            data: {
                employeeId: 'emp1', fromMonthlyCtc: null, toMonthlyCtc: 30000,
                effectiveDate: new Date('2026-01-01'), source: 'ONBOARDING', promotionId: undefined,
                changedById: 'actor1',
            },
        });
    });

    it('records the previous CTC as "from" on a manual edit', async () => {
        const tx = makeTx();
        tx.employeeCtcMaster.findUnique.mockResolvedValue({ monthlyCtc: 25000 });

        await applyCtcChange(tx, {
            employeeId: 'emp1', newMonthlyCtc: 32000, source: 'MANUAL_EDIT',
            effectiveDate: new Date('2026-06-15'), actorUserId: 'actor2',
        });

        expect(tx.employeeCtcHistory.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({ fromMonthlyCtc: 25000, toMonthlyCtc: 32000, source: 'MANUAL_EDIT' }),
        }));
    });

    it('is a no-op when the new amount matches the current one — no history spam on re-save', async () => {
        const tx = makeTx();
        tx.employeeCtcMaster.findUnique.mockResolvedValue({ monthlyCtc: 40000 });

        const changed = await applyCtcChange(tx, {
            employeeId: 'emp1', newMonthlyCtc: 40000, source: 'MANUAL_EDIT',
            effectiveDate: new Date(), actorUserId: 'actor1',
        });

        expect(changed).toBe(false);
        expect(tx.employeeCtcMaster.upsert).not.toHaveBeenCalled();
        expect(tx.employeeCtcHistory.create).not.toHaveBeenCalled();
    });

    it('links the history row to the promotion when source is PROMOTION', async () => {
        const tx = makeTx();
        tx.employeeCtcMaster.findUnique.mockResolvedValue({ monthlyCtc: 40000 });

        await applyCtcChange(tx, {
            employeeId: 'emp1', newMonthlyCtc: 50000, source: 'PROMOTION',
            effectiveDate: new Date('2026-11-01'), actorUserId: 'reviewer1', promotionId: 'promo1',
        });

        expect(tx.employeeCtcHistory.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({ promotionId: 'promo1', source: 'PROMOTION' }),
        }));
    });
});
