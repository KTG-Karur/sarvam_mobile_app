import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx-js-style';

vi.mock('@/app/lib/brand-context', () => ({
    getBrandNamesGlobal: () => ({ companyNameFull: 'Test Trust' }),
}));

import { applyExcelReportFont, normalizeNumericCells, parseNumericText } from './excel-report-header';

describe('parseNumericText', () => {
    it('parses display-formatted amounts', () => {
        expect(parseNumericText('1,23,456.00')).toEqual({ value: 123456, numFmt: '#,##0.00' });
        expect(parseNumericText('1,234,567')).toEqual({ value: 1234567, numFmt: '#,##0' });
        expect(parseNumericText('₹ 2,500.50')).toEqual({ value: 2500.5, numFmt: '#,##0.00' });
        expect(parseNumericText('Rs. 900')).toEqual({ value: 900, numFmt: '#,##0' });
        expect(parseNumericText('1,000/-')).toEqual({ value: 1000, numFmt: '#,##0' });
        expect(parseNumericText('-450.50')).toEqual({ value: -450.5, numFmt: '0.00' });
        expect(parseNumericText('(1,200.00)')).toEqual({ value: -1200, numFmt: '#,##0.00' });
        expect(parseNumericText('₹-75')).toEqual({ value: -75, numFmt: '#,##0' });
        expect(parseNumericText('12.5%')).toEqual({ value: 0.125, numFmt: '0.0%' });
        expect(parseNumericText('42')).toEqual({ value: 42 });
        expect(parseNumericText('0')).toEqual({ value: 0 });
        expect(parseNumericText('0.75')).toEqual({ value: 0.75, numFmt: '0.00' });
    });

    it('leaves identifiers, dates and text alone', () => {
        for (const s of ['9876543210', '123456789012', '00123', '01/10/2026', '2026-10-01', '10:30', 'LN-0001', '1,2', '1,234 Dr', '', 'N/A', '-']) {
            expect(parseNumericText(s)).toBeNull();
        }
    });
});

describe('normalizeNumericCells', () => {
    const build = () =>
        XLSX.utils.aoa_to_sheet([
            ['TEST TRUST'],
            ['Some Report'],
            [],
            ['Sl No', 'Client Name', 'Mobile', 'Loan No', 'Center Code', 'Amount', 'No of Clients'],
            [1, 'Ravi', '9876543', '1001', '205', '1,23,456.00', '12'],
            ['', 'Total', '', '', '', '₹ 2,00,000.00', '30'],
        ]);
    const cell = (ws: XLSX.WorkSheet, ref: string) => ws[ref] as XLSX.CellObject;

    it('converts numeric text into number cells with a matching format', () => {
        const ws = build();
        normalizeNumericCells(ws);
        expect(cell(ws, 'F5')).toMatchObject({ t: 'n', v: 123456, z: '#,##0.00' });
        expect(cell(ws, 'F6')).toMatchObject({ t: 'n', v: 200000, z: '#,##0.00' });
        expect(cell(ws, 'G5')).toMatchObject({ t: 'n', v: 12 });
        expect(cell(ws, 'B5')).toMatchObject({ t: 's', v: 'Ravi' });
    });

    it('keeps identifier columns as text', () => {
        const ws = build();
        normalizeNumericCells(ws);
        expect(cell(ws, 'C5')).toMatchObject({ t: 's', v: '9876543' });
        expect(cell(ws, 'D5')).toMatchObject({ t: 's', v: '1001' });
        expect(cell(ws, 'E5')).toMatchObject({ t: 's', v: '205' });
    });

    it('respects cells explicitly formatted as text', () => {
        const ws = XLSX.utils.aoa_to_sheet([['Amount'], ['500']]);
        (ws.A2 as XLSX.CellObject).z = '@';
        normalizeNumericCells(ws);
        expect(cell(ws, 'A2')).toMatchObject({ t: 's', v: '500' });
    });

    it('runs as part of applyExcelReportFont and survives a write round-trip', () => {
        const ws = build();
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'R');
        const back = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellNF: true });
        expect(back.Sheets.R.F5).toMatchObject({ t: 'n', v: 123456, z: '#,##0.00' });
    });
});
