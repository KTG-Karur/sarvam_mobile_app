// components/masters/LoanPurposePage.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    Building2,
    Save,
    RotateCcw,
    ChevronLeft,
    ChevronRight,
    Search,
    Upload,
    Download
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface LoanPurposeType {
    id: string;
    typeId: string;
    name: string;
}

interface LoanPurpose {
    id: string;
    purposeId: string;
    name: string;
    loanPurposeTypeId: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    loanPurposeType?: LoanPurposeType;
    _count?: {
        loans: number;
    };
}

interface LoanPurposeRow {
    id: string;
    purposeId: string;
    name: string;
    purposeTypeId: string;
    purposeTypeName: string;
    status: string;
    loanCount: number;
}

interface UploadResult {
    totalUploaded: number;
    totalCreated: number;
    totalNotCreated: number;
}

export default function LoanPurposePage() {
    const [purposes, setPurposes] = useState<LoanPurposeRow[]>([]);
    const [purposeTypes, setPurposeTypes] = useState<LoanPurposeType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingPurpose, setEditingPurpose] = useState<LoanPurpose | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        loanPurposeTypeId: ''
    });
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedTypeId, setSelectedTypeId] = useState('all');
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [showUploadResult, setShowUploadResult] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);
    const [totalCount, setTotalCount] = useState(0);

    const { toast } = useToast();

    const fetchPurposeTypes = useCallback(async () => {
        try {
            const result = await apiClient.get<LoanPurposeType[]>('/loan-purpose-types');
            if (result.success && result.data) {
                setPurposeTypes(result.data);
            }
        } catch (error) {
            console.error('Error fetching purpose types:', error);
        }
    }, []);

    const fetchPurposes = useCallback(async () => {
        setIsLoading(true);
        try {
            let url = '/loan-purposes?includeType=true&includeInactive=false';
            if (searchTerm) {
                url += `&search=${encodeURIComponent(searchTerm)}`;
            }
            if (selectedTypeId && selectedTypeId !== 'all') {
                url += `&purposeTypeId=${selectedTypeId}`;
            }
            
            const result = await apiClient.get<LoanPurpose[]>(url);
            if (result.success && result.data) {
                const rows: LoanPurposeRow[] = result.data.map((p) => ({
                    id: p.id,
                    purposeId: p.purposeId,
                    name: p.name,
                    purposeTypeId: p.loanPurposeTypeId,
                    purposeTypeName: p.loanPurposeType?.name || 'Not Set',
                    status: p.isActive ? 'Active' : 'Inactive',
                    loanCount: p._count?.loans || 0,
                }));
                setPurposes(rows);
                setTotalCount(rows.length);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching purposes:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loan purposes.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, searchTerm, selectedTypeId]);

    useEffect(() => {
        fetchPurposeTypes();
    }, []);

    useEffect(() => {
        fetchPurposes();
    }, [fetchPurposes]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchPurposes();
    };

    const handleTypeFilterChange = (value: string) => {
        setSelectedTypeId(value);
        setCurrentPage(1);
    };

    const handleOpenForm = (purpose?: LoanPurpose) => {
        if (purpose) {
            setEditingPurpose(purpose);
            setFormData({ 
                name: purpose.name, 
                loanPurposeTypeId: purpose.loanPurposeTypeId 
            });
        } else {
            setEditingPurpose(null);
            setFormData({ name: '', loanPurposeTypeId: '' });
        }
        setShowForm(true);
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingPurpose(null);
        setFormData({ name: '', loanPurposeTypeId: '' });
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Purpose name is required.',
                variant: 'destructive',
            });
            return;
        }

        if (!formData.loanPurposeTypeId) {
            toast({
                title: 'Validation Error',
                description: 'Purpose type is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            if (editingPurpose) {
                const result = await apiClient.put('/loan-purposes', {
                    id: editingPurpose.id,
                    name: formData.name.trim(),
                    loanPurposeTypeId: formData.loanPurposeTypeId,
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Loan purpose updated successfully.',
                    });
                    handleCloseForm();
                    fetchPurposes();
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                const result = await apiClient.post('/loan-purposes', {
                    name: formData.name.trim(),
                    loanPurposeTypeId: formData.loanPurposeTypeId,
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Loan purpose created successfully.',
                    });
                    handleCloseForm();
                    fetchPurposes();
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }
        } catch (error) {
            console.error('Error saving loan purpose:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save loan purpose.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (editingPurpose) {
            setFormData({ 
                name: editingPurpose.name, 
                loanPurposeTypeId: editingPurpose.loanPurposeTypeId 
            });
        } else {
            setFormData({ name: '', loanPurposeTypeId: '' });
        }
    };

    const handleDelete = async (purposeId: string, purposeName: string, loanCount: number) => {
        if (loanCount > 0) {
            toast({
                title: 'Cannot Delete',
                description: `Cannot delete "${purposeName}" because it has ${loanCount} active loan(s) associated.`,
                variant: 'destructive',
            });
            return;
        }

        if (!confirm(`Are you sure you want to delete "${purposeName}"?`)) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/loan-purposes?id=${purposeId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Loan purpose deleted successfully.',
                });
                fetchPurposes();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting loan purpose:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete loan purpose.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Pagination calculations
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = purposes.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(purposes.length / itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        document.getElementById('purposes-table')?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!selectedTypeId || selectedTypeId === 'all') {
            toast({
                title: 'Validation Error',
                description: 'Please select a purpose type before uploading.',
                variant: 'destructive',
            });
            return;
        }

        setIsUploading(true);
        try {
            const formDataObj = new FormData();
            formDataObj.append('file', file);
            formDataObj.append('loanPurposeTypeId', selectedTypeId);

            const response = await apiClient.post<UploadResult>('/loan-purposes/upload', formDataObj);

            if (response.success && response.data) {
                setUploadResult(response.data);
                setShowUploadResult(true);
                fetchPurposes();

                toast({
                    title: 'Upload Complete',
                    description: `${response.data.totalCreated} records created successfully.`,
                });
            } else {
                throw new Error(response.error || 'Upload failed');
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to upload file.',
                variant: 'destructive',
            });
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const downloadTemplate = () => {
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([
            ['Name'],
            ['Raw Material Purchase'],
            ['Inventory Replenishment'],
            ['Machinery Purchase'],
            ['Vehicle Purchase'],
            ['Building Construction'],
        ]);
        worksheet['!cols'] = [{ wch: 25 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        XLSX.writeFile(workbook, 'loan-purpose-template.xlsx');
    };

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-600 to-amber-600 shadow-lg shadow-orange-500/30">
                            <Building2 className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Loan Purposes</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage loan purpose options
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {totalCount} Purposes
                    </Badge>
                </div>

                {/* Upload Result Alert */}
                {showUploadResult && uploadResult && (
                    <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-6 py-4 dark:border-emerald-800 dark:bg-emerald-950/30 backdrop-blur-xl">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <h3 className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                                    <span className="h-2 w-2 bg-emerald-600 rounded-full"></span>
                                    Upload Result
                                </h3>
                                <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                                    <div>
                                        <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Uploaded</p>
                                        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalUploaded}</p>
                                    </div>
                                    <div>
                                        <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Created</p>
                                        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalCreated}</p>
                                    </div>
                                    <div>
                                        <p className="text-emerald-700 dark:text-emerald-300 font-medium">Total Not Created</p>
                                        <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">{uploadResult.totalNotCreated}</p>
                                    </div>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowUploadResult(false)}
                                className="text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                            >
                                ✕
                            </Button>
                        </div>
                    </div>
                )}

                {/* Search, Filter and Upload Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-3">
                    <form onSubmit={handleSearch} className="flex flex-1 gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Search by purpose name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9 h-10 text-sm"
                            />
                        </div>
                        <Button type="submit" variant="secondary" className="h-10">
                            <Search className="h-4 w-4 mr-2" />
                            Search
                        </Button>
                        {searchTerm && (
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => {
                                    setSearchTerm('');
                                    fetchPurposes();
                                }}
                                className="h-10"
                            >
                                Clear
                            </Button>
                        )}
                    </form>

                    <div className="w-full sm:w-64">
                        <Select value={selectedTypeId} onValueChange={handleTypeFilterChange}>
                            <SelectTrigger className="h-10 text-sm">
                                <SelectValue placeholder="All Purpose Types" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Purpose Types</SelectItem>
                                {purposeTypes.map((type) => (
                                    <SelectItem key={type.id} value={type.id}>
                                        {type.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={downloadTemplate}
                            variant="outline"
                            size="sm"
                            className="h-10 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950/30"
                        >
                            <Download className="h-4 w-4 mr-2" />
                            Template
                        </Button>
                        <label className="h-10 px-4 rounded-lg border border-primary/30 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-brand-green-darker flex items-center gap-2 text-sm font-medium cursor-pointer bg-white dark:bg-sidebar-accent transition-colors">
                            <Upload className="h-4 w-4" />
                            Upload Excel
                            <input
                                type="file"
                                accept=".xlsx,.xls,.csv"
                                onChange={handleFileUpload}
                                disabled={isUploading || selectedTypeId === 'all'}
                                className="hidden"
                            />
                        </label>
                    </div>
                </div>

                {/* Form Section - Toggle */}
                {showForm && (
                    <div className="mb-8 overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-orange-600 via-amber-600 to-yellow-500" />
                        
                        <div className="p-6">
                            <h2 className="mb-6 text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                                <Building2 className="h-5 w-5 text-orange-600" />
                                {editingPurpose ? 'Edit Loan Purpose' : 'Create Loan Purpose'}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Purpose Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        placeholder="e.g., Dairy Farming, Crop Cultivation"
                                        className="mt-1 h-10 text-sm"
                                        autoFocus
                                    />
                                </div>
                                
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Purpose Type <span className="text-red-500">*</span>
                                    </Label>
                                    <Select 
                                        value={formData.loanPurposeTypeId} 
                                        onValueChange={(v) => setFormData({ ...formData, loanPurposeTypeId: v })}
                                    >
                                        <SelectTrigger className="mt-1 h-10 text-sm">
                                            <SelectValue placeholder="Select purpose type" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {purposeTypes.length === 0 ? (
                                                <div className="p-4 text-center text-sm text-muted-foreground">
                                                    No purpose types available. Please create one first.
                                                </div>
                                            ) : (
                                                purposeTypes.map((type) => (
                                                    <SelectItem key={type.id} value={type.id}>
                                                        {type.name}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {editingPurpose && (
                                    <div>
                                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                            Purpose ID
                                        </Label>
                                        <Input
                                            value={editingPurpose.purposeId}
                                            disabled
                                            className="mt-1 h-10 text-sm bg-green-50 dark:bg-brand-green-darker"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center gap-3 pt-6">
                                <Button 
                                    onClick={handleSave} 
                                    disabled={isSaving}
                                    className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-1.5" />
                                    )}
                                    {editingPurpose ? 'Update Purpose' : 'Save Purpose'}
                                </Button>
                                <Button 
                                    type="button" 
                                    variant="outline" 
                                    onClick={handleReset}
                                    className="text-sm"
                                >
                                    <RotateCcw className="h-4 w-4 mr-1.5" /> Reset
                                </Button>
                                <Button 
                                    type="button" 
                                    variant="ghost" 
                                    onClick={handleCloseForm}
                                    className="text-sm"
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Add Button */}
                {!showForm && (
                    <div className="mb-6 flex justify-end">
                        <Button
                            onClick={() => handleOpenForm()}
                            className="bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Loan Purpose
                        </Button>
                    </div>
                )}

                {/* Table Section */}
                <div id="purposes-table" className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Loan Purposes Registry</h3>
                        <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                            {purposes.length} Records
                        </Badge>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gradient-to-r from-orange-600 to-amber-600 text-white">
                                <TableRow>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Purpose ID</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Purpose Name</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Purpose Type</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Loans</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Status</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading && purposes.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-orange-600" />
                                            <p className="mt-2 text-sm text-slate-500">Loading loan purposes...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : currentItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-32 text-center">
                                            <Building2 className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-2 text-sm text-slate-500">No loan purposes found.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentItems.map((purpose) => (
                                        <TableRow
                                            key={purpose.id}
                                            className="border-b border-slate-100 hover:bg-orange-50/40 dark:border-sidebar-accent dark:hover:bg-orange-950/20"
                                        >
                                            <TableCell className="px-6 py-3 font-mono text-sm font-medium text-foreground dark:text-white">
                                                {purpose.purposeId}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                                {purpose.name}
                                            </TableCell>
                                            <TableCell className="px-6 py-3">
                                                <Badge variant="outline" className="border-purple-200 text-purple-700 dark:border-purple-800 dark:text-purple-400">
                                                    {purpose.purposeTypeName}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge 
                                                    variant="outline" 
                                                    className={purpose.loanCount > 0 
                                                        ? "border-primary/50 text-sidebar-accent dark:border-sidebar-accent dark:text-primary"
                                                        : "border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400"
                                                    }
                                                >
                                                    {purpose.loanCount} {purpose.loanCount === 1 ? 'Loan' : 'Loans'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        purpose.status === 'Active'
                                                            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                                                            : 'border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'
                                                    }
                                                >
                                                    {purpose.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleOpenForm({
                                                            id: purpose.id,
                                                            purposeId: purpose.purposeId,
                                                            name: purpose.name,
                                                            loanPurposeTypeId: purpose.purposeTypeId,
                                                            isActive: purpose.status === 'Active',
                                                            createdAt: '',
                                                            updatedAt: '',
                                                        })}
                                                        className="h-8 w-8 p-0 border-primary/30 text-orange-600 hover:bg-orange-50 dark:border-sidebar-accent"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleDelete(purpose.id, purpose.name, purpose.loanCount)}
                                                        className="h-8 w-8 p-0 border-primary/30 text-red-600 hover:bg-red-50 dark:border-sidebar-accent"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {purposes.length > 0 && (
                        <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, purposes.length)} of {purposes.length} entries
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage - 1)}
                                    disabled={currentPage === 1}
                                    className="h-8 w-8 p-0"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                    <Button
                                        key={page}
                                        variant={currentPage === page ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => handlePageChange(page)}
                                        className={`h-8 w-8 p-0 ${
                                            currentPage === page 
                                                ? "bg-gradient-to-r from-orange-600 to-amber-600" 
                                                : ""
                                        }`}
                                    >
                                        {page}
                                    </Button>
                                ))}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handlePageChange(currentPage + 1)}
                                    disabled={currentPage === totalPages}
                                    className="h-8 w-8 p-0"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
