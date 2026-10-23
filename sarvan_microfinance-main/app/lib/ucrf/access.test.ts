import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { evaluateServerRouteAccess } from '@/app/lib/server-route-protection';
import { generateAccessToken } from '@/app/lib/auth';
import { applyValidityFilter } from './dataset.service';
import { exportFilename, prepareExport } from './export.service';
import { buildUcrfRecord } from './build-record';
import { REPORT_YMD, TEST_CONFIG, makeInput } from './test-fixtures';
import type { UcrfFilters } from './types';

const db = vi.hoisted(() => ({
    prisma: {
        branch: { findMany: vi.fn().mockResolvedValue([]) },
        loanProduct: { findMany: vi.fn().mockResolvedValue([]) },
        ucrfInstitutionConfig: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
        roleAuditLog: { create: vi.fn().mockResolvedValue({}), findFirst: vi.fn().mockResolvedValue(null) },
        loan: { findMany: vi.fn().mockResolvedValue([]) },
    },
}));
vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/app/lib/head-office-branch', () => ({ isHeadOfficeBranch: vi.fn().mockResolvedValue(true) }));
vi.mock('@/app/lib/services/user-activity-tracker', () => ({
    detectPlatformFromToken: () => 'web',
    getClientIp: () => '127.0.0.1',
    trackRequestActivity: () => undefined,
}));

const PAGE = '/dashboard/admin-reports/others/ucrf-export';

describe('page access (route table)', () => {
    it('allows ADMIN', () => expect(evaluateServerRouteAccess(PAGE, 'ADMIN', 'ADMIN')).toBe(true));
    it.each(['ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO', 'DIVISION_MANAGER'] as const)(
        'rejects %s',
        (role) => expect(evaluateServerRouteAccess(PAGE, role, role)).toBe(false)
    );
    it('does not widen sibling admin-report pages', () => {
        expect(evaluateServerRouteAccess('/dashboard/admin-reports/others/sms-format', 'BRANCH_MANAGER', 'BRANCH_MANAGER')).toBe(true);
    });
});

function tokenFor(role: string): string {
    return generateAccessToken({ userId: 'u1', email: 'a@b.c', role, branchId: 'b1' } as never);
}
function req(method: string, role: string | null, body?: unknown) {
    return new NextRequest('http://localhost/api/ucrf-export/x', {
        method,
        headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${tokenFor(role)}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

describe('API authorization', () => {
    beforeEach(() => vi.clearAllMocks());

    const routes = async () => ({
        config: await import('@/app/api/ucrf-export/config/route'),
        options: await import('@/app/api/ucrf-export/options/route'),
        summary: await import('@/app/api/ucrf-export/summary/route'),
        preview: await import('@/app/api/ucrf-export/preview/route'),
        exp: await import('@/app/api/ucrf-export/export/route'),
    });
    const body = { filters: { reportDate: REPORT_YMD }, format: 'csv' };

    it('rejects unauthenticated requests with 401 on every endpoint', async () => {
        const r = await routes();
        expect((await r.config.GET(req('GET', null))).status).toBe(401);
        expect((await r.options.GET(req('GET', null))).status).toBe(401);
        expect((await r.summary.POST(req('POST', null, body))).status).toBe(401);
        expect((await r.preview.POST(req('POST', null, body))).status).toBe(401);
        expect((await r.exp.POST(req('POST', null, body))).status).toBe(401);
    });

    it.each(['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'CUSTOM_ZH'])(
        'forbids %s on every endpoint — including GET, where withRole alone lets Head-Office users through',
        async (role) => {
            const r = await routes();
            expect((await r.config.GET(req('GET', role))).status).toBe(403);
            expect((await r.options.GET(req('GET', role))).status).toBe(403);
            expect((await r.config.PUT(req('PUT', role, {}))).status).toBe(403);
            expect((await r.summary.POST(req('POST', role, body))).status).toBe(403);
            expect((await r.preview.POST(req('POST', role, body))).status).toBe(403);
            expect((await r.exp.POST(req('POST', role, body))).status).toBe(403);
            expect(db.prisma.loan.findMany).not.toHaveBeenCalled();
            expect(db.prisma.roleAuditLog.create).not.toHaveBeenCalled();
        }
    );

    it('lets ADMIN through; export without saved settings is refused with 422, not a file', async () => {
        const r = await routes();
        expect((await r.options.GET(req('GET', 'ADMIN'))).status).toBe(200);
        expect((await r.config.GET(req('GET', 'ADMIN'))).status).toBe(200);
        const res = await r.exp.POST(req('POST', 'ADMIN', body));
        expect(res.status).toBe(422);
        expect((await res.json()).error).toMatch(/institution settings/i);
    });

    it('validates input: bad format, bad date, future date → 400', async () => {
        const r = await routes();
        expect((await r.exp.POST(req('POST', 'ADMIN', { format: 'exe', filters: { reportDate: REPORT_YMD } }))).status).toBe(400);
        expect((await r.summary.POST(req('POST', 'ADMIN', { filters: { reportDate: '30-04-2026' } }))).status).toBe(400);
        expect((await r.summary.POST(req('POST', 'ADMIN', { filters: { reportDate: '2999-01-01' } }))).status).toBe(400);
        expect((await r.summary.POST(req('POST', 'ADMIN', { filters: { reportDate: '2026-02-31' } }))).status).toBe(400);
        const cfg = await r.config.PUT(req('PUT', 'ADMIN', { memberId: 'WAY-TOO-LONG-ID', institutionName: 'X' }));
        expect(cfg.status).toBe(400);
    });
});

describe('export service: shared dataset, policy, filenames', () => {
    const filters: UcrfFilters = { reportDate: REPORT_YMD, loanStatus: 'ALL', validity: 'ALL' };
    const good = buildUcrfRecord(makeInput(), TEST_CONFIG, REPORT_YMD);
    const bad = buildUcrfRecord(makeInput({ loanId: 'b', loanNumber: '000777', client: { ...makeInput().client, gender: null } }), TEST_CONFIG, REPORT_YMD);
    const args = (format: 'cdf' | 'csv' | 'json' | 'xlsx' | 'errors', f = filters, recs = [good, bad]) => ({
        format, allRecords: recs, filters: f, config: TEST_CONFIG, todayYmd: REPORT_YMD, createdYmd: REPORT_YMD, generatedAtIso: '2026-05-02T00:00:00Z',
    });

    async function text(p: ReturnType<typeof prepareExport>): Promise<string> {
        if (!p.ok) throw new Error(p.error);
        if (Buffer.isBuffer(p.body)) return p.body.toString('latin1');
        const chunks: string[] = [];
        const dec = new TextDecoder();
        const reader = (p.body as ReadableStream<Uint8Array>).getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(dec.decode(value));
        }
        return chunks.join('');
    }

    it('CDF, CSV, JSON and XLSX use the same eligible counts and the same valid-only records', async () => {
        const counts = (['cdf', 'csv', 'json', 'xlsx'] as const).map((f) => {
            const p = prepareExport(args(f));
            if (!p.ok) throw new Error(p.error);
            return p.counts;
        });
        for (const c of counts) expect(c).toMatchObject({ eligible: 2, valid: 1, invalid: 1, included: 1, excluded: 1 });
        for (const f of ['cdf', 'csv'] as const) expect(await text(prepareExport(args(f)))).not.toContain('000777');
        expect(await text(prepareExport(args('csv')))).toContain('000123');
        const json = JSON.parse(await text(prepareExport(args('json'))));
        expect(json.records).toHaveLength(1);
        expect(json.metadata.totals).toMatchObject({ eligible: 2, valid: 1, invalid: 1 });
    });

    it('validity filter applies to the cards/preview scope; exports still contain valid records only', async () => {
        const invalidOnly = { ...filters, validity: 'INVALID' as const };
        expect(applyValidityFilter([good, bad], 'INVALID')).toEqual([bad]);
        expect(prepareExport(args('cdf', invalidOnly)).ok).toBe(false); // nothing valid to include
        const csv = await text(prepareExport(args('csv', invalidOnly)));
        expect(csv.split('\r\n').filter(Boolean)).toHaveLength(1); // header only
        const errors = await text(prepareExport(args('errors', invalidOnly)));
        expect(errors).toContain('000777');
    });

    it('blocks CDF on file-level errors and on an empty report; other formats still work on empty', async () => {
        const noMember = prepareExport({ ...args('cdf'), config: { ...TEST_CONFIG, memberId: '' } });
        expect(noMember.ok).toBe(false);
        const future = prepareExport({ ...args('cdf'), todayYmd: '2026-04-01' });
        expect(future.ok).toBe(false);
        expect(prepareExport(args('cdf', filters, [])).ok).toBe(false);
        const csv = prepareExport(args('csv', filters, []));
        expect(csv.ok).toBe(true);
        expect((await text(csv)).split('\r\n').filter(Boolean)).toHaveLength(1); // header only
        expect(JSON.parse(await text(prepareExport(args('json', filters, [])))).records).toEqual([]);
        expect(prepareExport(args('xlsx', filters, [])).ok).toBe(true);
    });

    it('errors report lists only issues, from the same validation results', async () => {
        const csv = await text(prepareExport(args('errors')));
        expect(csv).toContain('Member Gender Type');
        expect(csv.split('\r\n').filter(Boolean).length).toBeGreaterThan(1);
    });

    it('builds sanitized, deterministic filenames from validated inputs only', () => {
        expect(exportFilename('cdf', REPORT_YMD, { memberId: 'NBF0000001', fileFrequency: 'ME' })).toBe('MFI_ME_30042026_NBF0000001_JLG_DATA.CDF');
        expect(exportFilename('cdf', REPORT_YMD, { memberId: '../../etc/passwd', fileFrequency: 'ME' })).toBe('MFI_ME_30042026_etcpasswd_JLG_DATA.CDF');
        expect(exportFilename('csv', REPORT_YMD, TEST_CONFIG)).toBe('UCRF_JLG_20260430.csv');
        expect(exportFilename('xlsx', REPORT_YMD, TEST_CONFIG)).toBe('UCRF_JLG_20260430.xlsx');
        expect(exportFilename('json', REPORT_YMD, TEST_CONFIG)).toBe('UCRF_JLG_20260430.json');
    });
});
