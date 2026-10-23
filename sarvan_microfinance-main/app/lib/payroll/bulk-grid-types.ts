import type { GridEdits, GridRowBase } from './payroll-grid';

/** One employee row of the Bulk Payroll grid, as returned by
 * POST /api/payroll/salary-pay/bulk-run/preview — the identity/org columns
 * of the org's Payroll excel sheet plus the server-computed `base` that the
 * client recomputes live (computeGridRow) as cells are edited. */
export type BulkGridRow = {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    status: 'Live' | 'Exit';
    dateOfJoining: string | null;
    region: string | null;
    division: string | null;
    area: string | null;
    branchCode: string | null;
    branchName: string | null;
    designation: string | null;
    department: string | null;
    existingStatus: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID' | null;
    hasCtc: boolean;
    willRun: boolean;
    reason?: string;
    /** Where LOP came from, e.g. "From attendance: 2 absent · 0.5 half-day short". */
    lopNote?: string;
    base: GridRowBase | null;
};

export type BulkGridPreview = {
    total: number;
    willRunCount: number;
    blockedCount: number;
    rows: BulkGridRow[];
};

/** What the grid sends on Run — only the cells the user actually edited. */
export type BulkRunRowInput = { employeeId: string; edits: GridEdits };
