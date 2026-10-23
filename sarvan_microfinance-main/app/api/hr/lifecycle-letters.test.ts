import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// Mock DB
const db = vi.hoisted(() => {
    const employeeConfirmation = { findUnique: vi.fn() };
    const employeePromotion = { findUnique: vi.fn() };
    const employeeTransfer = { findUnique: vi.fn() };
    const employeeExitRequest = { findUnique: vi.fn() };
    const user = { findUnique: vi.fn() };
    const tx = { employeeConfirmation, employeePromotion, employeeTransfer, employeeExitRequest, user };
    return {
        ...tx,
        prisma: { ...tx, $transaction: vi.fn(async (cb: (txClient: typeof tx) => Promise<unknown>) => cb(tx)) },
    };
});

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));

const mockPermissions = vi.hoisted(() => ({
    requirePermission: vi.fn(),
    isUserContext: vi.fn((ctx: unknown) => ctx && typeof ctx === 'object' && 'userId' in ctx),
}));

vi.mock('@/app/lib/permissions/guards', () => ({
    requirePermission: mockPermissions.requirePermission,
    isUserContext: mockPermissions.isUserContext,
}));

vi.mock('@/app/lib/reports/confirmation-letter-pdf', () => ({
    buildConfirmationLetterPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4-confirmation')),
}));

vi.mock('@/app/lib/reports/promotion-letter-pdf', () => ({
    buildPromotionLetterPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4-promotion')),
}));

vi.mock('@/app/lib/reports/transfer-letter-pdf', () => ({
    buildTransferLetterPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4-transfer')),
}));

vi.mock('@/app/lib/reports/relieving-letter-pdf', () => ({
    buildRelievingLetterPdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4-relieving')),
}));

import { GET as getConfirmationLetter } from '@/app/api/hr/confirmations/[id]/letter/route';
import { GET as getPromotionLetter } from '@/app/api/hr/promotions/[id]/letter/route';
import { GET as getTransferLetter } from '@/app/api/hr/transfers/[id]/letter/route';
import { GET as getExitLetter } from '@/app/api/hr/exit-requests/[id]/letter/route';

const adminCtx: UserContext = {
    userId: 'admin-1',
    email: 'admin@sarvam.internal',
    firstName: 'Admin',
    lastName: 'User',
    isActive: true,
    branchId: 'branch-1',
    isHeadOffice: true,
    roles: [
        {
            roleId: 'role-admin',
            roleName: 'Admin',
            roleSlug: 'admin',
            priority: 1,
            branchId: null,
        },
    ],
    permissions: {
        granted: new Set<string>(),
        denied: new Set<string>(),
        conditions: new Map(),
    },
    branchAccess: [
        {
            branchId: 'branch-1',
            branchName: 'Head Office',
            branchCode: 'HO01',
            accessType: 'FULL',
            isPrimary: true,
            isHeadOffice: true,
        },
    ],
    fieldPermissions: new Map(),
    reportPermissions: new Map(),
};

describe('Lifecycle Letters Direct Streaming Downloads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPermissions.requirePermission.mockResolvedValue(adminCtx);
    });

    describe('GET /api/hr/confirmations/[id]/letter', () => {
        it('returns 404 when confirmation record is not found', async () => {
            db.employeeConfirmation.findUnique.mockResolvedValue(null);
            const req = new NextRequest('http://localhost/api/hr/confirmations/cnf-1/letter');
            const res = await getConfirmationLetter(req, { params: Promise.resolve({ id: 'cnf-1' }) });
            expect(res.status).toBe(404);
        });

        it('returns 400 when confirmation is still PENDING', async () => {
            db.employeeConfirmation.findUnique.mockResolvedValue({
                id: 'cnf-1',
                status: 'PENDING',
                proposedConfirmationDate: new Date(),
                employee: { id: 'emp-1', firstName: 'A', lastName: 'B', employeeId: 'EMP-001' },
            });
            const req = new NextRequest('http://localhost/api/hr/confirmations/cnf-1/letter');
            const res = await getConfirmationLetter(req, { params: Promise.resolve({ id: 'cnf-1' }) });
            expect(res.status).toBe(400);
        });

        it('returns 200 with PDF attachment when confirmation is APPROVED', async () => {
            db.employeeConfirmation.findUnique.mockResolvedValue({
                id: 'cnf-1',
                status: 'APPROVED',
                proposedConfirmationDate: new Date('2026-09-01'),
                reviewedAt: new Date('2026-09-02'),
                employee: {
                    id: 'emp-1',
                    firstName: 'Anitha',
                    lastName: 'Priya',
                    employeeId: 'EMP-888',
                    designation: { name: 'Field Officer' },
                    department: { name: 'Operations' },
                    branch: { name: 'Sattur' },
                },
            });
            const req = new NextRequest('http://localhost/api/hr/confirmations/cnf-1/letter');
            const res = await getConfirmationLetter(req, { params: Promise.resolve({ id: 'cnf-1' }) });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain('confirmation-letter-EMP-888.pdf');
        });
    });

    describe('GET /api/hr/promotions/[id]/letter', () => {
        it('returns 404 when promotion is not found', async () => {
            db.employeePromotion.findUnique.mockResolvedValue(null);
            const req = new NextRequest('http://localhost/api/hr/promotions/prm-1/letter');
            const res = await getPromotionLetter(req, { params: Promise.resolve({ id: 'prm-1' }) });
            expect(res.status).toBe(404);
        });

        it('returns 200 with PDF attachment when promotion is APPROVED', async () => {
            db.employeePromotion.findUnique.mockResolvedValue({
                id: 'prm-1',
                status: 'APPROVED',
                effectiveDate: new Date('2026-10-01'),
                reviewedAt: new Date('2026-09-20'),
                employee: {
                    id: 'emp-2',
                    firstName: 'Vikram',
                    lastName: 'Raj',
                    employeeId: 'EMP-222',
                    designation: { name: 'Branch Manager' },
                    department: { name: 'Credit' },
                    branch: { name: 'Othakadai' },
                },
                fromDesignation: { name: 'Assistant Branch Manager' },
                toDesignation: { name: 'Branch Manager' },
            });
            const req = new NextRequest('http://localhost/api/hr/promotions/prm-1/letter');
            const res = await getPromotionLetter(req, { params: Promise.resolve({ id: 'prm-1' }) });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain('promotion-letter-EMP-222.pdf');
        });
    });

    describe('GET /api/hr/transfers/[id]/letter', () => {
        it('returns 404 when transfer is not found', async () => {
            db.employeeTransfer.findUnique.mockResolvedValue(null);
            const req = new NextRequest('http://localhost/api/hr/transfers/trn-1/letter');
            const res = await getTransferLetter(req, { params: Promise.resolve({ id: 'trn-1' }) });
            expect(res.status).toBe(404);
        });

        it('returns 200 with PDF attachment when transfer is APPROVED', async () => {
            db.employeeTransfer.findUnique.mockResolvedValue({
                id: 'trn-1',
                status: 'APPROVED',
                transferType: 'BRANCH',
                effectiveDate: new Date('2026-10-01'),
                completedAt: new Date('2026-09-21'),
                employee: {
                    id: 'emp-3',
                    firstName: 'Karthik',
                    lastName: 'N',
                    employeeId: 'EMP-333',
                    designation: { name: 'Field Officer' },
                    department: { name: 'Operations' },
                    branch: { name: 'Sattur' },
                },
                fromBranch: { name: 'Sattur' },
                toBranch: { name: 'Othakadai' },
            });
            const req = new NextRequest('http://localhost/api/hr/transfers/trn-1/letter');
            const res = await getTransferLetter(req, { params: Promise.resolve({ id: 'trn-1' }) });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain('transfer-letter-EMP-333.pdf');
        });
    });

    describe('GET /api/hr/exit-requests/[id]/letter', () => {
        it('returns 404 when exit request is not found', async () => {
            db.employeeExitRequest.findUnique.mockResolvedValue(null);
            const req = new NextRequest('http://localhost/api/hr/exit-requests/ext-1/letter');
            const res = await getExitLetter(req, { params: Promise.resolve({ id: 'ext-1' }) });
            expect(res.status).toBe(404);
        });

        it('returns 200 with PDF attachment when exit request is HR_APPROVED', async () => {
            db.employeeExitRequest.findUnique.mockResolvedValue({
                id: 'ext-1',
                status: 'HR_APPROVED',
                exitType: 'VOLUNTARY_RESIGNATION',
                lastWorkingDate: new Date('2026-09-30'),
                finalHrApprovedAt: new Date('2026-09-21'),
                employee: {
                    id: 'emp-4',
                    firstName: 'Deepa',
                    lastName: 'R',
                    employeeId: 'EMP-444',
                    dateOfJoining: new Date('2024-01-15'),
                    designation: { name: 'Senior Accountant' },
                    department: { name: 'Finance' },
                    branch: { name: 'Head Office' },
                },
            });
            const req = new NextRequest('http://localhost/api/hr/exit-requests/ext-1/letter');
            const res = await getExitLetter(req, { params: Promise.resolve({ id: 'ext-1' }) });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain('relieving-letter-EMP-444.pdf');
        });
    });
});

