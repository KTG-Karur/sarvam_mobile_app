'use client';

import { useState, useEffect, useCallback } from 'react';
import { LoanProductForm, LoanProductFormData } from './LoanProductForm';
import { LoanProductTable, LoanProductRow } from './LoanProductTable';
import { LoanProductPreviewDialog, LoanProductDetails } from './LoanProductPreviewDialog';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { CreditCard } from 'lucide-react';
import { usePermission } from '@/app/hooks/usePermission';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

export default function LoanProductPage() {
    const { canPage } = usePermission();
    const canCreate = canPage('/dashboard/masters/loan-product', 'add');
    const canDelete = canPage('/dashboard/masters/loan-product', 'delete');
    const [formData, setFormData] = useState<LoanProductFormData | undefined>(undefined);
    const [formKey, setFormKey] = useState<number>(Date.now()); // Add key for forcing reset
    const [products, setProducts] = useState<LoanProductRow[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isUpdatingName, setIsUpdatingName] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewProduct, setPreviewProduct] = useState<LoanProductDetails | null>(null);
    const { toast } = useToast();
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedProducts } = useTableSearch(products);

    // ── Client-side pagination (product list is admin-managed, never large enough
    // to warrant a server round-trip per page) ──
    const PAGE_SIZE = 10;
    const [page, setPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(searchedProducts.length / PAGE_SIZE));
    const paginatedProducts = searchedProducts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // A new search should always show results from the top, not wherever page the
    // user happened to be on.
    useEffect(() => {
        setPage(1);
    }, [tableSearchQuery]);

    // Defensive clamp for the list itself shrinking (e.g. a delete) while on the
    // last page — never leave the table showing an out-of-range/blank page.
    useEffect(() => {
        setPage((p) => Math.min(p, totalPages));
    }, [totalPages]);

    // ── Fetch products ──
    const fetchProducts = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await apiClient.get<any[]>('/products?includeTemplates=true');
            if (result.success && result.data) {
                const rows: LoanProductRow[] = result.data.map((p) => ({
                    id: p.id,
                    productId: p.productId,
                    productName: p.productName,
                    loanProductTypeId: p.loanProductTypeId || '',
                    loanProductTypeName: p.loanProductType?.name || 'Not Set', // ADD THIS
                    loanAmount: `₹${Number(p.loanAmount).toLocaleString('en-IN')}`,
                    interestRate: `${p.interestRate}%`,
                    frequency: p.frequency,
                    numberOfDues: p.numberOfDues?.toString() || '0',
                    interestAmount: p.interestAmount ? `₹${Number(p.interestAmount).toLocaleString('en-IN')}` : '-',
                    loginStatus: p.status || p.loginStatus || 'enabled',
                    advanceSavingsAmount: `₹${Number(p.advanceSavingsAmount || 0).toLocaleString('en-IN')}`,
                }));
                setProducts(rows);
            }
        } catch (error) {
            console.error('Error fetching products:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loan products.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    // ── Save product (create or update) ──
    const handleSave = useCallback(async (data: LoanProductFormData) => {
        setIsLoading(true);
        try {
            if (data.productId) {
                // Update existing
                const result = await apiClient.put('/products', {
                    productId: data.productId,
                    productName: data.productName,
                    advanceSavingsAmount: parseFloat(data.advanceSavingsAmount) || 100,
                });
                if (result.success) {
                    toast({
                        title: 'Product Updated',
                        description: `Product name changed to "${data.productName}".`,
                    });
                } else {
                    throw new Error(result.error || 'Update failed');
                }
            } else {
                // Create new - include all fields
                // Validate required fields before sending
                if (!data.loanProductTypeId) {
                    throw new Error('Product Type is required');
                }
                if (!data.loanAmount || parseFloat(data.loanAmount) <= 0) {
                    throw new Error('Loan Amount must be greater than 0');
                }
                if (!data.interestRate || parseFloat(data.interestRate) <= 0) {
                    throw new Error('Interest Rate must be greater than 0');
                }
                if (!data.frequency) {
                    throw new Error('Frequency is required');
                }
                if (!data.numberOfDues || parseInt(data.numberOfDues) <= 0) {
                    throw new Error('Number of Dues must be greater than 0');
                }

                const payload: Record<string, unknown> = {
                    productName: data.productName,
                    loanProductTypeId: data.loanProductTypeId,
                    loanAmount: parseFloat(data.loanAmount) || 0,
                    interestRate: parseFloat(data.interestRate) || 0,
                    insuranceFees: parseFloat(data.insuranceFees) || null,
                    frequency: data.frequency,
                    interestAmount: parseFloat(data.interestAmount) || null,
                    numberOfDues: parseInt(data.numberOfDues) || 0,
                    documentCharges: parseFloat(data.documentCharges) || null,
                    interestMethod: data.interestMethod || 'FLAT',
                    advanceSavingsAmount: parseFloat(data.advanceSavingsAmount) || 100,
                    status: 'enabled',
                    branchIds: data.branchIds || [],
                };

                if (data.scheduleTemplates && data.scheduleTemplates.length > 0) {
                    payload.scheduleTemplates = data.scheduleTemplates.map((t) => ({
                        installmentNo: t.installmentNo,
                        principalAmount: t.principalAmount,
                        interestAmount: t.interestAmount,
                    }));
                }

                const result = await apiClient.post('/products', payload);
                if (result.success) {
                    toast({
                        title: 'Product Created',
                        description: `"${data.productName}" created successfully.`,
                    });
                    
                    setFormData(undefined);
                    setFormKey(Date.now());
                    setTimeout(() => setFormData(undefined), 100);
                } else {
                    throw new Error(result.error || 'Creation failed');
                }
            }

            await fetchProducts();
        } catch (error) {
            console.error('Error saving product:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save product.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }, [toast, fetchProducts]);

    // ── Delete product ──
    const handleDelete = useCallback(async (productId: string) => {
        try {
            const result = await apiClient.delete(`/products?productId=${productId}`);
            if (result.success) {
                toast({
                    title: 'Product Deleted',
                    description: 'Loan product has been removed.',
                });
                fetchProducts();
            } else {
                throw new Error(result.error || 'Delete failed');
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete product.',
                variant: 'destructive',
            });
        }
    }, [toast, fetchProducts]);

    // ── Preview with real data from API ──
    const handlePreview = useCallback(async (productId: string) => {
        try {
            const result = await apiClient.get<LoanProductDetails>(`/products?productId=${productId}`);
            if (result.success && result.data) {
                setPreviewProduct(result.data);
                setPreviewOpen(true);
            } else {
                throw new Error('Product not found');
            }
        } catch (error) {
            console.error('Error fetching product for preview:', error);
            toast({
                title: 'Error',
                description: 'Failed to load product details for preview.',
                variant: 'destructive',
            });
        }
    }, [toast]);

    const handleUpdateNameFromPreview = useCallback(async (productId: string, productName: string) => {
        setIsUpdatingName(true);
        try {
            const result = await apiClient.put('/products', { productId, productName });
            if (!result.success) {
                throw new Error(result.error || 'Update failed');
            }

            setPreviewProduct((prev) => (
                prev && prev.productId === productId
                    ? { ...prev, productName }
                    : prev
            ));
            toast({
                title: 'Product Name Updated',
                description: `Name changed to "${productName}".`,
            });
            fetchProducts();
        } catch (error) {
            console.error('Error updating product name:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to update product name.',
                variant: 'destructive',
            });
            throw error;
        } finally {
            setIsUpdatingName(false);
        }
    }, [toast, fetchProducts]);

    return (
        <div className="relative min-h-screen px-4 md:px-4 sm:px-8 py-8 md:py-12">
            <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(circle_at_top,rgba(30,64,175,0.14),transparent_60%)]" />
            <div className="mx-auto flex max-w-7xl flex-col gap-8">
                <div className="flex items-center justify-between rounded-3xl border border-primary/20/80 bg-white/80 px-6 py-4 shadow-xl backdrop-blur-xl dark:border-sidebar-accent dark:bg-brand-green-darker/70">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <CreditCard className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold text-foreground dark:text-white">Loan Product Master</h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Create premium product definitions. After creation, only product name can be changed.
                            </p>
                        </div>
                    </div>
                    <Badge variant="secondary" className="bg-brand-green-darker text-white dark:bg-brand-green-tint dark:text-foreground">
                        {products.length} Products
                    </Badge>
                </div>

            {/* Form — only visible to roles that have masters:create */}
            {canCreate && (
                <LoanProductForm
                    key={formKey} // This forces a complete remount when key changes
                    initialData={formData}
                    onSave={handleSave}
                />
            )}

            <div className="flex justify-end">
                <TableSearchInput
                    value={tableSearchQuery}
                    onChange={setTableSearchQuery}
                    placeholder="Search loan products..."
                />
            </div>

            {/* Table — onDelete only passed when role has masters:delete */}
            <LoanProductTable
                data={paginatedProducts}
                isLoading={isLoading}
                onDelete={canDelete ? handleDelete : undefined}
                onPreview={handlePreview}
                totalCount={searchedProducts.length}
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
            />

            {/* Preview Dialog */}
            <LoanProductPreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                product={previewProduct}
                onUpdateName={handleUpdateNameFromPreview}
                isUpdatingName={isUpdatingName}
            />
            </div>
        </div>
    );
}
