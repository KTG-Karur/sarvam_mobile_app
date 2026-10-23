import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Region / Division / Shift chosen when an employee request is raised must land on the employee
 * (User) when the request is finally approved, and the request screens must then show the
 * employee's own current values.
 */

const request = vi.hoisted(() => ({
    value: {} as Record<string, unknown>,
}));

const db = vi.hoisted(() => {
    const tx = {
        user: { create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({ id: 'newUser1' })) },
        designation: { findUnique: vi.fn(async () => null) },
        role: { findFirst: vi.fn(async () => null) },
        userRoleAssignment: { create: vi.fn() },
        areaManagerBranch: { findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn() },
        userBranchAssignment: { upsert: vi.fn() },
        employeeOnboardingRequest: { update: vi.fn(async () => ({ id: 'req1', createdUserId: 'newUser1', status: 'APPROVED' })) },
    };
    return {
        tx,
        prisma: {
            employeeOnboardingRequest: { findUnique: vi.fn() },
            user: { findUnique: vi.fn(async () => null), findMany: vi.fn(async (): Promise<unknown[]> => []) },
            onboardingDocument: { findMany: vi.fn(async () => []) },
            $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
        },
    };
});

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/auth', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/app/lib/permissions/guards', () => ({
    requireAuth: vi.fn(async () => ({ userId: 'admin1', roles: [{ roleSlug: 'admin' }] })),
    isUserContext: () => true,
}));
vi.mock('@/app/lib/approval/engine', () => ({
    getWorkflowStatus: vi.fn(async () => ({
        instance: { currentStageId: 'st1', status: 'IN_PROGRESS' },
        stages: [{ stageId: 'st1', stageOrder: 1 }],
    })),
    processStageAction: vi.fn(async () => ({ newStatus: 'APPROVED' })),
}));
vi.mock('@/app/lib/services/hr-onboarding-validation.service', () => ({
    hrOnboardingValidationService: { assertRequiredFieldsPresent: vi.fn(async () => ({ ok: true, missing: [] })) },
}));
vi.mock('@/app/lib/storage/gcs-path-resolver', () => ({ resolveEmployeeFolder: vi.fn(async () => 'folder') }));
vi.mock('@/app/lib/storage/gcs-client', () => ({ copyObject: vi.fn() }));
vi.mock('@/app/lib/rbac-role-sync', () => ({ syncUserLegacyRoleFromActiveAssignments: vi.fn() }));
vi.mock('@/app/lib/permissions/engine', () => ({ invalidateUserPermissions: vi.fn() }));
vi.mock('@/app/lib/hr/onboarding-duplicate-check', () => ({
    checkOnboardingDuplicates: vi.fn(async () => ({ hit: null, rejoinerHint: null })),
    formatInternalDuplicateMessage: vi.fn(() => ''),
}));
vi.mock('@/app/lib/hr/apply-ctc-change', () => ({ applyCtcChange: vi.fn() }));
vi.mock('@/app/lib/hr/employee-photo', () => ({ hasUsableOnboardingPhoto: vi.fn(async () => true) }));

import { POST } from './[id]/action/route';
import { withLiveEmployeeData } from '@/app/lib/hr/onboarding-live-employee';

const baseRequest = {
    id: 'req1',
    approvalInstanceId: 'inst1',
    createdByUserId: 'someoneElse',
    employeeName: 'Ravi Kumar',
    mobileNumber: '9876543210',
    email: 'ravi@example.com',
    branchId: 'branch1',
    currentAddress: 'A',
    permanentAddress: 'A',
};

async function approve() {
    const req = new NextRequest('http://localhost/api/hr/onboarding/req1/action', {
        method: 'POST',
        body: JSON.stringify({
            action: 'approve',
            designationId: 'des1',
            departmentId: 'dep1',
            reportingManagerId: 'mgr1',
            dateOfJoining: '2026-10-01',
            employeeId: 'EMP100',
            password: 'Passw0rd!',
            monthlyCtc: 20000,
        }),
        headers: { 'Content-Type': 'application/json' },
    });
    return POST(req, { params: Promise.resolve({ id: 'req1' }) });
}

beforeEach(() => {
    vi.clearAllMocks();
    db.prisma.user.findUnique.mockResolvedValue(null);
});

describe('final approval copies the org placement onto the new employee', () => {
    it('Region, Division and Shift chosen on the request are saved on the employee', async () => {
        request.value = { ...baseRequest, regionId: 'region1', divisionId: 'division1', shiftId: 'shift1' };
        db.prisma.employeeOnboardingRequest.findUnique.mockResolvedValue(request.value);

        const res = await approve();
        expect(res.status).toBe(200);
        expect(db.tx.user.create).toHaveBeenCalledTimes(1);
        const data = db.tx.user.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
            employeeId: 'EMP100',
            branchId: 'branch1',
            shiftId: 'shift1',
            orgRegionId: 'region1',
            orgDivisionId: 'division1',
        });
        // `divisionId` on User means "Division MANAGER assignment" and must NOT be set from the request.
        expect(data).not.toHaveProperty('divisionId');
    });

    it('a request raised without region / division / shift creates an employee with none of them', async () => {
        request.value = { ...baseRequest, regionId: null, divisionId: null, shiftId: null };
        db.prisma.employeeOnboardingRequest.findUnique.mockResolvedValue(request.value);

        const res = await approve();
        expect(res.status).toBe(200);
        const data = db.tx.user.create.mock.calls[0][0].data;
        expect(data).toMatchObject({ shiftId: null, orgRegionId: null, orgDivisionId: null });
    });

    it('a non-final approval stage does not create an employee yet', async () => {
        const { processStageAction } = await import('@/app/lib/approval/engine');
        (processStageAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ newStatus: 'IN_PROGRESS' });
        const { getWorkflowStatus } = await import('@/app/lib/approval/engine');
        (getWorkflowStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            instance: { currentStageId: 'st1', status: 'IN_PROGRESS' },
            stages: [{ stageId: 'st1', stageOrder: 1 }, { stageId: 'st2', stageOrder: 2 }],
        });
        db.prisma.employeeOnboardingRequest.findUnique.mockResolvedValue({ ...baseRequest, regionId: 'region1', shiftId: 'shift1' });

        const req = new NextRequest('http://localhost/api/hr/onboarding/req1/action', {
            method: 'POST',
            body: JSON.stringify({ action: 'approve' }),
            headers: { 'Content-Type': 'application/json' },
        });
        const res = await POST(req, { params: Promise.resolve({ id: 'req1' }) });
        expect(res.status).toBe(200);
        expect(db.tx.user.create).not.toHaveBeenCalled();
    });
});

describe('approved request screens read the employee’s own values', () => {
    const userRow = (over: Record<string, unknown> = {}) => ({
        id: 'u1', firstName: 'Ravi', lastName: 'Kumar', mobileNumber: '1', email: 'e', branchId: 'b1', shiftId: 'shiftNew',
        departmentId: null, designationId: null, dateOfJoining: null, education: null, address: null, permanentAddress: null,
        dob: null, gender: null, maritalStatus: null, bloodGroup: null, emergencyContactName: null, emergencyContactRelation: null,
        emergencyContactMobile: null, aadhaarNumber: null, panNumber: null, dlNumber: null, voterIdNumber: null, uanNumber: null,
        esiNumber: null, bankName: null, bankBranchName: null, bankAccountNumber: null, bankIfscCode: null, reportingManagerL1Id: null,
        insuranceCompanyName: null, insurancePolicyNumber: null, insuranceValidFrom: null, insuranceValidTo: null,
        fatherName: null, fatherAge: null, fatherAadhaarNumber: null, motherName: null, motherAge: null, motherAadhaarNumber: null,
        wifeName: null, wifeAge: null, wifeAadhaarNumber: null, wifeBankAccountNumber: null, wifeIfscCode: null, wifeContactNumber: null,
        husbandName: null, husbandAge: null, husbandAadhaarNumber: null, husbandBankAccountNumber: null, husbandIfscCode: null,
        husbandContactNumber: null, weddingDate: null, children: null,
        orgRegionId: 'regionNew', orgDivisionId: 'divisionNew',
        orgRegion: { name: 'South' }, orgDivision: { name: 'Tamil Nadu' },
        branch: { name: 'Salem' }, department: null, designation: null, shift: { name: 'Night' }, reportingManagerL1: null,
        ...over,
    });

    it('shows the employee’s current region / division / shift after an edit', async () => {
        db.prisma.user.findMany.mockResolvedValue([userRow()]);
        const [row] = await withLiveEmployeeData([
            { id: 'req1', createdUser: { id: 'u1' }, regionId: 'regionOld', region: { name: 'North' }, divisionId: 'divisionOld', division: { name: 'Delhi' }, shiftId: 'shiftOld', shift: { name: 'Day' } },
        ] as never[]);
        expect(row).toMatchObject({
            regionId: 'regionNew', region: { name: 'South' },
            divisionId: 'divisionNew', division: { name: 'Tamil Nadu' },
            shiftId: 'shiftNew', shift: { name: 'Night' },
        });
    });

    it('keeps what the request recorded for an older employee that has no region / division yet', async () => {
        db.prisma.user.findMany.mockResolvedValue([userRow({ orgRegionId: null, orgDivisionId: null, orgRegion: null, orgDivision: null })]);
        const [row] = await withLiveEmployeeData([
            { id: 'req1', createdUser: { id: 'u1' }, regionId: 'regionOld', region: { name: 'North' }, divisionId: 'divisionOld', division: { name: 'Delhi' } },
        ] as never[]);
        expect(row).toMatchObject({ regionId: 'regionOld', region: { name: 'North' }, divisionId: 'divisionOld', division: { name: 'Delhi' } });
    });

    it('leaves a request that has no employee yet untouched', async () => {
        const pending = { id: 'req2', createdUser: null, regionId: 'r', shiftId: 's' };
        const [row] = await withLiveEmployeeData([pending] as never[]);
        expect(row).toEqual(pending);
    });
});
