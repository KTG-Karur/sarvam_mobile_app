import { describe, expect, it } from 'vitest';
import { advanceCanApplyForOthers, advancePageScope, advanceRoleScope, isUnrestricted } from './access';
import { ADVANCE_APPROVAL_PAGE } from './advance';

const actor = (over: Record<string, unknown> = {}) => ({
    userId: 'u1', isAdmin: false, isHR: false, branchIds: ['b1'], assignments: [], ...over,
}) as any;

describe('advance access scopes', () => {
    it('admin sees everything (unrestricted) or is limited to their branches', () => {
        expect(isUnrestricted(advancePageScope(actor({ isAdmin: true, branchIds: null }), ADVANCE_APPROVAL_PAGE)!)).toBe(true);
        expect(advancePageScope(actor({ isAdmin: true, branchIds: ['b1'] }), ADVANCE_APPROVAL_PAGE)).toEqual({ branchId: { in: ['b1'] } });
    });

    it('a user with no grant on the page has no scope', () => {
        expect(advancePageScope(actor(), ADVANCE_APPROVAL_PAGE)).toBeNull();
    });

    it('a user without the role gets no role scope', () => {
        expect(advanceRoleScope(actor({ assignments: [{ roleId: 'r2', branchId: null, pagePermissions: {} }] }), 'r1')).toBeNull();
    });

    it('a global role assignment is only limited by the actor branch access', () => {
        const a = actor({ branchIds: null, assignments: [{ roleId: 'r1', branchId: null, pagePermissions: {} }] });
        expect(isUnrestricted(advanceRoleScope(a, 'r1')!)).toBe(true);
    });

    it('a branch-bound role assignment is limited to that branch', () => {
        const a = actor({ branchIds: ['b1', 'b2'], assignments: [{ roleId: 'r1', branchId: 'b2', pagePermissions: {} }] });
        expect(advanceRoleScope(a, 'r1')).toEqual({ AND: [{ branchId: { in: ['b1', 'b2'] } }, { branchId: { in: ['b2'] } }] });
    });

    it('only admin / HR (or an Advance Management "add" grant) can apply for someone else', () => {
        expect(advanceCanApplyForOthers(actor({ isAdmin: true }))).toBe(true);
        expect(advanceCanApplyForOthers(actor({ isHR: true }))).toBe(true);
        expect(advanceCanApplyForOthers(actor())).toBe(false);
    });
});
