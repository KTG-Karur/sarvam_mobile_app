import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getKolkataCalendarYmd, getKolkataDayEndExclusiveUtc, parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type AuditType = 'INDIVIDUAL_FUNDER' | 'BULK_FUNDER' | 'SCHEDULE' | 'MEMBER_ID' | 'CENTER_ID';

const TYPE_LABEL: Record<AuditType, string> = {
    INDIVIDUAL_FUNDER: 'Individual Funder Change',
    BULK_FUNDER: 'Bulk Funder Change',
    SCHEDULE: 'Live Loan Schedule Edit',
    MEMBER_ID: 'Member ID Edit',
    CENTER_ID: 'Center ID Edit',
};

interface AuditEntry {
    id: string;
    type: AuditType;
    menu: string;
    at: string;
    changedBy: string;
    /** Loan number, Member ID or Center ID the change was made on. */
    target: string;
    targetName: string;
    summary: string;
    reason: string;
    /** One human-readable line per individual change. */
    lines: string[];
}

const personName = (u: { firstName: string | null; lastName: string | null; email: string | null } | null) =>
    u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || 'Unknown' : 'Unknown';
const clientName = (c: { firstName: string | null; lastName: string | null; clientId: string } | null) =>
    c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.clientId : '';

const FIELD_LABEL: Record<string, string> = {
    dueDate: 'due date',
    principalDue: 'principal due',
    interestDue: 'interest due',
    savingsDue: 'savings due',
    savingsPaid: 'savings paid',
    principalPaid: 'principal paid',
    interestPaid: 'interest paid',
    status: 'status',
};

/** Row-by-row before → after lines for a schedule edit snapshot pair. */
function diffScheduleSnapshots(before: unknown, after: unknown): string[] {
    if (!Array.isArray(before) || !Array.isArray(after)) return [];
    const out: string[] = [];
    after.forEach((a, i) => {
        const b = before[i] as Record<string, unknown> | undefined;
        const row = a as Record<string, unknown>;
        if (!b) return;
        const changes: string[] = [];
        for (const key of Object.keys(FIELD_LABEL)) {
            if (key in row && key in b && row[key] !== b[key]) changes.push(`${FIELD_LABEL[key]} ${b[key]} → ${row[key]}`);
        }
        if (changes.length > 0) out.push(`Installment ${row.installmentNo}: ${changes.join(', ')}`);
    });
    return out;
}

/**
 * GET /api/super-control/audit-history?type=&q=&from=&to=&page=&pageSize=
 * One merged, newest-first timeline of every Super Control change: who changed what, when.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
            const typeParam = (searchParams.get('type') || 'ALL').toUpperCase();
            const q = (searchParams.get('q') || '').trim();
            const from = (searchParams.get('from') || '').trim();
            const to = (searchParams.get('to') || '').trim();
            const branchId = (searchParams.get('branchId') || '').trim();

            const dateFilter: Prisma.DateTimeFilter | undefined =
                from || to
                    ? {
                          ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { gte: parseKolkataAttendanceDateYmd(from) } : {}),
                          ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { lt: getKolkataDayEndExclusiveUtc(parseKolkataAttendanceDateYmd(to)) } : {}),
                      }
                    : undefined;

            const wants = (t: AuditType) => typeParam === 'ALL' || typeParam === t || (typeParam === 'FUNDER' && (t === 'INDIVIDUAL_FUNDER' || t === 'BULK_FUNDER'));
            const take = page * pageSize; // enough from each source to build this page after merging
            const userSelect = { select: { firstName: true, lastName: true, email: true } } as const;

            const loanSearch: Prisma.LoanWhereInput | undefined = q || branchId
                ? {
                      ...(branchId ? { branchId } : {}),
                      ...(q ? { OR: [
                          { loanNumber: { contains: q, mode: 'insensitive' } },
                          { client: { clientId: { contains: q, mode: 'insensitive' } } },
                          { client: { firstName: { contains: q, mode: 'insensitive' } } },
                          { client: { lastName: { contains: q, mode: 'insensitive' } } },
                      ] } : {}),
                  }
                : undefined;

            const entries: AuditEntry[] = [];
            let total = 0;

            // ── Funder changes (individual + bulk share one table; bulk rows carry a "[Bulk]" reason) ──
            if (wants('INDIVIDUAL_FUNDER') || wants('BULK_FUNDER')) {
                const bulkOnly = typeParam === 'BULK_FUNDER';
                const individualOnly = typeParam === 'INDIVIDUAL_FUNDER';
                const where: Prisma.LoanFunderChangeLogWhereInput = {
                    ...(dateFilter ? { createdAt: dateFilter } : {}),
                    ...(loanSearch ? { loan: loanSearch } : {}),
                    ...(bulkOnly ? { reason: { startsWith: '[Bulk]' } } : {}),
                    ...(individualOnly ? { NOT: { reason: { startsWith: '[Bulk]' } } } : {}),
                };
                const [count, rows] = await Promise.all([
                    prisma.loanFunderChangeLog.count({ where }),
                    prisma.loanFunderChangeLog.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        take,
                        include: {
                            changedBy: userSelect,
                            loan: { select: { loanNumber: true, client: { select: { clientId: true, firstName: true, lastName: true } } } },
                        },
                    }),
                ]);
                total += count;
                for (const r of rows) {
                    const snap = r.snapshot as { oldFunderName?: string; newFunderName?: string; moves?: { group: string; component: string; date: string; amount: number; fromVoucherNo: string; fromLedgerName: string; toLedgerName: string }[]; warnings?: string[] } | null;
                    const isBulk = r.reason.startsWith('[Bulk]');
                    const type: AuditType = isBulk ? 'BULK_FUNDER' : 'INDIVIDUAL_FUNDER';
                    entries.push({
                        id: r.id,
                        type,
                        menu: TYPE_LABEL[type],
                        at: r.createdAt.toISOString(),
                        changedBy: personName(r.changedBy),
                        target: `Loan ${r.loan.loanNumber}`,
                        targetName: `${clientName(r.loan.client)} (${r.loan.client.clientId})`,
                        summary: `Funder ${snap?.oldFunderName ?? '—'} → ${snap?.newFunderName ?? '—'}`,
                        reason: isBulk ? r.reason.replace(/^\[Bulk\]\s*/, '') : r.reason,
                        lines: [
                            ...(snap?.moves ?? []).map(
                                (m) => `${m.date} ${m.group === 'DISBURSEMENT' ? 'Disbursement' : 'EOD collection'} ${m.component.toLowerCase()} ₹${m.amount}: voucher ${m.fromVoucherNo} ${m.fromLedgerName} → ${m.toLedgerName}`
                            ),
                            ...(snap?.warnings ?? []).map((w) => `Warning: ${w}`),
                        ],
                    });
                }
            }

            // ── Schedule edits ──
            if (wants('SCHEDULE')) {
                const where: Prisma.LoanScheduleEditLogWhereInput = {
                    ...(dateFilter ? { createdAt: dateFilter } : {}),
                    ...(loanSearch ? { loan: loanSearch } : {}),
                };
                const [count, rows] = await Promise.all([
                    prisma.loanScheduleEditLog.count({ where }),
                    prisma.loanScheduleEditLog.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        take,
                        include: {
                            editedBy: userSelect,
                            loan: { select: { loanNumber: true, client: { select: { clientId: true, firstName: true, lastName: true } } } },
                        },
                    }),
                ]);
                total += count;
                for (const r of rows) {
                    const lines = diffScheduleSnapshots(r.beforeSnapshot, r.afterSnapshot);
                    entries.push({
                        id: r.id,
                        type: 'SCHEDULE',
                        menu: TYPE_LABEL.SCHEDULE,
                        at: r.createdAt.toISOString(),
                        changedBy: personName(r.editedBy),
                        target: `Loan ${r.loan.loanNumber}`,
                        targetName: `${clientName(r.loan.client)} (${r.loan.client.clientId})`,
                        summary: r.mode === 'REPAIR' ? `Data repair — ${lines.length} installment(s)` : `${lines.length} installment(s) edited${r.mode === 'DATES_ONLY' ? ' (due dates)' : ''}`,
                        reason: r.reason,
                        lines,
                    });
                }
            }

            // ── Member ID edits ──
            if (wants('MEMBER_ID')) {
                const where: Prisma.ClientIdChangeLogWhereInput = {
                    ...(dateFilter ? { createdAt: dateFilter } : {}),
                    ...(branchId ? { client: { center: { branchId } } } : {}),
                    ...(q
                        ? {
                              OR: [
                                  { oldClientId: { contains: q, mode: 'insensitive' } },
                                  { newClientId: { contains: q, mode: 'insensitive' } },
                                  { client: { firstName: { contains: q, mode: 'insensitive' } } },
                                  { client: { lastName: { contains: q, mode: 'insensitive' } } },
                              ],
                          }
                        : {}),
                };
                const [count, rows] = await Promise.all([
                    prisma.clientIdChangeLog.count({ where }),
                    prisma.clientIdChangeLog.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        take,
                        include: { changedBy: userSelect, client: { select: { firstName: true, lastName: true, clientId: true } } },
                    }),
                ]);
                total += count;
                for (const r of rows) {
                    entries.push({
                        id: r.id,
                        type: 'MEMBER_ID',
                        menu: TYPE_LABEL.MEMBER_ID,
                        at: r.createdAt.toISOString(),
                        changedBy: personName(r.changedBy),
                        target: `Member ${r.newClientId}`,
                        targetName: clientName(r.client),
                        summary: `Member ID ${r.oldClientId} → ${r.newClientId}`,
                        reason: r.reason,
                        lines: [],
                    });
                }
            }

            // ── Center ID edits (Create Center → edit, Admin/Sub Admin) ──
            if (wants('CENTER_ID')) {
                const where: Prisma.CenterIdChangeLogWhereInput = {
                    ...(dateFilter ? { createdAt: dateFilter } : {}),
                    ...(q
                        ? {
                              OR: [
                                  { oldCode: { contains: q, mode: 'insensitive' } },
                                  { newCode: { contains: q, mode: 'insensitive' } },
                                  { center: { name: { contains: q, mode: 'insensitive' } } },
                                  { center: { branch: { name: { contains: q, mode: 'insensitive' } } } },
                              ],
                          }
                        : {}),
                };
                const [count, rows] = await Promise.all([
                    prisma.centerIdChangeLog.count({ where }),
                    prisma.centerIdChangeLog.findMany({
                        where,
                        orderBy: { createdAt: 'desc' },
                        take,
                        include: {
                            changedBy: userSelect,
                            center: { select: { name: true, branch: { select: { code: true, name: true } } } },
                        },
                    }),
                ]);
                total += count;
                for (const r of rows) {
                    entries.push({
                        id: r.id,
                        type: 'CENTER_ID',
                        menu: TYPE_LABEL.CENTER_ID,
                        at: r.createdAt.toISOString(),
                        changedBy: personName(r.changedBy),
                        target: `Center ${r.newCode}`,
                        targetName: `${r.center.name} (Branch ${r.center.branch.code} - ${r.center.branch.name})`,
                        summary: `Center ID ${r.oldCode} → ${r.newCode}`,
                        reason: r.reason,
                        lines: [],
                    });
                }
            }

            entries.sort((a, b) => b.at.localeCompare(a.at));
            const pageEntries = entries.slice((page - 1) * pageSize, page * pageSize);

            return successResponse({
                entries: pageEntries,
                totalCount: total,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
                page,
                pageSize,
                today: getKolkataCalendarYmd(new Date()),
            });
        } catch (error) {
            console.error('[super-control audit-history] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to load audit history', 500);
        }
    })(request);
}
