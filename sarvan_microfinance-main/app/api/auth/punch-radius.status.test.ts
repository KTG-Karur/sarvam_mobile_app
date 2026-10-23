import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The mobile app learns whether the employee is radius-locked from two existing status endpoints:
 *   GET /api/auth/face/attendance-status   and   GET /api/mobile/attendance/today
 * Both must return punchRadius { locked, radiusMeters: 100, maxAllowedMeters: 130 }.
 */

const state = vi.hoisted(() => ({ locked: false }));

const db = vi.hoisted(() => ({
    prisma: {
        user: {
            findUnique: vi.fn(async (args: { select?: Record<string, unknown> }) => {
                if (args?.select && 'punchRadiusLocked' in args.select && !('firstName' in args.select)) {
                    return { punchRadiusLocked: state.locked };
                }
                if (args?.select && 'firstName' in args.select) {
                    return {
                        id: 'emp1', employeeId: 'E1', firstName: 'Ravi', lastName: 'K', role: 'FDO', designation: null,
                        punchRadiusLocked: state.locked,
                        branch: { id: 'br1', name: 'Salem', code: '001' },
                    };
                }
                return { branchId: 'br1' };
            }),
        },
        attendance: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null) },
        faceTemplate: { findUnique: vi.fn(async () => ({ id: 't1' })) },
        faceReRegistrationRequest: { findFirst: vi.fn(async () => null) },
    },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/api-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/api-utils')>();
    return {
        ...actual,
        withAuth: (handler: (req: NextRequest, user: unknown) => Promise<Response>) =>
            (req: NextRequest) => handler(req, { userId: 'emp1', branchId: 'br1', role: 'FDO' }),
    };
});
vi.mock('@/app/lib/attendance-schedule', () => ({
    checkDayAttendanceAllowed: vi.fn(async () => ({ allowed: true, isWorkingDay: true, dayType: 'WORKING', faceAttendanceEnabled: true })),
    getWeekConfiguration: vi.fn(async () => ({ days: [] })),
}));
vi.mock('@/app/lib/attendance-leave-permission', () => ({ getApprovedLeaveForDay: vi.fn(async () => null) }));
vi.mock('@/app/lib/face-settings', () => ({ checkFaceTrainingAllowed: vi.fn(async () => ({ allowed: true })) }));

import { GET as attendanceStatus } from './face/attendance-status/route';
import { GET as mobileToday } from '../mobile/attendance/today/route';

const request = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
    vi.clearAllMocks();
    state.locked = false;
});

describe.each([
    ['GET /api/auth/face/attendance-status', () => attendanceStatus(request('/api/auth/face/attendance-status'))],
    ['GET /api/mobile/attendance/today', () => mobileToday(request('/api/mobile/attendance/today'))],
])('%s', (_name, call) => {
    it('reports an UNLOCKED employee (can punch in from anywhere)', async () => {
        state.locked = false;
        const res = await call();
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.data.punchRadius).toEqual({ locked: false, radiusMeters: 100, maxAllowedMeters: 130 });
    });

    it('reports a LOCKED employee (must be near the branch)', async () => {
        state.locked = true;
        const json = await (await call()).json();
        expect(json.data.punchRadius).toEqual({ locked: true, radiusMeters: 100, maxAllowedMeters: 130 });
    });
});
