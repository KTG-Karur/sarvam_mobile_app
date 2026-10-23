'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Calendar, RefreshCw, Download, Loader2, Printer, FileText, FileType, FileOutput } from 'lucide-react';
import { getDCBData, DCBRow } from '@/app/lib/actions/reports';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { reportHtmlHeader } from '@/app/lib/reports/report-html-header';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawDcbReport } from '@/app/lib/reports/dcb-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { DateInput } from '@/components/ui/date-input';

// Helper to format currency — truncates (not rounds) to whole rupees.
const formatCurrency = formatReportAmount;

// Helper to format percentage
const formatPercentage = (value: number): string => {
    return value.toFixed(2);
};

/** Returns today's date as yyyy-MM-dd in IST */
const todayIst = () => {
    const now = new Date();
    // offset to IST (+05:30 = 330 min)
    const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
    return ist.toISOString().split('T')[0];
};

type BranchOption = { id: string; name: string; code: string };

export function DCBClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    /** 'single' = one date picker; 'range' = from + till pickers */
    const [mode, setMode] = useState<'single' | 'range'>('single');
    const [singleDate, setSingleDate] = useState<string>(todayIst());
    const [fromDate, setFromDate] = useState<string>(todayIst());
    const [tillDate, setTillDate] = useState<string>(todayIst());
    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<DCBRow[]>([]);

    /** Effective from/till based on current mode */
    const effectiveFrom = mode === 'single' ? singleDate : fromDate;
    const effectiveTill = mode === 'single' ? singleDate : tillDate;

    // Submitted (applied) date snapshot — frozen until the next Show click. Filenames,
    // PDF/Word subtitles, on-screen labels and the Request-Queue exportParams all read
    // this (not the live effectiveFrom/effectiveTill draft), so editing the date inputs
    // after Show has no effect on export/label output until Show is clicked again.
    const [submittedFrom, setSubmittedFrom] = useState<string>(effectiveFrom);
    const [submittedTill, setSubmittedTill] = useState<string>(effectiveTill);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown().then(setCenters).catch(() => {});
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    const handleShow = async () => {
        if (mode === 'single' && !singleDate) {
            toast({ title: 'Date required', description: 'Please select a date.', variant: 'destructive' });
            return;
        }
        if (mode === 'range' && (!fromDate || !tillDate)) {
            toast({ title: 'Date range required', description: 'Please select both From Date and Till Date.', variant: 'destructive' });
            return;
        }
        if (mode === 'range' && fromDate > tillDate) {
            toast({ title: 'Invalid date range', description: 'From Date cannot be after Till Date.', variant: 'destructive' });
            return;
        }

        setIsLoading(true);
        try {
            const result = await getDCBData(effectiveFrom, effectiveTill, selectedBranch, selectedCenter);
            setData(result);
            setShowReport(true);
            setSubmittedFrom(effectiveFrom);
            setSubmittedTill(effectiveTill);
            toast({
                title: 'Report generated',
                description: `Found ${result.length} record(s)${mode === 'single' ? ` for ${singleDate}` : ''}.`,
            });
        } catch (err) {
            toast({
                title: 'Error',
                description: err instanceof Error ? err.message : 'Failed to fetch report data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        const today = todayIst();
        setSingleDate(today);
        setFromDate(today);
        setTillDate(today);
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setSubmittedFrom(today);
        setSubmittedTill(today);
    };

    const handleExport = () => {
        if (!showReport || searchedRows.length === 0) {
            toast({
                title: 'No data to export',
                description: 'Please generate the report first before exporting.',
                variant: 'destructive',
            });
            return;
        }

        try {
            // Reuses the same field mapping (and Grand Total row) as the PDF/CSV/Word
            // exports below, so Excel no longer silently diverges from the other formats.
            const { headers, rows } = buildDCBExportRows();
            const excelData = rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));

            // Create worksheet
            const ws = buildReportSheet('DCB Report', excelData);
            autoSizeColumns(ws);
            applyExcelReportFont(ws);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "DCB Report");

            const fileName = `DCB_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
            XLSX.writeFile(wb, fileName);

            toast({
                title: 'Export successful',
                description: `Downloaded ${fileName}`,
            });
        } catch {
            toast({
                title: 'Export failed',
                description: 'Could not generate Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the exact same field mapping used by handleExport above (kept
    // separate so handleExport is left untouched).
    const buildDCBExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch ID', 'Branch Name', 'Date', 'Center ID', 'Center Name', 'FDO Name',
            'Opening Arr (P)', 'Opening Arr (I)', 'Opening Arr (Total)',
            'Curr Demand (P)', 'Curr Demand (I)', 'Curr Demand (Total)',
            'Total Demand (P)', 'Total Demand (I)', 'Total Demand (Total)',
            'Arrear Coll (P)', 'Arrear Coll (I)',
            'Curr Demand Coll (P)', 'Curr Demand Coll (I)',
            'Advance Coll (P)', 'Advance Coll (I)',
            'Preclosure (P)', 'Preclosure (I)',
            // 'WO Coll (P)', 'WO Coll (I)',
            // 'WO Waiver (P)', 'WO Waiver (I)',
            'OD Arrear Coll (P)', 'OD Arrear Coll (I)',
            'Total Coll (P)', 'Total Coll (I)',
            'Curr Arrear (P)', 'Curr Arrear (I)',
            'Closing Arr (P)', 'Closing Arr (I)',
            'RR %',
        ];
        const rows: (string | number)[][] = searchedRows.map(row => [
            row.branchCode, row.branchName, row.meetingDate, row.centerCode, row.centerName, row.fdoName,
            truncateReportAmount(row.openingArrPrincipal), truncateReportAmount(row.openingArrInterest), truncateReportAmount(row.openingArr),
            truncateReportAmount(row.demandPrincipal), truncateReportAmount(row.demandInterest), truncateReportAmount(row.demand),
            truncateReportAmount(row.openingArrPrincipal + row.demandPrincipal), truncateReportAmount(row.openingArrInterest + row.demandInterest), truncateReportAmount(row.openingArr + row.demand),
            truncateReportAmount(row.arrearCollPrincipal), truncateReportAmount(row.arrearCollInterest),
            truncateReportAmount(row.currDemandCollPrincipal), truncateReportAmount(row.currDemandCollInterest),
            truncateReportAmount(row.advanceCollPrincipal), truncateReportAmount(row.advanceCollInterest),
            truncateReportAmount(row.preclosurePrincipal), truncateReportAmount(row.preclosureInterest),
            // row.writeOffPrincipalColl ?? 0, row.writeOffInterestColl ?? 0,
            // row.writeOffWaiverPrincipal ?? 0, row.writeOffWaiverInterest ?? 0,
            truncateReportAmount(row.odArrearCollPrincipal), truncateReportAmount(row.odArrearCollInterest),
            truncateReportAmount(row.totalCollPrincipal), truncateReportAmount(row.totalCollInterest),
            truncateReportAmount(row.currArrearPrincipal + row.todayPendingPrincipal), truncateReportAmount(row.currArrearInterest + row.todayPendingInterest),
            truncateReportAmount(row.closingArrPrincipal), truncateReportAmount(row.closingArrInterest),
            Number(row.recPercentage.toFixed(2)),
        ]);
        if (data.length > 0) {
            const T = (fn: (r: DCBRow) => number) => data.reduce((s, r) => s + fn(r), 0);
            const avgRR = T(r => r.recPercentage) / data.length;
            const tOAP = T(r => r.openingArrPrincipal), tOAI = T(r => r.openingArrInterest);
            const tDP = T(r => r.demandPrincipal), tDI = T(r => r.demandInterest);
            const tArCP = T(r => r.arrearCollPrincipal), tArCI = T(r => r.arrearCollInterest);
            const tCDCP = T(r => r.currDemandCollPrincipal), tCDCI = T(r => r.currDemandCollInterest);
            const tAdvP = T(r => r.advanceCollPrincipal), tAdvI = T(r => r.advanceCollInterest);
            const tPreP = T(r => r.preclosurePrincipal), tPreI = T(r => r.preclosureInterest);
            const tWOCP = T(r => r.writeOffPrincipalColl ?? 0), tWOCI = T(r => r.writeOffInterestColl ?? 0);
            const tWOWP = T(r => r.writeOffWaiverPrincipal ?? 0), tWOWI = T(r => r.writeOffWaiverInterest ?? 0);
            const tODP = T(r => r.odArrearCollPrincipal), tODI = T(r => r.odArrearCollInterest);
            const tTCP = T(r => r.totalCollPrincipal), tTCI = T(r => r.totalCollInterest);
            const tCAP = T(r => r.currArrearPrincipal + r.todayPendingPrincipal);
            const tCAI = T(r => r.currArrearInterest + r.todayPendingInterest);
            const tClP = T(r => r.closingArrPrincipal), tClI = T(r => r.closingArrInterest);

            rows.push([
                'GRAND TOTAL', '', '', '', '', '',
                truncateReportAmount(tOAP), truncateReportAmount(tOAI), truncateReportAmount(tOAP + tOAI),
                truncateReportAmount(tDP), truncateReportAmount(tDI), truncateReportAmount(tDP + tDI),
                truncateReportAmount(tOAP + tDP), truncateReportAmount(tOAI + tDI), truncateReportAmount(tOAP + tDP + tOAI + tDI),
                truncateReportAmount(tArCP), truncateReportAmount(tArCI),
                truncateReportAmount(tCDCP), truncateReportAmount(tCDCI),
                truncateReportAmount(tAdvP), truncateReportAmount(tAdvI),
                truncateReportAmount(tPreP), truncateReportAmount(tPreI),
                truncateReportAmount(tWOCP), truncateReportAmount(tWOCI),
                truncateReportAmount(tWOWP), truncateReportAmount(tWOWI),
                truncateReportAmount(tODP), truncateReportAmount(tODI),
                truncateReportAmount(tTCP), truncateReportAmount(tTCI),
                truncateReportAmount(tCAP), truncateReportAmount(tCAI),
                truncateReportAmount(tClP), truncateReportAmount(tClI),
                Number(avgRR.toFixed(2)),
            ]);
        }
        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
        const reportFont = await ensureReportFont(doc);
        await drawDcbReport(doc, searchedRows, { subtitle: `From ${submittedFrom} to ${submittedTill}` }, reportFont);
        doc.save(`DCB_Report_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
        toast({ title: 'PDF exported', description: 'Report downloaded as PDF.' });
    };

    const handleExportCSV = () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDCBExportRows();
        exportToCSV(`DCB_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'DCB REPORT — DEMAND COLLECTION BALANCE', headers, rows);
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing GRAND TOTAL
    // row is split off for distinct styling, and the Opening Arrear / Current Demand /
    // Total Demand Principal-Interest-Total triads plus the 8 collection/arrear
    // Principal-Interest pairs get a 2-row grouped header — genuine related fields, and
    // the same grouping the on-screen table and PDF export already use. At 32 columns
    // (comparable to Demand Sheet's 33) this needs A3 landscape.
    // NOTE: buildDCBExportRows()'s totals row (untouched, pre-existing) carries 4 extra
    // WriteOff Coll/Waiver values that have no corresponding header column (those columns
    // are commented out above) — sliced to headers.length here purely for the grouped
    // table's cell count, not a data change; CSV/Excel/PDF still receive the full row.
    const buildDCBWordOptions = (
        headers: string[],
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Branch ID', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'Date', span: 1 },
                { label: 'Center ID', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'FDO Name', span: 1 },
                { label: 'OPENING ARREAR', span: 3 }, { label: 'CURRENT DEMAND', span: 3 }, { label: 'TOTAL DEMAND', span: 3 },
                { label: 'ARREAR COLLECTED', span: 2 }, { label: 'CURR DEMAND COLLECTED', span: 2 },
                { label: 'ADVANCE COLLECTED', span: 2 }, { label: 'PRECLOSURE', span: 2 }, { label: 'OD ARREAR COLLECTED', span: 2 },
                { label: 'TOTAL COLLECTED', span: 2 }, { label: 'CURRENT ARREAR', span: 2 }, { label: 'CLOSING ARREAR', span: 2 },
                { label: 'RR %', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: ['center', 'left', 'center', 'center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [6, 9, 7, 6, 9, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
            totalsRow: rows[rows.length - 1].slice(0, headers.length),
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    });

    const handleExportWordFile = async () => {
        if (!showReport || data.length === 0) {
            toast({ title: 'No data to export', description: 'Please generate the report first before exporting.', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildDCBExportRows();
        const { bodyRows, options } = buildDCBWordOptions(headers, rows);
        await exportToWord(`DCB_Report_${format(new Date(), 'yyyyMMdd_HHmm')}`, 'DCB REPORT — DEMAND COLLECTION BALANCE', headers, bodyRows, options);
    };

    const handlePrint = () => {
        if (!showReport || data.length === 0) {
            toast({
                title: 'No data to print',
                description: 'Please generate the report first before printing.',
                variant: 'destructive',
            });
            return;
        }

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast({
                title: 'Popup blocked',
                description: 'Please allow popups to print the report.',
                variant: 'destructive',
            });
            return;
        }

        // Calculate totals
        const T = (fn: (r: DCBRow) => number) => searchedRows.reduce((s, r) => s + fn(r), 0);
        const avgRR = T(r => r.recPercentage) / searchedRows.length;
        // Opening Arrear
        const tOAP = T(r => r.openingArrPrincipal), tOAI = T(r => r.openingArrInterest);
        // Current Demand
        const tDP = T(r => r.demandPrincipal), tDI = T(r => r.demandInterest);
        // Collections
        const tArCP = T(r => r.arrearCollPrincipal),    tArCI = T(r => r.arrearCollInterest);
        const tCDCP = T(r => r.currDemandCollPrincipal), tCDCI = T(r => r.currDemandCollInterest);
        const tAdvP = T(r => r.advanceCollPrincipal),    tAdvI = T(r => r.advanceCollInterest);
        const tPreP = T(r => r.preclosurePrincipal),     tPreI = T(r => r.preclosureInterest);
        const tWOCP = T(r => r.writeOffPrincipalColl ?? 0), tWOCI = T(r => r.writeOffInterestColl ?? 0);
        const tWOWP = T(r => r.writeOffWaiverPrincipal ?? 0), tWOWI = T(r => r.writeOffWaiverInterest ?? 0);
        const tODP  = T(r => r.odArrearCollPrincipal),   tODI  = T(r => r.odArrearCollInterest);
        const tTCP  = T(r => r.totalCollPrincipal),      tTCI  = T(r => r.totalCollInterest);
        // Arrears
        const tCAP = T(r => r.currArrearPrincipal + r.todayPendingPrincipal);
        const tCAI = T(r => r.currArrearInterest  + r.todayPendingInterest);
        const tClP = T(r => r.closingArrPrincipal), tClI = T(r => r.closingArrInterest);

        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>DCB Report - ${submittedFrom} to ${submittedTill}</title>
                <style>
                    @page { size: landscape; margin: 8mm; }
                    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 8px; background: white; font-size: 8px; }
                    .header { text-align: center; margin-bottom: 12px; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; }
                    .header h1 { margin: 0; color: #1e3a8a; font-size: 15px; }
                    .header p { margin: 3px 0; color: #4b5563; font-size: 10px; }
                    .report-info { margin-bottom: 10px; padding: 6px; background: #f3f4f6; border-radius: 4px; }
                    .report-info td { padding: 2px 6px; border: none; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 7.5px; }
                    th, td { border: 1px solid #000000; padding: 4px 3px; text-align: left; }
                    th { background: #ffffff; color: #000000; font-weight: bold; white-space: nowrap; text-align: center; }
                    th.grp-oa, th.grp-ca { color: #c00000; }
                    th.grp-demand-top { background: #5b74a6; color: #ffffff; }
                    th.grp-collect-top { background: #9bbb59; color: #ffffff; }
                    .tr { text-align: right; }
                    .tc { text-align: center; }
                    .bold { font-weight: bold; }
                    .hl-yellow { background: #ffff99; }
                    .hl-grey { background: #d9d9d9; }
                    .grand-total td { background: #ddebf7; font-weight: bold; border-top: 2px solid #000000; }
                    .footer { margin-top: 15px; text-align: center; font-size: 8px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 6px; }
                    @media print {
                        th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        .grand-total td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
                ${reportHtmlHeader('DCB Report — Demand Collection Balance')}
                <p style="text-align:center;color:#4b5563;font-size:10px;margin:4px 0 12px;">Generated on: ${format(new Date(), 'dd/MM/yyyy hh:mm:ss a')}</p>
                <div class="report-info">
                    <table><tr>
                        <td><strong>From:</strong> ${submittedFrom}</td>
                        <td><strong>Till:</strong> ${submittedTill}</td>
                        <td><strong>Records:</strong> ${searchedRows.length}</td>
                        <td><strong>Avg RR%:</strong> ${avgRR.toFixed(2)}%</td>
                    </tr></table>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th rowspan="3">Branch ID</th>
                            <th rowspan="3">Branch</th>
                            <th rowspan="3">Date</th>
                            <th rowspan="3">Center ID</th>
                            <th rowspan="3">Center</th>
                            <th rowspan="3">FDO</th>
                            <th colspan="2"></th>
                            <th colspan="4" class="grp-demand-top">Demand</th>
                            <th colspan="12" class="grp-collect-top">Collection</th>
                            <th colspan="2"></th>
                            <th colspan="2"></th>
                            <th rowspan="3">RR %</th>
                        </tr>
                        <tr>
                            <th colspan="2" class="grp-oa">Opening Arrear</th>
                            <th colspan="2" class="grp-dem">Curr Demand</th>
                            <th colspan="2" class="grp-tdm">Total Demand</th>
                            <th colspan="2" class="grp-arc">Arrear Coll</th>
                            <th colspan="2" class="grp-cdc">Curr Dmd Coll</th>
                            <th colspan="2" class="grp-adv">Advance Coll</th>
                            <th colspan="2" class="grp-pre">Preclosure</th>
                            <!--
                            <th colspan="2" style="background:#7f1d1d;color:#fca5a5">WO Coll</th>
                            <th colspan="2" style="background:#7c2d12;color:#fdba74">WO Waiver</th>
                            -->
                            <th colspan="2" class="grp-od">OD Arrear Coll</th>
                            <th colspan="2" class="grp-tc">Total Coll</th>
                            <th colspan="2" class="grp-ca">Curr Arrear</th>
                            <th colspan="2" class="grp-cl">Closing Arr</th>
                        </tr>
                        <tr>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <!--
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            -->
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                            <th class="tr">Pri</th><th class="tr">Int</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${searchedRows.map(row => `
                            <tr>
                                <td>${row.branchCode}</td>
                                <td>${row.branchName}</td>
                                <td>${row.meetingDate}</td>
                                <td>${row.centerCode}</td>
                                <td><strong>${row.centerName}</strong></td>
                                <td>${row.fdoName}</td>
                                <td class="tr">${formatCurrency(row.openingArrPrincipal)}</td>
                                <td class="tr">${formatCurrency(row.openingArrInterest)}</td>
                                <td class="tr hl-yellow">${formatCurrency(row.demandPrincipal)}</td>
                                <td class="tr hl-yellow">${formatCurrency(row.demandInterest)}</td>
                                <td class="tr bold hl-yellow">${formatCurrency(row.openingArrPrincipal + row.demandPrincipal)}</td>
                                <td class="tr bold hl-yellow">${formatCurrency(row.openingArrInterest + row.demandInterest)}</td>
                                <td class="tr">${formatCurrency(row.arrearCollPrincipal)}</td>
                                <td class="tr">${formatCurrency(row.arrearCollInterest)}</td>
                                <td class="tr">${formatCurrency(row.currDemandCollPrincipal)}</td>
                                <td class="tr">${formatCurrency(row.currDemandCollInterest)}</td>
                                <td class="tr hl-grey">${formatCurrency(row.advanceCollPrincipal)}</td>
                                <td class="tr hl-grey">${formatCurrency(row.advanceCollInterest)}</td>
                                <td class="tr">${formatCurrency(row.preclosurePrincipal)}</td>
                                <td class="tr">${formatCurrency(row.preclosureInterest)}</td>
                            <!--
                                <td class="tr">${formatCurrency(row.writeOffPrincipalColl ?? 0)}</td>
                                <td class="tr">${formatCurrency(row.writeOffInterestColl ?? 0)}</td>
                                <td class="tr">${formatCurrency(row.writeOffWaiverPrincipal ?? 0)}</td>
                                <td class="tr">${formatCurrency(row.writeOffWaiverInterest ?? 0)}</td>
                            -->
                                <td class="tr">${formatCurrency(row.odArrearCollPrincipal)}</td>
                                <td class="tr">${formatCurrency(row.odArrearCollInterest)}</td>
                                <td class="tr bold hl-yellow">${formatCurrency(row.totalCollPrincipal)}</td>
                                <td class="tr bold hl-yellow">${formatCurrency(row.totalCollInterest)}</td>
                                <td class="tr">${formatCurrency(row.currArrearPrincipal + row.todayPendingPrincipal)}</td>
                                <td class="tr">${formatCurrency(row.currArrearInterest + row.todayPendingInterest)}</td>
                                <td class="tr bold">${formatCurrency(row.closingArrPrincipal)}</td>
                                <td class="tr bold">${formatCurrency(row.closingArrInterest)}</td>
                                <td class="tc bold">${formatPercentage(row.recPercentage)}%</td>
                            </tr>
                        `).join('')}
                        <tr class="grand-total">
                            <td colspan="6"><strong>GRAND TOTAL</strong></td>
                            <td class="tr">${formatCurrency(tOAP)}</td><td class="tr">${formatCurrency(tOAI)}</td>
                            <td class="tr">${formatCurrency(tDP)}</td><td class="tr">${formatCurrency(tDI)}</td>
                            <td class="tr">${formatCurrency(tOAP+tDP)}</td><td class="tr">${formatCurrency(tOAI+tDI)}</td>
                            <td class="tr">${formatCurrency(tArCP)}</td><td class="tr">${formatCurrency(tArCI)}</td>
                            <td class="tr">${formatCurrency(tCDCP)}</td><td class="tr">${formatCurrency(tCDCI)}</td>
                            <td class="tr">${formatCurrency(tAdvP)}</td><td class="tr">${formatCurrency(tAdvI)}</td>
                            <td class="tr">${formatCurrency(tPreP)}</td><td class="tr">${formatCurrency(tPreI)}</td>
                            <!--
                            <td class="tr">${formatCurrency(tWOCP)}</td><td class="tr">${formatCurrency(tWOCI)}</td>
                            <td class="tr">${formatCurrency(tWOWP)}</td><td class="tr">${formatCurrency(tWOWI)}</td>
                            -->
                            <td class="tr">${formatCurrency(tODP)}</td><td class="tr">${formatCurrency(tODI)}</td>
                            <td class="tr">${formatCurrency(tTCP)}</td><td class="tr">${formatCurrency(tTCI)}</td>
                            <td class="tr">${formatCurrency(tCAP)}</td><td class="tr">${formatCurrency(tCAI)}</td>
                            <td class="tr">${formatCurrency(tClP)}</td><td class="tr">${formatCurrency(tClI)}</td>
                            <td class="tc">${avgRR.toFixed(2)}%</td>
                        </tr>
                    </tbody>
                </table>
                <div class="footer">
                    <p>This is a system-generated DCB Report. Please verify with source records if needed.</p>
                    <p>Report period (IST): ${submittedFrom} to ${submittedTill}</p>
                </div>

                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() {
                            window.close();
                        }, 1000);
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.write(printContent);
        printWindow.document.close();

        toast({
            title: 'Print initiated',
            description: 'Print dialog has been opened in landscape mode.',
        });
    };

    // Grand total figures for the on-screen table footer row.
    const T = (fn: (r: DCBRow) => number) => data.reduce((s, r) => s + fn(r), 0);
    const avgRR = data.length > 0 ? T(r => r.recPercentage) / data.length : 0;
    const tOAP = T(r => r.openingArrPrincipal), tOAI = T(r => r.openingArrInterest);
    const tDP = T(r => r.demandPrincipal), tDI = T(r => r.demandInterest);
    const tArCP = T(r => r.arrearCollPrincipal), tArCI = T(r => r.arrearCollInterest);
    const tCDCP = T(r => r.currDemandCollPrincipal), tCDCI = T(r => r.currDemandCollInterest);
    const tAdvP = T(r => r.advanceCollPrincipal), tAdvI = T(r => r.advanceCollInterest);
    const tPreP = T(r => r.preclosurePrincipal), tPreI = T(r => r.preclosureInterest);
    const tODP = T(r => r.odArrearCollPrincipal), tODI = T(r => r.odArrearCollInterest);
    const tTCP = T(r => r.totalCollPrincipal), tTCI = T(r => r.totalCollInterest);
    const tCAP = T(r => r.currArrearPrincipal + r.todayPendingPrincipal);
    const tCAI = T(r => r.currArrearInterest + r.todayPendingInterest);
    const tClP = T(r => r.closingArrPrincipal), tClI = T(r => r.closingArrInterest);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary">
                    <CardTitle className="text-lg text-white">DCB Report</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                    {/* Mode Toggle */}
                    <div className="flex gap-2 mb-6">
                        <Button
                            onClick={() => { setMode('single'); setShowReport(false); setData([]); }}
                            disabled={isLoading}
                            variant={mode === 'single' ? 'default' : 'outline'}
                            className={mode === 'single'
                                ? 'h-9 bg-primary text-white border-primary shadow hover:bg-sidebar-accent'
                                : 'h-9 border-primary/50 text-sidebar-accent hover:bg-primary/10 dark:text-slate-200 dark:border-slate-600'}
                        >
                            Single Date
                        </Button>
                        <Button
                            onClick={() => { setMode('range'); setShowReport(false); setData([]); }}
                            disabled={isLoading}
                            variant={mode === 'range' ? 'default' : 'outline'}
                            className={mode === 'range'
                                ? 'h-9 bg-primary text-white border-primary shadow hover:bg-sidebar-accent'
                                : 'h-9 border-primary/50 text-sidebar-accent hover:bg-primary/10 dark:text-slate-200 dark:border-slate-600'}
                        >
                            Date Range
                        </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-8 gap-6">
                        {/* Date Input(s) — conditional on mode */}
                        {mode === 'single' ? (
                            <div className="space-y-2">
                                <Label htmlFor="singleDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    Date
                                </Label>
                                <div className="relative">
                                    <DateInput
                                        id="singleDate"
                                        value={singleDate}
                                        onChange={(e) => setSingleDate(e.target.value)}
                                        className="h-11 pl-10"
                                        disabled={isLoading}
                                    />
                                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* From Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="fromDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        From Date
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="fromDate"
                                            value={fromDate}
                                            onChange={(e) => setFromDate(e.target.value)}
                                            className="h-11 pl-10"
                                            disabled={isLoading}
                                        />
                                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>

                                {/* Till Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="tillDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Till Date
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="tillDate"
                                            value={tillDate}
                                            onChange={(e) => setTillDate(e.target.value)}
                                            className="h-11 pl-10"
                                            disabled={isLoading}
                                        />
                                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                            </>
                        )}

                        {/* Branch */}
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Branch
                            </Label>
                            <Select
                                value={selectedBranch}
                                onValueChange={(v) => { setSelectedBranch(v); setSelectedCenter('all'); }}
                                disabled={isLoading}
                            >
                                <SelectTrigger id="branchName" className="h-11">
                                    <SelectValue placeholder="-- ALL BRANCHES --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id}>
                                            {branch.code} - {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Center */}
                        <div className="space-y-2">
                            <Label htmlFor="centerName" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                Center
                            </Label>
                            <Select value={selectedCenter} onValueChange={setSelectedCenter} disabled={isLoading}>
                                <SelectTrigger id="centerName" className="h-11">
                                    <SelectValue placeholder="-- ALL CENTERS --" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">-- ALL CENTERS --</SelectItem>
                                    {filteredCenters.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            {center.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Action Buttons */}
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Show</Label>
                            <Button
                                onClick={handleShow}
                                disabled={isLoading}
                                className="h-11 w-full bg-gradient-to-r from-primary to-primary text-white shadow-lg transition-all hover:from-sidebar-accent hover:to-primary hover:shadow-xl"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    'Show'
                                )}
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Print</Label>
                            <Button
                                onClick={handlePrint}
                                disabled={isLoading || !showReport}
                                variant="outline"
                                className="h-11 w-full bg-gradient-to-r from-green-600 to-teal-600 text-white border-green-600 shadow-lg transition-all hover:from-green-700 hover:to-teal-700 hover:shadow-xl dark:border-green-600"
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                Print
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Reset</Label>
                            <Button
                                onClick={handleReset}
                                disabled={isLoading}
                                variant="destructive"
                                className="h-11 w-full shadow-lg transition-all hover:shadow-xl"
                            >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Reset
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-sm font-semibold opacity-0">Export</Label>
                            <ExportDropdown
                                onExportPDF={!isLoading && showReport ? handleExportPDF : undefined}
                                onExportExcel={!isLoading && showReport ? handleExport : undefined}
                                onExportCSV={!isLoading && showReport ? handleExportCSV : undefined}
                                onExportWord={!isLoading && showReport ? handleExportWordFile : undefined}
                                reportSlug={!isLoading && showReport && getReportExportMode('dcb') === 'REQUEST_QUEUE' ? 'dcb' : undefined}
                                canExport={canExportReport('dcb')}
                                exportParams={{
                                    fromDate: submittedFrom,
                                    toDate: submittedTill,
                                    branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                    filters: selectedCenter !== 'all' ? { centerId: selectedCenter } : null,
                                }}
                                className="h-11 w-full bg-sidebar-accent text-white border-sidebar-accent shadow-lg transition-all hover:bg-brand-green-darker hover:shadow-xl dark:bg-sidebar-accent dark:border-sidebar-accent dark:hover:bg-sidebar-accent/80"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-2">
                        <ReportHeader
                            title="DCB Report — Demand Collection Balance"
                            subtitle={`From ${submittedFrom} to ${submittedTill}`}
                        />
                    </CardHeader>
                    <div className="flex flex-wrap items-center gap-4 px-6 pb-2">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search DCB report..."
                            className="ml-auto"
                        />
                    </div>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                            <Table className="min-w-max w-full">
                                <TableHeader className="bg-white dark:bg-slate-900 sticky top-0 z-10 shadow-md">
                                    {/* Row 0 — top-level super-group labels (Demand / Collection) */}
                                    <TableRow className="border-b border-black dark:border-slate-600">
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">Branch ID</TableHead>
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">Branch</TableHead>
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">Date</TableHead>
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">Center ID</TableHead>
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">Center</TableHead>
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs whitespace-nowrap align-middle">FDO</TableHead>
                                        {/* Opening Arrear (no super-group) */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-900" />
                                        {/* Demand = Curr Demand + Total Demand */}
                                        <TableHead colSpan={4} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-white text-xs text-center whitespace-nowrap bg-[#5b74a6]">Demand</TableHead>
                                        {/* Collection = Arrear Coll + Curr Dmd Coll + Advance Coll + Preclosure + OD Arrear Coll + Total Coll */}
                                        <TableHead colSpan={12} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-white text-xs text-center whitespace-nowrap bg-[#9bbb59]">Collection</TableHead>
                                        {/* Curr Arrear / Closing Arrear (no super-group) */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-900" />
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-900" />
                                        <TableHead rowSpan={3} className="border border-black dark:border-slate-600 px-2 py-3 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap align-middle">RR %</TableHead>
                                    </TableRow>
                                    {/* Row 1 — group labels */}
                                    <TableRow className="border-b border-black dark:border-slate-600">
                                        {/* Opening Arrear */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-[#c00000] text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Opening Arrear</TableHead>
                                        {/* Current Demand */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Curr Demand</TableHead>
                                        {/* Total Demand */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Total Demand</TableHead>
                                        {/* Arrear Collection */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Arrear Coll</TableHead>
                                        {/* Current Demand Collection */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Curr Dmd Coll</TableHead>
                                        {/* Advance Collection */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Advance Coll</TableHead>
                                        {/* Preclosure */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Preclosure</TableHead>
                                        {/* Write-Off Collection */}
                                        {/* <TableHead colSpan={2} className="border border-black px-2 py-2 font-bold text-black text-xs text-center whitespace-nowrap bg-white">WO Coll</TableHead> */}
                                        {/* Write-Off Waiver */}
                                        {/* <TableHead colSpan={2} className="border border-black px-2 py-2 font-bold text-black text-xs text-center whitespace-nowrap bg-white">WO Waiver</TableHead> */}
                                        {/* OD Arrear Collection */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">OD Arrear Coll</TableHead>
                                        {/* Total Collection */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Total Coll</TableHead>
                                        {/* Current Arrear */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-[#c00000] text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Curr Arrear</TableHead>
                                        {/* Closing Arrear */}
                                        <TableHead colSpan={2} className="border border-black dark:border-slate-600 px-2 py-2 font-bold text-black dark:text-slate-100 text-xs text-center whitespace-nowrap bg-white dark:bg-slate-900">Closing Arr</TableHead>
                                    </TableRow>
                                    {/* Row 2 — Pri / Int sub-headers */}
                                    <TableRow className="border-b border-black dark:border-slate-600">
                                        {Array.from({ length: 11 }).map((_, i) => (
                                            <React.Fragment key={i}>
                                                <TableHead className="border border-black dark:border-slate-600 px-2 py-1 font-bold text-black dark:text-slate-100 text-xs text-right whitespace-nowrap bg-white dark:bg-slate-900">Pri</TableHead>
                                                <TableHead className="border border-black dark:border-slate-600 px-2 py-1 font-bold text-black dark:text-slate-100 text-xs text-right whitespace-nowrap bg-white dark:bg-slate-900">Int</TableHead>
                                            </React.Fragment>
                                        ))}
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-slate-900">
                                    {searchedRows.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={29} className="border border-black dark:border-slate-600 px-4 py-8 text-center text-slate-500">
                                                No data available for the selected filters
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        <>
                                            {searchedRows.map((row, index) => {
                                                const cell = 'border border-black dark:border-slate-600 px-2 py-2 text-xs text-black dark:text-slate-100';
                                                const hlYellow = 'bg-[#ffff99] dark:bg-yellow-900/40';
                                                const hlGrey = 'bg-[#d9d9d9] dark:bg-slate-700/60';
                                                return (
                                                    <TableRow key={index} className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                                                        {/* Info cols */}
                                                        <TableCell className={`${cell} whitespace-nowrap`}>{row.branchCode}</TableCell>
                                                        <TableCell className={`${cell} whitespace-nowrap`}>{row.branchName}</TableCell>
                                                        <TableCell className={`${cell} whitespace-nowrap`}>{row.meetingDate}</TableCell>
                                                        <TableCell className={`${cell} whitespace-nowrap`}>{row.centerCode}</TableCell>
                                                        <TableCell className={`${cell} font-medium`}>{row.centerName}</TableCell>
                                                        <TableCell className={cell}>{row.fdoName}</TableCell>
                                                        {/* Opening Arrear Pri | Int */}
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.openingArrPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.openingArrInterest)}</TableCell>
                                                        {/* Current Demand Pri | Int */}
                                                        <TableCell className={`${cell} text-right ${hlYellow}`}>{formatCurrency(row.demandPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right ${hlYellow}`}>{formatCurrency(row.demandInterest)}</TableCell>
                                                        {/* Total Demand Pri | Int = Opening + Current */}
                                                        <TableCell className={`${cell} text-right font-semibold ${hlYellow}`}>{formatCurrency(row.openingArrPrincipal + row.demandPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right font-semibold ${hlYellow}`}>{formatCurrency(row.openingArrInterest + row.demandInterest)}</TableCell>
                                                        {/* Arrear Coll Pri | Int */}
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.arrearCollPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.arrearCollInterest)}</TableCell>
                                                        {/* Curr Demand Coll Pri | Int */}
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.currDemandCollPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.currDemandCollInterest)}</TableCell>
                                                        {/* Advance Coll Pri | Int */}
                                                        <TableCell className={`${cell} text-right ${hlGrey}`}>{formatCurrency(row.advanceCollPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right ${hlGrey}`}>{formatCurrency(row.advanceCollInterest)}</TableCell>
                                                        {/* Preclosure Pri | Int */}
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.preclosurePrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.preclosureInterest)}</TableCell>
                                                        {/* Write-Off Coll Pri | Int */}
                                                        {/* <TableCell className={`${cell} text-right`}>{formatCurrency(row.writeOffPrincipalColl ?? 0)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.writeOffInterestColl ?? 0)}</TableCell> */}
                                                        {/* Write-Off Waiver Pri | Int */}
                                                        {/* <TableCell className={`${cell} text-right`}>{formatCurrency(row.writeOffWaiverPrincipal ?? 0)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.writeOffWaiverInterest ?? 0)}</TableCell> */}
                                                        {/* OD Arrear Coll Pri | Int */}
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.odArrearCollPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right`}>{formatCurrency(row.odArrearCollInterest)}</TableCell>
                                                        {/* Total Coll Pri | Int */}
                                                        <TableCell className={`${cell} text-right font-bold ${hlYellow}`}>{formatCurrency(row.totalCollPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right font-bold ${hlYellow}`}>{formatCurrency(row.totalCollInterest)}</TableCell>
                                                        {/* Curr Arrear Pri | Int (today = pending, past = arrear) */}
                                                        <TableCell className={`${cell} text-right font-semibold`}>
                                                            {formatCurrency(row.currArrearPrincipal + row.todayPendingPrincipal)}
                                                        </TableCell>
                                                        <TableCell className={`${cell} text-right font-semibold`}>
                                                            {formatCurrency(row.currArrearInterest + row.todayPendingInterest)}
                                                        </TableCell>
                                                        {/* Closing Arrear Pri | Int */}
                                                        <TableCell className={`${cell} text-right font-bold`}>{formatCurrency(row.closingArrPrincipal)}</TableCell>
                                                        <TableCell className={`${cell} text-right font-bold`}>{formatCurrency(row.closingArrInterest)}</TableCell>
                                                        {/* RR % */}
                                                        <TableCell className={`${cell} text-center font-bold`}>{formatPercentage(row.recPercentage)}%</TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                            {/* Grand Total Row */}
                                            {(() => {
                                                const totalCell = 'border border-black dark:border-slate-600 px-2 py-3 text-xs font-bold text-black dark:text-slate-100 bg-[#ddebf7] dark:bg-slate-800 text-right';
                                                return (
                                                    <TableRow className="sticky bottom-0 z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.15)]">
                                                        <TableCell colSpan={6} className="border border-black dark:border-slate-600 px-2 py-3 text-xs font-bold text-black dark:text-slate-100 bg-[#ddebf7] dark:bg-slate-800 whitespace-nowrap">GRAND TOTAL</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tOAP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tOAI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tDP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tDI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tOAP + tDP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tOAI + tDI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tArCP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tArCI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tCDCP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tCDCI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tAdvP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tAdvI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tPreP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tPreI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tODP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tODI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tTCP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tTCI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tCAP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tCAI)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tClP)}</TableCell>
                                                        <TableCell className={totalCell}>{formatCurrency(tClI)}</TableCell>
                                                        <TableCell className="border border-black dark:border-slate-600 px-2 py-3 text-xs font-bold text-black dark:text-slate-100 bg-[#ddebf7] dark:bg-slate-800 text-center">{avgRR.toFixed(2)}%</TableCell>
                                                    </TableRow>
                                                );
                                            })()}
                                        </>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <Download className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                        Select date range and click Show to generate the DCB Report
                    </p>
                </Card>
            )}
        </div>
    );
}