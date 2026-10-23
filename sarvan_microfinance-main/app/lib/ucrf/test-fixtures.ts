import { verhoeffCheckDigit } from './id-validation';
import type { UcrfConfig, UcrfLoanInput } from './types';

/** Synthetic data only — shaped like the sample .CDF, no real member/KYC values. */
export const TEST_CONFIG: UcrfConfig = {
    memberId: 'NBF0000001',
    institutionName: 'TEST FINANCE PVT LTD',
    submittingBranchId: '',
    fileFrequency: 'ME',
    oldMemberId: '',
    loanCategory: 'T02',
};

export const REPORT_YMD = '2026-04-30';

export function syntheticAadhaar(payload = '12345678901'): string {
    return payload + verhoeffCheckDigit(payload);
}

export function makeInput(over: Partial<UcrfLoanInput> = {}): UcrfLoanInput {
    const schedules = Array.from({ length: 4 }, (_, i) => ({
        dueYmd: `2026-0${i + 1}-15`,
        principalDue: 1000,
        interestDue: 100,
        status: 'PENDING',
        principalPaid: 0,
        interestPaid: 0,
    }));
    const base: UcrfLoanInput = {
        loanId: 'loan_1',
        loanNumber: '000123',
        client: {
            dbId: 'client_1',
        clientId: '00045',
            firstName: 'Asha',
            lastName: 'Devi',
            gender: 'FEMALE',
            dobYmd: '1990-05-17',
            maritalStatus: 'Married',
            fatherName: 'Ram Lal',
            motherName: null,
            spouseName: 'Mohan Lal',
            spouseGender: 'MALE',
            nomineeName: 'Mohan Lal',
            nomineeRelation: 'Husband',
            votersIdNo: null,
            aadhaar: syntheticAadhaar(),
            pancardNo: null,
            mobileNumber: '9876501234',
            phone: null,
            email: null,
            qualification: '8th',
            bankName: null,
            ifscCode: null,
            bankAcNo: null,
            monthlyFamilyIncome: 15000,
            monthlyFamilyExpense: 8000,
            religion: 'Hindu',
            caste: 'BC',
            permanentAddress: '12 Main Street Alwar',
            state: 'Rajasthan',
            pincode: '301001',
        },
        branch: { id: 'br_1', code: 'BR01', name: 'Alwar' },
        center: { code: 'C07', name: 'Madhogarh' },
        groupIdentifier: 'BR01/C07/1',
        productName: 'JLG 45000',
        purposeName: 'LIVESTOCK',
        frequency: 'MONTHLY',
        appliedAmount: 45000,
        amount: 4000,
        disbursedYmd: '2026-01-10',
        closedYmd: null,
        disbursementStatus: 'DISBURSED',
        closureReason: null,
        schedules,
        lastPaymentYmd: null,
        writeOff: null,
        loanCycle: 1,
        insurance: null,
    };
    return { ...base, ...over, client: { ...base.client, ...(over.client ?? {}) } };
}

/** Pays the first `n` schedules in full. */
export function paySchedules(input: UcrfLoanInput, n: number): UcrfLoanInput {
    return {
        ...input,
        schedules: input.schedules.map((s, i) =>
            i < n ? { ...s, principalPaid: s.principalDue, interestPaid: s.interestDue, status: 'PAID' } : s
        ),
    };
}
