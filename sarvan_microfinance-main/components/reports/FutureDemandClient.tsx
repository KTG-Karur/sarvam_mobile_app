'use client';

import * as XLSX from 'xlsx-js-style';
import { applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';

import { useState, useEffect } from 'react';
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
import { Calendar, RefreshCw, Download, Loader2, ChevronLeft, ChevronRight, FileText, FileType, FileOutput } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { Input } from '@/components/ui/input';
import { MEMBER_CONTACT_HEADERS, memberContactValues, type MemberContactFields } from '@/app/lib/reports/member-contact-columns';
import { MemberContactCell, MEMBER_CONTACT_COLUMN_LABEL } from '@/components/reports/MemberContactCell';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { reportHeaderRows } from '@/app/lib/reports/excel-report-header';
import jsPDF from 'jspdf';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawFutureDemandReport } from '@/app/lib/reports/future-demand-pdf';
import { exportToCSV, exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { getCentersForDropdown, CenterOption } from '@/app/lib/actions/centers';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { DateInput } from '@/components/ui/date-input';

type ReportType = 'OFFICERWISE' | 'CENTERWISE' | 'CLIENTWISE';

type BranchOption = { id: string; name: string; code: string };

type FutureDemandRow = {
    demandDate: string;
    demandDay: string;
    fdo: string;
    centerName?: string;
    clientName?: string;
    noOfCenters?: number;
    noOfClients?: number;
    demandPri: number;
    demandInt: number;
    demandSavings: number;
    totalDemand: number;
} & MemberContactFields; // CLIENTWISE rows only

type FutureDemandResponse = {
    data: FutureDemandRow[];
    totalPages: number;
    totalRecords: number;
    totals: {
        noOfCenters: number;
        noOfClients: number;
        demandPri: number;
        demandInt: number;
        demandSavings: number;
        totalDemand: number;
    };
};

// Format date as "Mon DD YYYY" for display
const formatDateForDisplay = (dateString: string): string => {
    if (!dateString) return '';
    if (/^[A-Za-z]{3} \d{2} \d{4}$/.test(dateString.trim())) {
        return dateString;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${month} ${day} ${year}`;
};

// Format currency — whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number): string => formatReportAmount(amount);

export function FutureDemandClient() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const [fromDate, setFromDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [tillDate, setTillDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    // Submitted (applied) date snapshot — frozen until the next Show click, so pagination and
    // exports keep using the last-submitted range even if fromDate/tillDate above are edited
    // afterward without clicking Show again.
    const [submittedFromDate, setSubmittedFromDate] = useState(fromDate);
    const [submittedTillDate, setSubmittedTillDate] = useState(tillDate);
    const [reportType, setReportType] = useState<ReportType>('OFFICERWISE');
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<FutureDemandRow[]>([]);
    const [totals, setTotals] = useState<FutureDemandResponse['totals'] | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalRecords, setTotalRecords] = useState(0);
    // CLIENTWISE, server-side: member name / Aadhaar / mobile / co-applicant mobile.
    const [search, setSearch] = useState('');

    const [selectedBranch, setSelectedBranch] = useState<string>('all');
    const [selectedCenter, setSelectedCenter] = useState<string>('all');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [centers, setCenters] = useState<CenterOption[]>([]);

    const filteredCenters = selectedBranch === 'all'
        ? centers
        : centers.filter((c) => c.branchId === selectedBranch);

    useEffect(() => {
        getCentersForDropdown()
            .then((list) => setCenters(list))
            .catch(() => {});

        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, []);

    // `dateOverride` lets handleShow pass the just-read draft dates straight through on the
    // same click — reading submittedFromDate/submittedTillDate here would otherwise use the
    // pre-update (stale) state, since the setSubmitted* calls in handleShow haven't
    // re-rendered yet. Callers other than handleShow (pagination) omit it and get the
    // last-submitted snapshot.
    const fetchData = async (page: number, dateOverride?: { fromDate: string; tillDate: string }) => {
        const effFromDate = dateOverride?.fromDate ?? submittedFromDate;
        const effTillDate = dateOverride?.tillDate ?? submittedTillDate;
        setIsLoading(true);
        try {
            const params = new URLSearchParams({
                fromDate: effFromDate,
                toDate: effTillDate,
                reportType,
                page: page.toString(),
                pageSize: '20',
                ...(selectedBranch !== 'all' ? { branchId: selectedBranch } : {}),
                ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                ...(reportType === 'CLIENTWISE' && search.trim() ? { search: search.trim() } : {}),
            });

            const response = await fetch(`/api/reports/future-demand?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch data');
            }

            const result: FutureDemandResponse = await response.json();

            setData(result.data);
            setTotals(result.totals);
            setTotalPages(result.totalPages);
            setTotalRecords(result.totalRecords);
            setCurrentPage(page);
            setShowReport(true);

            if (page === 1) {
                toast({
                    title: 'Report generated',
                    description: `Found ${result.totalRecords} records.`,
                });
            }

        } catch (error) {
            console.error(error);
            toast({
                title: 'Error',
                description: 'Failed to load report data.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleShow = () => {
        if (!fromDate || !tillDate) {
            toast({
                title: 'Date range required',
                description: 'Please select both From Date and Till Date.',
                variant: 'destructive',
            });
            return;
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            toast({
                title: 'Invalid date range',
                description: 'From Date cannot be greater than Till Date.',
                variant: 'destructive',
            });
            return;
        }

        const snapshot = { fromDate, tillDate };
        setSubmittedFromDate(fromDate);
        setSubmittedTillDate(tillDate);
        fetchData(1, snapshot);
    };

    const handleReset = () => {
        const today = new Date().toISOString().split('T')[0];
        setFromDate(today);
        setTillDate(today);
        setSubmittedFromDate(today);
        setSubmittedTillDate(today);
        setReportType('OFFICERWISE');
        setSelectedBranch('all');
        setSelectedCenter('all');
        setShowReport(false);
        setData([]);
        setTotals(null);
        setCurrentPage(1);
        setTotalPages(1);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            fetchData(newPage);
        }
    };

    const handleExport = async () => {
        if (!submittedFromDate || !submittedTillDate) return;

        try {
            toast({
                title: 'Export started',
                description: 'Fetching data for export...',
            });

            const params = new URLSearchParams({
                fromDate: submittedFromDate,
                toDate: submittedTillDate,
                reportType,
                page: '1',
                pageSize: '1000000', // Fetch all records for export
                ...(selectedBranch !== 'all' ? { branchId: selectedBranch } : {}),
                ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                ...(reportType === 'CLIENTWISE' && search.trim() ? { search: search.trim() } : {}),
            });

            const response = await fetch(`/api/reports/future-demand?${params}`);

            if (!response.ok) {
                throw new Error('Failed to fetch data for export');
            }

            const result: FutureDemandResponse = await response.json();
            const exportData = result.data;
            const exportTotals = result.totals;

            // Prepare data directly for table structure
            const excelRows = [];

            // Add Header Info
            excelRows.push(...reportHeaderRows('Future Demand Report'));
            excelRows.push([`From Date: ${formatDateForDisplay(submittedFromDate)}`, `Till Date: ${formatDateForDisplay(submittedTillDate)}`]);
            excelRows.push([`Report Type: ${reportType}`]);
            excelRows.push([]); // Empty row

            // Define Headers
            let headers: string[] = [];
            if (reportType === 'OFFICERWISE') {
                headers = ['Demand Date', 'Demand Day', 'FDO', 'No. of Centers', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];
            } else if (reportType === 'CENTERWISE') {
                headers = ['Demand Date', 'Demand Day', 'Center Name', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];
            } else if (reportType === 'CLIENTWISE') {
                headers = ['Demand Date', 'Demand Day', 'Client Name', 'Center Name', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand', ...MEMBER_CONTACT_HEADERS];
            }
            excelRows.push(headers);

            // Add Data Rows
            exportData.forEach(row => {
                const rowData: any[] = [
                    formatDateForDisplay(row.demandDate),
                    row.demandDay,
                ];

                if (reportType === 'OFFICERWISE') {
                    rowData.push(row.fdo);
                    rowData.push(row.noOfCenters);
                    rowData.push(row.noOfClients);
                } else if (reportType === 'CENTERWISE') {
                    rowData.push(row.centerName);
                    rowData.push(row.noOfClients);
                } else if (reportType === 'CLIENTWISE') {
                    rowData.push(row.clientName);
                    rowData.push(row.centerName);
                }

                rowData.push(truncateReportAmount(row.demandPri));
                rowData.push(truncateReportAmount(row.demandInt));
                if (loanAdvanceEnabled) rowData.push(truncateReportAmount(row.demandSavings || 0));
                rowData.push(truncateReportAmount(row.totalDemand));
                if (reportType === 'CLIENTWISE') rowData.push(...memberContactValues(row));

                excelRows.push(rowData);
            });

            // Add Totals Row
            if (exportTotals) {
                const totalsRow: any[] = ['TOTAL', ''];

                if (reportType === 'OFFICERWISE') {
                    totalsRow.push('');
                    totalsRow.push(exportTotals.noOfCenters);
                    totalsRow.push(exportTotals.noOfClients);
                } else if (reportType === 'CENTERWISE') {
                    totalsRow.push('');
                    totalsRow.push(exportTotals.noOfClients);
                } else if (reportType === 'CLIENTWISE') {
                    totalsRow.push('');
                    totalsRow.push('');
                }

                totalsRow.push(truncateReportAmount(exportTotals.demandPri));
                totalsRow.push(truncateReportAmount(exportTotals.demandInt));
                if (loanAdvanceEnabled) totalsRow.push(truncateReportAmount(exportTotals.demandSavings || 0));
                totalsRow.push(truncateReportAmount(exportTotals.totalDemand));

                excelRows.push(totalsRow);
            }

            // Create Workbook
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(excelRows);

            // Add column widths (optional but good)
            const wscols = headers.map(() => ({ wch: 15 }));
            if (reportType === 'OFFICERWISE') wscols[2] = { wch: 25 }; // FDO Name
            if (reportType === 'CENTERWISE') wscols[2] = { wch: 25 }; // Center Name
            if (reportType === 'CLIENTWISE') { wscols[2] = { wch: 25 }; wscols[3] = { wch: 25 }; }
            ws['!cols'] = wscols;
            applyExcelReportFont(ws);

            XLSX.utils.book_append_sheet(wb, ws, 'Future Demand');

            // Generate file
            XLSX.writeFile(wb, `Future_Demand_${reportType}_${submittedFromDate}_to_${submittedTillDate}.xlsx`);

            toast({
                title: 'Export successful',
                description: 'The Excel file has been downloaded.',
            });

        } catch (error) {
            console.error(error);
            toast({
                title: 'Export failed',
                description: 'There was an error generating the Excel file.',
                variant: 'destructive',
            });
        }
    };

    // Mirrors the same re-fetch-all + field mapping used by handleExport above
    // (kept separate so handleExport is left untouched).
    const fetchFutureDemandExportRows = async (): Promise<{ headers: string[]; rows: (string | number)[][] } | null> => {
        const params = new URLSearchParams({
            fromDate: submittedFromDate,
            toDate: submittedTillDate,
            reportType,
            page: '1',
            pageSize: '1000000',
            ...(selectedBranch !== 'all' ? { branchId: selectedBranch } : {}),
            ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
            ...(reportType === 'CLIENTWISE' && search.trim() ? { search: search.trim() } : {}),
        });
        const response = await fetch(`/api/reports/future-demand?${params}`);
        if (!response.ok) throw new Error('Failed to fetch data for export');
        const result: FutureDemandResponse = await response.json();
        const exportData = result.data;
        const exportTotals = result.totals;

        let headers: string[] = [];
        if (reportType === 'OFFICERWISE') {
            headers = ['Demand Date', 'Demand Day', 'FDO', 'No. of Centers', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];
        } else if (reportType === 'CENTERWISE') {
            headers = ['Demand Date', 'Demand Day', 'Center Name', 'No. of Clients', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand'];
        } else if (reportType === 'CLIENTWISE') {
            headers = ['Demand Date', 'Demand Day', 'Client Name', 'Center Name', 'Demand Pri', 'Demand Int', ...(loanAdvanceEnabled ? ['Demand Savings'] : []), 'Total Demand', ...MEMBER_CONTACT_HEADERS];
        }

        const rows: (string | number)[][] = exportData.map((row) => {
            const rowData: (string | number)[] = [formatDateForDisplay(row.demandDate), row.demandDay];
            if (reportType === 'OFFICERWISE') {
                rowData.push(row.fdo ?? '');
                rowData.push(row.noOfCenters ?? '');
                rowData.push(row.noOfClients ?? '');
            } else if (reportType === 'CENTERWISE') {
                rowData.push(row.centerName ?? '');
                rowData.push(row.noOfClients ?? '');
            } else if (reportType === 'CLIENTWISE') {
                rowData.push(row.clientName ?? '');
                rowData.push(row.centerName ?? '');
            }
            rowData.push(truncateReportAmount(row.demandPri));
            rowData.push(truncateReportAmount(row.demandInt));
            if (loanAdvanceEnabled) rowData.push(truncateReportAmount(row.demandSavings || 0));
            rowData.push(truncateReportAmount(row.totalDemand));
            if (reportType === 'CLIENTWISE') rowData.push(...memberContactValues(row));
            return rowData;
        });

        if (exportTotals) {
            const totalsRow: (string | number)[] = ['TOTAL', ''];
            if (reportType === 'OFFICERWISE') {
                totalsRow.push('');
                totalsRow.push(exportTotals.noOfCenters);
                totalsRow.push(exportTotals.noOfClients);
            } else if (reportType === 'CENTERWISE') {
                totalsRow.push('');
                totalsRow.push(exportTotals.noOfClients);
            } else if (reportType === 'CLIENTWISE') {
                totalsRow.push('');
                totalsRow.push('');
            }
            totalsRow.push(truncateReportAmount(exportTotals.demandPri));
            totalsRow.push(truncateReportAmount(exportTotals.demandInt));
            if (loanAdvanceEnabled) totalsRow.push(truncateReportAmount(exportTotals.demandSavings || 0));
            totalsRow.push(truncateReportAmount(exportTotals.totalDemand));
            rows.push(totalsRow);
        }

        return { headers, rows };
    };

    const handleExportPDF = async () => {
        if (!submittedFromDate || !submittedTillDate) return;
        try {
            toast({ title: 'Export started', description: 'Fetching data for export...' });
            const result = await fetchFutureDemandExportRows();
            if (!result) return;
            const doc = new jsPDF({ orientation: 'landscape' });
            const reportFont = await ensureReportFont(doc);
            await drawFutureDemandReport(doc, result.headers, result.rows, {
                reportType,
                subtitle: `${formatDateForDisplay(submittedFromDate)} to ${formatDateForDisplay(submittedTillDate)}`,
            }, reportFont);
            doc.save(`Future_Demand_${reportType}_${submittedFromDate}_to_${submittedTillDate}.pdf`);
            toast({ title: 'Export successful', description: 'The PDF file has been downloaded.' });
        } catch (error) {
            console.error(error);
            toast({ title: 'Export failed', description: 'There was an error generating the PDF file.', variant: 'destructive' });
        }
    };

    const handleExportCSV = async () => {
        if (!submittedFromDate || !submittedTillDate) return;
        try {
            toast({ title: 'Export started', description: 'Fetching data for export...' });
            const result = await fetchFutureDemandExportRows();
            if (!result) return;
            exportToCSV(`Future_Demand_${reportType}_${submittedFromDate}_to_${submittedTillDate}`, `FUTURE DEMAND REPORT — ${reportType}`, result.headers, result.rows);
        } catch (error) {
            console.error(error);
            toast({ title: 'Export failed', description: 'There was an error generating the CSV file.', variant: 'destructive' });
        }
    };

    // Word-only presentation: same rows as PDF/CSV above, but the trailing 'TOTAL' row
    // (when present) is split off for distinct styling. Columns differ by reportType, so
    // alignment/widths branch the same way the header set already does; no grouped headers
    // — 8-9 flat columns don't have genuine repeated-prefix pairs to collapse.
    const buildFutureDemandWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => {
        const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
        const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
        const totalsRow = hasTotals ? rows[rows.length - 1] : undefined;

        if (reportType === 'OFFICERWISE') {
            return {
                bodyRows,
                options: {
                    columnAlignments: ['center', 'center', 'left', 'right', 'right', 'right', 'right', ...(loanAdvanceEnabled ? (['right'] as const) : []), 'right'],
                    columnWidthWeights: [8, 8, 14, 9, 9, 9, 9, ...(loanAdvanceEnabled ? [9] : []), 10],
                    totalsRow,
                },
            };
        }
        if (reportType === 'CENTERWISE') {
            return {
                bodyRows,
                options: {
                    columnAlignments: ['center', 'center', 'left', 'right', 'right', 'right', ...(loanAdvanceEnabled ? (['right'] as const) : []), 'right'],
                    columnWidthWeights: [8, 8, 16, 9, 9, 9, ...(loanAdvanceEnabled ? [9] : []), 10],
                    totalsRow,
                },
            };
        }
        // CLIENTWISE
        return {
            bodyRows,
            options: {
                columnAlignments: ['center', 'center', 'left', 'left', 'right', 'right', ...(loanAdvanceEnabled ? (['right'] as const) : []), 'right'],
                columnWidthWeights: [8, 8, 14, 12, 9, 9, ...(loanAdvanceEnabled ? [9] : []), 10],
                totalsRow,
            },
        };
    };

    const handleExportWord = async () => {
        if (!submittedFromDate || !submittedTillDate) return;
        try {
            toast({ title: 'Export started', description: 'Fetching data for export...' });
            const result = await fetchFutureDemandExportRows();
            if (!result) return;
            const { bodyRows, options } = buildFutureDemandWordOptions(result.rows);
            await exportToWord(`Future_Demand_${reportType}_${submittedFromDate}_to_${submittedTillDate}`, `FUTURE DEMAND REPORT — ${reportType}`, result.headers, bodyRows, options);
        } catch (error) {
            console.error(error);
            toast({ title: 'Export failed', description: 'There was an error generating the Word file.', variant: 'destructive' });
        }
    };

    // Define table columns based on report type
    // OFFICERWISE: Demand Date, Demand Day, FDO, No. of Centers, No. of Clients, Demand Pri, Demand Int, Total Demand
    // CENTERWISE: Demand Date, Demand Day, Center Name, No. of Clients, Demand Pri, Demand Int, Total Demand
    // CLIENTWISE: Demand Date, Demand Day, Client Name, Center Name, Demand Pri, Demand Int, Total Demand (Maybe FDO too?)

    return (
        <div className="space-y-6">
            {/* Filter Section */}
            <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <CardHeader>
                    <CardTitle className="text-lg">Report Parameters</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="branchName" className="text-sm font-semibold">Branch</Label>
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

                        <div className="space-y-2">
                            <Label htmlFor="centerName" className="text-sm font-semibold">Center</Label>
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

                        <div className="space-y-2">
                            <Label htmlFor="fromDate" className="text-sm font-semibold">From Date</Label>
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

                        <div className="space-y-2">
                            <Label htmlFor="tillDate" className="text-sm font-semibold">Till Date</Label>
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

                        <div className="space-y-2">
                            <Label htmlFor="reportType" className="text-sm font-semibold">Report Type</Label>
                            <Select
                                value={reportType}
                                onValueChange={(value) => setReportType(value as ReportType)}
                                disabled={isLoading}
                            >
                                <SelectTrigger id="reportType" className="h-11">
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="OFFICERWISE">OFFICERWISE</SelectItem>
                                    <SelectItem value="CENTERWISE">CENTERWISE</SelectItem>
                                    <SelectItem value="CLIENTWISE">CLIENTWISE</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex gap-3 mt-6">
                        <Button
                            onClick={handleShow}
                            disabled={isLoading}
                            className="bg-primary hover:bg-primary text-white shadow-md"
                        >
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Show'}
                        </Button>
                        <Button
                            onClick={handleReset}
                            disabled={isLoading}
                            variant="destructive"
                            className="shadow-md"
                        >
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Reset
                        </Button>
                        <ExportDropdown
                            onExportPDF={showReport && !isLoading ? handleExportPDF : undefined}
                            onExportExcel={showReport && !isLoading ? handleExport : undefined}
                            onExportCSV={showReport && !isLoading ? handleExportCSV : undefined}
                            onExportWord={showReport && !isLoading ? handleExportWord : undefined}
                            reportSlug={showReport && !isLoading && getReportExportMode('future-demand') === 'REQUEST_QUEUE' ? 'future-demand' : undefined}
                            canExport={canExportReport('future-demand')}
                            exportParams={{
                                fromDate: submittedFromDate,
                                toDate: submittedTillDate,
                                branchIds: selectedBranch === 'all' ? 'ALL' : [selectedBranch],
                                filters: {
                                    reportType,
                                    ...(selectedCenter !== 'all' ? { centerId: selectedCenter } : {}),
                                },
                            }}
                            className="shadow-md"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Report Table */}
            {showReport && (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardHeader className="pb-0">
                        <ReportHeader title="Future Demand Report" subtitle={`Report Type: ${reportType}`} />
                        {reportType === 'CLIENTWISE' && (
                            <div className="flex justify-end pb-2">
                                <Input
                                    placeholder="Name, Aadhaar or mobile — Enter to search"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') fetchData(1); }}
                                    className="h-9 w-full max-w-xs"
                                />
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="max-h-[600px] overflow-auto">
                            <Table className="min-w-full">
                                <TableHeader className="bg-primary text-white sticky top-0 z-10">
                                    <TableRow className="hover:bg-primary/80 border-b border-sidebar-accent">
                                        <TableHead className="text-white font-semibold">Demand Date</TableHead>
                                        <TableHead className="text-white font-semibold">Demand Day</TableHead>

                                        {/* Dynamic Headers */}
                                        {reportType === 'OFFICERWISE' && <TableHead className="text-white font-semibold">FDO</TableHead>}
                                        {reportType === 'CENTERWISE' && <TableHead className="text-white font-semibold">Center Name</TableHead>}
                                        {reportType === 'CLIENTWISE' && <TableHead className="text-white font-semibold">Client Name</TableHead>}
                                        {reportType === 'CLIENTWISE' && <TableHead className="text-white font-semibold">{MEMBER_CONTACT_COLUMN_LABEL}</TableHead>}
                                        {reportType === 'CLIENTWISE' && <TableHead className="text-white font-semibold">Center Name</TableHead>}

                                        {reportType === 'OFFICERWISE' && <TableHead className="text-white font-semibold text-right">No. of Centers</TableHead>}
                                        {(reportType === 'OFFICERWISE' || reportType === 'CENTERWISE') && <TableHead className="text-white font-semibold text-right">No. of Clients</TableHead>}

                                        <TableHead className="text-white font-semibold text-right">Demand Pri</TableHead>
                                        <TableHead className="text-white font-semibold text-right">Demand Int</TableHead>
                                        {loanAdvanceEnabled && (
                                            <TableHead className="text-emerald-200 font-semibold text-right">Demand Sav</TableHead>
                                        )}
                                        <TableHead className="text-white font-semibold text-right">Total Demand</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody className="bg-white dark:bg-green-950/30">
                                    {data.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={11} className="text-center py-8 text-slate-500">
                                                No records found
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        data.map((row, idx) => (
                                            <TableRow key={idx} className="hover:bg-green-50/50">
                                                <TableCell>{formatDateForDisplay(row.demandDate)}</TableCell>
                                                <TableCell>{row.demandDay}</TableCell>

                                                {reportType === 'OFFICERWISE' && <TableCell>{row.fdo}</TableCell>}
                                                {reportType === 'CENTERWISE' && <TableCell>{row.centerName}</TableCell>}
                                                {reportType === 'CLIENTWISE' && <TableCell>{row.clientName}</TableCell>}
                                                {reportType === 'CLIENTWISE' && <TableCell><MemberContactCell row={row} /></TableCell>}
                                                {reportType === 'CLIENTWISE' && <TableCell>{row.centerName}</TableCell>}

                                                {reportType === 'OFFICERWISE' && <TableCell className="text-right">{row.noOfCenters}</TableCell>}
                                                {(reportType === 'OFFICERWISE' || reportType === 'CENTERWISE') && <TableCell className="text-right">{row.noOfClients}</TableCell>}

                                                <TableCell className="text-right">{formatCurrency(row.demandPri)}</TableCell>
                                                <TableCell className="text-right">{formatCurrency(row.demandInt)}</TableCell>
                                                {loanAdvanceEnabled && (
                                                    <TableCell className="text-right text-emerald-700 dark:text-emerald-400">{formatCurrency(row.demandSavings || 0)}</TableCell>
                                                )}
                                                <TableCell className="text-right font-bold">{formatCurrency(row.totalDemand)}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                    {/* Grand Total Row */}
                                    {data.length > 0 && totals && (
                                        <TableRow className="bg-green-50 font-bold border-t-2 border-primary/30">
                                            <TableCell>TOTAL</TableCell>
                                            <TableCell></TableCell>

                                            {reportType === 'OFFICERWISE' && <TableCell></TableCell>}
                                            {reportType === 'CENTERWISE' && <TableCell></TableCell>}
                                            {reportType === 'CLIENTWISE' && <TableCell></TableCell>}
                                            {reportType === 'CLIENTWISE' && <TableCell></TableCell>}
                                            {reportType === 'CLIENTWISE' && <TableCell></TableCell>}

                                            {reportType === 'OFFICERWISE' && <TableCell className="text-right">{totals.noOfCenters}</TableCell>}
                                            {(reportType === 'OFFICERWISE' || reportType === 'CENTERWISE') && <TableCell className="text-right">{totals.noOfClients}</TableCell>}

                                            <TableCell className="text-right">{formatCurrency(totals.demandPri)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(totals.demandInt)}</TableCell>
                                            {loanAdvanceEnabled && (
                                                <TableCell className="text-right text-emerald-700 dark:text-emerald-400">{formatCurrency(totals.demandSavings || 0)}</TableCell>
                                            )}
                                            <TableCell className="text-right">{formatCurrency(totals.totalDemand)}</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between p-4 border-t bg-green-50 dark:bg-brand-green-darker/50">
                                <div className="text-sm text-slate-500">
                                    Page {currentPage} of {totalPages} ({totalRecords} records)
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage <= 1}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage >= totalPages}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {!showReport && (
                <Card className="border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <Download className="mx-auto h-12 w-12 text-slate-400" />
                    <p className="mt-4 text-sm font-medium text-sidebar-accent">
                        Select parameters and click Show to view the report
                    </p>
                </Card>
            )}
        </div>
    );
}
