// components/masters/LoanProductForm.tsx
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { autoSizeColumns } from '@/app/lib/reports/excel-report-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Save, RotateCcw, Download, Loader2, Table2, PlusCircle, Trash2, FileSpreadsheet, ShieldCheck, Upload, Building2, ChevronDown, Search, X } from 'lucide-react';
import { ScheduleEditorModal, ScheduleRow } from './ScheduleEditorModal';
import { LOAN_FEES } from '@/app/lib/config';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';

/* ─────────────── Types ─────────────── */

export interface LoanProductFormData {
    productId?: string;
    productName: string;
    loanProductTypeId: string; // Make this required
    loanAmount: string;
    interestRate: string;
    insuranceFees: string;
    frequency: string;
    interestAmount: string;
    numberOfDues: string;
    documentCharges: string;
    interestMethod: string;
    advanceSavingsAmount: string;
    scheduleTemplates: ScheduleRow[];
    branchIds?: string[];
}

interface Branch {
    id: string;
    name: string;
    code: string;
    address: string | null;
    isActive: boolean;
}

interface LoanProductType {
    id: string;
    typeId: string;
    name: string;
}

interface LoanProductFormProps {
    initialData?: LoanProductFormData;
    onSave?: (data: LoanProductFormData) => void;
}

const EMPTY_FORM: LoanProductFormData = {
    productName: '',
    loanProductTypeId: '',
    loanAmount: '',
    interestRate: '',
    insuranceFees: '',
    frequency: '',
    interestAmount: '',
    numberOfDues: '',
    documentCharges: '',
    interestMethod: 'FLAT',
    advanceSavingsAmount: '100',
    scheduleTemplates: [],
    branchIds: [],
};

/* ─────────────── Component ─────────────── */

export function LoanProductForm({ initialData, onSave }: LoanProductFormProps) {
    const { toast } = useToast();
    const [formData, setFormData] = useState<LoanProductFormData>(initialData || EMPTY_FORM);
    const [isLoading, setIsLoading] = useState(false);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [productTypes, setProductTypes] = useState<LoanProductType[]>([]);
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [isLoadingTypes, setIsLoadingTypes] = useState(true);
    const [branchPopoverOpen, setBranchPopoverOpen] = useState(false);
    const [branchSearchQuery, setBranchSearchQuery] = useState('');
    const excelFileRef = useRef<HTMLInputElement>(null);

    // Schedule option
    const [scheduleOption, setScheduleOption] = useState<'manual' | 'paste'>('manual');
    const [fromDue, setFromDue] = useState('1');
    const [tillDue, setTillDue] = useState('');
    const [manualPrincipal, setManualPrincipal] = useState('');
    const [manualInterest, setManualInterest] = useState('');
    const [editorOpen, setEditorOpen] = useState(false);
    const isEditMode = !!formData.productId;

    // Fetch branches
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const result = await apiClient.get<Branch[]>('/branches?includeInactive=false');
                if (result.success && result.data) {
                    setBranches(result.data);
                }
            } catch (error) {
                console.error('Error fetching branches:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load branches.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoadingBranches(false);
            }
        };
        fetchBranches();
    }, [toast]);

    // Fetch product types
    useEffect(() => {
        const fetchProductTypes = async () => {
            try {
                const result = await apiClient.get<LoanProductType[]>('/loan-product-types');
                if (result.success && result.data) {
                    setProductTypes(result.data);
                }
            } catch (error) {
                console.error('Error fetching product types:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load product types.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoadingTypes(false);
            }
        };
        fetchProductTypes();
    }, [toast]);

    // Sync from initialData
    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
            if (initialData.scheduleTemplates?.length > 0) {
                setScheduleOption('paste');
            }
            if (initialData.branchIds) {
                setFormData(prev => ({ ...prev, branchIds: initialData.branchIds }));
            }
        }
    }, [initialData]);

    useEffect(() => {
        if (formData.numberOfDues && !tillDue) {
            setTillDue(formData.numberOfDues);
        }
    }, [formData.numberOfDues, tillDue]);

    useEffect(() => {
        if (!initialData) {
            setFormData(EMPTY_FORM);
            setFromDue('1');
            setTillDue('');
            setManualPrincipal('');
            setManualInterest('');
            setScheduleOption('manual');
            setEditorOpen(false);
            setBranchSearchQuery('');
        }
    }, [initialData]);

    // Filter branches based on search
    const filteredBranches = useMemo(() => {
        if (!branchSearchQuery.trim()) return branches;
        const query = branchSearchQuery.toLowerCase();
        return branches.filter(branch => 
            branch.name.toLowerCase().includes(query) ||
            branch.code.toLowerCase().includes(query)
        );
    }, [branches, branchSearchQuery]);

    const handleChange = (field: keyof LoanProductFormData, value: string) => {
        if (isEditMode && field !== 'productName' && field !== 'advanceSavingsAmount') return;
        setFormData((prev) => {
            const next = { ...prev, [field]: value };

            if (field === 'loanAmount') {
                const amount = parseFloat(value) || 0;
                next.insuranceFees = amount > 0 ? (amount * (LOAN_FEES.INSURANCE_FEE_PERCENT / 100)).toFixed(2) : '';
                next.documentCharges = amount > 0 ? (amount * (LOAN_FEES.DOCUMENT_CHARGES_PERCENT / 100)).toFixed(2) : '';
            }

            if (['loanAmount', 'interestRate'].includes(field) && next.scheduleTemplates.length === 0) {
                const amount = parseFloat(field === 'loanAmount' ? value : prev.loanAmount) || 0;
                const rate = parseFloat(field === 'interestRate' ? value : prev.interestRate) || 0;

                if (amount > 0 && rate > 0) {
                    next.interestAmount = (amount * rate / 100).toFixed(2);
                } else {
                    next.interestAmount = '';
                }
            }

            return next;
        });
    };

    const handleBranchSelection = (branchId: string) => {
        setFormData(prev => {
            const currentBranchIds = prev.branchIds || [];
            const newBranchIds = currentBranchIds.includes(branchId)
                ? currentBranchIds.filter(id => id !== branchId)
                : [...currentBranchIds, branchId];
            return { ...prev, branchIds: newBranchIds };
        });
    };

    const selectAllBranches = () => {
        setFormData(prev => ({ ...prev, branchIds: branches.map(b => b.id) }));
    };

    const clearAllBranches = () => {
        setFormData(prev => ({ ...prev, branchIds: [] }));
    };

    const getBranchLabel = () => {
        const branchIds = formData.branchIds || [];
        if (branchIds.length === 0) return 'All Branches';
        if (branchIds.length === 1) {
            const branch = branches.find(b => b.id === branchIds[0]);
            return branch?.name || '1 branch';
        }
        return `${branchIds.length} branches selected`;
    };

    const handleManualGenerate = () => {
        const from = parseInt(fromDue) || 1;
        const till = parseInt(tillDue) || parseInt(formData.numberOfDues) || 0;
        const principal = parseFloat(manualPrincipal) || 0;
        const interest = parseFloat(manualInterest) || 0;

        if (till < from) {
            toast({ title: 'Invalid Range', description: 'Till Due must be greater than or equal to From Due.', variant: 'destructive' });
            return;
        }
        if (principal <= 0) {
            toast({ title: 'Missing Principal', description: 'Enter a principal amount per installment.', variant: 'destructive' });
            return;
        }

        const newRows: ScheduleRow[] = [];
        for (let i = from; i <= till; i++) {
            newRows.push({ installmentNo: i, principalAmount: principal, interestAmount: interest });
        }

        const existingRows = [...formData.scheduleTemplates];
        const mergedRows = [...existingRows];
        
        for (const newRow of newRows) {
            const existingIndex = mergedRows.findIndex(r => r.installmentNo === newRow.installmentNo);
            if (existingIndex >= 0) {
                mergedRows[existingIndex] = newRow;
            } else {
                mergedRows.push(newRow);
            }
        }
        
        mergedRows.sort((a, b) => a.installmentNo - b.installmentNo);
        
        const totalInterest = mergedRows.reduce((s, r) => s + r.interestAmount, 0);
        const maxDue = Math.max(...mergedRows.map(r => r.installmentNo), till);
        
        setFormData((prev) => ({
            ...prev,
            scheduleTemplates: mergedRows,
            numberOfDues: maxDue.toString(),
            interestAmount: totalInterest.toFixed(2),
            interestMethod: 'FLAT',
        }));

        setFromDue((parseInt(tillDue) + 1).toString());
        setTillDue('');
        setManualPrincipal('');
        setManualInterest('');

        toast({ title: 'Schedule Generated', description: `${newRows.length} installments added/updated.` });
    };

    const handleScheduleApply = (rows: ScheduleRow[]) => {
        const allSameP = rows.every((r) => r.principalAmount === rows[0].principalAmount);
        const allSameI = rows.every((r) => r.interestAmount === rows[0].interestAmount);
        const method = allSameP && allSameI ? 'FLAT' : 'REDUCING';

        const totalInterest = rows.reduce((s, r) => s + r.interestAmount, 0);

        setFormData((prev) => ({
            ...prev,
            scheduleTemplates: rows,
            numberOfDues: rows.length.toString(),
            interestAmount: totalInterest.toFixed(2),
            interestMethod: method,
        }));

        toast({ title: 'Schedule Applied', description: `${rows.length} installments configured (${method}).` });
    };

    const handleClearSchedule = () => {
        setFormData((prev) => ({
            ...prev,
            scheduleTemplates: [],
            interestMethod: 'FLAT',
        }));
        setManualPrincipal('');
        setManualInterest('');
        toast({ title: 'Schedule Cleared' });
    };

    const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

                if (rows.length === 0) {
                    toast({ title: 'Empty File', description: 'No data found in the Excel file.', variant: 'destructive' });
                    return;
                }

                const normalize = (key: string) => key.toLowerCase().replace(/[\s_\-\.#]/g, '');
                const firstRowKeys = Object.keys(rows[0]);

                const dueKey = firstRowKeys.find(k =>
                    ['dueno', 'due', 'installmentno', 'installment', 'sno', 'no', 'sr'].some(n => normalize(k) === n)
                );
                const principalKey = firstRowKeys.find(k => normalize(k).includes('principal'));
                const interestKey = firstRowKeys.find(k => normalize(k).includes('interest'));

                if (!dueKey || !principalKey || !interestKey) {
                    toast({
                        title: 'Invalid Format',
                        description: 'Excel must have columns: DueNo, Principal, Interest',
                        variant: 'destructive',
                    });
                    return;
                }

                const parsed: ScheduleRow[] = [];
                for (const row of rows) {
                    const installmentNo = parseInt(String(row[dueKey]));
                    const principalAmount = parseFloat(String(row[principalKey]));
                    const interestAmount = parseFloat(String(row[interestKey] ?? '0'));

                    if (!isNaN(installmentNo) && installmentNo > 0 && !isNaN(principalAmount) && principalAmount >= 0) {
                        parsed.push({
                            installmentNo,
                            principalAmount,
                            interestAmount: isNaN(interestAmount) ? 0 : interestAmount,
                        });
                    }
                }

                if (parsed.length === 0) {
                    toast({ title: 'No Valid Rows', description: 'Could not parse any installment rows.', variant: 'destructive' });
                    return;
                }

                parsed.sort((a, b) => a.installmentNo - b.installmentNo);

                const allSameP = parsed.every(r => r.principalAmount === parsed[0].principalAmount);
                const allSameI = parsed.every(r => r.interestAmount === parsed[0].interestAmount);
                const method = allSameP && allSameI ? 'FLAT' : 'REDUCING';

                const totalInterest = parsed.reduce((s, r) => s + r.interestAmount, 0);
                const maxDue = Math.max(...parsed.map(r => r.installmentNo));

                setFormData(prev => ({
                    ...prev,
                    scheduleTemplates: parsed,
                    numberOfDues: maxDue.toString(),
                    interestAmount: totalInterest.toFixed(2),
                    interestMethod: method,
                }));

                toast({ title: 'Excel Imported', description: `${parsed.length} installments imported.` });
            } catch (err) {
                console.error('Excel import error:', err);
                toast({ title: 'Import Failed', description: 'Could not read the Excel file.', variant: 'destructive' });
            } finally {
                if (excelFileRef.current) excelFileRef.current.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleDownloadFormat = () => {
        const sampleData = [
            { DueNo: 1, Principal: 1000, Interest: 100 },
            { DueNo: 2, Principal: 1000, Interest: 100 },
            { DueNo: 3, Principal: 1000, Interest: 100 },
        ];
        const ws = XLSX.utils.json_to_sheet(sampleData);
        autoSizeColumns(ws);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
        XLSX.writeFile(wb, 'schedule_template.xlsx');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.productName.trim()) {
            toast({ title: 'Validation Error', description: 'Product Name is required.', variant: 'destructive' });
            return;
        }
        
        if (!formData.loanProductTypeId) {
            toast({ title: 'Validation Error', description: 'Product Type is required.', variant: 'destructive' });
            return;
        }
        
        if (isEditMode) {
            setIsLoading(true);
            try {
                if (onSave) await onSave(formData);
            } finally {
                setIsLoading(false);
            }
            return;
        }
        
        if (!formData.loanAmount || parseFloat(formData.loanAmount) <= 0) {
            toast({ title: 'Validation Error', description: 'Loan Amount is required.', variant: 'destructive' });
            return;
        }
        if (!formData.interestRate || parseFloat(formData.interestRate) <= 0) {
            toast({ title: 'Validation Error', description: 'Interest Rate is required.', variant: 'destructive' });
            return;
        }
        if (!formData.frequency) {
            toast({ title: 'Validation Error', description: 'Frequency is required.', variant: 'destructive' });
            return;
        }
        if (!formData.numberOfDues || parseInt(formData.numberOfDues) <= 0) {
            toast({ title: 'Validation Error', description: 'Number of Dues is required.', variant: 'destructive' });
            return;
        }

        const submissionData = {
            ...formData,
            branchIds: formData.branchIds || [],
        };

        setIsLoading(true);
        try {
            if (onSave) await onSave(submissionData);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        if (isEditMode && initialData) {
            setFormData(initialData);
            return;
        }
        setFormData(EMPTY_FORM);
        setFromDue('1');
        setTillDue('');
        setManualPrincipal('');
        setManualInterest('');
        setScheduleOption('manual');
        setBranchSearchQuery('');
    };

    const loanAmt = parseFloat(formData.loanAmount) || 0;
    const intAmt = parseFloat(formData.interestAmount) || 0;
    const dues = parseInt(formData.numberOfDues) || 0;
    const totalRepayment = loanAmt + intAmt;
    const perInstP = dues > 0 ? loanAmt / dues : 0;
    const perInstI = dues > 0 ? intAmt / dues : 0;
    const hasSchedule = formData.scheduleTemplates.length > 0;
    const branchIds = formData.branchIds || [];

    return (
        <>
            <form onSubmit={handleSubmit} className="relative overflow-hidden rounded-[2rem] border border-primary/20/80 bg-white/90 p-6 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/80">
                <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-primary to-cyan-500" />
                
                <div className="mb-6">
                    <h2 className="text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5 text-primary" />
                        {formData.productId ? 'Edit Loan Product' : 'Create Loan Product'}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">Configure product details, assign to branches, and set schedule template.</p>
                    {isEditMode && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
                            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                            <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                                Product is locked after creation. Only Product Name and Loan Advance can be edited.
                            </span>
                            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                                {formData.productId}
                            </Badge>
                        </div>
                    )}
                </div>

                {/* ── Row 1: Product ID, Name, Type, Frequency ── */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Product ID</Label>
                        <Input
                            value={formData.productId || '(Auto-Generated)'}
                            disabled
                            className="mt-1 h-10 bg-green-50 dark:bg-brand-green-darker text-slate-500 text-sm"
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Product Name <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            value={formData.productName}
                            onChange={(e) => handleChange('productName', e.target.value)}
                            placeholder="e.g. 30000 WEEKLY"
                            className="mt-1 h-10 text-sm"
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Product Type <span className="text-red-500">*</span>
                        </Label>
                        <Select 
                            value={formData.loanProductTypeId} 
                            onValueChange={(v) => handleChange('loanProductTypeId', v)} 
                            disabled={isEditMode}
                        >
                            <SelectTrigger className="mt-1 h-10 text-sm" disabled={isEditMode}>
                                <SelectValue placeholder="Select product type" />
                            </SelectTrigger>
                            <SelectContent>
                                {isLoadingTypes ? (
                                    <div className="flex items-center justify-center p-4">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    </div>
                                ) : productTypes.length === 0 ? (
                                    <div className="p-4 text-center text-sm text-muted-foreground">
                                        No product types available. Please create one first.
                                    </div>
                                ) : (
                                    productTypes.map((type) => (
                                        <SelectItem key={type.id} value={type.id}>
                                            {type.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Frequency <span className="text-red-500">*</span>
                        </Label>
                        <Select value={formData.frequency} onValueChange={(v) => handleChange('frequency', v)} disabled={isEditMode}>
                            <SelectTrigger className="mt-1 h-10 text-sm" disabled={isEditMode}>
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                                <SelectItem value="forthnight">ForthNight</SelectItem>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="quarterly">Quarterly</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* ── Row 2: Loan Amount, IR%, Interest Amount, No. of Dues ── */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Loan Amount <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            type="number"
                            value={formData.loanAmount}
                            onChange={(e) => handleChange('loanAmount', e.target.value)}
                            placeholder="0.00"
                            className="mt-1 h-10 text-sm"
                            disabled={isEditMode}
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Interest Rate (Flat %) <span className="text-red-500">*</span>
                        </Label>
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Flat rate on total principal</p>
                        <Input
                            type="number"
                            step="0.01"
                            value={formData.interestRate}
                            onChange={(e) => handleChange('interestRate', e.target.value)}
                            placeholder="e.g. 25"
                            className="mt-1 h-10 text-sm"
                            disabled={isEditMode}
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Interest Amount</Label>
                        <Input
                            type="number"
                            value={formData.interestAmount}
                            onChange={(e) => handleChange('interestAmount', e.target.value)}
                            placeholder="Auto-calculated"
                            readOnly={hasSchedule}
                            className={`mt-1 h-10 text-sm ${hasSchedule ? 'bg-green-50 dark:bg-brand-green-darker text-slate-500' : ''}`}
                            disabled={isEditMode}
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            No. of Dues <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            type="number"
                            value={formData.numberOfDues}
                            onChange={(e) => handleChange('numberOfDues', e.target.value)}
                            placeholder="e.g. 50"
                            className="mt-1 h-10 text-sm"
                            disabled={isEditMode}
                        />
                    </div>
                </div>

                {/* ── Row 3: Insurance Fees, Document Charges, Loan Advance, Branch Assignment ── */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Insurance Fees</Label>
                        <Input
                            type="number"
                            value={formData.insuranceFees}
                            onChange={(e) => handleChange('insuranceFees', e.target.value)}
                            placeholder="Auto-calculated"
                            className="mt-1 h-10 text-sm"
                            disabled={isEditMode}
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Document Charges</Label>
                        <Input
                            type="number"
                            value={formData.documentCharges}
                            onChange={(e) => handleChange('documentCharges', e.target.value)}
                            placeholder="Auto-calculated"
                            className="mt-1 h-10 text-sm"
                            disabled={isEditMode}
                        />
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                            Loan Advance <span className="text-rose-500">*</span>
                        </Label>
                        <Input
                            type="number"
                            min={0}
                            step={1}
                            value={formData.advanceSavingsAmount}
                            onChange={(e) => handleChange('advanceSavingsAmount', e.target.value)}
                            placeholder="100"
                            className="mt-1 h-10 text-sm"
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">Collected as advance from client</p>
                    </div>
                    <div>
                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400 flex items-center gap-2">
                            <Building2 className="h-3.5 w-3.5" />
                            Assign to Branches
                        </Label>
                        {isLoadingBranches ? (
                            <div className="mt-1 h-10 flex items-center">
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                <span className="text-xs text-muted-foreground">Loading branches...</span>
                            </div>
                        ) : (
                            <Popover open={branchPopoverOpen} onOpenChange={setBranchPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className={cn(
                                            'w-full justify-between font-normal mt-1 h-10 text-sm',
                                            branchIds.length === 0 && 'text-muted-foreground'
                                        )}
                                        disabled={isEditMode}
                                    >
                                        <span className="truncate flex items-center gap-2">
                                            {branchIds.length === 0 ? (
                                                <>
                                                    <GlobeIcon className="h-3.5 w-3.5" />
                                                    All Branches
                                                </>
                                            ) : (
                                                <>
                                                    <Building2 className="h-3.5 w-3.5" />
                                                    {getBranchLabel()}
                                                </>
                                            )}
                                        </span>
                                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[400px] p-0" align="start">
                                    <div className="p-3 border-b">
                                        <div className="relative">
                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Search branches by name or code..."
                                                value={branchSearchQuery}
                                                onChange={(e) => setBranchSearchQuery(e.target.value)}
                                                className="pl-8 h-9 text-sm"
                                            />
                                            {branchSearchQuery && (
                                                <button
                                                    onClick={() => setBranchSearchQuery('')}
                                                    className="absolute right-2 top-2.5"
                                                >
                                                    <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
                                        {filteredBranches.length === 0 ? (
                                            <div className="text-center py-8 text-sm text-muted-foreground">
                                                No branches found matching "{branchSearchQuery}"
                                            </div>
                                        ) : (
                                            filteredBranches.map(branch => (
                                                <div
                                                    key={branch.id}
                                                    className="flex items-center gap-2 rounded-sm px-2 py-2 hover:bg-accent cursor-pointer"
                                                    onClick={() => handleBranchSelection(branch.id)}
                                                >
                                                    <Checkbox
                                                        checked={branchIds.includes(branch.id)}
                                                        onCheckedChange={() => handleBranchSelection(branch.id)}
                                                        id={`branch-${branch.id}`}
                                                    />
                                                    <label
                                                        htmlFor={`branch-${branch.id}`}
                                                        className="text-sm cursor-pointer select-none flex-1 flex items-center justify-between"
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{branch.name}</span>
                                                            <span className="text-xs text-muted-foreground">{branch.code}</span>
                                                        </div>
                                                    </label>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    {branches.length > 0 && (
                                        <div className="border-t p-2 flex gap-2 justify-between">
                                            <div className="flex gap-2">
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
                                            <div className="text-xs text-muted-foreground px-2 py-1">
                                                {branchIds.length} selected
                                            </div>
                                        </div>
                                    )}
                                </PopoverContent>
                            </Popover>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                            {branchIds.length === 0 
                                ? '⚠️ Product will be available in ALL branches' 
                                : `✓ Product will only be available in ${branchIds.length} selected branch(es)`}
                        </p>
                    </div>
                </div>

                {/* Schedule Configuration Section */}
                {!isEditMode && (
                    <div className="border-t border-primary/20 dark:border-sidebar-accent pt-5 mb-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-sidebar-accent dark:text-primary">Repayment Schedule Configuration</h3>
                        </div>

                        <div className="flex items-center gap-6 mb-4">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="scheduleOption"
                                    checked={scheduleOption === 'manual'}
                                    onChange={() => setScheduleOption('manual')}
                                    className="accent-primary w-4 h-4"
                                />
                                <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300 group-hover:text-primary transition-colors">Manual Insert</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input
                                    type="radio"
                                    name="scheduleOption"
                                    checked={scheduleOption === 'paste'}
                                    onChange={() => setScheduleOption('paste')}
                                    className="accent-primary w-4 h-4"
                                />
                                <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300 group-hover:text-primary transition-colors">Paste Schedule</span>
                            </label>
                        </div>

                        {scheduleOption === 'manual' && (
                            <div className="rounded-xl border border-primary/20 dark:border-sidebar-accent bg-green-50/60 dark:bg-brand-green-darker/40 p-4 mb-4 space-y-4">
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
                                    <div>
                                        <Label className="text-xs text-sidebar-accent dark:text-slate-400">From Due</Label>
                                        <Input
                                            type="number"
                                            value={fromDue}
                                            onChange={(e) => setFromDue(e.target.value)}
                                            placeholder="1"
                                            className="mt-1 h-9 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs text-sidebar-accent dark:text-slate-400">Till Due</Label>
                                        <Input
                                            type="number"
                                            value={tillDue}
                                            onChange={(e) => setTillDue(e.target.value)}
                                            placeholder={formData.numberOfDues || 'e.g. 50'}
                                            className="mt-1 h-9 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs text-sidebar-accent dark:text-slate-400">Principal</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={manualPrincipal}
                                            onChange={(e) => setManualPrincipal(e.target.value)}
                                            placeholder="Per installment"
                                            className="mt-1 h-9 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-xs text-sidebar-accent dark:text-slate-400">Interest</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={manualInterest}
                                            onChange={(e) => setManualInterest(e.target.value)}
                                            placeholder="Per installment"
                                            className="mt-1 h-9 text-sm"
                                        />
                                    </div>
                                    <Button type="button" onClick={handleManualGenerate} className="h-9 bg-primary hover:bg-primary text-xs">
                                        <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Generate
                                    </Button>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="flex-1 h-px bg-brand-green-tint dark:bg-sidebar-accent" />
                                    <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">or</span>
                                    <div className="flex-1 h-px bg-brand-green-tint dark:bg-sidebar-accent" />
                                </div>

                                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                    <input
                                        ref={excelFileRef}
                                        type="file"
                                        accept=".xlsx,.xls,.csv"
                                        className="hidden"
                                        onChange={handleExcelImport}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => excelFileRef.current?.click()}
                                        className="h-9 border-green-500 text-green-700 hover:bg-green-50 dark:border-green-600 dark:text-green-400 dark:hover:bg-green-950/30 text-xs font-semibold"
                                    >
                                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                                        Import Excel
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleDownloadFormat}
                                        className="h-9 border-primary text-primary hover:bg-green-50 dark:border-primary dark:text-primary dark:hover:bg-green-950/30 text-xs font-semibold"
                                    >
                                        <Download className="h-3.5 w-3.5 mr-1.5" />
                                        Download Format
                                    </Button>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                        Upload with columns: <code className="bg-brand-green-tint dark:bg-sidebar-accent px-1 py-0.5 rounded">DueNo</code>,&nbsp;
                                        <code className="bg-brand-green-tint dark:bg-sidebar-accent px-1 py-0.5 rounded">Principal</code>,&nbsp;
                                        <code className="bg-brand-green-tint dark:bg-sidebar-accent px-1 py-0.5 rounded">Interest</code>
                                    </div>
                                </div>
                            </div>
                        )}

                        {scheduleOption === 'paste' && (
                            <div className="rounded-xl border border-primary/20 dark:border-sidebar-accent bg-green-50/60 dark:bg-brand-green-darker/40 p-4 mb-4">
                                <div className="flex items-center gap-3">
                                    <Button type="button" onClick={() => setEditorOpen(true)} className="bg-primary hover:bg-primary text-sm">
                                        <Table2 className="h-4 w-4 mr-2" /> Open Schedule Editor
                                    </Button>
                                    <span className="text-xs text-slate-500">
                                        Paste from Excel, edit cells, auto-fill — all in one place.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {hasSchedule && (
                    <div className="border border-primary/20 dark:border-sidebar-accent rounded-xl mb-5 overflow-hidden">
                        <div className="px-4 py-2.5 bg-brand-green-tint dark:bg-sidebar-accent flex items-center justify-between">
                            <h4 className="text-xs font-semibold text-sidebar-accent dark:text-slate-300">
                                Schedule Preview ({formData.scheduleTemplates.length} installments)
                                {formData.interestMethod === 'REDUCING' && (
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                        Reducing Balance
                                    </span>
                                )}
                                {formData.interestMethod === 'FLAT' && (
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                        Flat Rate
                                    </span>
                                )}
                            </h4>
                            {!isEditMode && (
                                <Button type="button" variant="ghost" size="sm" onClick={handleClearSchedule} className="text-xs text-red-500 hover:text-red-700 h-7">
                                    <Trash2 className="h-3 w-3 mr-1" /> Clear
                                </Button>
                            )}
                        </div>
                        <div className="max-h-64 overflow-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-green-50 dark:bg-brand-green-darker sticky top-0 z-10">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-slate-500 font-medium">#</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-medium">Principal</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-medium">Interest</th>
                                        <th className="px-3 py-2 text-right text-slate-500 font-medium">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {formData.scheduleTemplates.map((row) => (
                                        <tr key={row.installmentNo} className="border-t border-slate-100 dark:border-sidebar-accent">
                                            <td className="px-3 py-1.5 text-slate-500">{row.installmentNo}</td>
                                            <td className="px-3 py-1.5 text-right font-mono">₹{row.principalAmount.toLocaleString('en-IN')}</td>
                                            <td className="px-3 py-1.5 text-right font-mono">₹{row.interestAmount.toLocaleString('en-IN')}</td>
                                            <td className="px-3 py-1.5 text-right font-mono font-medium">₹{(row.principalAmount + row.interestAmount).toLocaleString('en-IN')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot className="bg-green-50 dark:bg-brand-green-darker sticky bottom-0 border-t-2 border-primary/20 dark:border-sidebar-accent">
                                    <tr>
                                        <td className="px-3 py-2 font-semibold text-sidebar-accent dark:text-slate-300">Total</td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold text-sidebar-accent dark:text-slate-300">
                                            ₹{formData.scheduleTemplates.reduce((s, r) => s + r.principalAmount, 0).toLocaleString('en-IN')}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold text-sidebar-accent dark:text-slate-300">
                                            ₹{formData.scheduleTemplates.reduce((s, r) => s + r.interestAmount, 0).toLocaleString('en-IN')}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono font-semibold text-sidebar-accent dark:text-primary">
                                            ₹{formData.scheduleTemplates.reduce((s, r) => s + r.principalAmount + r.interestAmount, 0).toLocaleString('en-IN')}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {loanAmt > 0 && dues > 0 && (
                    <div className="rounded-xl bg-gradient-to-r from-green-50 to-green-50 dark:from-brand-green-darker/30 dark:to-brand-green-darker/30 border border-primary/30 dark:border-sidebar-accent p-4 mb-5">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                            <div>
                                <p className="text-[10px] text-primary dark:text-primary font-semibold uppercase tracking-wider">Total Interest</p>
                                <p className="text-sm font-bold text-foreground dark:text-white mt-0.5">₹{intAmt.toLocaleString('en-IN')}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-primary dark:text-primary font-semibold uppercase tracking-wider">Total Repayment</p>
                                <p className="text-sm font-bold text-foreground dark:text-white mt-0.5">₹{totalRepayment.toLocaleString('en-IN')}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-primary dark:text-primary font-semibold uppercase tracking-wider">Per Inst. Principal</p>
                                <p className="text-sm font-bold text-foreground dark:text-white mt-0.5">₹{perInstP.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-primary dark:text-primary font-semibold uppercase tracking-wider">Per Inst. Interest</p>
                                <p className="text-sm font-bold text-foreground dark:text-white mt-0.5">₹{perInstI.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] text-primary dark:text-primary font-semibold uppercase tracking-wider">Per Inst. Total</p>
                                <p className="text-sm font-bold text-foreground dark:text-white mt-0.5">₹{(perInstP + perInstI).toFixed(2)}</p>
                            </div>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                    <Button type="submit" disabled={isLoading} className="bg-primary hover:bg-primary text-sm">
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
                        {formData.productId ? 'Update Product' : 'Save Product'}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleReset} className="text-sm">
                        <RotateCcw className="h-4 w-4 mr-1.5" /> {isEditMode ? 'Revert' : 'Reset'}
                    </Button>
                </div>
            </form>

            <ScheduleEditorModal
                open={editorOpen}
                onOpenChange={setEditorOpen}
                numberOfDues={parseInt(formData.numberOfDues) || 0}
                loanAmount={parseFloat(formData.loanAmount) || 0}
                interestAmount={parseFloat(formData.interestAmount) || 0}
                frequency={formData.frequency}
                initialData={formData.scheduleTemplates.length > 0 ? formData.scheduleTemplates : undefined}
                onApply={handleScheduleApply}
            />
        </>
    );
}

function GlobeIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
    );
}