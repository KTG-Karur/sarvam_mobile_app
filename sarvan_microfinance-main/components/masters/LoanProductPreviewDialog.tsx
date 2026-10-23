'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    CreditCard, Edit, Percent, DollarSign, Calendar, Hash, Package,
    FileText, Shield, Calculator, Table2, ChevronDown, ChevronUp,Coins,ShieldCheck, Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useEffect, useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScheduleTemplateItem {
    installmentNo: number;
    principalAmount: number;
    interestAmount: number;
    totalAmount?: number; // may be computed client-side
}

export interface LoanProductDetails {
    productId: string;
    productName: string;
    loanProductTypeId?: string;
    loanProductType?: {
        id: string;
        typeId: string;
        name: string;
    };
    loanAmount: number;
    interestRate: number;
    insuranceFees: number | null;
    frequency: string;
    interestAmount: number;
    numberOfDues: number;
    documentCharges: number | null;
    advanceSavingsAmount: number | null;
    interestMethod: string;
    status: string;
    perInstallmentPrincipal: number;
    perInstallmentInterest: number;
    totalRepayment: number;
    hasCustomSchedule: boolean;
    scheduleTemplates: ScheduleTemplateItem[];
}

interface LoanProductPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    product: LoanProductDetails | null;
    onUpdateName?: (productId: string, productName: string) => Promise<void> | void;
    isUpdatingName?: boolean;
}

const frequencyLabels: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    forthnight: 'ForthNight',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LoanProductPreviewDialog({
    open,
    onOpenChange,
    product,
    onUpdateName,
    isUpdatingName = false,
}: LoanProductPreviewDialogProps) {
    const [showSchedule, setShowSchedule] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [draftName, setDraftName] = useState('');

    useEffect(() => {
        if (!open || !product) return;
        setDraftName(product.productName);
        setIsRenaming(false);
    }, [open, product?.productId, product?.productName]);

    if (!product) return null;

    // Auto-determine schedule type from data
    const templates = product.scheduleTemplates || [];
    const hasTemplates = templates.length > 0;
    const allSameP = hasTemplates && templates.every((r) => r.principalAmount === templates[0].principalAmount);
    const allSameI = hasTemplates && templates.every((r) => r.interestAmount === templates[0].interestAmount);
    const scheduleType = !hasTemplates ? 'Flat Rate' : (allSameP && allSameI ? 'Flat Rate' : 'Reducing Balance');
    const getTotal = (r: ScheduleTemplateItem) => r.totalAmount ?? (r.principalAmount + r.interestAmount);

    const handleDownloadExcel = () => {
        const rows: (string | number)[][] = [
            ['Installment No', 'Principal', 'Interest', 'Total'],
            ...templates.map((r) => [r.installmentNo, r.principalAmount, r.interestAmount, getTotal(r)]),
            [
                'Total',
                templates.reduce((s, r) => s + r.principalAmount, 0),
                templates.reduce((s, r) => s + r.interestAmount, 0),
                templates.reduce((s, r) => s + getTotal(r), 0),
            ],
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule Template');
        const safeName = (product.productId || 'loan-product').replace(/[^\w-]+/g, '_');
        XLSX.writeFile(wb, `${safeName}_schedule_template.xlsx`);
    };

    const handlePrimaryAction = async () => {
        if (!isRenaming) {
            setIsRenaming(true);
            return;
        }
        const normalizedName = draftName.trim();
        if (!normalizedName || normalizedName === product.productName) {
            setIsRenaming(false);
            setDraftName(product.productName);
            return;
        }
        try {
            await onUpdateName?.(product.productId, normalizedName);
            setIsRenaming(false);
        } catch {
            // Keep rename mode active so user can correct and retry.
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl bg-green-50 dark:bg-brand-green-darker max-h-[90vh] overflow-auto">
                <DialogHeader className="pb-4">
                    <DialogTitle className="flex items-center gap-3 text-xl font-semibold text-foreground dark:text-white">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <CreditCard className="h-5 w-5 text-white" />
                        </div>
                        Loan Product Details
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Main Info Card */}
                    <div className="rounded-2xl border border-primary/20 bg-white p-6 shadow-sm dark:border-sidebar-accent dark:bg-sidebar-accent">
                        <div className="grid gap-6 md:grid-cols-2">
                            {/* Left Column */}
                            <div className="space-y-5">
                                <InfoField icon={Hash} label="Product ID" value={product.productId} />
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        <CreditCard className="h-3.5 w-3.5" />
                                        Product Name
                                    </div>
                                    <Input
                                        value={draftName}
                                        onChange={(e) => setDraftName(e.target.value)}
                                        disabled={!isRenaming || isUpdatingName}
                                        className={`h-11 ${!isRenaming ? 'bg-green-50 dark:bg-brand-green-darker/50' : ''}`}
                                    />
                                </div>
                                <InfoField 
                                    icon={Package} 
                                    label="Product Type" 
                                    value={product.loanProductType?.name || 'Not Assigned'} 
                                />
                                <InfoField icon={DollarSign} label="Loan Amount" value={`₹${product.loanAmount.toLocaleString('en-IN')}`} />
                                <InfoField icon={Percent} label="Interest Rate" value={`${product.interestRate}% p.a.`} />
                                <InfoField
                                    icon={DollarSign}
                                    label="Insurance Fees"
                                    value={product.insuranceFees ? `₹${product.insuranceFees.toLocaleString('en-IN')}` : 'Not Set'}
                                />
                                <InfoField
                                    icon={Calculator}
                                    label="Schedule Type"
                                    value={scheduleType}
                                />
                            </div>

                            {/* Right Column */}
                            <div className="space-y-5">
                                <InfoField icon={Calendar} label="Frequency" value={frequencyLabels[product.frequency] || product.frequency} />
                                <InfoField icon={DollarSign} label="Total Interest" value={`₹${product.interestAmount.toLocaleString('en-IN')}`} />
                                <InfoField icon={FileText} label="No. of Installments" value={product.numberOfDues.toString()} />
                                <InfoField
                                    icon={DollarSign}
                                    label="Document Charges"
                                    value={product.documentCharges ? `₹${product.documentCharges.toLocaleString('en-IN')}` : 'Not Set'}
                                />
                                
                                <InfoField 
                                    icon={Coins} 
                                    label="Loan Advance" 
                                    value={`₹${product.advanceSavingsAmount?.toLocaleString('en-IN') || '0'}`} 
                                />

                                {/* Status Badge */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        <Shield className="h-3.5 w-3.5" />
                                        Status
                                    </div>
                                    <div>
                                        <Badge
                                            variant={product.status === 'enabled' ? 'default' : 'secondary'}
                                            className={
                                                product.status === 'enabled'
                                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                                    : 'bg-brand-green-tint text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-400'
                                            }
                                        >
                                            {product.status === 'enabled' ? 'Active' : 'Disabled'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Computed Summary */}
                        <div className="mt-6 rounded-xl border border-primary/30 bg-gradient-to-r from-green-50 to-green-50 p-4 dark:border-sidebar-accent/40 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20">
                            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                                <SummaryItem label="Total Repayment" value={`₹${product.totalRepayment.toLocaleString('en-IN')}`} />
                                {scheduleType === 'Flat Rate' && product.perInstallmentPrincipal > 0 && (
                                    <>
                                        <SummaryItem label="Per Inst. Principal" value={`₹${product.perInstallmentPrincipal.toLocaleString('en-IN')}`} />
                                        <SummaryItem label="Per Inst. Interest" value={`₹${product.perInstallmentInterest.toLocaleString('en-IN')}`} />
                                        <SummaryItem
                                            label="Per Inst. Total"
                                            value={`₹${(product.perInstallmentPrincipal + product.perInstallmentInterest).toLocaleString('en-IN')}`}
                                            highlight
                                        />
                                    </>
                                )}
                                {scheduleType === 'Reducing Balance' && (
                                    <div className="col-span-2 flex items-center gap-2">
                                        <Table2 className="h-4 w-4 text-amber-600" />
                                        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                                            Custom {templates.length}-installment schedule (Reducing Balance)
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Schedule Template Table */}
                        {hasTemplates && (
                            <div className="mt-4 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowSchedule(!showSchedule)}
                                        className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent hover:text-primary dark:text-slate-300 dark:hover:text-primary transition-colors"
                                    >
                                        {showSchedule ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                        View Schedule Template ({templates.length} installments)
                                    </button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={handleDownloadExcel}
                                        className="h-8 gap-2 text-xs font-semibold"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Download Excel
                                    </Button>
                                </div>

                                {showSchedule && (
                                    <div className="max-h-[300px] overflow-auto rounded-xl border border-primary/20 dark:border-sidebar-accent">
                                        <Table className="text-xs">
                                            <TableHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white sticky top-0">
                                                <TableRow>
                                                    <TableHead className="px-3 py-2.5 font-semibold text-white text-center w-16">#</TableHead>
                                                    <TableHead className="px-3 py-2.5 font-semibold text-white text-right">Principal</TableHead>
                                                    <TableHead className="px-3 py-2.5 font-semibold text-white text-right">Interest</TableHead>
                                                    <TableHead className="px-3 py-2.5 font-semibold text-white text-right">Total</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody className="bg-white dark:bg-green-950/30">
                                                {templates.map((row) => (
                                                    <TableRow
                                                        key={row.installmentNo}
                                                        className="odd:bg-green-50/70 hover:bg-green-50/60 dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80"
                                                    >
                                                        <TableCell className="px-3 py-2 text-center font-medium">{row.installmentNo}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-mono">₹{row.principalAmount.toLocaleString('en-IN')}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-mono">₹{row.interestAmount.toLocaleString('en-IN')}</TableCell>
                                                        <TableCell className="px-3 py-2 text-right font-mono font-semibold">₹{getTotal(row).toLocaleString('en-IN')}</TableCell>
                                                    </TableRow>
                                                ))}
                                                <TableRow className="bg-green-50 font-semibold dark:bg-green-950/30 border-t-2 border-primary/30 dark:border-sidebar-accent">
                                                    <TableCell className="px-3 py-2.5 text-center">Total</TableCell>
                                                    <TableCell className="px-3 py-2.5 text-right font-mono">
                                                        ₹{templates.reduce((s, r) => s + r.principalAmount, 0).toLocaleString('en-IN')}
                                                    </TableCell>
                                                    <TableCell className="px-3 py-2.5 text-right font-mono">
                                                        ₹{templates.reduce((s, r) => s + r.interestAmount, 0).toLocaleString('en-IN')}
                                                    </TableCell>
                                                    <TableCell className="px-3 py-2.5 text-right font-mono text-sidebar-accent dark:text-primary">
                                                        ₹{templates.reduce((s, r) => s + getTotal(r), 0).toLocaleString('en-IN')}
                                                    </TableCell>
                                                </TableRow>
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            className="h-10 px-5 text-sm font-semibold"
                        >
                            Close
                        </Button>
                        <Button
                            type="button"
                            onClick={handlePrimaryAction}
                            disabled={isUpdatingName}
                            className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white"
                        >
                            <span className="flex items-center gap-2">
                                <Edit className="h-4 w-4" />
                                {isRenaming ? 'Update' : 'Rename'}
                            </span>
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function InfoField({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Icon className="h-3.5 w-3.5" />
                {label}
            </div>
            <div className="rounded-lg border border-primary/20 bg-green-50 px-4 py-2.5 text-sm font-medium text-sidebar-accent dark:border-sidebar-accent dark:bg-brand-green-darker/50 dark:text-slate-300">
                {value || 'Not Set'}
            </div>
        </div>
    );
}

function SummaryItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-primary/70 dark:text-primary/70">{label}</div>
            <div className={`text-base font-bold ${highlight ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground dark:text-white'}`}>
                {value}
            </div>
        </div>
    );
}
