import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * End-to-end behaviour of the Punch Radius lock through the REAL punch-in route handlers
 * (POST /api/auth/attendance/device-biometric and POST /api/auth/face/verify), with the database
 * and unrelated collaborators mocked. Asserts both the HTTP outcome and whether an Attendance row
 * was actually written ("marked").
 */

const BRANCH = { name: 'Salem', latitude: 11.6643, longitude: 78.146 };
const METERS_PER_DEGREE = 111_195;
const north = (meters: number) => ({ latitude: BRANCH.latitude + meters / METERS_PER_DEGREE, longitude: BRANCH.longitude });

const state = vi.hoisted(() => ({
    locked: false,
    branch: null as null | { name: string; latitude: number | null; longitude: number | null },
    existing: null as null | Record<string, unknown>,
}));

const db = vi.hoisted(() => ({
    prisma: {
        faceTemplate: { findUnique: vi.fn(async () => ({ id: 'tpl1', isActive: true, embeddings: [[1]], featureVector: [1], modelVersion: 'test' })) },
        faceVerificationLog: { create: vi.fn(async () => ({ id: 'log1' })) },
        user: { findUnique: vi.fn() },
        attendance: {
            findUnique: vi.fn(),
            create: vi.fn(async () => ({ id: 'att1' })),
            update: vi.fn(async () => ({ id: 'att1' })),
        },
    },
}));

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));

vi.mock('@/app/lib/api-utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/api-utils')>();
    return {
        ...actual,
        withAuth: (handler: (req: NextRequest, user: unknown) => Promise<Response>) =>
            (req: NextRequest) => handler(req, { userId: 'emp1', branchId: 'br1', email: 'e@x.com', role: 'FDO' }),
    };
});

vi.mock('@/app/lib/attendance-schedule', () => ({
    checkDayAttendanceAllowed: vi.fn(async () => ({ allowed: true, isWorkingDay: true, dayType: 'WORKING' })),
}));
vi.mock('@/app/lib/attendance-leave-permission', () => ({
    getApprovedLeaveForDay: vi.fn(async () => null),
    formatHalfDayLeaveBlockedMessage: vi.fn(() => ''),
}));
vi.mock('@/app/lib/employee-shift', () => ({
    resolveEmployeeShiftConfig: vi.fn(async () => ({ shiftStart: '09:30', shiftEnd: '18:00', graceMinutes: 15, fullDayHours: 8, halfDayHours: 4 })),
}));
vi.mock('@/app/lib/hr-tracking', () => ({ recordPunchTrackingEvent: vi.fn(async () => true) }));
vi.mock('@/app/lib/face-match', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/face-match')>();
    return { ...actual, computeFaceMatchScore: vi.fn(() => ({ matched: true, scorePercent: 99, similarityScore: 0.99, distanceScore: 0.01 })) };
});

import { POST as deviceBiometricPunch } from './attendance/device-biometric/route';
import { POST as facePunch } from './face/verify/route';

type Route = 'device-biometric' | 'face-verify';
const ROUTES: Route[] = ['device-biometric', 'face-verify'];

async function punch(route: Route, type: 'PUNCH_IN' | 'PUNCH_OUT', coords?: { latitude: number; longitude: number }) {
    const body: Record<string, unknown> = { type, ...(coords ?? {}), deviceId: 'dev1' };
    if (route === 'face-verify') body.featureVector = [1];
    const request = new NextRequest(`http://localhost/api/auth/${route}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
    const handler = route === 'device-biometric' ? deviceBiometricPunch : facePunch;
    const response = await handler(request);
    const json = await response.json();
    const marked = db.prisma.attendance.create.mock.calls.length + db.prisma.attendance.update.mock.calls.length > 0;
    return { status: response.status, json, marked };
}

beforeEach(() => {
    vi.clearAllMocks();
    state.locked = false;
    state.branch = BRANCH;
    state.existing = null;
    db.prisma.user.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
        if (args?.select && 'punchRadiusLocked' in args.select) {
            return { punchRadiusLocked: state.locked, branch: state.branch };
        }
        return { branchId: 'br1' };
    });
    db.prisma.attendance.findUnique.mockImplementation(async () => state.existing);
});

describe.each(ROUTES)('Punch Radius via %s', (route) => {
    describe('lock ENABLED — punch-in only near the branch', () => {
        beforeEach(() => { state.locked = true; });

        it.each([
            [0, 'at the branch'],
            [60, '60 m away'],
            [99, '99 m away (inside the 100 m radius)'],
            [115, '115 m away (inside the 30 m allowance)'],
            [128, '128 m away (just inside the 130 m limit)'],
        ])('ALLOWS and marks attendance at %i m — %s', async (meters) => {
            const r = await punch(route, 'PUNCH_IN', north(meters));
            expect(r.status).toBe(200);
            expect(r.marked).toBe(true);
            expect(db.prisma.attendance.create).toHaveBeenCalledTimes(1);
        });

        it.each([
            [133, 'just outside the 130 m limit'],
            [200, '200 m away'],
            [1000, '1 km away'],
            [25_000, '25 km away'],
        ])('BLOCKS and does NOT mark attendance at %i m — %s', async (meters) => {
            const r = await punch(route, 'PUNCH_IN', north(meters));
            expect(r.status).toBe(403);
            expect(r.json.data.code).toBe('OUT_OF_RADIUS');
            expect(r.json.error).toContain('Salem');
            expect(r.json.error).toContain('within 100 m');
            expect(Math.abs(r.json.data.distanceMeters - meters)).toBeLessThanOrEqual(2);
            expect(r.marked).toBe(false);
            expect(db.prisma.attendance.create).not.toHaveBeenCalled();
            expect(db.prisma.attendance.update).not.toHaveBeenCalled();
        });

        it('BLOCKS punch-in when the phone sends no location (LOCATION_REQUIRED)', async () => {
            const r = await punch(route, 'PUNCH_IN');
            expect(r.status).toBe(403);
            expect(r.json.data.code).toBe('LOCATION_REQUIRED');
            expect(r.marked).toBe(false);
        });

        it('ALLOWS punch-in when the branch has no saved location (rule skipped)', async () => {
            state.branch = { name: 'No-GPS Branch', latitude: null, longitude: null };
            const r = await punch(route, 'PUNCH_IN', north(5000));
            expect(r.status).toBe(200);
            expect(r.marked).toBe(true);
        });

        it('NEVER restricts punch-out, even 25 km away', async () => {
            state.existing = { id: 'att1', status: 'PRESENT', checkIn: new Date(Date.now() - 8 * 3600_000), checkOut: null, isHoliday: false, branchId: 'br1' };
            const r = await punch(route, 'PUNCH_OUT', north(25_000));
            expect(r.status).toBe(200);
            expect(db.prisma.attendance.update).toHaveBeenCalledTimes(1);
        });
    });

    describe('lock DISABLED — punch-in from anywhere', () => {
        beforeEach(() => { state.locked = false; });

        it.each([
            [0, 'at the branch'],
            [1000, '1 km away'],
            [25_000, '25 km away'],
        ])('ALLOWS and marks attendance at %i m — %s', async (meters) => {
            const r = await punch(route, 'PUNCH_IN', north(meters));
            expect(r.status).toBe(200);
            expect(r.marked).toBe(true);
        });

        it('ALLOWS punch-in with no location at all (behaviour unchanged)', async () => {
            const r = await punch(route, 'PUNCH_IN');
            expect(r.status).toBe(200);
            expect(r.marked).toBe(true);
        });
    });

    it('switching the lock on/off changes the outcome for the same far-away punch', async () => {
        state.locked = true;
        const blocked = await punch(route, 'PUNCH_IN', north(5000));
        expect(blocked.status).toBe(403);

        vi.clearAllMocks();
        db.prisma.attendance.findUnique.mockImplementation(async () => state.existing);
        state.locked = false;
        const allowed = await punch(route, 'PUNCH_IN', north(5000));
        expect(allowed.status).toBe(200);
        expect(allowed.marked).toBe(true);
    });
});
