'use client';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { HOTransactionClient } from '@/components/transactions/HOTransactionClient';

/**
 * HO Transaction page — accessible to Admin, Branch Manager, and Area Manager.
 *
 * Access rules (enforced both at middleware and API level):
 *   ADMIN             — may select any branch, post for any date
 *   BRANCH_MANAGER    — own branch, current working day only
 *   AREA_MANAGER      — own branch, current working day only
 */
export default function HOTransactionPage() {
    return (
        <ProtectedRoute>
            <HOTransactionClient />
        </ProtectedRoute>
    );
}
