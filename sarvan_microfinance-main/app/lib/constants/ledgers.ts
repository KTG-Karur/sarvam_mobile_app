/**
 * System Ledger IDs and Group Names
 * Use these constants throughout the app to ensure consistent ledger mapping.
 *
 * ACCOUNTING REFERENCE:
 *   Disbursement (Cash Payment):  Dr Loan Portfolio  /  Cr Cash in Hand
 *   Collection   (Cash Receipt):  Dr Cash in Hand    /  Cr Loan Portfolio / Interest Income
 */

// Reserved Ledger IDs for System Ledgers
export const SYSTEM_LEDGERS = {
    DOC_CHARGES: {
        id: "101",
        name: "Document Charge Income",
        group: "G-INC-IND"
    },
    INSURANCE_PAYABLE: {
        id: "102",
        name: "Member Insurance Payable",
        group: "G-LIAB-CUR"
    },
    CASH_IN_HAND: {
        id: "100",
        name: "Cash in Hand",
        group: "G-ASSET-CUR"
    },
    /**
     * LOAN_PORTFOLIO is the canonical asset ledger used as the DEBIT side
     * when cash is disbursed to a borrower (Cash Payment voucher).
     *
     * Accounting Entry on Disbursement:
     *   Debit:  Loan Portfolio (Asset ↑)
     *   Credit: Cash in Hand   (Asset ↓)
     */
    LOAN_PORTFOLIO: {
        id: "103",
        name: "Loan Portfolio",
        group: "G-ASSET-CUR"
    }
};

// Reserved System Group IDs
export const SYSTEM_GROUPS = {
    INCOME: "G-INC",
    LIABILITIES: "G-LIAB",
    ASSETS: "G-ASSET",
    EXPENSES: "G-EXP",
    INDIRECT_INCOME: "G-INC-IND",
    CURRENT_LIABILITIES: "G-LIAB-CUR",
    CURRENT_ASSETS: "G-ASSET-CUR"
};
