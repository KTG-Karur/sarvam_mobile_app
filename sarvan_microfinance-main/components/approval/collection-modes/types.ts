export interface CollectionRow {
    transactionId: string;
    batchId: string | null;
    clientId: string;
    clientCode: string;
    clientName: string;
    loanNumber: string;
    productName: string;
    funderName: string;
    isGoldLoan: boolean;
    centerName: string;
    centerCode: string;
    collectedByName: string;
    collectedById: string;
    dueCount: string;
    dueDate: string | null;
    collectionDate: string;
    status: string;
    // ADVANCE = EMI repaid before its due date; LOAN_ADVANCE = loan-advance wallet
    // collection only (no EMI) — gated by the Loan Advance feature flag.
    mode: 'DEMAND' | 'ADVANCE' | 'ARREAR' | 'LOAN_ADVANCE';
    collectionType: 'ADVANCE' | 'ARREAR' | 'MIXED';
    loanAmount: number;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    loanAdvanceAmount: number;
    walletAdvance: number;
    walletPay: number;
    thrift1: number;
    thrift2: number;
    remarks: string | null;
    isEodLocked: boolean;
    isAllocationLocked: boolean;
    isReversed?: boolean;
    revertedAt?: string | null;
    revertedByName?: string | null;
    revertedByEmployeeId?: string | null;
    revertReason?: string | null;
    revertLocation?: { latitude: number; longitude: number } | null;
}

export interface DenominationCenterRow {
    centerName: string;
    centerCode: string;
    d500: number; d200: number; d100: number; d50: number;
    d20: number; d10: number; d5: number; d2: number; d1: number;
    totalAmount: number;
}

export interface PendingCollectionsResponse {
    rows: CollectionRow[];
    denominationByCenter: DenominationCenterRow[];
}

export const formatCurrency = (amount: number): string =>
    `₹${Math.round(amount).toLocaleString('en-IN')}`;

export const formatDate = (date: string | null): string => {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}-${month}-${d.getFullYear()}`;
};
