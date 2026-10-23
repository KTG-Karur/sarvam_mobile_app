// components/masters/LoanProductTypePage.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { 
    Plus, 
    Edit, 
    Trash2, 
    Loader2, 
    Package, 
    Save, 
    RotateCcw,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';

interface LoanProductType {
    id: string;
    typeId: string;
    name: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    _count?: {
        loanProducts: number;
    };
}

interface LoanProductTypeRow {
    id: string;
    typeId: string;
    name: string;
    status: string;
    productCount: number;
}

export default function LoanProductTypePage() {
    const [types, setTypes] = useState<LoanProductTypeRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingType, setEditingType] = useState<LoanProductType | null>(null);
    const [formData, setFormData] = useState({ name: '' });
    
    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);

    const { toast } = useToast();

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(types);

    // Reset to first page whenever the search narrows the result set, so the user
    // doesn't land on an empty page after typing a query.
    useEffect(() => {
        setCurrentPage(1);
    }, [tableSearchQuery]);

    const fetchTypes = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<LoanProductType[]>('/loan-product-types?includeCount=true');
            if (result.success && result.data) {
                const rows: LoanProductTypeRow[] = result.data.map((t) => ({
                    id: t.id,
                    typeId: t.typeId,
                    name: t.name,
                    status: t.isActive ? 'Active' : 'Inactive',
                    productCount: t._count?.loanProducts || 0,
                }));
                setTypes(rows);
                // Reset to first page when data changes
                setCurrentPage(1);
            }
        } catch (error) {
            console.error('Error fetching product types:', error);
            toast({
                title: 'Error',
                description: 'Failed to load product types.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchTypes();
    }, [fetchTypes]);

    const handleOpenForm = (type?: LoanProductType) => {
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
                description: 'Product type name is required.',
                variant: 'destructive',
            });
            return;
        }

        setIsSaving(true);
        try {
            if (editingType) {
                // Update
                const result = await apiClient.put('/loan-product-types', {
                    id: editingType.id,
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Product type updated successfully.',
                    });
                    handleCloseForm();
                    fetchTypes();
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                // Create
                const result = await apiClient.post('/loan-product-types', {
                    name: formData.name.trim(),
                });
                if (result.success) {
                    toast({
                        title: 'Success',
                        description: 'Product type created successfully.',
                    });
                    handleCloseForm();
                    fetchTypes();
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }
        } catch (error) {
            console.error('Error saving product type:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save product type.',
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

    const handleDelete = async (typeId: string, typeName: string, productCount: number) => {
        if (productCount > 0) {
            toast({
                title: 'Cannot Delete',
                description: `Cannot delete "${typeName}" because it has ${productCount} active product(s) associated.`,
                variant: 'destructive',
            });
            return;
        }

        if (!confirm(`Are you sure you want to delete "${typeName}"?`)) {
            return;
        }

        setIsLoading(true);
        try {
            const result = await apiClient.delete(`/loan-product-types?id=${typeId}`);
            if (result.success) {
                toast({
                    title: 'Success',
                    description: 'Product type deleted successfully.',
                });
                fetchTypes();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting product type:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete product type.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    // Pagination calculations
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = searchedRows.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(searchedRows.length / itemsPerPage);

    const handlePageChange = (page: number) => {
        setCurrentPage(page);
        // Scroll to top of table
        document.getElementById('types-table')?.scrollIntoView({ behavior: 'smooth' });
    };

    return (
        <div className="px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 shadow-lg shadow-emerald-500/30">
                            <Package className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Loan Product Types</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Manage categories for loan products
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {types.length} Types
                    </Badge>
                </div>

                {/* Form Section - Toggle */}
                {showForm && (
                    <div className="mb-8 overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-500" />
                        
                        <div className="p-6">
                            <h2 className="mb-6 text-lg font-semibold text-foreground dark:text-slate-100 flex items-center gap-2">
                                <Package className="h-5 w-5 text-emerald-600" />
                                {editingType ? 'Edit Product Type' : 'Create Product Type'}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <Label className="text-xs font-medium text-sidebar-accent dark:text-slate-400">
                                        Type Name <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                        value={formData.name}
                                        onChange={(e) => setFormData({ name: e.target.value })}
                                        placeholder="e.g., Group Loan, Individual Loan, Emergency Loan"
                                        className="mt-1 h-10 text-sm"
                                        autoFocus
                                    />
                                    <p className="text-xs text-slate-500 mt-1">
                                        This name will be displayed in loan product selection
                                    </p>
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
                                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
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
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search product types..."
                        />
                        <Button
                            onClick={() => handleOpenForm()}
                            className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Product Type
                        </Button>
                    </div>
                )}

                {/* Table Section */}
                <div id="types-table" className="overflow-hidden rounded-2xl border border-primary/20/80 bg-white/70 shadow-2xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between border-b border-primary/20/70 px-5 py-3 dark:border-sidebar-accent/80">
                        <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">Product Types Registry</h3>
                        <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                            {searchedRows.length} Records
                        </Badge>
                    </div>

                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
                                <TableRow>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Type ID</TableHead>
                                    <TableHead className="px-6 py-3 font-semibold text-white">Type Name</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Products</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Status</TableHead>
                                    <TableHead className="px-6 py-3 text-center font-semibold text-white">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading && types.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center">
                                            <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
                                            <p className="mt-2 text-sm text-slate-500">Loading product types...</p>
                                        </TableCell>
                                    </TableRow>
                                ) : currentItems.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center">
                                            <Package className="mx-auto h-12 w-12 text-slate-400" />
                                            <p className="mt-2 text-sm text-slate-500">No product types found. Create your first type.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentItems.map((type) => (
                                        <TableRow
                                            key={type.id}
                                            className="border-b border-slate-100 hover:bg-emerald-50/40 dark:border-sidebar-accent dark:hover:bg-emerald-950/20"
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
                                                    className={type.productCount > 0 
                                                        ? "border-primary/50 text-sidebar-accent dark:border-sidebar-accent dark:text-primary"
                                                        : "border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-400"
                                                    }
                                                >
                                                    {type.productCount} {type.productCount === 1 ? 'Product' : 'Products'}
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
                                                        className="h-8 w-8 p-0 border-primary/30 text-emerald-600 hover:bg-emerald-50 dark:border-sidebar-accent"
                                                        title="Edit"
                                                    >
                                                        <Edit className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => handleDelete(type.id, type.name, type.productCount)}
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
                    {searchedRows.length > 0 && (
                        <div className="flex items-center justify-between border-t border-primary/20/70 px-5 py-4 dark:border-sidebar-accent/80">
                            <div className="text-sm text-sidebar-accent dark:text-slate-400">
                                Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, searchedRows.length)} of {searchedRows.length} entries
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
                                                ? "bg-gradient-to-r from-emerald-600 to-teal-600" 
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
