// Mirrors components/reports/InsuranceReportClient.tsx's `insuranceWordOptions` literal.
// Flat, ungrouped, fixed-order 65 columns (64 COLUMNS + Status) matching an external
// insurer submission spec, including two intentionally duplicated column pairs
// (Number Of Installments Per Month at #24 & #28, Occupation at #38 & #60) —
// fetchInsuranceReport returns the exact same 65 columns in the exact same order,
// duplicates included. Widest report in the app; needs A3 landscape. No totals row.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

// label + align mirrors the client's module-level COLUMNS metadata (align omitted = 'left').
const COLUMN_META: { label: string; align?: 'left' | 'right' | 'center' }[] = [
    { label: 'Master Code' }, { label: 'Agent code' }, { label: 'Source' }, { label: 'CAFOS Code' }, { label: 'FSC/FSM code' },
    { label: 'Branch ID' }, { label: 'Branch Name' }, { label: 'Member Id' }, { label: 'Loan ID' }, { label: 'Member Name' },
    { label: 'Last Name' }, { label: 'DOB' }, { label: 'Salutation' }, { label: 'Gender' },
    { label: 'Address 1' }, { label: 'Address 2' }, { label: 'Address 3' }, { label: 'Address 4' },
    { label: 'City' }, { label: 'State' }, { label: 'Country' }, { label: 'Pincode' },
    { label: 'Loan Amount', align: 'right' }, { label: 'Number Of Installments Per Month', align: 'right' }, { label: 'Sum Assured', align: 'right' }, { label: 'LD Date' },
    { label: 'Type of Cover (Single Life / Joint Life)' }, { label: 'Number Of Installments Per Month', align: 'right' }, { label: 'Premium Amount', align: 'right' },
    { label: 'ADB SA', align: 'right' }, { label: 'Accelerated TI Benefit', align: 'right' }, { label: 'Type of cover (Level / Reducing)' },
    { label: 'Nominee First Name' }, { label: 'Nominee SurName' }, { label: 'Nominee Gender' }, { label: 'Nominee DOB' }, { label: 'Nominee Relationship with LA' },
    { label: 'Occupation' }, { label: 'Medical Questions YES/No' }, { label: 'Member Consent to Split Payment' },
    { label: 'Spouse/CoApplicant First Name' }, { label: 'Spouse/CoApplicant Last Name' }, { label: 'Spouse/CoApplicant DOB' }, { label: 'Spouse/CoApplicant Gender' }, { label: 'Spouse/CoApplicant Relationship with LA' },
    { label: 'CoApplicant Hse/Flat' }, { label: 'CoApplicant Street' }, { label: 'CoApplicant Area' }, { label: 'CoApplicant City' }, { label: 'CoApplicant State' }, { label: 'CoApplicant ZIPCODE' },
    { label: 'UTRN No.' }, { label: 'Fund Transfer Date' },
    { label: 'Appointee Name' }, { label: 'Appointee SurName' }, { label: 'Appointee Gender' }, { label: 'Appointee DOB' }, { label: 'Appointee Relationship with Nominee' },
    { label: 'Member Consent to Cover Continuation' }, { label: 'Occupation' }, { label: 'Mobile No' },
    { label: 'COVID-19 tested/self-isolated (3mo)' }, { label: 'COVID-19 advised isolation/symptoms (1mo)' }, { label: 'Overseas travel post 1 Jan 2020 / next 6mo' },
];

export const buildInsuranceReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: [...COLUMN_META.map((c) => c.align ?? 'left'), 'center'],
        columnWidthWeights: [...COLUMN_META.map((c) => (c.align === 'right' ? 8 : Math.max(7, Math.min(14, c.label.length)))), 8],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
