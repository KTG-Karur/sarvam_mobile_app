'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
    Calendar,
    Download,
    RefreshCw,
    Filter,
    Building2,
    MapPin,
    DollarSign,
    FileSpreadsheet,
    FileText,
    FileOutput,
    RotateCcw,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    AlertCircle,
    Users,
    Loader2,
    SearchX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import { exportToWord, type WordExportOptions } from '@/app/lib/report-export-utils';
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from '@/app/lib/reports/excel-report-header';
import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';
import { drawOsCenterwiseReport } from '@/app/lib/reports/os-centerwise-pdf';
import { formatReportAmount, truncateReportAmount } from '@/app/lib/utils/format-amount';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import { PageLoader } from '@/components/ui/page-loader';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface OSCenterwiseEntry {
    branchCode: string;
    branchName: string;
    centerCode: string;
    centerName: string;
    noOfClients: number;
    osPrincipal: number;
    osInterest: number;
    arrClients: number;
    arrearPri: number;
    arrearInt: number;
}

interface OSCenterwiseTotals {
    totalCenters: number;
    totalClients: number;
    totalOSPrincipal: number;
    totalOSInterest: number;
    totalArrClients: number;
    totalArrearPri: number;
    totalArrearInt: number;
}

interface BranchOption {
    id: string;
    name: string;
    code: string;
}

interface User {
    id: string;
    employeeId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    branchId: string;
    isActive: boolean;
}

interface ActiveBranch {
    id: string;
    name: string;
    code: string;
    address: string;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Whole rupees, truncated (not rounded), per the report amount-display requirement.
const formatCurrency = (amount: number) => formatReportAmount(amount);

const getTodayStr = (): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function OSCenterwisePage() {
    const { toast } = useToast();
    const { canExportReport, getReportExportMode } = usePermission();

    // User and branch state
    const [user, setUser] = useState<User | null>(null);
    const [activeBranch, setActiveBranch] = useState<ActiveBranch | null>(null);
    
    // Filter state
    const [branchId, setBranchId] = useState('all');
    const [reportDate, setReportDate] = useState<string>(getTodayStr());
    // Submitted (applied) date snapshot — frozen until the next Show click, so exports and
    // the footer date label keep using the last-shown date even if reportDate is edited
    // afterward without clicking Show again.
    const [submittedReportDate, setSubmittedReportDate] = useState(reportDate);

    // Data state
    const [data, setData] = useState<OSCenterwiseEntry[]>([]);
    const [totals, setTotals] = useState<OSCenterwiseTotals>({
        totalCenters: 0,
        totalClients: 0,
        totalOSPrincipal: 0,
        totalOSInterest: 0,
        totalArrClients: 0,
        totalArrearPri: 0,
        totalArrearInt: 0,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [hasFetched, setHasFetched] = useState(false);

    // Branch dropdown state
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [branchesLoading, setBranchesLoading] = useState(true);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 25;

    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentData = data.slice(startIndex, endIndex);

    // Determine user role
    const isAdmin = user?.role === 'ADMIN';
    const isBranchManager = user?.role === 'BRANCH_MANAGER';
    const isAreaManager = user?.role === 'AREA_MANAGER';

    // â”€â”€â”€ Load User and Active Branch from localStorage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    useEffect(() => {
        // Load user from localStorage
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            try {
                const parsedUser = JSON.parse(storedUser);
                setUser(parsedUser);
            } catch (error) {
                console.error('Failed to parse user from localStorage:', error);
            }
        }

        // Load active branch from localStorage
        const storedActiveBranch = localStorage.getItem('activeBranch');
        if (storedActiveBranch) {
            try {
                const parsedBranch = JSON.parse(storedActiveBranch);
                setActiveBranch(parsedBranch);
            } catch (error) {
                console.error('Failed to parse active branch from localStorage:', error);
            }
        }
    }, []);

    // â”€â”€â”€ Set branch filter based on user role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    useEffect(() => {
        if (user && activeBranch) {
            if (isAdmin) {
                // Admin can see all branches, default to 'all'
                setBranchId('all');
            } else if (isBranchManager) {
                // Branch Manager - only their assigned branch
                if (user.branchId) {
                    setBranchId(user.branchId);
                } else if (activeBranch.id) {
                    setBranchId(activeBranch.id);
                }
            } else if (isAreaManager) {
                // Area Manager - can see branches in their area
                // Default to their primary branch or active branch
                if (user.branchId) {
                    setBranchId(user.branchId);
                } else if (activeBranch.id) {
                    setBranchId(activeBranch.id);
                }
            }
        }
    }, [user, activeBranch, isAdmin, isBranchManager, isAreaManager]);

    // â”€â”€â”€ Fetch Branches (filtered by role) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    useEffect(() => {
        const fetchBranches = async () => {
            try {
                setBranchesLoading(true);
                const res = await fetch('/api/branches');
                if (!res.ok) throw new Error('Failed to fetch branches');
                const json = await res.json();
                let branchList = (json.data || json || []).map((b: any) => ({
                    id: b.id,
                    name: b.name,
                    code: b.code,
                }));

                // Filter branches based on user role
                if (user) {
                    if (isBranchManager && user.branchId) {
                        // Branch Manager - only their branch
                        branchList = branchList.filter((b: BranchOption) => b.id === user.branchId);
                    } else if (isAreaManager && user.branchId) {
                        // Area Manager - branches in their area (you may need to adjust filtering logic)
                        // For now, showing all branches but will be restricted in API
                        // You can add areaId filtering here if available
                        branchList = branchList;
                    }
                }

                setBranches(branchList);
            } catch (err) {
                console.error('Error fetching branches:', err);
                toast({
                    title: 'Error',
                    description: 'Failed to load branch list',
                    variant: 'destructive',
                });
            } finally {
                setBranchesLoading(false);
            }
        };
        
        if (user) {
            fetchBranches();
        } else {
            // If no user yet, still fetch but don't filter
            const fetchBranchesWithoutUser = async () => {
                try {
                    setBranchesLoading(true);
                    const res = await fetch('/api/branches');
                    if (!res.ok) throw new Error('Failed to fetch branches');
                    const json = await res.json();
                    const branchList = (json.data || json || []).map((b: any) => ({
                        id: b.id,
                        name: b.name,
                        code: b.code,
                    }));
                    setBranches(branchList);
                } catch (err) {
                    console.error('Error fetching branches:', err);
                } finally {
                    setBranchesLoading(false);
                }
            };
            fetchBranchesWithoutUser();
        }
    }, [user, isBranchManager, isAreaManager, toast]);

    // â”€â”€â”€ Fetch Centerwise Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const fetchData = useCallback(async () => {
        if (!reportDate) {
            toast({
                title: 'Validation Error',
                description: 'Please select a report date',
                variant: 'destructive',
            });
            return;
        }

        // For non-admin users, ensure branch is selected
        if (!isAdmin && !branchId) {
            toast({
                title: 'Validation Error',
                description: 'Branch information is missing',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        setCurrentPage(1);

        try {
            const params = new URLSearchParams({ reportDate });
            
            // For non-admin users, always send branchId (their assigned branch)
            // For admin, send only if not 'all'
            if (!isAdmin && branchId) {
                params.set('branchId', branchId);
            } else if (isAdmin && branchId && branchId !== 'all') {
                params.set('branchId', branchId);
            }

            const res = await fetch(`/api/reports/os-centerwise?${params.toString()}`);
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Request failed with status ${res.status}`);
            }

            const json = await res.json();

            setSubmittedReportDate(reportDate);
            setData(json.data || []);
            setTotals(json.totals || {
                totalCenters: 0,
                totalClients: 0,
                totalOSPrincipal: 0,
                totalOSInterest: 0,
                totalArrClients: 0,
                totalArrearPri: 0,
                totalArrearInt: 0,
            });
            setHasFetched(true);

            toast({
                title: 'Report Loaded',
                description: `${json.totalCount || 0} centers found as of ${toDisplayDate(new Date(reportDate))}`,
            });
        } catch (err: any) {
            console.error('Error fetching OS centerwise data:', err);
            toast({
                title: 'Error',
                description: err.message || 'Failed to fetch report data',
                variant: 'destructive',
            });
            setData([]);
            setTotals({
                totalCenters: 0,
                totalClients: 0,
                totalOSPrincipal: 0,
                totalOSInterest: 0,
                totalArrClients: 0,
                totalArrearPri: 0,
                totalArrearInt: 0,
            });
        } finally {
            setIsLoading(false);
        }
    }, [reportDate, branchId, isAdmin, toast]);

    // â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const handleReset = () => {
        if (isAdmin) {
            setBranchId('all');
        } else if (user?.branchId) {
            setBranchId(user.branchId);
        } else if (activeBranch?.id) {
            setBranchId(activeBranch.id);
        }
        setReportDate(getTodayStr());
        setSubmittedReportDate(getTodayStr());
        setData([]);
        setTotals({
            totalCenters: 0,
            totalClients: 0,
            totalOSPrincipal: 0,
            totalOSInterest: 0,
            totalArrClients: 0,
            totalArrearPri: 0,
            totalArrearInt: 0,
        });
        setCurrentPage(1);
        setHasFetched(false);
    };

    const handleExport = () => {
        if (data.length === 0) {
            toast({
                title: 'No Data',
                description: 'Please generate the report first before exporting',
                variant: 'destructive',
            });
            return;
        }

        // Generate CSV
        const headers = [
            'Branch Name',
            'Center Name',
            'No. of Clients',
            'OS Principal',
            'OS Interest',
            'Arrear Clients',
            'Arrear Principal',
            'Arrear Interest',
        ];
        const rows = data.map((e) => [
            e.branchName,
            e.centerName,
            e.noOfClients,
            truncateReportAmount(e.osPrincipal),
            truncateReportAmount(e.osInterest),
            e.arrClients,
            truncateReportAmount(e.arrearPri),
            truncateReportAmount(e.arrearInt),
        ]);
        // Add totals row
        rows.push([
            'TOTAL',
            '',
            totals.totalClients,
            truncateReportAmount(totals.totalOSPrincipal),
            truncateReportAmount(totals.totalOSInterest),
            totals.totalArrClients,
            truncateReportAmount(totals.totalArrearPri),
            truncateReportAmount(totals.totalArrearInt),
        ] as any);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `os-centerwise-report-${submittedReportDate}.csv`;
        link.click();
        URL.revokeObjectURL(url);

        toast({
            title: 'Export Successful',
            description: 'CSV file downloaded successfully',
        });
    };

    // Mirrors the same field mapping used by handleExport (CSV) above (kept separate so
    // handleExport is left untouched).
    const buildOSCenterwiseExportRows = (): { headers: string[]; rows: (string | number)[][] } => {
        const headers = [
            'Branch Name', 'Center Name', 'No. of Clients', 'OS Principal', 'OS Interest',
            'Arrear Clients', 'Arrear Principal', 'Arrear Interest',
        ];
        const rows: (string | number)[][] = data.map((e) => [
            e.branchName, e.centerName, e.noOfClients, truncateReportAmount(e.osPrincipal), truncateReportAmount(e.osInterest),
            e.arrClients, truncateReportAmount(e.arrearPri), truncateReportAmount(e.arrearInt),
        ]);
        rows.push([
            'TOTAL', '', totals.totalClients, truncateReportAmount(totals.totalOSPrincipal), truncateReportAmount(totals.totalOSInterest),
            totals.totalArrClients, truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt),
        ]);
        return { headers, rows };
    };

    const handleExportExcel = () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildOSCenterwiseExportRows();
        const rowObjects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
        const ws = buildReportSheet('Outstanding Centerwise Report', rowObjects);
        autoSizeColumns(ws);
        applyExcelReportFont(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'OS Centerwise');
        XLSX.writeFile(wb, `os-centerwise-report-${submittedReportDate}.xlsx`);
        toast({ title: 'Export Successful', description: 'Excel file downloaded successfully' });
    };

    const handleExportPDF = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const doc = new jsPDF({ orientation: 'landscape' });
        const reportFont = await ensureReportFont(doc);
        await drawOsCenterwiseReport(doc, data, totals, {
            subtitle: `As of ${toDisplayDate(new Date(submittedReportDate))}`,
        }, reportFont);
        doc.save(`os-centerwise-report-${submittedReportDate}.pdf`);
        toast({ title: 'Export Successful', description: 'PDF file downloaded successfully' });
    };

    // Word-only presentation: same rows as Excel/PDF above, but the trailing TOTAL row is
    // split off for distinct styling, and OS/Arrear Principal-Interest pairs get a 2-row
    // grouped header — genuine related fields.
    const buildOSCenterwiseWordOptions = (
        rows: (string | number)[][]
    ): { bodyRows: (string | number)[][]; options: WordExportOptions } => ({
        bodyRows: rows.slice(0, -1),
        options: {
            groupHeaders: [
                { label: 'Branch Name', span: 1 },
                { label: 'Center Name', span: 1 },
                { label: 'No. of Clients', span: 1 },
                { label: 'OS', span: 2 },
                { label: 'ARREAR', span: 3 },
            ],
            subHeaders: ['Principal', 'Interest', 'Clients', 'Principal', 'Interest'],
            columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 14, 8, 8, 8, 8, 8, 8],
            totalsRow: rows[rows.length - 1],
        },
    });

    const handleExportWord = async () => {
        if (data.length === 0) {
            toast({ title: 'No Data', description: 'Please generate the report first before exporting', variant: 'destructive' });
            return;
        }
        const { headers, rows } = buildOSCenterwiseExportRows();
        const { bodyRows, options } = buildOSCenterwiseWordOptions(rows);
        await exportToWord(`os-centerwise-report-${submittedReportDate}`, 'OUTSTANDING CENTERWISE REPORT', headers, bodyRows, options);
        toast({ title: 'Export Successful', description: 'Word file downloaded successfully' });
    };

    // Get display branch name for non-admin users
    const getDisplayBranchName = () => {
        if (isAdmin) return null;
        if (activeBranch) return activeBranch.name;
        if (user?.branchId) {
            const branch = branches.find(b => b.id === user.branchId);
            return branch?.name || 'Assigned Branch';
        }
        return 'Loading...';
    };

    // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    return (
        <ProtectedRoute requiredPermission="OS_CENTERWISE">
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="container mx-auto px-3 sm:px-6 py-4 sm:py-8">
                    {/* Background Glow Effects */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Header Section */}
                    <div className="mb-8">
                        <div className="flex items-center gap-4 mb-4">
                            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <Building2 className="h-7 w-7 text-white" />
                                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                            </div>
                            <div className="flex-1">
                                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                    Loan OS Center
                                </h1>
                                <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                                    Center-wise outstanding principal, interest, and arrears report
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <Card className="border-2 border-primary/30/50 dark:border-sidebar-accent/50 bg-gradient-to-br from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-sidebar-accent dark:text-green-300">
                                            Total Centers
                                        </p>
                                        <p className="text-3xl font-bold text-foreground dark:text-green-100 mt-2">
                                            {totals.totalCenters}
                                        </p>
                                        <p className="text-xs text-primary dark:text-primary mt-1">
                                            {totals.totalClients} total clients
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green-tint dark:bg-brand-green-darker/50">
                                        <MapPin className="h-6 w-6 text-primary dark:text-primary" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-green-200/50 dark:border-green-800/50 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-green-700 dark:text-green-300">
                                            Total OS
                                        </p>
                                        <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-2">
                                            ₹ {formatCurrency(totals.totalOSPrincipal + totals.totalOSInterest)}
                                        </p>
                                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                            Outstanding
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 dark:bg-green-900/50">
                                        <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-purple-200/50 dark:border-purple-800/50 bg-gradient-to-br from-purple-50 to-pink-50/50 dark:from-purple-950/20 dark:to-pink-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
                                            OS Principal
                                        </p>
                                        <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-2">
                                            ₹ {formatCurrency(totals.totalOSPrincipal)}
                                        </p>
                                        <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                            Principal
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/50">
                                        <TrendingUp className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-2 border-red-200/50 dark:border-red-800/50 bg-gradient-to-br from-red-50 to-rose-50/50 dark:from-red-950/20 dark:to-rose-950/20">
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-red-700 dark:text-red-300">
                                            Total Arrear
                                        </p>
                                        <p className="text-2xl font-bold text-red-900 dark:text-red-100 mt-2">
                                            ₹ {formatCurrency(totals.totalArrearPri + totals.totalArrearInt)}
                                        </p>
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                            {totals.totalArrClients} clients overdue
                                        </p>
                                    </div>
                                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-900/50">
                                        <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Filters Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden mb-6">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Filter className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Report Filters</CardTitle>
                                    <CardDescription>
                                        Select branch and report date to view OS centerwise report
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                {/* Branch Filter - Only show for ADMIN */}
                                {isAdmin ? (
                                    <div className="space-y-2">
                                        <Label htmlFor="branch" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch
                                        </Label>
                                        <Select value={branchId} onValueChange={setBranchId} disabled={branchesLoading}>
                                            <SelectTrigger id="branch" className="h-11 border-primary/30 dark:border-sidebar-accent">
                                                <SelectValue placeholder={branchesLoading ? 'Loading...' : 'Select branch'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="all">-- ALL BRANCHES --</SelectItem>
                                                {branches.map((b) => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        {b.code} - {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : (
                                    // For non-admin users, show read-only branch
                                    <div className="space-y-2">
                                        <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                            Branch
                                        </Label>
                                        <div className="h-11 px-3 py-2 rounded-md border border-primary/30 dark:border-sidebar-accent bg-green-50 dark:bg-sidebar-accent text-sidebar-accent dark:text-slate-300 flex items-center">
                                            <Building2 className="h-4 w-4 mr-2 text-primary" />
                                            {getDisplayBranchName()}
                                        </div>
                                    </div>
                                )}

                                {/* Report Date */}
                                <div className="space-y-2">
                                    <Label htmlFor="reportDate" className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                        Report Date <span className="text-red-500">*</span>
                                    </Label>
                                    <div className="relative">
                                        <DateInput
                                            id="reportDate"
                                            value={reportDate}
                                            onChange={(e) => setReportDate(e.target.value)}
                                            className="h-11 border-primary/30 dark:border-sidebar-accent pl-10"
                                        />
                                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="space-y-2 lg:col-span-2">
                                    <Label className="text-sm font-semibold text-sidebar-accent dark:text-slate-200 opacity-0">
                                        Actions
                                    </Label>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={fetchData}
                                            disabled={isLoading || (!isAdmin && !branchId)}
                                            className="h-11 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30"
                                        >
                                            {isLoading ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                    Loading...
                                                </>
                                            ) : (
                                                <>
                                                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                                                    Show
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            onClick={handleReset}
                                            variant="outline"
                                            className="h-11 border-primary/30 dark:border-sidebar-accent"
                                            disabled={isLoading}
                                        >
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            Reset
                                        </Button>
                                        <ExportDropdown
                                            onExportPDF={!isLoading && data.length > 0 ? handleExportPDF : undefined}
                                            onExportExcel={!isLoading && data.length > 0 ? handleExportExcel : undefined}
                                            onExportCSV={!isLoading && data.length > 0 ? handleExport : undefined}
                                            onExportWord={!isLoading && data.length > 0 ? handleExportWord : undefined}
                                            reportSlug={!isLoading && data.length > 0 && getReportExportMode('os-centerwise') === 'REQUEST_QUEUE' ? 'os-centerwise' : undefined}
                                            canExport={canExportReport('os-centerwise')}
                                            exportParams={{
                                                fromDate: submittedReportDate,
                                                branchIds: branchId !== 'all' ? [branchId] : 'ALL',
                                            }}
                                            className="h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* OS Centerwise Table Card */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Building2 className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl">Outstanding Centerwise Report</CardTitle>
                                        <CardDescription>
                                            Center-wise outstanding and arrear details
                                        </CardDescription>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-sm px-3 py-1">
                                    {data.length} Centers
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {/* Loading State */}
                            {isLoading && (
                                <PageLoader label="Generating report, please wait..." fullScreen={false} />
                            )}

                            {/* Empty State - before first fetch */}
                            {!isLoading && !hasFetched && (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green-tint/80 dark:bg-brand-green-darker/30">
                                        <FileSpreadsheet className="h-8 w-8 text-primary" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                                            Select filters and click &quot;Show&quot;
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            Choose a report date and optionally a branch to generate the report
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Empty State - no results */}
                            {!isLoading && hasFetched && data.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100/80 dark:bg-amber-900/30">
                                        <SearchX className="h-8 w-8 text-amber-500" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-lg font-semibold text-sidebar-accent dark:text-slate-300">
                                            No data found
                                        </p>
                                        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                                            No active centers with outstanding loans for the selected date
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Table - data loaded */}
                            {!isLoading && hasFetched && data.length > 0 && (
                                <>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-primary hover:from-primary hover:to-primary">
                                                    <TableHead className="font-bold text-white">Branch Name</TableHead>
                                                    <TableHead className="font-bold text-white">Center Name</TableHead>
                                                    <TableHead className="text-center font-bold text-white">Clients</TableHead>
                                                    <TableHead className="text-right font-bold text-white">OS Principal</TableHead>
                                                    <TableHead className="text-right font-bold text-white">OS Interest</TableHead>
                                                    <TableHead className="text-center font-bold text-white">Arr Clients</TableHead>
                                                    <TableHead className="text-right font-bold text-white">Arrear Pri</TableHead>
                                                    <TableHead className="text-right font-bold text-white">Arrear Int</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {currentData.map((entry, index) => (
                                                    <TableRow
                                                        key={`${entry.centerCode}-${index}`}
                                                        className={cn(
                                                            'hover:bg-green-50/50 dark:hover:bg-green-950/20 transition-colors',
                                                            index % 2 === 0 ? 'bg-white dark:bg-brand-green-darker' : 'bg-green-50/50 dark:bg-brand-green-darker/50',
                                                            (entry.arrearPri > 0 || entry.arrearInt > 0) && 'border-l-4 border-red-500'
                                                        )}
                                                    >
                                                        <TableCell className="font-semibold text-sidebar-accent dark:text-primary">
                                                            {entry.branchName}
                                                        </TableCell>
                                                        <TableCell className="font-medium text-foreground dark:text-slate-100">
                                                            {entry.centerName}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <Badge variant="secondary" className="text-xs min-w-[2rem] justify-center">
                                                                {entry.noOfClients}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-green-700 dark:text-green-400">
                                                            {formatCurrency(entry.osPrincipal)}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-purple-700 dark:text-purple-400">
                                                            {formatCurrency(entry.osInterest)}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            {entry.arrClients > 0 ? (
                                                                <Badge variant="destructive" className="text-xs min-w-[2rem] justify-center">
                                                                    {entry.arrClients}
                                                                </Badge>
                                                            ) : (
                                                                <span className="text-slate-400">0</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {entry.arrearPri > 0 ? (
                                                                <span className="font-bold text-red-700 dark:text-red-400">
                                                                    {formatCurrency(entry.arrearPri)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">0</span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            {entry.arrearInt > 0 ? (
                                                                <span className="font-bold text-red-700 dark:text-red-400">
                                                                    {formatCurrency(entry.arrearInt)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-slate-400">0</span>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}

                                                {/* Total Row */}
                                                <TableRow className="bg-gradient-to-r from-brand-green-tint to-primary dark:from-brand-green-darker/50 dark:to-brand-green-darker/50 font-bold border-t-2 border-primary/50 dark:border-sidebar-accent">
                                                    <TableCell className="text-lg text-foreground dark:text-green-100" colSpan={2}>
                                                        TOTAL
                                                    </TableCell>
                                                    <TableCell className="text-center text-sidebar-accent dark:text-green-300">
                                                        {totals.totalClients}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalOSPrincipal)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalOSInterest)}
                                                    </TableCell>
                                                    <TableCell className="text-center text-sidebar-accent dark:text-green-300">
                                                        {totals.totalArrClients}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalArrearPri)}
                                                    </TableCell>
                                                    <TableCell className="text-right text-sidebar-accent dark:text-green-300">
                                                        {formatCurrency(totals.totalArrearInt)}
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Pagination */}
                                    {totalPages > 1 && (
                                        <div className="flex items-center justify-between border-t border-primary/20 dark:border-sidebar-accent px-6 py-4">
                                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                                Showing {startIndex + 1} to {Math.min(endIndex, data.length)} of {data.length} centers
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                                    disabled={currentPage === 1}
                                                >
                                                    <ChevronLeft className="h-4 w-4" />
                                                    Previous
                                                </Button>
                                                <div className="flex items-center gap-1">
                                                    {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
                                                        let page: number;
                                                        if (totalPages <= 10) {
                                                            page = i + 1;
                                                        } else if (currentPage <= 5) {
                                                            page = i + 1;
                                                        } else if (currentPage >= totalPages - 4) {
                                                            page = totalPages - 9 + i;
                                                        } else {
                                                            page = currentPage - 4 + i;
                                                        }
                                                        return (
                                                            <Button
                                                                key={page}
                                                                variant={currentPage === page ? 'default' : 'outline'}
                                                                size="sm"
                                                                onClick={() => setCurrentPage(page)}
                                                                className={cn(
                                                                    'w-8 h-8 p-0',
                                                                    currentPage === page && 'bg-primary hover:bg-primary'
                                                                )}
                                                            >
                                                                {page}
                                                            </Button>
                                                        );
                                                    })}
                                                </div>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                                    disabled={currentPage === totalPages}
                                                >
                                                    Next
                                                    <ChevronRight className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>

                    {/* Footer Info */}
                    <div className="mt-6 flex items-center justify-between text-sm text-sidebar-accent dark:text-slate-400">
                        <p>
                            Report generated on {toDisplayDateTime(new Date())}
                        </p>
                        <p>
                            Report Date: <span className="font-semibold text-sidebar-accent dark:text-primary">
                                {submittedReportDate ? toDisplayDate(new Date(submittedReportDate)) : 'Not selected'}
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
