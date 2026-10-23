// ============================================================
// LOAN ADVANCE FEATURE FLAG HOOK — Client-side gate for the Loan Advance
// feature (Client.loanAdvance wallet / Loan Advance Refund / related
// reports). Backed by the admin-controlled LoanAdvanceConfig singleton.
//
// Usage:
//   const { enabled, loading } = useLoanAdvanceEnabled();
//   if (!loading && !enabled) return null; // hide field/column/menu item
// ============================================================

'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';

export function useLoanAdvanceEnabled() {
    const [enabled, setEnabled] = useState(true); // default true until fetched
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await apiClient.get<{ enabled: boolean }>('/settings/loan-advance');
                if (!cancelled && result.success && result.data) {
                    setEnabled(result.data.enabled);
                }
            } catch {
                // keep default (true) on failure
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return { enabled, loading };
}
