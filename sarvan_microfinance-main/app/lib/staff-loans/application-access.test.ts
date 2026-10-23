import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, branchScope } = vi.hoisted(() => ({
    db: { user: { findUnique: vi.fn() }, role: { findMany: vi.fn() }, staffLoan: {} },
    branchScope: { getPermittedBranchIds: vi.fn() },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/api-utils', () => ({
    withAuth: (handler: (req: unknown, session: { userId: string }) => unknown) => (req: unknown) => handler(req, { userId: 'u1' }),
    errorResponse: (message: string, status: number) => ({ message, status }),
}));
vi.mock('@/app/lib/permissions/branch-scope', () => branchScope);
vi.mock('@/app/lib/head-office-branch', () => ({ isHeadOfficeBranch: vi.fn(async (id: string) => id === 'ho') }));
vi.mock('./configuration-api', () => ({ configurationError: (error: unknown) => { throw error; } }));

import { registerScope, roleBranchScope, withStaffLoanActor, type StaffLoanActor } from './application-access';

const loadActor = async (): Promise<StaffLoanActor> => {
    let captured: StaffLoanActor | undefined;
    await withStaffLoanActor(async (_req, actor) => { captured = actor; return {} as never; })({} as never);
    return captured!;
};

beforeEach(() => {
    vi.resetAllMocks();
    branchScope.getPermittedBranchIds.mockResolvedValue(['b1']);
    db.role.findMany.mockResolvedValue([]);
});

describe('withStaffLoanActor role assignments', () => {
    it('keeps a branch role assignment pinned to its branch', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'BRANCH_MANAGER', branchId: 'b1', userRoles: [{ roleId: 'bm', branchId: 'b1', role: { slug: 'bm', pagePermissions: null } }] });
        expect((await loadActor()).assignments).toEqual([{ roleId: 'bm', branchId: 'b1', pagePermissions: null }]);
    });

    it('treats an explicit Head Office assignment as company-wide, so an HO approver can act on any branch', async () => {
        branchScope.getPermittedBranchIds.mockResolvedValue(null);
        db.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'AREA_MANAGER', branchId: 'ho', userRoles: [{ roleId: 'am', branchId: 'ho', role: { slug: 'am', pagePermissions: null } }] });
        expect((await loadActor()).assignments).toEqual([{ roleId: 'am', branchId: null, pagePermissions: null }]);
    });

    it('treats the implicit role of an HO-based user as company-wide, not pinned to the HO branch', async () => {
        branchScope.getPermittedBranchIds.mockResolvedValue(null);
        db.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'AREA_MANAGER', branchId: 'ho', userRoles: [] });
        db.role.findMany.mockResolvedValue([{ id: 'am-role', slug: 'area-manager', pagePermissions: null }]);
        expect((await loadActor()).assignments).toEqual([{ roleId: 'am-role', branchId: null, pagePermissions: null }]);
    });

    it('keeps the implicit role of a branch user pinned to their own branch', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'u1', isActive: true, role: 'BRANCH_MANAGER', branchId: 'b1', userRoles: [] });
        db.role.findMany.mockResolvedValue([{ id: 'bm-role', slug: 'branch-manager', pagePermissions: null }]);
        expect((await loadActor()).assignments).toEqual([{ roleId: 'bm-role', branchId: 'b1', pagePermissions: null }]);
    });
});

describe('scope helpers with a company-wide assignment', () => {
    const actor = (over: Partial<StaffLoanActor>): StaffLoanActor => ({ userId: 'u1', isAdmin: false, branchIds: null, assignments: [], ...over });

    it('does not put an empty filter inside an OR list: a global role assignment adds no branch restriction', () => {
        expect(roleBranchScope(actor({ assignments: [{ roleId: 'r', branchId: null, pagePermissions: null }] }), 'r')).toEqual({});
        expect(roleBranchScope(actor({ branchIds: ['b1', 'b2'], assignments: [{ roleId: 'r', branchId: null, pagePermissions: null }] }), 'r')).toEqual({ branchId: { in: ['b1', 'b2'] } });
    });

    it('limits a branch role assignment to its own branch inside the permitted ones', () => {
        expect(roleBranchScope(actor({ branchIds: ['b1', 'b2'], assignments: [{ roleId: 'r', branchId: 'b2', pagePermissions: null }] }), 'r'))
            .toEqual({ AND: [{ branchId: { in: ['b1', 'b2'] } }, { branchId: { in: ['b2'] } }] });
        expect(roleBranchScope(actor({}), 'other')).toBeNull();
    });

    it('gives the register the plain branch scope for an admin', () => {
        expect(registerScope(actor({ isAdmin: true }))).toEqual({});
    });
});
