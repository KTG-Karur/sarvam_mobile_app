import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
    const tx = {
        employeePromotion: { findUnique: vi.fn(), update: vi.fn() },
        user: { update: vi.fn() },
        designation: { findUnique: vi.fn() },
        role: { findFirst: vi.fn() },
        userRoleAssignment: { findFirst: vi.fn(), create: vi.fn() },
        employeeCtcMaster: { findUnique: vi.fn(), upsert: vi.fn() },
        employeeCtcHistory: { create: vi.fn() },
    };
    return {
        tx,
        prisma: {
            employeePromotion: { findUnique: vi.fn() },
            $transaction: vi.fn(),
        },
    };
});
vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/reports/promotion-letter-pdf', () => ({ buildPromotionLetterPdf: vi.fn().mockResolvedValue(Buffer.from('pdf')) }));
vi.mock('@/app/lib/storage/hr-letter-storage', () => ({ uploadHrLetter: vi.fn().mockResolvedValue('https://example.com/letter.pdf') }));
vi.mock('@/app/lib/rbac-role-sync', () => ({ syncUserLegacyRoleFromActiveAssignments: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/app/lib/permissions/engine', () => ({ invalidateUserPermissions: vi.fn().mockResolvedValue(undefined) }));

import { executePromotionSideEffects } from './promotion-side-effects';

const baseParams = {
    promotionId: 'promo1',
    employeeId: 'emp1',
    employeeFirstName: 'Jane',
    employeeLastName: 'Doe',
    employeeCode: 'ST001',
    departmentName: 'Operations',
    branchName: 'Head Office',
    toDesignationName: 'Senior FDO',
    actorUserId: 'actor1',
};

const basePromotion = {
    id: 'promo1',
    status: 'PENDING',
    toDesignationId: 'desig2',
    toMonthlyCtc: null as number | null,
    fromMonthlyCtc: null as number | null,
    effectiveDate: new Date('2026-10-01'),
};

beforeEach(() => {
    vi.resetAllMocks();
    db.prisma.$transaction.mockImplementation(async (cb: (tx: typeof db.tx) => unknown) => cb(db.tx));
    db.tx.designation.findUnique.mockResolvedValue({ defaultRoleSlug: null });
    db.tx.employeePromotion.update.mockResolvedValue({ id: 'promo1', status: 'APPROVED' });
});

describe('executePromotionSideEffects', () => {
    it('throws if the promotion no longer exists', async () => {
        db.prisma.employeePromotion.findUnique.mockResolvedValue(null);
        await expect(executePromotionSideEffects(baseParams)).rejects.toThrow('Promotion request not found');
    });

    it('re-checks status inside the transaction and rejects a concurrently-changed promotion', async () => {
        db.prisma.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.employeePromotion.findUnique.mockResolvedValue({ ...basePromotion, status: 'REJECTED' });
        await expect(executePromotionSideEffects(baseParams)).rejects.toThrow('status changed');
        expect(db.tx.user.update).not.toHaveBeenCalled();
    });

    it('updates the designation but writes no CTC row when toMonthlyCtc is null (title-only promotion)', async () => {
        db.prisma.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.employeePromotion.findUnique.mockResolvedValue(basePromotion);

        await executePromotionSideEffects(baseParams);

        expect(db.tx.user.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'emp1' }, data: { designationId: 'desig2' } });
        expect(db.tx.employeeCtcMaster.upsert).not.toHaveBeenCalled();
        expect(db.tx.employeeCtcHistory.create).not.toHaveBeenCalled();
        expect(db.tx.employeePromotion.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            where: { id: 'promo1' },
            data: expect.objectContaining({ status: 'APPROVED', reviewedById: 'actor1' }),
        }));
    });

    it('upserts EmployeeCtcMaster and logs history when toMonthlyCtc is set', async () => {
        const promotionWithCtc = { ...basePromotion, toMonthlyCtc: 60000, fromMonthlyCtc: 50000 };
        db.prisma.employeePromotion.findUnique.mockResolvedValue(promotionWithCtc);
        db.tx.employeePromotion.findUnique.mockResolvedValue(promotionWithCtc);
        db.tx.employeeCtcMaster.findUnique.mockResolvedValue({ monthlyCtc: 50000 });

        await executePromotionSideEffects(baseParams);

        expect(db.tx.employeeCtcMaster.upsert).toHaveBeenCalledExactlyOnceWith({
            where: { employeeId: 'emp1' },
            update: { monthlyCtc: 60000, updatedById: 'actor1' },
            create: { employeeId: 'emp1', monthlyCtc: 60000, updatedById: 'actor1' },
        });
        expect(db.tx.employeeCtcHistory.create).toHaveBeenCalledExactlyOnceWith({
            data: {
                employeeId: 'emp1',
                fromMonthlyCtc: 50000,
                toMonthlyCtc: 60000,
                effectiveDate: promotionWithCtc.effectiveDate,
                source: 'PROMOTION',
                promotionId: 'promo1',
                changedById: 'actor1',
            },
        });
    });

    it('records a null "from" when the employee has no EmployeeCtcMaster row yet (first-ever CTC)', async () => {
        const promotionWithCtc = { ...basePromotion, toMonthlyCtc: 45000, fromMonthlyCtc: null };
        db.prisma.employeePromotion.findUnique.mockResolvedValue(promotionWithCtc);
        db.tx.employeePromotion.findUnique.mockResolvedValue(promotionWithCtc);
        db.tx.employeeCtcMaster.findUnique.mockResolvedValue(null);

        await executePromotionSideEffects(baseParams);

        expect(db.tx.employeeCtcHistory.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            data: expect.objectContaining({ fromMonthlyCtc: null, toMonthlyCtc: 45000 }),
        }));
    });

    it('grants the target designation\'s default role additively when not already assigned', async () => {
        db.prisma.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.designation.findUnique.mockResolvedValue({ defaultRoleSlug: 'senior-fdo' });
        db.tx.role.findFirst.mockResolvedValue({ id: 'role1' });
        db.tx.userRoleAssignment.findFirst.mockResolvedValue(null);

        await executePromotionSideEffects(baseParams);

        expect(db.tx.userRoleAssignment.create).toHaveBeenCalledExactlyOnceWith({
            data: { userId: 'emp1', roleId: 'role1', branchId: null, assignedBy: 'actor1', isActive: true },
        });
    });

    it('does not duplicate the role assignment if already active', async () => {
        db.prisma.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.employeePromotion.findUnique.mockResolvedValue(basePromotion);
        db.tx.designation.findUnique.mockResolvedValue({ defaultRoleSlug: 'senior-fdo' });
        db.tx.role.findFirst.mockResolvedValue({ id: 'role1' });
        db.tx.userRoleAssignment.findFirst.mockResolvedValue({ id: 'existing' });

        await executePromotionSideEffects(baseParams);

        expect(db.tx.userRoleAssignment.create).not.toHaveBeenCalled();
    });
});
