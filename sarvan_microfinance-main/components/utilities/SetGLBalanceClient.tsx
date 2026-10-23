'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    ArrowRight,
    Settings,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Clock,
    TrendingUp,
    TrendingDown,
    FileText,
    Loader2,
    Database,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { toDisplayDateTime } from '@/app/lib/date-format';

interface SyncStatus {
    pendingTransactions: number;
    totalSyncedTransactions: number;
    lastSync: {
        batchId: string;
        syncDate: string;
        txnCount: number;
        vouchersCreated: number;
        totalCollections: number;
        totalDisbursements: number;
        status: string;
    } | null;
}

interface SyncResult {
    status: string;
    message: string;
    batchId: string;
    txnCount: number;
    vouchersCreated: number;
    summary: {
        collections: {
            principal: number;
            interest: number;
            fees: number;
            penalties: number;
            total: number;
        };
        disbursements: {
            total: number;
        };
    } | null;
}

export function SetGLBalanceClient() {
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingStatus, setIsFetchingStatus] = useState(true);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    const [lastResult, setLastResult] = useState<SyncResult | null>(null);
    const { toast } = useToast();

    const fetchStatus = useCallback(async () => {
        try {
            setIsFetchingStatus(true);
            const res = await fetch('/api/utilities/set-gl-balance');
            const data = await res.json();
            if (data.success) {
                setSyncStatus(data.data);
            }
        } catch (error) {
            console.error('Failed to fetch GL sync status:', error);
        } finally {
            setIsFetchingStatus(false);
        }
    }, []);

    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    const handleProceed = () => {
        setShowConfirmDialog(true);
    };

    const handleConfirm = async () => {
        setIsLoading(true);
        setShowConfirmDialog(false);
        setLastResult(null);

        try {
            const res = await fetch('/api/utilities/set-gl-balance', {
                method: 'POST',
            });

            const data = await res.json();

            if (data.success) {
                const result: SyncResult = data.data;
                setLastResult(result);

                if (result.status === 'NO_DATA') {
                    toast({
                        title: 'Already Up to Date',
                        description: result.message,
                    });
                } else {
                    toast({
                        title: 'GL Balance Set Successfully',
                        description: `${result.txnCount} transactions synced into ${result.vouchersCreated} vouchers.`,
                    });
                }

                // Refresh status
                await fetchStatus();
            } else {
                toast({
                    title: 'Error',
                    description: data.error || 'Failed to set GL Balance.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to set GL Balance. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            minimumFractionDigits: 2,
        }).format(amount);
    };

    const formatDate = (dateStr: string) => {
        return toDisplayDateTime(new Date(dateStr));
    };

    return (
        <div className="relative w-full max-w-5xl mx-auto space-y-6">
            {/* Header Section */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <Settings className="h-7 w-7 text-white" />
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">
                            Set GL Balance
                        </h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Sync operational loan data (IL) to the General Ledger (GL)
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchStatus}
                        disabled={isFetchingStatus}
                        className="gap-2"
                    >
                        <RefreshCw className={`h-4 w-4 ${isFetchingStatus ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Status KPI Cards */}
            {syncStatus && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Pending Transactions */}
                    <Card className={`border-2 overflow-hidden transition-all ${syncStatus.pendingTransactions > 0
                            ? 'border-amber-300/80 dark:border-amber-600/60 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20'
                            : 'border-emerald-300/80 dark:border-emerald-600/60 bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/20'
                        }`}>
                        <CardContent className="pt-5 pb-4 px-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Pending Sync
                                    </p>
                                    <p className="text-3xl font-bold mt-1 text-foreground dark:text-white">
                                        {syncStatus.pendingTransactions.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {syncStatus.pendingTransactions > 0 ? 'Transactions awaiting GL sync' : 'All transactions synced ✓'}
                                    </p>
                                </div>
                                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${syncStatus.pendingTransactions > 0
                                        ? 'bg-amber-500/15 text-amber-600'
                                        : 'bg-emerald-500/15 text-emerald-600'
                                    }`}>
                                    {syncStatus.pendingTransactions > 0
                                        ? <AlertCircle className="h-6 w-6" />
                                        : <CheckCircle2 className="h-6 w-6" />
                                    }
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Total Synced */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 overflow-hidden">
                        <CardContent className="pt-5 pb-4 px-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Total Synced
                                    </p>
                                    <p className="text-3xl font-bold mt-1 text-foreground dark:text-white">
                                        {syncStatus.totalSyncedTransactions.toLocaleString()}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        Lifetime transactions posted to GL
                                    </p>
                                </div>
                                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-primary/15 text-primary">
                                    <Database className="h-6 w-6" />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Last Sync */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 overflow-hidden">
                        <CardContent className="pt-5 pb-4 px-5">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Last Sync
                                    </p>
                                    <p className="text-lg font-bold mt-1 text-foreground dark:text-white">
                                        {syncStatus.lastSync
                                            ? formatDate(syncStatus.lastSync.syncDate)
                                            : 'Never'
                                        }
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                        {syncStatus.lastSync
                                            ? `${syncStatus.lastSync.txnCount} txns → ${syncStatus.lastSync.vouchersCreated} vouchers`
                                            : 'No previous sync recorded'
                                        }
                                    </p>
                                </div>
                                <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-primary/15 text-primary">
                                    <Clock className="h-6 w-6" />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Main Action Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardHeader className="bg-gradient-to-r from-sidebar-accent to-primary dark:from-sidebar-accent dark:to-primary">
                    <h2 className="text-xl font-bold text-white">Sync GL Balance</h2>
                    <p className="text-green-100/80 text-sm mt-1">
                        Aggregate all pending loan transactions and post consolidated journal entries to the General Ledger
                    </p>
                </CardHeader>
                <CardContent className="pt-8 pb-8">
                    <div className="flex flex-col items-center justify-center min-h-[120px] gap-4">
                        {syncStatus && syncStatus.pendingTransactions === 0 && !lastResult && (
                            <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2 rounded-lg">
                                <CheckCircle2 className="h-5 w-5" />
                                <span className="text-sm font-medium">GL is up to date. No pending transactions.</span>
                            </div>
                        )}

                        <Button
                            onClick={handleProceed}
                            disabled={isLoading || isFetchingStatus}
                            size="lg"
                            className="h-12 px-8 bg-gradient-to-r from-primary to-primary hover:from-sidebar-accent hover:to-primary text-white shadow-lg shadow-primary/30 text-base font-semibold"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    Processing GL Sync...
                                </>
                            ) : (
                                <>
                                    Proceed
                                    <ArrowRight className="ml-2 h-5 w-5" />
                                </>
                            )}
                        </Button>

                        {syncStatus && syncStatus.pendingTransactions > 0 && (
                            <p className="text-sm text-slate-500 dark:text-slate-400">
                                {syncStatus.pendingTransactions.toLocaleString()} transactions will be synced
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Result Card (shown after sync) */}
            {lastResult && lastResult.summary && (
                <Card className="border-2 border-emerald-300/80 dark:border-emerald-600/40 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                    <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500" />
                    <CardHeader className="bg-gradient-to-r from-emerald-700 to-green-700 dark:from-emerald-800 dark:to-green-800">
                        <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-6 w-6 text-white" />
                            <div>
                                <h2 className="text-xl font-bold text-white">Sync Completed Successfully</h2>
                                <p className="text-emerald-100/80 text-sm mt-0.5">
                                    Batch: {lastResult.batchId}
                                </p>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="pt-6 pb-6">
                        {/* Summary KPIs */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div className="text-center p-3 bg-green-50 dark:bg-sidebar-accent/50 rounded-xl">
                                <p className="text-xs text-slate-500 uppercase font-semibold">Transactions</p>
                                <p className="text-2xl font-bold text-foreground dark:text-white">{lastResult.txnCount.toLocaleString()}</p>
                            </div>
                            <div className="text-center p-3 bg-green-50 dark:bg-sidebar-accent/50 rounded-xl">
                                <p className="text-xs text-slate-500 uppercase font-semibold">Vouchers</p>
                                <p className="text-2xl font-bold text-foreground dark:text-white">{lastResult.vouchersCreated}</p>
                            </div>
                            <div className="text-center p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl">
                                <p className="text-xs text-emerald-600 uppercase font-semibold">Collections</p>
                                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(lastResult.summary.collections.total)}</p>
                            </div>
                            <div className="text-center p-3 bg-orange-50 dark:bg-orange-950/30 rounded-xl">
                                <p className="text-xs text-orange-600 uppercase font-semibold">Disbursements</p>
                                <p className="text-2xl font-bold text-orange-700 dark:text-orange-400">{formatCurrency(lastResult.summary.disbursements.total)}</p>
                            </div>
                        </div>

                        {/* Collection Breakdown */}
                        {lastResult.summary.collections.total > 0 && (
                            <div className="border border-primary/20 dark:border-sidebar-accent rounded-xl overflow-hidden">
                                <div className="px-4 py-3 bg-green-50 dark:bg-sidebar-accent/50 border-b border-primary/20 dark:border-sidebar-accent">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className="h-4 w-4 text-emerald-600" />
                                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Collection Breakdown</h3>
                                    </div>
                                </div>
                                <div className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                    {[
                                        { label: 'Principal Recovery', value: lastResult.summary.collections.principal },
                                        { label: 'Interest Income', value: lastResult.summary.collections.interest },
                                        { label: 'Fee Income', value: lastResult.summary.collections.fees },
                                        { label: 'Penalty Income', value: lastResult.summary.collections.penalties },
                                    ].filter(item => item.value > 0).map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center px-4 py-2.5">
                                            <span className="text-sm text-sidebar-accent dark:text-slate-400">{item.label}</span>
                                            <span className="text-sm font-semibold text-foreground dark:text-white">{formatCurrency(item.value)}</span>
                                        </div>
                                    ))}
                                    <div className="flex justify-between items-center px-4 py-3 bg-emerald-50/50 dark:bg-emerald-950/20">
                                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">Total Collections</span>
                                        <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(lastResult.summary.collections.total)}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Disbursement Row */}
                        {lastResult.summary.disbursements.total > 0 && (
                            <div className="mt-4 border border-primary/20 dark:border-sidebar-accent rounded-xl overflow-hidden">
                                <div className="px-4 py-3 bg-green-50 dark:bg-sidebar-accent/50 border-b border-primary/20 dark:border-sidebar-accent">
                                    <div className="flex items-center gap-2">
                                        <TrendingDown className="h-4 w-4 text-orange-600" />
                                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Disbursement Summary</h3>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center px-4 py-3 bg-orange-50/50 dark:bg-orange-950/20">
                                    <span className="text-sm font-bold text-orange-700 dark:text-orange-400">Total Disbursements</span>
                                    <span className="text-sm font-bold text-orange-700 dark:text-orange-400">{formatCurrency(lastResult.summary.disbursements.total)}</span>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* No Data Result */}
            {lastResult && lastResult.status === 'NO_DATA' && (
                <Card className="border-2 border-primary/30/80 dark:border-sidebar-accent/40 shadow-lg overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
                    <CardContent className="py-8">
                        <div className="flex flex-col items-center gap-3 text-primary dark:text-primary">
                            <CheckCircle2 className="h-10 w-10" />
                            <p className="text-lg font-semibold">GL is Already Up to Date</p>
                            <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-md">
                                All loan transactions have already been synced to the General Ledger.
                                No new vouchers were created.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Confirmation Dialog */}
            <ConfirmationDialog
                open={showConfirmDialog}
                onOpenChange={setShowConfirmDialog}
                onConfirm={handleConfirm}
                title="Set GL Balance"
                description={`This will sync ${syncStatus?.pendingTransactions?.toLocaleString() || '0'} pending loan transactions to the General Ledger by creating consolidated journal entries. This action is safe and idempotent — running it multiple times will not create duplicate entries.`}
                confirmText="Proceed with GL Sync"
                cancelText="Cancel"
                type="warning"
                isLoading={isLoading}
            />
        </div>
    );
}
