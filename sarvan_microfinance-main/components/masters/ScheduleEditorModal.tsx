'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
    ClipboardPaste,
    Wand2,
    Trash2,
    Plus,
    Check,
    X,
    CalendarDays,
} from 'lucide-react';
import { addDays, addWeeks, format } from 'date-fns';
import { DateInput } from '@/components/ui/date-input';
import { MONTHLY_INTERVAL_DAYS, QUARTERLY_INTERVAL_DAYS } from '@/app/lib/loan-frequency';

export interface ScheduleRow {
    installmentNo: number;
    principalAmount: number;
    interestAmount: number;
}

interface ScheduleEditorModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    numberOfDues: number;
    loanAmount: number;
    interestAmount: number;
    frequency: string;
    initialData?: ScheduleRow[];
    onApply: (rows: ScheduleRow[]) => void;
}

export function ScheduleEditorModal({
    open,
    onOpenChange,
    numberOfDues,
    loanAmount,
    interestAmount,
    frequency,
    initialData,
    onApply,
}: ScheduleEditorModalProps) {
    const { toast } = useToast();
    const [rows, setRows] = useState<ScheduleRow[]>([]);
    const [pasteText, setPasteText] = useState('');
    const [showPaste, setShowPaste] = useState(false);
    const [referenceDate, setReferenceDate] = useState<string>(
        format(new Date(), 'yyyy-MM-dd')
    );
    const tableRef = useRef<HTMLDivElement>(null);

    // Initialize rows when modal opens
    useEffect(() => {
        if (open) {
            if (initialData && initialData.length > 0) {
                setRows([...initialData]);
            } else if (numberOfDues > 0) {
                setRows(
                    Array.from({ length: numberOfDues }, (_, i) => ({
                        installmentNo: i + 1,
                        principalAmount: 0,
                        interestAmount: 0,
                    }))
                );
            } else {
                setRows([]);
            }
            setPasteText('');
            setShowPaste(false);
        }
    }, [open, initialData, numberOfDues]);

    // Calculate reference due date for display
    const getRefDueDate = useCallback(
        (installmentNo: number): string => {
            if (!referenceDate) return '-';
            let date = new Date(referenceDate);
            const freq = frequency?.toLowerCase() || 'weekly';
            for (let i = 0; i < installmentNo; i++) {
                if (freq === 'weekly') date = addWeeks(date, 1);
                else if (freq === 'forthnight') date = addWeeks(date, 2);
                else if (freq === 'monthly') date = addDays(date, MONTHLY_INTERVAL_DAYS);
                else if (freq === 'quarterly') date = addDays(date, QUARTERLY_INTERVAL_DAYS);
                else if (freq === 'daily') date = addDays(date, 1);
                else date = addWeeks(date, 1);
            }
            return format(date, 'dd/MM/yyyy');
        },
        [referenceDate, frequency]
    );

    // Parse pasted data (tab, comma, or multi-space separated)
    const handleParse = () => {
        if (!pasteText.trim()) {
            toast({ 
                title: 'Nothing to parse', 
                description: 'Paste schedule data first.', 
                variant: 'destructive' 
            });
            return;
        }

        const lines = pasteText.trim().split('\n').filter((l) => l.trim());
        const parsed: ScheduleRow[] = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            let parts: string[];
            if (trimmedLine.includes('\t')) {
                parts = trimmedLine.split('\t');
            } else if (trimmedLine.includes(',')) {
                parts = trimmedLine.split(',');
            } else {
                parts = trimmedLine.split(/\s+/);
            }
            
            parts = parts.map(p => p.trim()).filter(p => p.length > 0);
            
            if (parts.length < 2) continue;
            
            const numbers = parts.map(p => {
                const cleaned = p.replace(/[^\d.-]/g, '');
                return parseFloat(cleaned);
            }).filter(n => !isNaN(n));
            
            if (numbers.length >= 3) {
                parsed.push({ 
                    installmentNo: Math.round(numbers[0]), 
                    principalAmount: numbers[1], 
                    interestAmount: numbers[2] 
                });
            } else if (numbers.length >= 2) {
                parsed.push({ 
                    installmentNo: parsed.length + 1, 
                    principalAmount: numbers[0], 
                    interestAmount: numbers[1] 
                });
            }
        }

        if (parsed.length === 0) {
            toast({ 
                title: 'Parse Failed', 
                description: 'Could not find valid rows. Expected format: "1 1000 400" or "1,1000,400" or "1\t1000\t400"', 
                variant: 'destructive' 
            });
            return;
        }
        
        parsed.forEach((row, idx) => {
            row.installmentNo = idx + 1;
        });
        
        setRows(parsed);
        setPasteText('');
        setShowPaste(false);
        toast({ 
            title: 'Success!', 
            description: `Parsed ${parsed.length} installments. Review the table and click Apply.` 
        });
    };

    // Auto-fill with flat (uniform) values
    const handleAutoFillFlat = () => {
        const n = rows.length || numberOfDues;
        if (n <= 0 || loanAmount <= 0) {
            toast({ 
                title: 'Cannot Auto-Fill', 
                description: 'Set Loan Amount and Number of Dues first.', 
                variant: 'destructive' 
            });
            return;
        }
        const perP = Math.round((loanAmount / n) * 100) / 100;
        const perI = interestAmount > 0 ? Math.round((interestAmount / n) * 100) / 100 : 0;
        setRows(Array.from({ length: n }, (_, i) => ({ 
            installmentNo: i + 1, 
            principalAmount: perP, 
            interestAmount: perI 
        })));
        toast({ 
            title: 'Auto-Filled', 
            description: `${n} installments: ₹${perP.toFixed(2)} principal + ₹${perI.toFixed(2)} interest each.` 
        });
    };

    const updateCell = (index: number, field: 'principalAmount' | 'interestAmount', value: string) => {
        setRows((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: parseFloat(value) || 0 };
            return next;
        });
    };

    const addRow = () => {
        const nextNo = rows.length > 0 ? rows[rows.length - 1].installmentNo + 1 : 1;
        setRows((prev) => [...prev, { installmentNo: nextNo, principalAmount: 0, interestAmount: 0 }]);
    };

    const removeRow = (index: number) => {
        setRows((prev) => prev.filter((_, i) => i !== index).map((row, i) => ({ ...row, installmentNo: i + 1 })));
    };

    const totalPrincipal = rows.reduce((s, r) => s + r.principalAmount, 0);
    const totalInterest = rows.reduce((s, r) => s + r.interestAmount, 0);
    const grandTotal = totalPrincipal + totalInterest;

    const handleApply = () => {
        const validRows = rows.filter((r) => r.principalAmount > 0 || r.interestAmount > 0);
        if (validRows.length === 0) {
            toast({ 
                title: 'No Data', 
                description: 'Fill at least one installment.', 
                variant: 'destructive' 
            });
            return;
        }
        onApply(validRows);
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-5xl max-h-[90vh] p-0 gap-0 overflow-hidden">
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-4 bg-gradient-to-r from-primary/5 to-primary/5 border-b border-primary/20 dark:border-sidebar-accent">
                    <DialogTitle className="text-lg font-semibold flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-primary" />
                        Schedule Editor
                    </DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        Paste data from Excel or edit the table directly. Due dates shown are for reference only (actual dates are generated at disbursement).
                    </DialogDescription>
                </DialogHeader>

                {/* Toolbar */}
                <div className="px-6 py-3 border-b border-primary/20 dark:border-sidebar-accent flex flex-wrap items-center gap-3 bg-white dark:bg-green-950">
                    <Button size="sm" variant={showPaste ? 'default' : 'outline'} onClick={() => setShowPaste(!showPaste)} className="text-xs">
                        <ClipboardPaste className="h-3.5 w-3.5 mr-1.5" />
                        Paste Data
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleAutoFillFlat} className="text-xs">
                        <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                        Auto-Fill Flat
                    </Button>
                    <Button size="sm" variant="outline" onClick={addRow} className="text-xs">
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Add Row
                    </Button>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2">
                        <Label className="text-xs text-slate-500 whitespace-nowrap">Ref. Start Date:</Label>
                        <DateInput 
                            value={referenceDate} 
                            onChange={(e) => setReferenceDate(e.target.value)} 
                            className="h-8 w-36 text-xs" 
                        />
                    </div>
                </div>

                {/* Paste Section */}
                {showPaste && (
                    <div className="px-6 py-4 border-b border-primary/20 dark:border-sidebar-accent bg-green-50/50 dark:bg-green-950/20">
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400 mb-2 block">
                            Paste schedule data (space, tab, or comma separated)
                        </Label>
                        <div className="text-[10px] text-slate-500 mb-2">
                            Accepted formats: "1 1000 400" or "1,1000,400" or "1\t1000\t400"
                        </div>
                        <textarea
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder={`1 1000 400
2 1000 400
3 1000 400
4 1000 400`}
                            className="w-full h-32 rounded-lg border border-primary/30 dark:border-sidebar-accent/60 bg-white dark:bg-brand-green-darker text-xs font-mono p-3 resize-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                        <div className="flex gap-2 mt-2">
                            <Button size="sm" onClick={handleParse} className="text-xs bg-primary hover:bg-primary">
                                <Check className="h-3.5 w-3.5 mr-1" /> Parse &amp; Fill Table
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setPasteText(''); setShowPaste(false); }} className="text-xs">
                                <X className="h-3.5 w-3.5 mr-1" /> Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {/* Editable Table */}
                <div className="flex-1 overflow-auto max-h-[50vh] px-6 py-2" ref={tableRef}>
                    <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-gradient-to-r from-primary via-primary to-primary text-white">
                                <th className="px-3 py-2.5 text-left font-semibold w-14">#</th>
                                <th className="px-3 py-2.5 text-left font-semibold w-28">Ref. Due Date</th>
                                <th className="px-3 py-2.5 text-right font-semibold">Principal (₹)</th>
                                <th className="px-3 py-2.5 text-right font-semibold">Interest (₹)</th>
                                <th className="px-3 py-2.5 text-right font-semibold">Total (₹)</th>
                                <th className="px-3 py-2.5 text-center font-semibold w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={index} className="border-b border-slate-100 dark:border-sidebar-accent hover:bg-green-50/40 dark:hover:bg-green-950/20 transition-colors">
                                    <td className="px-3 py-1.5 font-medium text-slate-500">{row.installmentNo}</td>
                                    <td className="px-3 py-1.5 text-slate-400 text-[11px]">{getRefDueDate(row.installmentNo)}</td>
                                    <td className="px-1 py-1">
                                        <input
                                            type="number" 
                                            step="0.01"
                                            value={row.principalAmount || ''}
                                            onChange={(e) => updateCell(index, 'principalAmount', e.target.value)}
                                            className="w-full text-right px-2 py-1.5 rounded border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-xs font-mono focus:ring-2 focus:ring-primary focus:border-transparent"
                                            placeholder="0.00"
                                        />
                                    </td>
                                    <td className="px-1 py-1">
                                        <input
                                            type="number" 
                                            step="0.01"
                                            value={row.interestAmount || ''}
                                            onChange={(e) => updateCell(index, 'interestAmount', e.target.value)}
                                            className="w-full text-right px-2 py-1.5 rounded border border-primary/20 dark:border-sidebar-accent bg-white dark:bg-brand-green-darker text-xs font-mono focus:ring-2 focus:ring-primary focus:border-transparent"
                                            placeholder="0.00"
                                        />
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono font-medium text-sidebar-accent dark:text-slate-300">
                                        {(row.principalAmount + row.interestAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-1 py-1 text-center">
                                        <button 
                                            type="button" 
                                            onClick={() => removeRow(index)} 
                                            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors" 
                                            title="Remove"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {rows.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-3 py-12 text-center text-slate-400">
                                        No installments. Use &ldquo;Paste Data&rdquo;, &ldquo;Auto-Fill Flat&rdquo;, or &ldquo;Add Row&rdquo; to begin.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {rows.length > 0 && (
                            <tfoot className="sticky bottom-0">
                                <tr className="bg-brand-green-tint dark:bg-sidebar-accent border-t-2 border-primary/30 dark:border-sidebar-accent/60 font-semibold">
                                    <td className="px-3 py-2.5 text-sidebar-accent dark:text-slate-300" colSpan={2}>
                                        TOTAL ({rows.length} installments)
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono">₹{totalPrincipal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2.5 text-right font-mono">₹{totalInterest.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-sidebar-accent dark:text-primary">₹{grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>

                {/* Footer */}
                <DialogFooter className="px-6 py-4 border-t border-primary/20 dark:border-sidebar-accent bg-green-50 dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between w-full">
                        <div className="text-xs text-slate-500 flex gap-4">
                            <span>📊 {rows.length} installments</span>
                            <span>💰 ₹{grandTotal.toLocaleString('en-IN')} total</span>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                            <Button onClick={handleApply} className="bg-primary hover:bg-primary">
                                <Check className="h-4 w-4 mr-1.5" /> Apply Schedule
                            </Button>
                        </div>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
