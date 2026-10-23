import { prisma } from '@/app/lib/db';
import { configVersion, getUcrfConfig } from './config.service';
import { toKolkataYmd } from './format';
import { ucrfFiltersSchema, type UcrfConfig, type UcrfFilters } from './types';

/** Used only to compute previews/summaries before the admin has saved settings; exports still require saved settings. */
export const PROVISIONAL_CONFIG: UcrfConfig = {
    memberId: '',
    institutionName: '',
    submittingBranchId: '',
    fileFrequency: 'ME',
    oldMemberId: '',
    loanCategory: 'T02',
};

export class UcrfRequestError extends Error {
    constructor(message: string, readonly status = 400) {
        super(message);
    }
}

export function todayYmd(): string {
    return toKolkataYmd(new Date())!;
}

/** Validates filter input and rejects future report dates (the spec forbids them). */
export function parseFilters(raw: unknown): UcrfFilters {
    const parsed = ucrfFiltersSchema.safeParse(raw);
    if (!parsed.success) throw new UcrfRequestError(parsed.error.errors[0].message, 400);
    const f = parsed.data;
    const d = new Date(`${f.reportDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f.reportDate) throw new UcrfRequestError('Report date is not a valid calendar date', 400);
    if (f.reportDate > todayYmd()) throw new UcrfRequestError('Report date cannot be in the future', 400);
    if (f.reportDate < '1900-01-01') throw new UcrfRequestError('Report date cannot be earlier than 01011900', 400);
    return f;
}

export async function loadConfigForRequest() {
    const stored = await getUcrfConfig();
    return {
        saved: stored !== null,
        config: stored ?? PROVISIONAL_CONFIG,
        version: stored ? configVersion(stored) : 'none',
    };
}

export async function lastSuccessfulExport() {
    const row = await prisma.roleAuditLog.findFirst({
        where: { targetType: 'ucrf_export', action: 'UCRF_EXPORT_SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, after: true },
    });
    if (!row) return null;
    const after = (row.after ?? {}) as { format?: string; reportDate?: string; included?: number };
    return { at: row.createdAt.toISOString(), format: after.format ?? null, reportDate: after.reportDate ?? null, included: after.included ?? null };
}
