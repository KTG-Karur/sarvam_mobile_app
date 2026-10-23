'use client';

import { useState, useMemo, useEffect } from 'react';
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
    RefreshCw,
    Loader2,
    FileText,
    AlertCircle,
    Clock,
    CheckCircle,
    Building2,
    User,
    Search,
    RotateCw,
    Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

type BranchOption = { id: string; name: string; code: string };

type PendingItemData = {
    centerId: string;
    centerName: string;
    fdo: string;
    meetingDay: string;
    meetingTime: string;
    nextMeetingDate: string;
};

// EOD Issue types
const EOD_ISSUE_TYPES = [
    { id: 'center_approval', name: 'CENTER APPROVAL PENDING ISSUE' },
    { id: 'member_approval', name: 'MEMBER APPROVAL PENDING ISSUE' },
    { id: 'center_meeting', name: 'CENTER MEETING PENDING ISSUE' },
    { id: 'preclosure_approval', name: 'PRECLOSURE APPROVAL PENDING ISSUE' },
    { id: 'loan_disbursement', name: 'LOAN DISBURSMENT APPROVAL PENDING ISSUE' },
    { id: 'session_out', name: 'SESSION OUT PENDING ISSUE' },
];

// Format date as "DD/MM/YYYY"
const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
        return dateString;
    }
    return dateString;
};

// Format time from "HH:MM:SS.0" to "HH:MM AM/PM"
const formatTime = (timeString: string): string => {
    if (!timeString || timeString === 'N/A') return timeString || '';
    if (timeString.includes('AM') || timeString.includes('PM')) {
        return timeString;
    }
    const parts = timeString.split(':');
    if (parts.length >= 2) {
        const hours = parseInt(parts[0], 10);
        const minutes = parts[1];
        const ampm = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${String(displayHours).padStart(2, '0')}:${minutes} ${ampm}`;
    }
    return timeString;
};

export function PendingItemsClient() {
    const { toast } = useToast();
    const { hasRole } = usePermission();
    const canSelectBranch = hasRole('admin') || hasRole('area-manager');
    const [selectedEodIssue, setSelectedEodIssue] = useState<string>('center_meeting');
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [branches, setBranches] = useState<BranchOption[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showReport, setShowReport] = useState(false);
    const [data, setData] = useState<PendingItemData[]>([]);
    const [showNoRecordsDialog, setShowNoRecordsDialog] = useState(false);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(data);

    useEffect(() => {
        if (!canSelectBranch) return;
        fetch('/api/branches')
            .then((r) => r.json())
            .then((d) => setBranches(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {});
    }, [canSelectBranch]);

    // Calculate metrics from fetched data
    const metrics = useMemo(() => {
        if (data.length === 0) {
            return {
                totalPending: 0,
                centersAffected: 0,
                fdosAffected: 0,
                meetingsPending: 0,
            };
        }

        const uniqueFDOs = new Set(data.filter(item => item.fdo && item.fdo !== 'Unassigned' && item.fdo !== 'N/A').map(item => item.fdo));
        const meetingsCount = data.filter(item => item.meetingDay && item.meetingDay !== 'N/A').length;

        return {
            totalPending: data.length,
            centersAffected: data.length,
            fdosAffected: uniqueFDOs.size,
            meetingsPending: meetingsCount,
        };
    }, [data]);

    const handleShow = async () => {
        if (!selectedEodIssue) {
            toast({
                title: 'Selection required',
                description: 'Please select an EOD Issue type before generating the report.',
                variant: 'destructive',
            });
            return;
        }
        if (canSelectBranch && !selectedBranch) {
            toast({
                title: 'Branch required',
                description: 'Please select a branch before generating the report.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const params = new URLSearchParams({ issueType: selectedEodIssue });
            if (canSelectBranch && selectedBranch) params.set('branchId', selectedBranch);
            const response = await fetch(`/api/reports/others/pending-items?${params.toString()}`);
            if (!response.ok) throw new Error('Failed to fetch pending items');

            const result = await response.json();

            if (result.success) {
                const fetchedData = result.data;
                if (fetchedData.length === 0) {
                    setShowNoRecordsDialog(true);
                    setShowReport(false);
                    setData([]);
                } else {
                    setShowReport(true);
                    setData(fetchedData);
                    toast({
                        title: 'Report generated',
                        description: `Found ${fetchedData.length} pending items.`,
                    });
                }
            } else {
                throw new Error(result.error || 'Server error');
            }
        } catch (error: any) {
            console.error("Fetch error:", error);
            toast({
                title: 'Error',
                description: error.message || 'Failed to generate report.',
                variant: 'destructive',
            });
            setData([]);
            setShowReport(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        setSelectedEodIssue('center_meeting');
        setSelectedBranch('');
        setShowReport(false);
        setData([]);
        setShowNoRecordsDialog(false);
        toast({
            title: 'Filters reset',
            description: 'All filters have been reset.',
        });
    };

    // Helper to get dynamic headers based on issue type
    const getHeaders = () => {
        switch (selectedEodIssue) {
            case 'member_approval':
                return { id: 'CLIENT ID', name: 'CLIENT NAME', extra1: 'ENROLLED BY', extra2: 'CENTER', extra3: '---', extra4: 'ENROLL DATE' };
            case 'loan_disbursement':
                return { id: 'LOAN NO', name: 'CLIENT NAME', extra1: 'CENTER', extra2: 'AMOUNT', extra3: 'STATUS', extra4: 'APPLY DATE' };
            case 'session_out':
                return { id: 'USER ID', name: 'USER NAME', extra1: 'ROLE', extra2: 'LOGIN TIME', extra3: 'STATUS', extra4: 'DATE' };
            default:
                return { id: 'CENTERID', name: 'CENTERNAME', extra1: 'FDO', extra2: 'MEETINGDAY', extra3: 'MEETINGTIME', extra4: 'NEXTMEETINGDATE' };
        }
    };

    const headers = getHeaders();

    return (
        <div className="space-y-6">
            {/* Metric Cards */}
            {showReport && data.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <MetricCard
                        title="Total Pending"
                        value={metrics.totalPending.toString()}
                        subtitle={`Items requiring action`}
                        icon={AlertCircle}
                        gradient="rose"
                    />
                    <MetricCard
                        title="Entities Involved"
                        value={metrics.centersAffected.toString()}
                        subtitle={`Total records in view`}
                        icon={Building2}
                        gradient="blue"
                    />
                    <MetricCard
                        title="Staff Assigned"
                        value={metrics.fdosAffected.toString()}
                        subtitle={`Responsible officers`}
                        icon={User}
                        gradient="purple"
                    />
                    <MetricCard
                        title="Dated Items"
                        value={metrics.meetingsPending.toString()}
                        subtitle={`Scheduled occurrences`}
                        icon={Clock}
                        gradient="indigo"
                    />
                </div>
            )}

            {/* Filter Section */}
            <Card className="border-0 shadow-2xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden group">
                <div className="h-1.5 w-full bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand-green-tint dark:bg-brand-green-darker/40 rounded-lg">
                            <Filter className="w-5 h-5 text-primary dark:text-primary" />
                        </div>
                        <CardTitle className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-white dark:to-slate-400">
                            Issue Filter
                        </CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-6">
                    <div className={cn('grid grid-cols-1 gap-6 mb-8', canSelectBranch ? 'md:grid-cols-2' : 'md:grid-cols-1')}>
                        {canSelectBranch && (
                            <div className="space-y-3">
                                <Label htmlFor="pending-branch" className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200">
                                    BRANCH <span className="text-red-500">*</span>
                                </Label>
                                <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                                    <SelectTrigger
                                        id="pending-branch"
                                        className="h-12 text-base border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary"
                                    >
                                        <SelectValue placeholder="-- SELECT BRANCH --" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[300px]">
                                        {branches.map((branch) => (
                                            <SelectItem key={branch.id} value={branch.id} className="py-3 text-sm font-medium">
                                                {branch.code} - {branch.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="space-y-3">
                            <Label htmlFor="eod-issue" className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200">
                                SELECT EOD ISSUE TYPE <span className="text-red-500">*</span>
                            </Label>
                            <Select value={selectedEodIssue} onValueChange={setSelectedEodIssue}>
                                <SelectTrigger
                                    id="eod-issue"
                                    className="h-12 text-base border-primary/20 focus:ring-4 focus:ring-primary/10 transition-all dark:bg-sidebar-accent dark:border-sidebar-accent hover:border-primary"
                                >
                                    <SelectValue placeholder="-- SELECT --" />
                                </SelectTrigger>
                                <SelectContent className="max-h-[300px]">
                                    {EOD_ISSUE_TYPES.map((issue) => (
                                        <SelectItem key={issue.id} value={issue.id} className="py-3 text-sm font-medium">
                                            {issue.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-4 pt-4">
                        <Button
                            onClick={handleShow}
                            disabled={isLoading}
                            className="min-w-[140px] h-12 bg-brand-green-darker hover:bg-black text-white dark:bg-primary dark:hover:bg-primary shadow-xl shadow-primary/10 transition-all active:scale-95"
                        >
                            {isLoading ? (
                                <><Loader2 className="h-5 w-5 mr-3 animate-spin" /> FETCHING...</>
                            ) : (
                                <><Search className="h-5 w-5 mr-3" /> SHOW REPORT</>
                            )}
                        </Button>
                        <Button
                            onClick={handleReset}
                            variant="outline"
                            className="min-w-[140px] h-12 border-primary/20 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-sidebar-accent font-bold tracking-tight"
                        >
                            <RotateCw className="h-5 w-5 mr-3" /> RESET
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Data Table */}
            {showReport && data.length > 0 && (
                <Card className="border-0 shadow-2xl bg-white/90 dark:bg-green-950/60 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <CardHeader className="px-6 py-5 bg-green-50/50 dark:bg-brand-green-darker/50 border-b border-slate-100 dark:border-sidebar-accent">
                        <ReportHeader title="Pending Items Report" />
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <span className="p-1 px-3 bg-primary text-white text-[12px] rounded-full uppercase tracking-tighter">Live</span>
                                {EOD_ISSUE_TYPES.find(i => i.id === selectedEodIssue)?.name}
                            </CardTitle>
                            <div className="flex items-center gap-3">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search pending items..."
                                />
                                <span className="text-xs font-mono text-slate-500 uppercase tracking-widest text-[10px]">Standard Format</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-brand-green-darker border-0">
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] border-r border-sidebar-accent">{headers.id}</TableHead>
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] border-r border-sidebar-accent">{headers.name}</TableHead>
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] border-r border-sidebar-accent">{headers.extra1}</TableHead>
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] border-r border-sidebar-accent">{headers.extra2}</TableHead>
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] border-r border-sidebar-accent">{headers.extra3}</TableHead>
                                        <TableHead className="text-white font-bold h-12 px-6 uppercase tracking-widest text-[11px] font-bold text-center">{headers.extra4}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((row, index) => (
                                        <TableRow
                                            key={index}
                                            className="hover:bg-green-50/50 dark:hover:bg-brand-green-darker/50 border-b border-slate-100 dark:border-sidebar-accent transition-colors"
                                        >
                                            <TableCell className="px-6 py-4 font-bold text-foreground dark:text-primary border-r border-slate-100 dark:border-sidebar-accent">
                                                {row.centerId}
                                            </TableCell>
                                            <TableCell className="px-6 py-4 font-semibold text-sidebar-accent dark:text-slate-100 border-r border-slate-100 dark:border-sidebar-accent">
                                                {row.centerName}
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-sidebar-accent dark:text-slate-400 border-r border-slate-100 dark:border-sidebar-accent antialiased uppercase text-[12px] font-medium">
                                                {row.fdo}
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-sidebar-accent dark:text-slate-400 border-r border-slate-100 dark:border-sidebar-accent font-medium tracking-tight">
                                                {row.meetingDay}
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-sidebar-accent dark:text-slate-400 border-r border-slate-100 dark:border-sidebar-accent font-mono text-[13px]">
                                                {formatTime(row.meetingTime)}
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-sidebar-accent dark:text-slate-400 font-semibold text-primary dark:text-primary tracking-tighter text-center">
                                                {formatDate(row.nextMeetingDate)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Empty State */}
            {!showReport && !isLoading && (
                <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-primary/20 dark:border-sidebar-accent rounded-3xl bg-green-50/20">
                    <div className="p-4 bg-white dark:bg-brand-green-darker rounded-2xl shadow-sm mb-6">
                        <CheckCircle className="w-12 h-12 text-slate-300" />
                    </div>
                    <h3 className="text-xl font-bold text-foreground dark:text-white mb-2">Ready to audit</h3>
                    <p className="text-slate-500 text-center max-w-sm">Select an issue type above to generate a real-time pending items report from the live database.</p>
                </div>
            )}

            {/* No Records Dialog */}
            <Dialog open={showNoRecordsDialog} onOpenChange={setShowNoRecordsDialog}>
                <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden border-0 shadow-2xl">
                    <DialogHeader className="p-0 space-y-0">
                        <div className="bg-emerald-500 p-8 flex justify-center">
                            <CheckCircle className="w-16 h-16 text-white" />
                        </div>
                        <div className="p-8 text-center bg-white dark:bg-brand-green-darker">
                            <DialogTitle className="text-2xl font-bold text-foreground dark:text-white mb-2">
                                No Issues Found
                            </DialogTitle>
                            <DialogDescription className="text-slate-500 mb-8 text-center">
                                Great! No pending items found for the selected category. The system is up to date.
                            </DialogDescription>
                            <Button
                                onClick={() => setShowNoRecordsDialog(false)}
                                className="w-full h-12 bg-brand-green-darker hover:bg-black text-white rounded-xl font-bold"
                            >
                                CLOSE
                            </Button>
                        </div>
                    </DialogHeader>
                </DialogContent>
            </Dialog>
        </div>
    );
}
