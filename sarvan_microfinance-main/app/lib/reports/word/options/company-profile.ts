// Mirrors components/reports/CompanyProfileClient.tsx's wordOptions literal. Freeform
// 2-column key/value summary sheet — no grouped headers, no totals row. fetchCompanyProfile
// returns the same 2-column ('Field', 'Value') shape.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildCompanyProfileWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['left', 'right'],
        columnWidthWeights: [16, 8],
    },
});
