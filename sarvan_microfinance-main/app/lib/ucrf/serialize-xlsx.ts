import * as XLSX from 'xlsx';
import { ERROR_COLUMNS, REPORT_COLUMNS, errorRows } from './serialize';
import type { UcrfRecord } from './types';

const AMOUNT_FORMAT = '#,##0';
const INTEGER_FORMAT = '0';
const DATE_FORMAT = 'dd-mmm-yyyy';

function ymdToDate(ymd: string): Date {
    // Midday UTC keeps the calendar day stable whatever timezone the workbook is opened in.
    return new Date(`${ymd}T12:00:00Z`);
}

/**
 * Genuine .xlsx workbook. Amounts/DPD/counts are written as numeric cells (t:'n') with number
 * formats applied separately; identifiers stay text (t:'s') so leading zeros survive; dates are
 * real date cells.
 */
export function buildXlsx(records: UcrfRecord[], recordsForErrors: UcrfRecord[] = records): Buffer {
    const wb = XLSX.utils.book_new();

    const aoa: Array<Array<string | number | Date | null>> = [REPORT_COLUMNS.map((c) => c.header)];
    for (const r of records) {
        aoa.push(
            REPORT_COLUMNS.map((c) => {
                const v = c.value(r);
                if (v === null || v === '') return null;
                if (c.kind === 'date' && typeof v === 'string') return ymdToDate(v);
                return v;
            })
        );
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });

    REPORT_COLUMNS.forEach((c, colIdx) => {
        for (let row = 1; row < aoa.length; row++) {
            const cell = ws[XLSX.utils.encode_cell({ r: row, c: colIdx })];
            if (!cell) continue;
            if (c.kind === 'amount') cell.z = AMOUNT_FORMAT;
            else if (c.kind === 'integer') cell.z = INTEGER_FORMAT;
            else if (c.kind === 'date') cell.z = DATE_FORMAT;
            else if (typeof cell.v === 'string') cell.t = 's'; // never let a reader coerce identifiers
        }
    });
    ws['!cols'] = REPORT_COLUMNS.map((c) => ({ wch: Math.max(12, Math.min(40, c.header.length + 2)) }));
    ws['!freeze'] = { xSplit: 0, ySplit: 1 } as unknown as XLSX.WorkSheet['!freeze'];
    XLSX.utils.book_append_sheet(wb, ws, 'UCRF Report');

    const errAoa: Array<Array<string | number>> = [[...ERROR_COLUMNS], ...errorRows(recordsForErrors)];
    const wsErr = XLSX.utils.aoa_to_sheet(errAoa);
    for (let row = 1; row < errAoa.length; row++) {
        const fieldNo = wsErr[XLSX.utils.encode_cell({ r: row, c: 3 })];
        if (fieldNo) fieldNo.z = INTEGER_FORMAT;
    }
    wsErr['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 9 }, { wch: 34 }, { wch: 22 }, { wch: 70 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsErr, 'Validation Errors');

    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer', cellDates: true }) as Buffer;
}
