'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Calendar,
    CalendarClock,
    CalendarCheck2,
    RefreshCw,
    AlertCircle,
    Building2,
    Search,
    MapPin,
    Users,
    UserX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ExportDropdown } from '@/components/reports/ExportDropdown';
import * as XLSX from 'xlsx';
import { toDisplayDate } from '@/app/lib/date-format';

type BranchWorkingDate = {
    id: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    regionName: string;
    divisionName: string;
    areaName: string;
    eodStartDate: string | null;
    currentDate: string;
    currentWorkingDate: string;
    lastEodClosedAt: string | null;
    diffFromCurrentDate: number;
    noOfCenters: number;
    noOfActiveClients: number;
    noOfInactiveClients: number;
};

const ALL_FILTER = '__all__';

/**
 * Read-only viewer for each branch's current working (EOD) date. Business-hours
 * write-window enforcement was removed app-wide (see assertBranchNotLocked in
 * app/lib/branch-lock.ts) — employees may submit transactions any time of day — so
 * this page no longer offers an "extend lock" action, only the working date itself.
 */
export function BranchWorkingDateClient() {
    const [branches, setBranches] = useState<BranchWorkingDate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [regionFilter, setRegionFilter] = useState(ALL_FILTER);
    const [divisionFilter, setDivisionFilter] = useState(ALL_FILTER);
    const [areaFilter, setAreaFilter] = useState(ALL_FILTER);
    const [branchFilter, setBranchFilter] = useState(ALL_FILTER);

    useEffect(() => {
        fetchBranchWorkingDates();
    }, []);

    const fetchBranchWorkingDates = async () => {
        try {
            setIsLoading(true);
            const response = await fetch('/api/branches/lock');
            const result = await response.json();
            if (result.success) {
                setBranches(result.data);
            } else {
                setBranches([]);
            }
        } catch (error) {
            console.error('Error fetching branch working dates:', error);
            setBranches([]);
        } finally {
            setIsLoading(false);
        }
    };

    const formatDate = (dateString: string): string => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const weekday = date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
        return `${weekday}, ${toDisplayDate(date)}`;
    };

    // diffFromCurrentDate is (today − working date); negative means the branch's
    // working date is already ahead of today, so show it as "N day(s) (advance)".
    const formatDiff = (diff: number): string => {
        const n = Math.abs(diff);
        const unit = n === 1 ? 'day' : 'days';
        return diff < 0 ? `${n} ${unit} (advance)` : `${n} ${unit}`;
    };

    // Cascading filter option lists — each level is narrowed by the levels above it.
    const branchesInRegion = useMemo(
        () => (regionFilter === ALL_FILTER ? branches : branches.filter((b) => b.regionName === regionFilter)),
        [branches, regionFilter]
    );
    const branchesInDivision = useMemo(
        () =>
            divisionFilter === ALL_FILTER
                ? branchesInRegion
                : branchesInRegion.filter((b) => b.divisionName === divisionFilter),
        [branchesInRegion, divisionFilter]
    );
    const branchesInArea = useMemo(
        () => (areaFilter === ALL_FILTER ? branchesInDivision : branchesInDivision.filter((b) => b.areaName === areaFilter)),
        [branchesInDivision, areaFilter]
    );

    const regionOptions = useMemo(
        () => Array.from(new Set(branches.map((b) => b.regionName))).sort(),
        [branches]
    );
    const divisionOptions = useMemo(
        () => Array.from(new Set(branchesInRegion.map((b) => b.divisionName))).sort(),
        [branchesInRegion]
    );
    const areaOptions = useMemo(
        () => Array.from(new Set(branchesInDivision.map((b) => b.areaName))).sort(),
        [branchesInDivision]
    );
    const branchOptions = useMemo(
        () => branchesInArea.map((b) => ({ code: b.branchCode, name: b.branchName })).sort((a, b) => a.code.localeCompare(b.code)),
        [branchesInArea]
    );

    const handleRegionChange = (value: string) => {
        setRegionFilter(value);
        setDivisionFilter(ALL_FILTER);
        setAreaFilter(ALL_FILTER);
        setBranchFilter(ALL_FILTER);
    };
    const handleDivisionChange = (value: string) => {
        setDivisionFilter(value);
        setAreaFilter(ALL_FILTER);
        setBranchFilter(ALL_FILTER);
    };
    const handleAreaChange = (value: string) => {
        setAreaFilter(value);
        setBranchFilter(ALL_FILTER);
    };

    const filteredBranches = useMemo(() => {
        let result = branchesInArea;
        if (branchFilter !== ALL_FILTER) {
            result = result.filter((b) => b.branchCode === branchFilter);
        }
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter(
                (b) =>
                    b.branchCode.toLowerCase().includes(term) ||
                    b.branchName.toLowerCase().includes(term)
            );
        }
        return result;
    }, [branchesInArea, branchFilter, searchTerm]);

    const exportRows = () =>
        filteredBranches.map((b, idx) => ({
            'S.No': idx + 1,
            'Region': b.regionName,
            'Division': b.divisionName,
            'Area': b.areaName,
            'Branch Code': b.branchCode,
            'Branch Name': b.branchName,
            'No. of Centers': b.noOfCenters,
            'Active Clients': b.noOfActiveClients,
            'Inactive Clients': b.noOfInactiveClients,
            'Branch Started Working Date': b.eodStartDate ? formatDate(b.eodStartDate) : 'Not set',
            'Current Date': formatDate(b.currentDate),
            'Current EOD Date': formatDate(b.currentWorkingDate),
            'Last EOD Done Date': b.lastEodClosedAt ? formatDate(b.lastEodClosedAt) : 'Not done yet',
            'Difference from Current Date': formatDiff(b.diffFromCurrentDate),
        }));

    const exportToExcel = () => {
        const worksheet = XLSX.utils.json_to_sheet(exportRows());
        worksheet['!cols'] = [
            { wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 15 }, { wch: 25 },
            { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 14 },
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Branch Working Dates');
        XLSX.writeFile(workbook, `branch-working-dates-${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const exportToCSV = () => {
        const rows = exportRows();
        const headers = [
            'S.No', 'Region', 'Division', 'Area', 'Branch Code', 'Branch Name',
            'No. of Centers', 'Active Clients', 'Inactive Clients', 'Branch Started Working Date',
            'Current Date', 'Current EOD Date',
            'Last EOD Done Date', 'Difference from Current Date',
        ];
        const csv = [headers, ...rows.map((r) => headers.map((h) => r[h as keyof typeof r]))]
            .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `branch-working-dates-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Summary Card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border border-primary/20/60 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Total Branches
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-white">
                                    {isLoading ? '—' : branches.length}
                                </p>
                            </div>
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-primary flex items-center justify-center shadow-lg shadow-primary/20">
                                <Building2 className="h-6 w-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-primary/20/60 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Total Centers
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-white">
                                    {isLoading ? '—' : branches.reduce((s, b) => s + b.noOfCenters, 0)}
                                </p>
                            </div>
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-lg shadow-primary/20">
                                <MapPin className="h-6 w-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-primary/20/60 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Active Clients
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-white">
                                    {isLoading ? '—' : branches.reduce((s, b) => s + b.noOfActiveClients, 0)}
                                </p>
                            </div>
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                                <Users className="h-6 w-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border border-primary/20/60 dark:border-sidebar-accent/60 bg-white/70 dark:bg-brand-green-darker/70 backdrop-blur-sm shadow-lg">
                    <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                    Inactive Clients
                                </p>
                                <p className="text-3xl font-bold text-foreground dark:text-white">
                                    {isLoading ? '—' : branches.reduce((s, b) => s + b.noOfInactiveClients, 0)}
                                </p>
                            </div>
                            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-lg shadow-slate-500/20">
                                <UserX className="h-6 w-6 text-white" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Table Card */}
            <Card className="overflow-hidden border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl bg-white dark:bg-brand-green-darker">
                {/* Top Gradient Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-purple-600 to-primary" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-purple-50/60 px-6 py-5 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker border-b border-primary/20/80 dark:border-sidebar-accent/60">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/30">
                                <CalendarClock className="h-5 w-5 text-white" />
                                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <h2 className="text-lg font-bold tracking-tight text-foreground dark:text-white">
                                    Branch Working Date
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Current working (EOD) date for every branch
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            {/* Search */}
                            <div className="relative flex-1 sm:flex-none">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input
                                    placeholder="Search branches..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-9 h-10 w-full sm:w-56 bg-white/80 dark:bg-sidebar-accent/80 border-primary/30 dark:border-sidebar-accent text-sm"
                                />
                            </div>
                            {/* Export (Excel / CSV) */}
                            <ExportDropdown
                                onExportExcel={exportToExcel}
                                onExportCSV={exportToCSV}
                                className="h-10 px-3 border-primary/30 dark:border-sidebar-accent"
                            />
                            {/* Refresh Button */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={fetchBranchWorkingDates}
                                disabled={isLoading}
                                className="h-10 px-3 border-primary/30 dark:border-sidebar-accent"
                            >
                                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
                            </Button>
                        </div>
                    </div>

                    {/* Filters: Region -> Division -> Area -> Branch (cascading) */}
                    <div className="flex flex-wrap items-center gap-3 mt-4">
                        <Select value={regionFilter} onValueChange={handleRegionChange}>
                            <SelectTrigger className="h-10 w-full sm:w-44 bg-white/80 dark:bg-sidebar-accent/80 border-primary/30 dark:border-sidebar-accent text-sm">
                                <SelectValue placeholder="Region" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_FILTER}>All Regions</SelectItem>
                                {regionOptions.map((r) => (
                                    <SelectItem key={r} value={r}>{r}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={divisionFilter} onValueChange={handleDivisionChange}>
                            <SelectTrigger className="h-10 w-full sm:w-44 bg-white/80 dark:bg-sidebar-accent/80 border-primary/30 dark:border-sidebar-accent text-sm">
                                <SelectValue placeholder="Division" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_FILTER}>All Divisions</SelectItem>
                                {divisionOptions.map((d) => (
                                    <SelectItem key={d} value={d}>{d}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={areaFilter} onValueChange={handleAreaChange}>
                            <SelectTrigger className="h-10 w-full sm:w-44 bg-white/80 dark:bg-sidebar-accent/80 border-primary/30 dark:border-sidebar-accent text-sm">
                                <SelectValue placeholder="Area" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_FILTER}>All Areas</SelectItem>
                                {areaOptions.map((a) => (
                                    <SelectItem key={a} value={a}>{a}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={branchFilter} onValueChange={setBranchFilter}>
                            <SelectTrigger className="h-10 w-full sm:w-52 bg-white/80 dark:bg-sidebar-accent/80 border-primary/30 dark:border-sidebar-accent text-sm">
                                <SelectValue placeholder="Branch" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_FILTER}>All Branches</SelectItem>
                                {branchOptions.map((b) => (
                                    <SelectItem key={b.code} value={b.code}>{b.code} — {b.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-green-50/80 dark:bg-sidebar-accent/50 border-b border-primary/20 dark:border-sidebar-accent hover:bg-green-50/80">
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        S.No
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Region
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Division
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Area
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Branch Code
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Branch Name
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">
                                        No. of Centers
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">
                                        Active Clients
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">
                                        Inactive Clients
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Branch Started Working Date
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Current Date
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Current EOD Date
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Last EOD Done Date
                                    </TableHead>
                                    <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">
                                        Difference from Current Date
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    Array.from({ length: 5 }).map((_, idx) => (
                                        <TableRow key={idx} className="border-b border-slate-100 dark:border-sidebar-accent/50">
                                            {Array.from({ length: 13 }).map((__, tdIdx) => (
                                                <TableCell key={tdIdx} className="px-4 py-5">
                                                    <Skeleton className="h-5 w-full rounded-md" />
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))
                                ) : filteredBranches.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={14} className="h-48 text-center">
                                            <div className="flex flex-col items-center justify-center space-y-3 opacity-50">
                                                <AlertCircle className="h-10 w-10 text-slate-300" />
                                                <p className="text-sm font-medium text-slate-400">
                                                    {searchTerm ? 'No branches match your search' : 'No branch records found'}
                                                </p>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredBranches.map((branch, idx) => (
                                        <TableRow
                                            key={branch.id}
                                            className="group transition-colors border-b border-slate-100 dark:border-sidebar-accent/50 hover:bg-green-50/80 dark:hover:bg-sidebar-accent/30"
                                        >
                                            {/* S.No */}
                                            <TableCell className="px-4 py-4 text-sm font-medium text-slate-500 dark:text-slate-400">
                                                {idx + 1}
                                            </TableCell>

                                            {/* Region */}
                                            <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-300">
                                                {branch.regionName}
                                            </TableCell>

                                            {/* Division */}
                                            <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-300">
                                                {branch.divisionName}
                                            </TableCell>

                                            {/* Area */}
                                            <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-300">
                                                {branch.areaName}
                                            </TableCell>

                                            {/* Branch Code */}
                                            <TableCell className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-xs font-bold shadow-sm bg-gradient-to-br from-primary to-purple-500 shrink-0">
                                                        <Building2 className="h-4 w-4" />
                                                    </div>
                                                    <span className="text-sm font-semibold text-foreground dark:text-white">
                                                        {branch.branchCode}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Branch Name */}
                                            <TableCell className="px-4 py-4 text-sm text-sidebar-accent dark:text-slate-300">
                                                {branch.branchName}
                                            </TableCell>

                                            {/* No. of Centers */}
                                            <TableCell className="px-4 py-4 text-right">
                                                <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                    {branch.noOfCenters}
                                                </span>
                                            </TableCell>

                                            {/* Active Clients */}
                                            <TableCell className="px-4 py-4 text-right">
                                                <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                    {branch.noOfActiveClients}
                                                </span>
                                            </TableCell>

                                            {/* Inactive Clients */}
                                            <TableCell className="px-4 py-4 text-right">
                                                <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                                                    {branch.noOfInactiveClients}
                                                </span>
                                            </TableCell>

                                            {/* Branch Started Working Date */}
                                            <TableCell className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                        {branch.eodStartDate ? formatDate(branch.eodStartDate) : (
                                                            <span className="text-slate-400 italic">Not set</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Current Date */}
                                            <TableCell className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                        {formatDate(branch.currentDate)}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Current EOD Date */}
                                            <TableCell className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4 text-primary shrink-0" />
                                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                        {formatDate(branch.currentWorkingDate)}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Last EOD Done Date */}
                                            <TableCell className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    <CalendarCheck2 className="h-4 w-4 text-primary shrink-0" />
                                                    <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">
                                                        {branch.lastEodClosedAt ? formatDate(branch.lastEodClosedAt) : (
                                                            <span className="text-slate-400 italic">Not done yet</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </TableCell>

                                            {/* Difference from Current Date */}
                                            <TableCell className="px-4 py-4 text-right">
                                                <span
                                                    className={cn(
                                                        'text-sm font-semibold',
                                                        branch.diffFromCurrentDate > 0
                                                            ? 'text-red-600 dark:text-red-400'
                                                            : 'text-emerald-600 dark:text-emerald-400'
                                                    )}
                                                >
                                                    {formatDiff(branch.diffFromCurrentDate)}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
