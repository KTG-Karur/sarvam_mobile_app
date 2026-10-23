import { deriveAccountState } from './financials';
import { buildUcrfFields, makeWarn } from './field-map';
import { validateRecord, findDuplicateAccountRefs } from './validate';
import type { UcrfConfig, UcrfLoanInput, UcrfRecord, UcrfValidationIssue } from './types';

/** One loan → one UCRF record (100 fields) with its validation issues. The only place records are produced. */
export function buildUcrfRecord(input: UcrfLoanInput, config: UcrfConfig, reportYmd: string): UcrfRecord {
    const state = deriveAccountState(input, reportYmd);
    const warnings: UcrfValidationIssue[] = [];
    const fields = buildUcrfFields({
        input,
        config,
        reportYmd,
        state,
        warn: makeWarn(input, warnings),
    });
    // validateRecord reports both severities (Optional-field violations are field-level warnings).
    const found = validateRecord(input, fields, reportYmd);
    const errors = found.filter((i) => i.severity === 'error');
    const issues = [...found, ...warnings];

    return {
        loanId: input.loanId,
        loanNumber: input.loanNumber,
        memberId: input.client.clientId,
        clientDbId: input.client.dbId,
        memberName: `${input.client.firstName} ${input.client.lastName}`.replace(/\s+/g, ' ').trim(),
        branchId: input.branch.id,
        branchCode: input.branch.code,
        branchName: input.branch.name,
        centerCode: input.center.code,
        centerName: input.center.name,
        groupIdentifier: input.groupIdentifier,
        productName: input.productName,
        accountStatus: state.status,
        disbursementDate: input.disbursedYmd,
        closedDate: state.closedYmd,
        disbursedAmount: Math.trunc(input.amount),
        installmentAmount: state.installmentRupees,
        installments: state.installments,
        outstandingBalance: state.outstandingRupees,
        overdueAmount: state.overdueRupees,
        dpd: state.dpd,
        fields,
        issues,
        isValid: !errors.length,
    };
}

/** Marks later records that repeat an account reference as invalid (UCRF "Duplicate Record Handling"). */
export function flagDuplicateAccounts(records: UcrfRecord[]): void {
    const dups = findDuplicateAccountRefs(records.map((r) => ({ loanId: r.loanId, ref: r.fields[64] })));
    if (dups.size === 0) return;
    for (const r of records) {
        if (!dups.has(r.loanId)) continue;
        r.isValid = false;
        r.issues.push({
            loanId: r.loanId,
            loanNumber: r.loanNumber,
            memberId: r.memberId,
            fieldNo: 65,
            field: 'Unique Account Reference number',
            value: r.fields[64],
            reason: 'Duplicate account reference number in this file',
            suggestion: 'Account references must be unique',
            severity: 'error',
        });
    }
}

/**
 * Client.clientId is intentionally non-unique (legacy imports reuse an ID for two people). Two
 * different clients under one Member Identifier would be merged into one customer at the bureau,
 * so every record in such a collision is flagged. One client with several loans is fine.
 */
export function flagDuplicateMemberIds(records: UcrfRecord[]): void {
    const owners = new Map<string, Set<string>>();
    for (const r of records) {
        const set = owners.get(r.memberId) ?? new Set<string>();
        set.add(r.clientDbId);
        owners.set(r.memberId, set);
    }
    for (const r of records) {
        if ((owners.get(r.memberId)?.size ?? 0) < 2) continue;
        r.isValid = false;
        r.issues.push({
            loanId: r.loanId,
            loanNumber: r.loanNumber,
            memberId: r.memberId,
            fieldNo: 2,
            field: 'Member Identifier',
            value: r.memberId,
            reason: 'The same Member Identifier belongs to more than one client',
            suggestion: 'Give each client a unique member ID before reporting',
            severity: 'error',
        });
    }
}
