'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
    RefreshCw,
    Download,
    Loader2,
    Search,
    ChevronDown,
    Printer,
    Calendar,
    Filter,
    X,
    Building2,
    FileText,
    FileSpreadsheet,
    FileOutput,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage } from '@/app/lib/branch-storage';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { usePermission } from '@/app/hooks/usePermission';
import { reportHtmlHeader } from '@/app/lib/reports/report-html-header';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

type NEFTFormatData = {
    sno: number;
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    centreId: string;
    centerName: string;
    loanId: string;
    memberId: string;
    ifsc: string;
    accountNo: string;
    name: string;
    bank: string;
    bankBranch: string;
    loanAmount: number;
};

type IndexNumber = {
    id: string;
    indexNo: string;
    centerCode: string;
    centerName: string;
    hasNonDisbursedLoans?: boolean;
    nonDisbursedCount?: number;
    disbursementStatus?: string;
    totalLoans?: number;
};

type Branch = {
    id: string;
    name: string;
    code: string;
};

type DisbursementFilter = 'ALL' | 'DISBURSED' | 'NON_DISBURSED';

const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(Math.trunc(amount));
};

// Get today's date in YYYY-MM-DD format
const getTodayDate = (): string => {
    const today = new Date();
    return today.toISOString().split('T')[0];
};

// Simple DatePicker component using native input
function SimpleDatePicker({ 
    date, 
    setDate, 
    className,
    placeholder 
}: { 
    date?: string; 
    setDate: (date: string) => void; 
    className?: string;
    placeholder?: string;
}) {
    return (
        <DateInput
            value={date || ''}
            onChange={(e) => setDate(e.target.value)}
            className={className}
            placeholder={placeholder}
        />
    );
}

interface NEFTFormatClientProps {
    userRole?: string;
    userBranchId?: string;
}

export function NEFTFormatClient(props: NEFTFormatClientProps = {}) {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    // The page wrapper (app/dashboard/reports/others/neft-format/page.tsx) is a
    // thin server-rendered shell and never passes userRole/userBranchId — self-resolve
    // them client-side instead, same as every sibling report/collection component
    // (tokenStorage.getUser() / branchStorage.getActiveBranch()). Explicit props are
    // still honored if a future caller passes them.
    const [userRole, setUserRole] = useState<string | undefined>(props.userRole);
    const [userBranchId, setUserBranchId] = useState<string | undefined>(props.userBranchId);

    useEffect(() => {
        if (props.userRole && props.userBranchId) return;
        const storedUser = tokenStorage.getUser();
        const activeBranch = branchStorage.getActiveBranch();
        setUserRole(props.userRole ?? storedUser?.role ?? undefined);
        setUserBranchId(props.userBranchId ?? activeBranch?.id ?? storedUser?.branchId ?? undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);
    // Submitted (applied) selection snapshot — frozen until the next Show Report click, so
    // exports/print/queue params keep using the indices that actually generated the report
    // even if the checkbox selection is changed afterward without clicking Show Report again.
    const [submittedIndexIds, setSubmittedIndexIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingIndices, setIsLoadingIndices] = useState(true);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<NEFTFormatData[]>([]);
    const [indexNumbers, setIndexNumbers] = useState<IndexNumber[]>([]);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);
    
    // Date filter states - default to today's date
    const [fromDate, setFromDate] = useState<string>(getTodayDate());
    const [toDate, setToDate] = useState<string>(getTodayDate());
    
    // Disbursement filter state - default to NON_DISBURSED
    const [disbursementFilter, setDisbursementFilter] = useState<DisbursementFilter>('NON_DISBURSED');
    
    // Branch filter for different roles
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
    const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Fetch branches based on user role
    useEffect(() => {
        const fetchBranches = async () => {
            setIsLoadingBranches(true);
            try {
                const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                if (result.success && result.data) {
                    let availableBranches = result.data;
                    
                    // Filter based on user role
                    if (userRole === 'BRANCH_MANAGER' && userBranchId) {
                        availableBranches = availableBranches.filter(b => b.id === userBranchId);
                        setSelectedBranchIds([userBranchId]);
                    }
                    
                    setBranches(availableBranches);
                }
            } catch (error) {
                console.error('Error fetching branches:', error);
            } finally {
                setIsLoadingBranches(false);
            }
        };
        fetchBranches();
    }, [userRole, userBranchId]);

    // Fetch indices with date and branch filters
    const fetchIndices = useCallback(async () => {
        setIsLoadingIndices(true);
        try {
            let url = '/loan-indexes?includeDisbursementStatus=true';
            
            // Add date filters
            if (fromDate) {
                url += `&fromDate=${fromDate}`;
            }
            if (toDate) {
                url += `&toDate=${toDate}`;
            }
            
            // Add branch filter based on role
            if (userRole !== 'ADMIN' && selectedBranchIds.length === 0 && userBranchId) {
                url += `&branchId=${userBranchId}`;
            } else if (selectedBranchIds.length > 0) {
                url += `&branchIds=${selectedBranchIds.join(',')}`;
            }
            
            const response = await apiClient.get(url);
            if (response.success) {
                let indices = (response.data as any[]).map((idx: any) => ({
                    id: idx.id,
                    indexNo: idx.indexNo,
                    centerCode: idx.centerCode,
                    centerName: idx.centerName,
                    hasNonDisbursedLoans: idx.hasNonDisbursedLoans || false,
                    nonDisbursedCount: idx.nonDisbursedCount || 0,
                    disbursementStatus: idx.status,
                    totalLoans: idx.totalApps || 0,
                }));
                
                // Apply disbursement filter on frontend
                let filteredIndices = indices;
                if (disbursementFilter === 'DISBURSED') {
                    filteredIndices = indices.filter(idx => !idx.hasNonDisbursedLoans);
                } else if (disbursementFilter === 'NON_DISBURSED') {
                    filteredIndices = indices.filter(idx => idx.hasNonDisbursedLoans);
                }
                
                setIndexNumbers(filteredIndices);
                
                // Clear selected indices if they no longer exist in filtered results
                const newSelectedIds = selectedIndexIds.filter(id => 
                    filteredIndices.some(idx => idx.id === id)
                );
                if (newSelectedIds.length !== selectedIndexIds.length) {
                    setSelectedIndexIds(newSelectedIds);
                }
            } else {
                toast({
                    title: 'Error',
                    description: response.error || 'Failed to fetch index numbers',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error fetching indices:', error);
            toast({
                title: 'System Error',
                description: 'Could not connect to the server.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingIndices(false);
        }
    }, [fromDate, toDate, selectedBranchIds, disbursementFilter, userRole, userBranchId, selectedIndexIds, toast]);

    // Fetch indices when filters change
    useEffect(() => {
        fetchIndices();
        // Clear report when filters change
        if (showReport) {
            setShowReport(false);
            setData([]);
        }
    }, [fetchIndices]);

    const availableIndices = useMemo(() => {
        return indexNumbers;
    }, [indexNumbers]);

    const selectedIndexInfos = useMemo(() => {
        return indexNumbers.filter(n => selectedIndexIds.includes(n.id));
    }, [indexNumbers, selectedIndexIds]);

    // Submitted counterpart of selectedIndexInfos — describes the indices that actually
    // generated the currently-shown report, used by exports/print/queue params instead of
    // the live (possibly since-changed) checkbox selection.
    const submittedIndexInfos = useMemo(() => {
        return indexNumbers.filter(n => submittedIndexIds.includes(n.id));
    }, [indexNumbers, submittedIndexIds]);

    const toggleIndex = (id: string) => {
        setSelectedIndexIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleBranch = (branchId: string) => {
        setSelectedBranchIds(prev =>
            prev.includes(branchId) ? prev.filter(id => id !== branchId) : [...prev, branchId]
        );
    };

    const selectAllBranches = () => {
        setSelectedBranchIds(branches.map(b => b.id));
    };

    const clearAllBranches = () => {
        setSelectedBranchIds([]);
    };

    const clearDateFilters = () => {
        setFromDate('');
        setToDate('');
        setShowReport(false);
        setData([]);
        setSelectedIndexIds([]);
    };

    const handleShow = async () => {
        if (selectedIndexIds.length === 0) {
            toast({
                title: 'Selection required',
                description: 'Please select at least one Index No before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const results = await Promise.all(
                selectedIndexIds.map(id =>
                    apiClient.get(`/reports/neft-format?indexId=${id}`)
                )
            );

            let combined: NEFTFormatData[] = [];
            for (const result of results) {
                if (result.success && result.data && Array.isArray(result.data)) {
                    combined = [...combined, ...result.data];
                }
            }

            if (combined.length === 0) {
                toast({
                    title: 'No Data',
                    description: 'No NEFT data found for the selected indices.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            combined = combined.map((row, i) => ({ ...row, sno: i + 1 }));

            setSubmittedIndexIds(selectedIndexIds);
            setData(combined);
            setShowReport(true);
            toast({
                title: 'Report Generated',
                description: `Loaded ${combined.length} records from ${selectedIndexIds.length} index(es).`,
            });
        } catch (error) {
            console.error('Error fetching NEFT data:', error);
            toast({
                title: 'System Error',
                description: 'An unexpected error occurred while fetching NEFT data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedIndexIds([]);
        setSubmittedIndexIds([]);
        setShowReport(false);
        setData([]);
        setFromDate(getTodayDate());
        setToDate(getTodayDate());
        setDisbursementFilter('NON_DISBURSED');
        if (userRole !== 'BRANCH_MANAGER') {
            setSelectedBranchIds([]);
        } else if (userRole === 'BRANCH_MANAGER' && userBranchId) {
            setSelectedBranchIds([userBranchId]);
        }
    };

    const handleExport = () => {
        if (data.length === 0) return;

        try {
            const q = (val: string | number | null | undefined): string => {
                const s = val === null || val === undefined ? '' : String(val);
                return `"${s.replace(/"/g, '""')}"`;
            };

            const forceText = (val: string | null | undefined): string => {
                const s = val ?? '';
                return `'${s.replace(/'/g, "''")}`;
            };

            const headers = ['S NO', 'REGION NAME', 'DIVISION NAME', 'AREA NAME', 'BRANCH ID', 'BRANCH NAME', 'CENTRE ID', 'CENTER NAME', 'LOAN ID', 'MEMBER ID', 'IFSC CODE', 'ACCOUNT NUMBER', 'MEMBER NAME', 'BANK NAME', 'BANK BRANCH NAME', 'LOAN AMOUNT'];

            const rows = searchedRows.map(row => [
                q(row.sno),
                q(row.regionName),
                q(row.divisionName),
                q(row.areaName),
                q(row.branchId),
                q(row.branchName),
                q(row.centreId),
                q(row.centerName),
                q(row.loanId),
                q(row.memberId),
                q(row.ifsc),
                forceText(row.accountNo),
                q(row.name),
                q(row.bank),
                q(row.bankBranch),
                q(row.loanAmount),
            ]);

            const csvContent = [
                headers.map(h => q(h)).join(','),
                ...rows.map(row => row.join(',')),
            ].join('\n');

            const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('hidden', '');
            a.setAttribute('href', url);
            const dateLabel = fromDate || toDate ? `_${fromDate}_to_${toDate}` : '';
            const indexLabel = submittedIndexInfos.map(n => n.indexNo).join('_') || 'report';
            a.setAttribute('download', `NEFT_Format_${indexLabel}${dateLabel}.csv`);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast({ title: 'Export Successful', description: 'CSV file has been downloaded.' });
        } catch (error) {
            console.error('Export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate CSV file.', variant: 'destructive' });
        }
    };

    // ── Excel / PDF / Word export (mirrors the same field mapping used by
    // handleExport above, kept separate so handleExport is left untouched) ──────

    const buildNEFTExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = ['S NO', 'REGION NAME', 'DIVISION NAME', 'AREA NAME', 'BRANCH ID', 'BRANCH NAME', 'CENTRE ID', 'CENTER NAME', 'LOAN ID', 'MEMBER ID', 'IFSC CODE', 'ACCOUNT NUMBER', 'MEMBER NAME', 'BANK NAME', 'BANK BRANCH NAME', 'LOAN AMOUNT'];
        const rows: (string | number)[][] = searchedRows.map(row => [
            row.sno, row.regionName, row.divisionName, row.areaName, row.branchId, row.branchName,
            row.centreId, row.centerName, row.loanId, row.memberId, row.ifsc, row.accountNo,
            row.name, row.bank, row.bankBranch, row.loanAmount,
        ]);
        if (searchedRows.length > 0) {
            const totalLoanAmount = searchedRows.reduce((sum, row) => sum + (row.loanAmount || 0), 0);
            rows.push([
                '', 'Grand Total', '', '', '', '', '', '', '', '', '', '', '', '', '', totalLoanAmount,
            ]);
        }
        return { headers, rows };
    };

    const handleExportExcel = async () => {
        if (data.length === 0) return;
        try {
            const XLSX = await import('xlsx');
            const { buildReportSheet, autoSizeColumns } = await import('@/app/lib/reports/excel-report-header');
            const { headers, rows } = buildNEFTExportRows();
            const excelRows = rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
            const ws = buildReportSheet('NEFT Format Report', excelRows);

            // Force ACCOUNT NUMBER column to text format so Excel never strips leading
            // zeros or converts long account numbers to scientific notation.
            const acctColIdx = headers.indexOf('ACCOUNT NUMBER');
            const range = XLSX.utils.decode_range(ws['!ref']!);
            for (let r = range.s.r; r <= range.e.r; r++) {
                const cellRef = XLSX.utils.encode_cell({ r, c: acctColIdx });
                const cell = ws[cellRef];
                if (cell) {
                    cell.t = 's';
                    cell.z = '@';
                    cell.v = String(cell.v);
                }
            }

            autoSizeColumns(ws);

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'NEFT Format');
            const dateLabel = fromDate || toDate ? `_${fromDate}_to_${toDate}` : '';
            const indexLabel = submittedIndexInfos.map(n => n.indexNo).join('_') || 'report';
            XLSX.writeFile(wb, `NEFT_Format_${indexLabel}${dateLabel}.xlsx`);
            toast({ title: 'Export Successful', description: 'Excel file has been downloaded.' });
        } catch (error) {
            console.error('Excel export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate Excel file.', variant: 'destructive' });
        }
    };

    const handleExportPDF = async () => {
        if (data.length === 0) return;
        try {
            const { default: jsPDF } = await import('jspdf');
            const { ensureReportFont } = await import('@/app/lib/reports/pdf-fonts');
            const { drawNeftFormatReport } = await import('@/app/lib/reports/neft-format-pdf');
            const { headers, rows } = buildNEFTExportRows();
            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
            const reportFont = await ensureReportFont(doc);
            const indexLabel = submittedIndexInfos.map(n => n.indexNo).join(', ');
            await drawNeftFormatReport(doc, { headers, rows }, { subtitle: `Index Number(s): ${indexLabel}` }, reportFont);
            const dateLabel = fromDate || toDate ? `_${fromDate}_to_${toDate}` : '';
            const fileLabel = submittedIndexInfos.map(n => n.indexNo).join('_') || 'report';
            doc.save(`NEFT_Format_${fileLabel}${dateLabel}.pdf`);
            toast({ title: 'Export Successful', description: 'PDF file has been downloaded.' });
        } catch (error) {
            console.error('PDF export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate PDF file.', variant: 'destructive' });
        }
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing "Grand
    // Total" row (when present) is split off for distinct styling, and genuinely
    // related column clusters (location, branch/center ID+Name pairs, IFSC+Account,
    // Bank Name+Branch) get a 2-row grouped header.
    const buildNEFTWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][1] === 'Grand Total';
        return {
            bodyRows: hasTotals ? rows.slice(0, -1) : rows,
            options: {
                groupHeaders: [
                    { label: 'S NO', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                    { label: 'LOAN ID', span: 1 }, { label: 'MEMBER ID', span: 1 }, { label: 'ACCOUNT', span: 2 },
                    { label: 'MEMBER NAME', span: 1 }, { label: 'BANK', span: 2 }, { label: 'LOAN AMOUNT', span: 1 },
                ],
                subHeaders: ['REGION NAME', 'DIVISION NAME', 'AREA NAME', 'BRANCH ID', 'BRANCH NAME', 'CENTRE ID', 'CENTER NAME', 'IFSC CODE', 'ACCOUNT NUMBER', 'BANK NAME', 'BANK BRANCH NAME'],
                columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'right'],
                columnWidthWeights: [4, 9, 9, 9, 6, 10, 6, 10, 8, 8, 8, 10, 11, 10, 10, 8],
                totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
            },
        };
    };

    const handleExportWord = async () => {
        if (data.length === 0) return;
        try {
            const { headers, rows } = buildNEFTExportRows();
            const dateLabel = fromDate || toDate ? `_${fromDate}_to_${toDate}` : '';
            const fileLabel = submittedIndexInfos.map(n => n.indexNo).join('_') || 'report';
            const { bodyRows, options } = buildNEFTWordOptions(rows);
            await exportToWord(`NEFT_Format_${fileLabel}${dateLabel}`, 'NEFT FORMAT REPORT', headers, bodyRows, options);
            toast({ title: 'Export Successful', description: 'Word file has been downloaded.' });
        } catch (error) {
            console.error('Word export error:', error);
            toast({ title: 'Export Failed', description: 'Could not generate Word file.', variant: 'destructive' });
        }
    };

    const handlePrint = () => {
        if (data.length === 0) return;

        const currentDate = toDisplayDate(new Date());

        const totalAmount = searchedRows.reduce((sum, item) => sum + item.loanAmount, 0);
        const recordsWithBankDetails = searchedRows.filter(item => item.accountNo && item.ifsc).length;
        const indexLabel = submittedIndexInfos.map(n => n.indexNo).join(', ');
        const centerLabel = [...new Set(submittedIndexInfos.map(n => `${n.centerCode} - ${n.centerName}`))].join(', ');

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast({ title: 'Print Failed', description: 'Please allow pop-ups to print the report.', variant: 'destructive' });
            return;
        }

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>NEFT Format - ${indexLabel}</title>
                <style>
                    @page { size: landscape; margin: 0.5in; }
                    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 20px; background: white; color: black; line-height: 1.3; }
                    .header { margin-bottom: 30px; }
                    .header h1 { margin: 0 0 5px 0; font-size: 24px; font-weight: bold; }
                    .header h3 { margin: 0 0 5px 0; font-size: 18px; font-weight: bold; }
                    .header p { margin: 3px 0; font-size: 14px; }
                    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px; }
                    th { font-weight: bold; padding: 10px 5px; border: 1px solid black; text-align: center; background: white; }
                    td { padding: 8px 5px; border: 1px solid black; }
                    td:first-child { text-align: center; }
                    td:nth-child(16) { text-align: right; }
                    .summary { margin: 20px 0; padding: 15px; border: 1px solid black; font-size: 14px; }
                    .summary table { width: auto; margin: 0; border: none; }
                    .summary td { padding: 3px 15px; border: none; }
                    .summary td:first-child { font-weight: bold; }
                    .footer { margin-top: 30px; text-align: right; font-size: 12px; border-top: 1px solid black; padding-top: 15px; }
                </style>
            </head>
            <body>
                <div class="header">
                    ${reportHtmlHeader('NEFT Format Report')}
                    <h3>Index Number(s): ${indexLabel}</h3>
                    <p>Center(s): ${centerLabel}</p>
                    <p>Generated on: ${currentDate}</p>
                </div>
                <div class="summary">
                    <table>
                        </td>
                            <td>Total Records:</td><td>${searchedRows.length}</td>
                        </tr>
                        <tr>
                            <td>Total Amount:</td><td>${formatCurrency(totalAmount)}</td>
                        </tr>
                        <tr>
                            <td>Records with Bank Details:</td><td>${recordsWithBankDetails}</td>
                        </tr>
                    </table>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>S NO</th><th>REGION NAME</th><th>DIVISION NAME</th><th>AREA NAME</th>
                            <th>BRANCH ID</th><th>BRANCH NAME</th>
                            <th>CENTRE ID</th><th>CENTER NAME</th><th>LOAN ID</th>
                            <th>MEMBER ID</th><th>IFSC CODE</th><th>ACCOUNT NUMBER</th>
                            <th>MEMBER NAME</th><th>BANK NAME</th><th>BANK BRANCH NAME</th>
                            <th>LOAN AMOUNT</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${searchedRows.map(row => `
                            <tr>
                                <td>${row.sno}</td>
                                <td>${row.regionName || '-'}</td>
                                <td>${row.divisionName || '-'}</td>
                                <td>${row.areaName || '-'}</td>
                                <td>${row.branchId || '-'}</td>
                                <td>${row.branchName || '-'}</td>
                                <td>${row.centreId || '-'}</td>
                                <td>${row.centerName || '-'}</td>
                                <td>${row.loanId || '-'}</td>
                                <td>${row.memberId || '-'}</td>
                                <td>${row.ifsc || '-'}</td>
                                <td>${row.accountNo || '-'}</td>
                                <td>${row.name}</td>
                                <td>${row.bank || '-'}</td>
                                <td>${row.bankBranch || '-'}</td>
                                <td>${formatCurrency(row.loanAmount)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <div class="footer"><p>This is a computer generated report</p></div>
            </body>
            </html>
        `);

        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
    };

    const triggerLabel = selectedIndexIds.length === 0
        ? 'Select index numbers...'
        : selectedIndexIds.length === 1
            ? selectedIndexInfos[0]?.indexNo + ' - ' + selectedIndexInfos[0]?.centerName
            : `${selectedIndexIds.length} indices selected`;

    const branchTriggerLabel = selectedBranchIds.length === 0
        ? 'All Branches'
        : selectedBranchIds.length === 1
            ? branches.find(b => b.id === selectedBranchIds[0])?.name || '1 branch'
            : `${selectedBranchIds.length} branches selected`;

    return (
        <div className="space-y-6">
            {/* Selection Panel */}
            <Card>
                <CardHeader>
                    <CardTitle>NEFT Format Report</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {/* Branch Filter - Only show for Admin and Area Manager */}
                        {(userRole === 'ADMIN' || userRole === 'AREA_MANAGER') && (
                            <div className="flex flex-col gap-2 mb-4">
                                <Label className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4" />
                                    Branch Filter
                                </Label>
                                {isLoadingBranches ? (
                                    <Skeleton className="h-10 w-full" />
                                ) : (
                                    <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                className="w-full justify-between font-normal"
                                            >
                                                <span className="truncate flex items-center gap-2">
                                                    <Building2 className="h-4 w-4" />
                                                    {branchTriggerLabel}
                                                </span>
                                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[400px] p-0" align="start">
                                            <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
                                                {branches.map(branch => (
                                                    <div
                                                        key={branch.id}
                                                        className="flex items-center gap-2 rounded-sm px-2 py-2 hover:bg-accent cursor-pointer"
                                                        onClick={() => toggleBranch(branch.id)}
                                                    >
                                                        <Checkbox
                                                            checked={selectedBranchIds.includes(branch.id)}
                                                            onCheckedChange={() => toggleBranch(branch.id)}
                                                            id={`branch-${branch.id}`}
                                                        />
                                                        <label
                                                            htmlFor={`branch-${branch.id}`}
                                                            className="text-sm cursor-pointer select-none flex-1 flex items-center justify-between"
                                                        >
                                                            <span>{branch.name}</span>
                                                            <span className="text-xs text-muted-foreground">{branch.code}</span>
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                            {branches.length > 1 && (
                                                <div className="border-t p-2 flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs h-7"
                                                        onClick={selectAllBranches}
                                                    >
                                                        Select All
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs h-7"
                                                        onClick={clearAllBranches}
                                                    >
                                                        Clear All
                                                    </Button>
                                                </div>
                                            )}
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                        )}

                        {/* Row 1: Date Range + Disbursement Status in one line */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <Label className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    From Date
                                </Label>
                                <SimpleDatePicker
                                    date={fromDate}
                                    setDate={(date) => setFromDate(date)}
                                    className="w-full mt-1.5"
                                />
                            </div>
                            <div>
                                <Label className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4" />
                                    To Date
                                </Label>
                                <SimpleDatePicker
                                    date={toDate}
                                    setDate={(date) => setToDate(date)}
                                    className="w-full mt-1.5"
                                />
                            </div>
                            <div>
                                <Label className="flex items-center gap-2">
                                    <Filter className="h-4 w-4" />
                                    Disbursement Status
                                </Label>
                                <div className="flex gap-2 mt-1.5">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={disbursementFilter === 'ALL' ? 'default' : 'outline'}
                                        onClick={() => setDisbursementFilter('ALL')}
                                        className="flex-1 h-9"
                                    >
                                        All
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={disbursementFilter === 'DISBURSED' ? 'default' : 'outline'}
                                        onClick={() => setDisbursementFilter('DISBURSED')}
                                        className="flex-1 h-9"
                                    >
                                        Disbursed
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={disbursementFilter === 'NON_DISBURSED' ? 'default' : 'outline'}
                                        onClick={() => setDisbursementFilter('NON_DISBURSED')}
                                        className="flex-1 h-9"
                                    >
                                        Non-Disbursed
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {/* Clear Dates Button - only show if dates are not today */}
                        {(fromDate !== getTodayDate() || toDate !== getTodayDate()) && (
                            <div className="flex justify-end">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearDateFilters}
                                >
                                    <X className="h-4 w-4 mr-1" />
                                    Reset to Today
                                </Button>
                            </div>
                        )}

                        {/* Row 2: Index Selection + Search Button in one line */}
                        <div className="flex flex-col md:flex-row gap-3 pt-2">
                            <div className="flex-1">
                                <Label>Select Loan Index Number(s)</Label>
                                {isLoadingIndices ? (
                                    <Skeleton className="h-10 w-full mt-1.5" />
                                ) : (
                                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                role="combobox"
                                                className={cn(
                                                    'w-full justify-between font-normal mt-1.5',
                                                    selectedIndexIds.length === 0 && 'text-muted-foreground'
                                                )}
                                                disabled={availableIndices.length === 0}
                                            >
                                                <span className="truncate">{triggerLabel}</span>
                                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                                            <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
                                                {availableIndices.map(index => (
                                                    <div
                                                        key={index.id}
                                                        className="flex items-center gap-2 rounded-sm px-2 py-2 hover:bg-accent cursor-pointer"
                                                        onClick={() => toggleIndex(index.id)}
                                                    >
                                                        <Checkbox
                                                            checked={selectedIndexIds.includes(index.id)}
                                                            onCheckedChange={() => toggleIndex(index.id)}
                                                            id={`idx-${index.id}`}
                                                        />
                                                        <label
                                                            htmlFor={`idx-${index.id}`}
                                                            className="text-sm cursor-pointer select-none flex-1 flex items-center justify-between"
                                                        >
                                                            <div className="flex flex-col">
                                                                <span>{index.indexNo} — {index.centerName}</span>
                                                                {(index.nonDisbursedCount ?? 0) > 0 && (
                                                                    <span className="text-xs text-amber-600">
                                                                        {index.nonDisbursedCount} pending out of {index.totalLoans}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {!index.hasNonDisbursedLoans && (index.totalLoans ?? 0) > 0 && (
                                                                <span className="text-xs text-green-600">✓ Fully Disbursed</span>
                                                            )}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                            {availableIndices.length > 1 && (
                                                <div className="border-t p-2 flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs h-7"
                                                        onClick={() => setSelectedIndexIds(availableIndices.map(i => i.id))}
                                                    >
                                                        Select All
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-xs h-7"
                                                        onClick={() => setSelectedIndexIds([])}
                                                    >
                                                        Clear
                                                    </Button>
                                                </div>
                                            )}
                                        </PopoverContent>
                                    </Popover>
                                )}
                            </div>
                            <div className="flex gap-2 items-end">
                                <Button
                                    onClick={handleShow}
                                    disabled={isLoading || selectedIndexIds.length === 0 || availableIndices.length === 0}
                                    className="h-10"
                                >
                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                                    Show Report
                                </Button>
                                <Button onClick={handleReset} variant="outline" className="h-10">
                                    <RefreshCw className="w-4 h-4 mr-2" />
                                    Reset
                                </Button>
                            </div>
                        </div>

                        {availableIndices.length === 0 && !isLoadingIndices && (
                            <p className="text-sm text-muted-foreground text-center py-2">
                                No loan indices found for the selected filters.
                            </p>
                        )}
                    </div>

                    {showReport && (
                        <div className="mt-6 flex justify-end gap-2 pt-4 border-t">
                            <Button onClick={handlePrint} disabled={data.length === 0} variant="outline">
                                <Printer className="w-4 h-4 mr-2" />
                                Print
                            </Button>
                            <ExportDropdown
                                onExportPDF={data.length > 0 ? handleExportPDF : undefined}
                                onExportExcel={data.length > 0 ? handleExportExcel : undefined}
                                canExport={canExportReport('neft-format')}
                                onExportCSV={data.length > 0 ? handleExport : undefined}
                                onExportWord={data.length > 0 ? handleExportWord : undefined}
                                reportSlug={data.length > 0 && getReportExportMode('neft-format') === 'REQUEST_QUEUE' ? 'neft-format' : undefined}
                                exportParams={{
                                    fromDate: fromDate || null,
                                    toDate: toDate || null,
                                    branchIds: selectedBranchIds.length > 0 ? selectedBranchIds : 'ALL',
                                    filters: { indexIds: submittedIndexIds.join(',') },
                                }}
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Results Table */}
            {showReport && (
                <Card>
                    <CardHeader className="pb-3">
                        <ReportHeader title="NEFT Format Report" />
                        <div className="flex justify-between items-center flex-wrap gap-2">
                            <CardTitle className="text-base">
                                NEFT Disbursement List
                                {submittedIndexInfos.length > 0 && (
                                    <span className="ml-2 font-normal text-muted-foreground text-sm">
                                        — {submittedIndexInfos.map(n => n.indexNo).join(', ')}
                                    </span>
                                )}
                            </CardTitle>
                            <div className="flex items-center gap-3 flex-wrap">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search NEFT records..."
                                />
                                <div className="text-sm text-muted-foreground">
                                    {searchedRows.length} records | Total: {formatCurrency(searchedRows.reduce((sum, item) => sum + item.loanAmount, 0))}
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-b">
                                        <TableHead className="text-center font-bold w-16">S No</TableHead>
                                        <TableHead className="font-bold">Region Name</TableHead>
                                        <TableHead className="font-bold">Division Name</TableHead>
                                        <TableHead className="font-bold">Area Name</TableHead>
                                        <TableHead className="font-bold">Branch ID</TableHead>
                                        <TableHead className="font-bold">Branch Name</TableHead>
                                        <TableHead className="font-bold">Centre ID</TableHead>
                                        <TableHead className="font-bold">Center Name</TableHead>
                                        <TableHead className="font-bold">Loan ID</TableHead>
                                        <TableHead className="font-bold">Member ID</TableHead>
                                        <TableHead className="font-bold">IFSC Code</TableHead>
                                        <TableHead className="font-bold">Account Number</TableHead>
                                        <TableHead className="font-bold">Member Name</TableHead>
                                        <TableHead className="font-bold">Bank Name</TableHead>
                                        <TableHead className="font-bold">Bank Branch Name</TableHead>
                                        <TableHead className="text-right font-bold w-36">Loan Amount</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((row) => (
                                        <TableRow key={row.sno} className="border-b">
                                            <TableCell className="text-center font-mono">{row.sno}</TableCell>
                                            <TableCell>{row.regionName || '-'}</TableCell>
                                            <TableCell>{row.divisionName || '-'}</TableCell>
                                            <TableCell>{row.areaName || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.branchId || '-'}</TableCell>
                                            <TableCell>{row.branchName || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.centreId || '-'}</TableCell>
                                            <TableCell>{row.centerName || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.loanId || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.memberId || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.ifsc || '-'}</TableCell>
                                            <TableCell className="font-mono">{row.accountNo || '-'}</TableCell>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell>{row.bank || '-'}</TableCell>
                                            <TableCell>{row.bankBranch || '-'}</TableCell>
                                            <TableCell className="text-right font-mono">{formatCurrency(row.loanAmount)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}