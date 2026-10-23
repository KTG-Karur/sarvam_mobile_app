/**
 * Controlled-value tables for UCRF v3.3.1 (MFI incl. SHG) — transcribed from the
 * specification PDF (Appendix B state codes, Appendix C PIN prefixes, Appendix D loan
 * categories and the per-field enumerations). Never extend these from sample data.
 */

export const UCRF_LAYOUT_VERSION = '3.3';
export const UCRF_FILE_NAME_TAG = 'HMMFI';
export const UCRF_ORG_STRUCTURE_JLG = 'JLG';

/** Appendix B — State Code → description. */
export const STATE_CODES: Record<string, string> = {
    AN: 'Andaman and Nicobar Islands', AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam',
    BR: 'Bihar', CG: 'Chandigarh', CH: 'Chhattisgarh', DD: 'Dadra and Nagar Haveli and Daman & Diu',
    DL: 'Delhi', LA: 'Ladakh', GA: 'Goa', GJ: 'Gujarat', HP: 'Himachal Pradesh', HR: 'Haryana',
    JH: 'Jharkhand', JK: 'Jammu and Kashmir', KA: 'Karnataka', KL: 'Kerala', LD: 'Lakshadweep',
    MH: 'Maharashtra', ML: 'Meghalaya', MN: 'Manipur', MP: 'Madhya Pradesh', MZ: 'Mizoram',
    NL: 'Nagaland', OR: 'Orissa', PB: 'Punjab', PY: 'Puducherry', RJ: 'Rajasthan', SK: 'Sikkim',
    TN: 'Tamil Nadu', TR: 'Tripura', TS: 'Telangana State', UK: 'Uttarakhand', UP: 'Uttar Pradesh',
    WB: 'West Bengal',
};
// NOTE: Appendix B of the PDF prints HP = "Haryana", HR = "Himachal Pradesh", JH = "Jammu and
// Kashmir" and JK = "Jharkhand", but Appendix C (PIN table) pairs them the other way round
// (HP = Himachal 17, HR = Haryana 12-13, JK = J&K 18-19, JH = Jharkhand 81-83). We follow Appendix C
// because it is consistent with real PIN prefixes — flagged for confirmation with the CIC.
const STATE_NAME_TO_CODE: Record<string, string> = {
    'andaman and nicobar islands': 'AN', 'andaman & nicobar islands': 'AN', 'andaman': 'AN',
    'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', 'assam': 'AS', 'bihar': 'BR',
    'chandigarh': 'CG', 'chhattisgarh': 'CH', 'chattisgarh': 'CH',
    'dadra and nagar haveli and daman and diu': 'DD', 'dadra & nagar haveli and daman & diu': 'DD',
    'dadra and nagar haveli': 'DD', 'daman and diu': 'DD', 'daman & diu': 'DD',
    'delhi': 'DL', 'new delhi': 'DL', 'ladakh': 'LA', 'goa': 'GA', 'gujarat': 'GJ',
    'haryana': 'HR', 'himachal pradesh': 'HP', 'jammu and kashmir': 'JK', 'jammu & kashmir': 'JK',
    'jharkhand': 'JH', 'karnataka': 'KA', 'kerala': 'KL', 'lakshadweep': 'LD',
    'maharashtra': 'MH', 'meghalaya': 'ML', 'manipur': 'MN', 'madhya pradesh': 'MP', 'mizoram': 'MZ',
    'nagaland': 'NL', 'orissa': 'OR', 'odisha': 'OR', 'punjab': 'PB', 'puducherry': 'PY',
    'pondicherry': 'PY', 'rajasthan': 'RJ', 'sikkim': 'SK', 'tamil nadu': 'TN', 'tamilnadu': 'TN',
    'tripura': 'TR', 'telangana': 'TS', 'uttarakhand': 'UK', 'uttaranchal': 'UK',
    'uttar pradesh': 'UP', 'west bengal': 'WB',
};

/** Appendix C — allowed first-two-digit PIN prefix range per state code. */
export const PIN_PREFIX_RANGE: Record<string, [number, number]> = {
    JK: [18, 19], HP: [17, 17], PB: [14, 16], CG: [14, 16], UK: [24, 26], HR: [12, 13], DL: [11, 11],
    RJ: [30, 34], UP: [20, 28], BR: [80, 85], SK: [73, 73], AR: [78, 79], NL: [79, 79], MN: [79, 79],
    MZ: [79, 79], TR: [72, 79], ML: [79, 79], AS: [78, 79], WB: [70, 74], JH: [81, 83], OR: [75, 77],
    CH: [46, 49], MP: [45, 48], GJ: [36, 39], DD: [36, 39], MH: [40, 44], KA: [53, 59], GA: [40, 40],
    LD: [67, 68], KL: [67, 69], TN: [53, 67], PY: [53, 67], AN: [74, 74], TS: [50, 56], AP: [50, 56],
    LA: [18, 19],
};

export function resolveStateCode(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const t = raw.trim();
    if (!t) return null;
    const upper = t.toUpperCase();
    if (upper === 'UA') return 'UK'; // "UK (Formerly UA)"
    if (STATE_CODES[upper] && upper.length === 2) return upper;
    return STATE_NAME_TO_CODE[t.toLowerCase().replace(/\s+/g, ' ')] ?? null;
}

export const LOAN_CATEGORIES = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'] as const;
export const JLG_LOAN_CATEGORIES = ['T01', 'T02', 'T03'] as const;
export const FILE_FREQUENCIES = ['DL', 'W1', 'W2', 'W3', 'ME', 'DC', 'AH', 'RR'] as const;
export const REPAYMENT_FREQUENCIES = ['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07', 'F08', 'F10', 'F11', 'F12'] as const;
export const ACCOUNT_STATUSES = [
    'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15', 'S16', 'S17', 'S18',
] as const;
export const CLOSED_STATUSES = ['S07', 'S09', 'S12'] as const;
export const RELATIONSHIP_CODES = [
    'K01', 'K02', 'K03', 'K04', 'K05', 'K06', 'K07', 'K08', 'K09', 'K10', 'K11', 'K12', 'K13', 'K15', 'K16',
] as const;
export const PHONE_TYPES = ['P01', 'P02', 'P03', 'P04', 'P07', 'P08'] as const;
export const WRITE_OFF_REASONS = ['X01', 'X02', 'X03', 'X04', 'X09', 'X10'] as const;
export const MARITAL_CODES = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06'] as const;
export const EDUCATION_CODES = ['Y01', 'Y02', 'Y03', 'Y04', 'Y05'] as const;
export const RELIGION_CODES = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09'] as const;
export const CASTE_CODES = ['V01', 'V02', 'V03', 'V04', 'V05', 'V08', 'V09'] as const;
export const OCCUPATION_CODES = ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06'] as const;
export const MEMBER_STATUS_CODES = ['W01', 'W02', 'W03', 'W04'] as const;
export const MEMBER_ROLE_CODES = ['L01', 'L02', 'L03', 'L04'] as const;
export const INSURANCE_TYPES = ['L01', 'L02', 'L03', 'L04', 'L05', 'L10'] as const;

export function mapGender(raw: string | null | undefined): 'F' | 'M' | 'T' | null {
    const v = (raw ?? '').trim().toUpperCase();
    if (v === 'F' || v === 'FEMALE') return 'F';
    if (v === 'M' || v === 'MALE') return 'M';
    if (v === 'T' || v === 'TRANSGENDER' || v === 'THIRD GENDER' || v === 'OTHER' || v === 'OTHERS') return 'T';
    return null;
}

/** Loan.frequency (free string in this schema) → UCRF Repayment Frequency. */
export function mapRepaymentFrequency(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    switch (v) {
        case 'DAILY': return 'F11';
        case 'WEEKLY': return 'F01';
        case 'BIWEEKLY':
        case 'FORTNIGHTLY':
        case 'FORTHNIGHT':
        case 'FORTNIGHT': return 'F02';
        case 'MONTHLY': return 'F03';
        case 'BIMONTHLY':
        case 'EVERY_TWO_MONTHS': return 'F04';
        case 'QUARTERLY': return 'F05';
        case 'HALF_YEARLY':
        case 'SEMI_ANNUALLY':
        case 'SEMIANNUALLY': return 'F06';
        case 'YEARLY':
        case 'ANNUALLY': return 'F07';
        default: return null;
    }
}

/**
 * Free-text relation (Client.nomineeRelation) → K-code. "Spouse" is resolved from the member's own
 * gender (female member → husband K02, male → wife K06); unrecognised text yields null, never K15.
 */
export function mapRelationship(raw: string | null | undefined, memberGender?: string | null): string | null {
    const v = (raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
    if (!v) return null;
    if (v === 'spouse') {
        const g = mapGender(memberGender);
        return g === 'F' ? 'K02' : g === 'M' ? 'K06' : null;
    }
    const table: Record<string, string> = {
        father: 'K01', husband: 'K02', mother: 'K03', son: 'K04', daughter: 'K05', wife: 'K06',
        brother: 'K07', 'mother in law': 'K08', 'father in law': 'K09', 'daughter in law': 'K10',
        'sister in law': 'K11', 'son in law': 'K12', 'brother in law': 'K13', other: 'K15', sister: 'K16',
    };
    return table[v] ?? null;
}

export function mapMaritalStatus(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim().toLowerCase();
    if (!v) return null;
    if (v.startsWith('married')) return 'M01';
    if (v.startsWith('separat')) return 'M02';
    if (v.startsWith('divorc')) return 'M03';
    if (v.startsWith('widow')) return 'M04';
    if (v === 'unmarried' || v === 'single' || v === 'never married') return 'M05';
    return null;
}

export function mapReligion(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim().toLowerCase();
    const t: Record<string, string> = {
        hindu: 'R01', hinduism: 'R01', muslim: 'R02', islam: 'R02', christian: 'R03', christianity: 'R03',
        sikh: 'R04', buddhist: 'R05', jain: 'R06', bahai: 'R07', others: 'R08', other: 'R08',
    };
    return t[v] ?? null;
}

export function mapCaste(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim().toLowerCase();
    const t: Record<string, string> = {
        sc: 'V01', st: 'V02', bc: 'V03', obc: 'V03', mbc: 'V03', dnc: 'V04', 'nt/vj': 'V04', nt: 'V04', vj: 'V04',
        general: 'V05', oc: 'V05', others: 'V08', other: 'V08',
    };
    return t[v] ?? null;
}

export function mapEducation(raw: string | null | undefined): string | null {
    const v = (raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!v) return null;
    if (v.includes('illiterate') || v === 'no education' || v === 'none') return 'Y01';
    if (v.includes('5th') || v.includes('primary')) return 'Y02';
    if (v.includes('8th') || v.includes('middle')) return 'Y03';
    if (v.includes('10th') || v.includes('sslc') || v.includes('matric')) return 'Y04';
    if (v.includes('above') || v.includes('12th') || v.includes('degree') || v.includes('graduate') || v.includes('diploma') || v.includes('hsc')) return 'Y05';
    return null;
}
