import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const db = vi.hoisted(() => {
    const exitClearanceItemConfig = {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
    };
    const employeeExitClearanceItem = {
        count: vi.fn(),
        findMany: vi.fn(),
    };
    return {
        exitClearanceItemConfig,
        employeeExitClearanceItem,
        prisma: {
            exitClearanceItemConfig,
            employeeExitClearanceItem,
        },
    };
});

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/prisma', () => ({ prisma: db.prisma }));

vi.mock('@/app/lib/api-utils', async () => {
    const actual = await vi.importActual<typeof import('@/app/lib/api-utils')>('@/app/lib/api-utils');
    return {
        ...actual,
        withAuth: (handler: (req: NextRequest) => Promise<Response>) => (req: NextRequest) => handler(req),
        withRole: (_roles: string[], handler: (req: NextRequest) => Promise<Response>) => (req: NextRequest) => handler(req),
    };
});

import { GET, POST, PUT, DELETE } from './route';

describe('Exit Clearance Config API Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/hr/exit-clearance-config', () => {
        it('fetches only active items by default', async () => {
            db.exitClearanceItemConfig.findMany.mockResolvedValue([]);
            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config');
            const res = await GET(req);
            expect(res.status).toBe(200);
            expect(db.exitClearanceItemConfig.findMany).toHaveBeenCalledWith({
                where: { isActive: true },
                orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }],
            });
        });

        it('fetches all items when includeInactive=true', async () => {
            db.exitClearanceItemConfig.findMany.mockResolvedValue([]);
            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?includeInactive=true');
            const res = await GET(req);
            expect(res.status).toBe(200);
            expect(db.exitClearanceItemConfig.findMany).toHaveBeenCalledWith({
                where: {},
                orderBy: [{ department: 'asc' }, { sortOrder: 'asc' }],
            });
        });
    });

    describe('POST /api/hr/exit-clearance-config', () => {
        it('creates an item when no duplicate exists', async () => {
            db.exitClearanceItemConfig.findFirst.mockResolvedValue(null);
            db.exitClearanceItemConfig.create.mockResolvedValue({
                id: 'cfg-1',
                department: 'IT',
                itemName: 'Laptop Return',
                exitTypes: [],
                isActive: true,
                sortOrder: 0,
            });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config', {
                method: 'POST',
                body: JSON.stringify({
                    department: 'IT',
                    itemName: 'Laptop Return',
                }),
            });
            const res = await POST(req);
            expect(res.status).toBe(201);
            expect(db.exitClearanceItemConfig.create).toHaveBeenCalledTimes(1);
        });

        it('returns 409 when an active item with the same name and department exists', async () => {
            db.exitClearanceItemConfig.findFirst.mockResolvedValue({
                id: 'cfg-existing',
                department: 'IT',
                itemName: 'Laptop Return',
                isActive: true,
            });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config', {
                method: 'POST',
                body: JSON.stringify({
                    department: 'IT',
                    itemName: 'Laptop Return',
                }),
            });
            const res = await POST(req);
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error).toBe('An active clearance item with this name already exists for the selected department');
            expect(db.exitClearanceItemConfig.create).not.toHaveBeenCalled();
        });
    });

    describe('PUT /api/hr/exit-clearance-config?id=', () => {
        it('updates an item when valid and no duplicate collision', async () => {
            db.exitClearanceItemConfig.findFirst.mockResolvedValue(null);
            db.exitClearanceItemConfig.update.mockResolvedValue({
                id: 'cfg-1',
                department: 'IT',
                itemName: 'Laptop and Charger Return',
                exitTypes: [],
                isActive: true,
                sortOrder: 0,
            });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?id=cfg-1', {
                method: 'PUT',
                body: JSON.stringify({
                    department: 'IT',
                    itemName: 'Laptop and Charger Return',
                }),
            });
            const res = await PUT(req);
            expect(res.status).toBe(200);
            expect(db.exitClearanceItemConfig.update).toHaveBeenCalledWith({
                where: { id: 'cfg-1' },
                data: expect.objectContaining({ itemName: 'Laptop and Charger Return' }),
            });
        });

        it('returns 409 with reactivate-collision wording when reactivating over an existing active item', async () => {
            db.exitClearanceItemConfig.findFirst.mockResolvedValue({
                id: 'cfg-2',
                department: 'IT',
                itemName: 'Laptop Return',
                isActive: true,
            });
            db.exitClearanceItemConfig.findUnique.mockResolvedValue({
                id: 'cfg-1',
                isActive: false,
            });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?id=cfg-1', {
                method: 'PUT',
                body: JSON.stringify({
                    department: 'IT',
                    itemName: 'Laptop Return',
                    isActive: true,
                }),
            });
            const res = await PUT(req);
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error).toContain('cannot be reactivated — an active record already uses this name');
        });
    });

    describe('DELETE /api/hr/exit-clearance-config?id=', () => {
        it('soft deactivates the item when permanent flag is not set', async () => {
            db.exitClearanceItemConfig.update.mockResolvedValue({ id: 'cfg-1', isActive: false });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?id=cfg-1', {
                method: 'DELETE',
            });
            const res = await DELETE(req);
            expect(res.status).toBe(200);
            expect(db.exitClearanceItemConfig.update).toHaveBeenCalledWith({
                where: { id: 'cfg-1' },
                data: { isActive: false },
            });
        });

        it('returns 409 with employee details when permanent=true and clearance records still reference this item', async () => {
            db.employeeExitClearanceItem.findMany.mockResolvedValue([
                {
                    id: 'clr-1',
                    status: 'CLEARED',
                    exitRequest: {
                        id: 'req-1',
                        exitType: 'VOLUNTARY_RESIGNATION',
                        status: 'IN_PROGRESS',
                        employee: {
                            id: 'emp-1',
                            employeeId: 'EMP-001',
                            firstName: 'John',
                            lastName: 'Doe',
                            branch: { name: 'Main Branch' },
                        },
                    },
                },
            ]);

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?id=cfg-1&permanent=true', {
                method: 'DELETE',
            });
            const res = await DELETE(req);
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error).toContain('Cannot permanently delete: 1 clearance record(s) still reference this item');
            expect(json.error).toContain('John Doe (EMP-001)');
            expect(json.data.references).toHaveLength(1);
            expect(json.data.references[0].employeeName).toBe('John Doe');
            expect(json.data.references[0].employeeCode).toBe('EMP-001');
            expect(db.exitClearanceItemConfig.delete).not.toHaveBeenCalled();
        });

        it('permanently deletes item when permanent=true and 0 clearance records reference it', async () => {
            db.employeeExitClearanceItem.findMany.mockResolvedValue([]);
            db.exitClearanceItemConfig.delete.mockResolvedValue({ id: 'cfg-1' });

            const req = new NextRequest('http://localhost/api/hr/exit-clearance-config?id=cfg-1&permanent=true', {
                method: 'DELETE',
            });
            const res = await DELETE(req);
            expect(res.status).toBe(200);
            expect(db.exitClearanceItemConfig.delete).toHaveBeenCalledWith({ where: { id: 'cfg-1' } });
            const json = await res.json();
            expect(json.message).toBe('Exit clearance item permanently deleted');
        });
    });
});

