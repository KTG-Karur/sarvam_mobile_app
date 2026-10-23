// components/masters/LoanPurposeTypePage.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    Edit,
    Trash2,
    Loader2,
    Target,
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
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    _count?: {
        loanPurposes: number;
    };
}

interface LoanPurposeTypeRow {
    id: string;
    typeId: string;
    name: string;
    status: string;
    purposeCount: number;
}

interface UploadResult {
    totalUploaded: number;
    totalCreated: number;
    totalNotCreated: number;
}

export default function LoanPurposeTypePage() {
    const [types, setTypes] = useState<LoanPurposeTypeRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingType, setEditingType] = useState<LoanPurposeType | null>(null);
    const [formData, setFormData] = useState({ name: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
    const [showUploadResult, setShowUploadResult] = useState(false);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);
    const [totalCount, setTotalCount] = useState(0);

    const { toast } = useToast();

    const fetchTypes = useCallback(async () => {
        setIsLoading(true);
        try {
            let url = '/loan-purpose-types?includeCount=true&includeInactive=false';
            if (searchTerm) {
                url += `&search=${encodeURIComponent(searchTerm)}`;
            }
            
            const result = await apiClient.get<LoanPurposeType[]>(url);
            if (result.success && result.data) {
                const rows: LoanPurposeTypeRow[] = result.data.map((t) => ({
                    id: t.id,
                    typeId: t.typeId,
                    name: t.name,
                    status: t.isActive ? 'Active' : 'Inactive',
                    purposeCount: t._count?.loanPurposes || 0,
                }));
                setTypes(rows);
                setTotalCount(rows.length);
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching purpose types:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loan purpose types.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, searchTerm]);

    useEffect(() => {
        fetchTypes();
    }, [fetchTypes]);

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        fetchTypes();
    };

    const handleOpenForm = (type?: LoanPurposeType) => {
        if (type) {
            setEditingType(type);
            setFormData({ name: type.name });
        } else {
            setEditingType(null);
            setFormData({ name: '' });
        }
        setShowForm(true);
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setEditingType(null);
        setFormData({ name: '' });
    };

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast({
                title: 'Validation Error',
                description: 'Purpose type name is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            if (editingType) {
                const result = await apiClient.put('/loan-purpose-types', {
                    id: editingType.id,
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Purpose type updated successfully.',
                    });
                    handleCloseForm();
                    fetchTypes();
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                const result = await apiClient.post('/loan-purpose-types', {
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Purpose type created successfully.',
                    });
                    handleCloseForm();
                    fetchTypes();
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }
        } catch (error) {
            console.error('Error saving purpose type:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save purpose type.',
                variant: 'destructive',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (editingType) {
            setFormData({ name: editingType.name });
        } else {
            setFormData({ name: '' });
        }
    };

    const handleDelete = async (typeId: string, typeName: string, purposeCount: number) => {
        if (purposeCount > 0) {
            toast({
                title: 'Cannot Delete',
                description: `Cannot delete "${typeName}" because it has ${purposeCount} active purpose(s) associated.`,
                variant: 'destructive',
            });
            return;
        }

        if (!confirm(`Are you sure you want to delete "${typeName}"?`)) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/loan-purpose-types?id=${typeId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Purpose type deleted successfully.',
                });
                fetchTypes();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting purpose type:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete purpose type.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Pagination calculations
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = types.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(types.length / itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        document.getElementById('purpose-types-table')?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const formDataObj = new FormData();
            formDataObj.append('file', file);

            const response = await apiClient.post<UploadResult>('/loan-purpose-types/upload', formDataObj);

            if (response.success && response.data) {
                setUploadResult(response.data);
                setShowUploadResult(true);
                fetchTypes();

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
            ['Type Name'],
            ['Working Capital'],
            ['Asset Purchase'],
            ['Business Expansion'],
            ['Equipment Purchase'],
            ['Emergency Fund'],
        ]);
        worksheet['!cols'] = [{ wch: 25 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        XLSX.writeFile(workbook, 'loan-purpose-type-template.xlsx');
    };

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg shadow-purple-500/30">
                            <Target className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Loan Purpose Types</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage categories for loan purposes
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {totalCount} Types
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

                {/* Search and Actions Bar */}
                <div className="mb-6 flex flex-col sm:flex-row gap-3">
                    <form onSubmit={handleSearch} className="flex flex-1 gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                type="text"
                                placeholder="Search by type name..."
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
                                    fetchTypes();
                                }}
                                className="h-10"
                            >
                                Clear
                            </Button>
                        )}
                    </form>

                    <div className="flex gap-2">
                        <Button
                            onClick={downloadTemplate}
                            variant="outline"
                            size="sm"
                            className="h-10 text-purple-600 border-purple-200 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-400 dark:hover:bg-purple-950/30"
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
                                disabled={isUploading}
                                className="hidden"
                            />
                        </label>
                    </div>
                </div>

                {/* Form Section - Toggle */}
                {showForm && (
                    <div className="mb-8 overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-rose-500" />
                        
                        <div className="p-6">
                            <h2 className="mb-6 text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                                <Target className="h-5 w-5 text-purple-600" />
                                {editingType ? 'Edit Purpose Type' : 'Create Purpose Type'}
                            </h2>

                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Type Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ name: e.target.value })}
                                        placeholder="e.g., Business, Agriculture, Education"
                                        className="mt-1 h-10 text-sm"
                                        autoFocus
                                    />
                                </div>
                                
                                {editingType && (
                                    <div>
                                        <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                            Type ID
                                        </Label>
                                        <Input
                                            value={editingType.typeId}
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
                                    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-1.5" />
                                    )}
                                    {editingType ? 'Update Type' : 'Save Type'}
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
                            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Purpose Type
                        </Button>
                    </div>
                )}

                {/* Table Section */}
                <div id="purpose-types-table" className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Purpose Types Registry</h3>
                        <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                            {types.length} Records
                        </Badge>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                                <TableRow>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Type ID</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Type Name</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Purposes</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Status</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading && types.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center">
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-600" />
                                            <p className="mt-2 text-sm text-slate-500">Loading purpose types...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : currentItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center">
                                            <Target className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-2 text-sm text-slate-500">No purpose types found.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentItems.map((type) => (
                                        <TableRow
                                            key={type.id}
                                            className="border-b border-slate-100 hover:bg-purple-50/40 dark:border-sidebar-accent dark:hover:bg-purple-950/20"
                                        >
                                            <TableCell className="px-6 py-3 font-mono text-sm font-medium text-foreground dark:text-white">
                                                {type.typeId}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 font-medium text-sidebar-accent dark:text-slate-200">
                                                {type.name}
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge 
                                                    variant="outline" 
                                                    className={type.purposeCount > 0 
                                                        ? "border-primary/50 text-sidebar-accent dark:border-sidebar-accent dark:text-primary"
                                                        : "border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400"
                                                    }
                                                >
                                                    {type.purposeCount} {type.purposeCount === 1 ? 'Purpose' : 'Purposes'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        type.status === 'Active'
                                                            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400'
                                                            : 'border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400'
                                                    }
                                                >
                                                    {type.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="px-6 py-3 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleOpenForm({
                                                            id: type.id,
                                                            typeId: type.typeId,
                                                            name: type.name,
                                                            isActive: type.status === 'Active',
                                                            createdAt: '',
                                                            updatedAt: '',
                                                        })}
                                                        className="h-8 w-8 p-0 border-primary/30 text-purple-600 hover:bg-purple-50 dark:border-sidebar-accent"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleDelete(type.id, type.name, type.purposeCount)}
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
                    {types.length > 0 && (
                        <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, types.length)} of {types.length} entries
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
                                                ? "bg-gradient-to-r from-purple-600 to-pink-600" 
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
