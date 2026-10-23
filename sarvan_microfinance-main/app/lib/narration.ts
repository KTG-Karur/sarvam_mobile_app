/**
 * System-generated FinancialTransaction rows (EOD collection allocations, disbursement
 * postings, etc. — see app/lib/services/accounting-posting.service.ts) embed an
 * idempotency marker directly inside `description`, e.g.
 * "[POSTING:EOD_COLLECTION:branchId:2026-07-28:funderKey] Principal Amount Collected on 2026-07-28".
 * The marker must stay in the stored value (it's how the posting service detects a
 * duplicate run) but must never be shown to users. Strip it for display only.
 */
export function stripPostingMarker(description?: string | null): string {
    if (!description) return '';
    return description.replace(/^\[POSTING:[^\]]*\]\s*/, '').trim();
}
