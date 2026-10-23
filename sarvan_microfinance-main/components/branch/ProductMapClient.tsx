'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Save, RotateCcw, Loader2, Building2, Search, PackageOpen } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { cn } from '@/lib/utils';
import type { Branch } from '@/app/types';
import { apiClient } from '@/app/lib/api-client';

type Product = {
    id: string;
    productId: string;
    productName: string;
    frequency: string;
    loanAmount: number;
    totalDues: number;
    interest: number;
};

type ProductMapping = {
    productId: string;
    productName: string;
    frequency?: string;
    loanAmount?: number;
    totalDues?: number;
    interest?: number;
    isAccessible: boolean;
};

type BranchProductMapping = {
    id: string;
    branchId: string;
    productId: string;
    productName: string;
    frequency: string | null;
    loanAmount: number | null;
    totalDues: number | null;
    interest: number | null;
    isAccessible: boolean;
};

export function ProductMapClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    const [products, setProducts] = useState<Product[]>([]);
    const [productMappings, setProductMappings] = useState<Record<string, boolean>>({});
    const [originalMappings, setOriginalMappings] = useState<Record<string, boolean>>({});

    // UI State
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [selectAll, setSelectAll] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Fetch Initial Data (Branches and Products)
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                // Fetch Branches
                const branchRes = await fetch('/api/branches');
                const branchData = await branchRes.json();
                if (branchData.success) {
                    setBranches(branchData.data);
                } else {
                    toast({ title: 'Error', description: 'Failed to fetch branches', variant: 'destructive' });
                }

                // Fetch Products
                const productRes = await fetch('/api/products');
                const productData = await productRes.json();
                if (productData.success) {
                    setProducts(productData.data);
                } else {
                    toast({ title: 'Error', description: 'Failed to fetch products', variant: 'destructive' });
                }
            } catch (error) {
                console.error('Initial data fetch error:', error);
                toast({ title: 'Connection Error', description: 'Failed to load initial data', variant: 'destructive' });
            }
        };

        fetchInitialData();
    }, [toast]);

    // Fetch mappings when a branch is selected
    useEffect(() => {
        if (!selectedBranchId || products.length === 0) {
            setProductMappings({});
            setOriginalMappings({});
            setHasChanges(false);
            setSelectAll(false);
            return;
        }

        const fetchMappings = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/branches/product-mapping?branchId=${selectedBranchId}`);
                const result = await response.json();

                if (result.success) {
                    const mappings: Record<string, boolean> = {};
                    const original: Record<string, boolean> = {};

                    // Default all products to false
                    products.forEach((product) => {
                        mappings[product.productId] = false;
                        original[product.productId] = false;
                    });

                    // Overlay existing active mappings
                    result.data.forEach((mapping: BranchProductMapping) => {
                        mappings[mapping.productId] = mapping.isAccessible;
                        original[mapping.productId] = mapping.isAccessible;
                    });

                    setProductMappings(mappings);
                    setOriginalMappings(original);
                    setHasChanges(false);

                    // Determine Select All state
                    const allSelected = products.every(p => mappings[p.productId]);
                    setSelectAll(allSelected);
                } else {
                    toast({ title: 'Error', description: 'Failed to fetch product mappings', variant: 'destructive' });
                }
            } catch (error) {
                console.error('Mapping fetch error:', error);
                toast({ title: 'Error', description: 'Unable to load branch mapping configuration', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        };

        fetchMappings();
    }, [selectedBranchId, products, toast]);

    // Observe changes to determine unsaved state & select-all toggle
    useEffect(() => {
        if (!selectedBranchId) {
            setHasChanges(false);
            return;
        }

        const isChanged = Object.keys(productMappings).some(
            (key) => productMappings[key] !== originalMappings[key]
        );
        setHasChanges(isChanged);

        const allSelected = products.length > 0 && products.every(p => productMappings[p.productId]);
        setSelectAll(allSelected);
    }, [productMappings, originalMappings, selectedBranchId, products]);

    const handleToggle = (productId: string, checked: boolean) => {
        setProductMappings((prev) => ({
            ...prev,
            [productId]: checked,
        }));
    };

    const handleSelectAllToggle = (checked: boolean) => {
        const newMappings = { ...productMappings };
        products.forEach(p => {
            newMappings[p.productId] = checked;
        });
        setProductMappings(newMappings);
        setSelectAll(checked);
    };

    const handleSubmit = async () => {
        if (!selectedBranchId) {
            toast({ title: 'Validation Error', description: 'Please select a branch first', variant: 'destructive' });
            return;
        }

        setIsSubmitting(true);
        try {
            const mappingsPayload: ProductMapping[] = products.map((product) => ({
                productId: product.productId,
                productName: product.productName,
                frequency: product.frequency,
                loanAmount: product.loanAmount,
                totalDues: product.totalDues,
                interest: product.interest,
                isAccessible: productMappings[product.productId] || false,
            }));

            const response = await fetch('/api/branches/product-mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    branchId: selectedBranchId,
                    productMappings: mappingsPayload,
                }),
            });

            const result = await response.json();

            if (result.success) {
                // Sync original state with the new active state
                const newOriginal = { ...productMappings };
                setOriginalMappings(newOriginal);
                setHasChanges(false);

                toast({ title: 'Mapping Updated', description: 'Branch product access mapped successfully.' });
            } else {
                throw new Error(result.error || 'Failed to update mappings');
            }
        } catch (error: any) {
            console.error('Submit update error:', error);
            toast({ title: 'Update Failed', description: error.message || 'Operation failed', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setProductMappings({ ...originalMappings });
        toast({ title: 'Reset Successful', description: 'Reverted to previous saved configuration.' });
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(amount);
    };

    // Filter products logically
    const filteredProducts = products.filter(p =>
        p.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.productId.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-6">
            <Card className="border-0 shadow-2xl bg-white/90 dark:bg-brand-green-darker/60 backdrop-blur-xl overflow-hidden rounded-3xl border-b-4 border-primary">
                <CardHeader className="bg-gradient-to-r from-green-50 to-green-50/50 dark:from-brand-green-darker/20 dark:to-brand-green-darker/20 px-4 sm:px-8 py-6 border-b border-slate-100 dark:border-sidebar-accent/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 dark:bg-brand-green-darker/40">
                                <PackageOpen className="h-6 w-6 text-primary dark:text-primary" />
                            </div>
                            <div>
                                <CardTitle className="text-xl font-bold text-foreground dark:text-white">Mapping Configuration</CardTitle>
                                <CardDescription className="text-slate-500 font-medium pt-1">
                                    Configure exactly which loan products this branch can access.
                                </CardDescription>
                            </div>
                        </div>

                        {/* Search Bar for products */}
                        <div className="hidden md:flex relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                placeholder="Search products..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-11 bg-white/50 dark:bg-sidebar-accent/50 border-primary/20 dark:border-sidebar-accent rounded-xl font-medium focus:ring-primary"
                            />
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-8">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                        <div className="md:col-span-6 space-y-2">
                            <Label htmlFor="branch-select" className="text-sm font-bold tracking-wide text-sidebar-accent dark:text-slate-200 uppercase">
                                Branch Name <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={selectedBranchId}
                                onValueChange={setSelectedBranchId}
                                disabled={isLoading || isSubmitting}
                            >
                                <SelectTrigger className="h-12 w-full border-primary/30 dark:border-sidebar-accent focus:ring-primary rounded-xl font-medium">
                                    <SelectValue placeholder="-- SELECT BRANCH --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {branches.map((branch) => (
                                        <SelectItem key={branch.id} value={branch.id} className="font-medium">
                                            <span className="text-slate-500 mr-2">[{branch.code}]</span> {branch.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedBranchId && (
                            <div className="md:col-span-2 flex items-center justify-start md:justify-center h-12">
                                <div className="flex items-center gap-3 bg-green-50 dark:bg-brand-green-darker/20 px-4 py-2 rounded-xl border border-primary dark:border-primary/30">
                                    <Label htmlFor="select-all" className="text-sm font-bold cursor-pointer text-primary dark:text-primary whitespace-nowrap">
                                        SELECT ALL
                                    </Label>
                                    <Switch
                                        id="select-all"
                                        checked={selectAll}
                                        onCheckedChange={handleSelectAllToggle}
                                        disabled={isLoading || isSubmitting || products.length === 0}
                                        className="data-[state=checked]:bg-primary"
                                    />
                                </div>
                            </div>
                        )}

                        <div className="md:col-span-4 flex items-center gap-4 justify-end h-12">
                            <Button
                                onClick={handleSubmit}
                                disabled={!selectedBranchId || !hasChanges || isSubmitting}
                                className="h-11 px-8 bg-primary hover:bg-sidebar-accent text-white font-bold rounded-xl shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> SAVING...</>
                                ) : (
                                    <><Save className="mr-2 h-4 w-4" /> SUBMIT</>
                                )}
                            </Button>

                            <Button
                                onClick={handleReset}
                                disabled={!selectedBranchId || !hasChanges || isSubmitting}
                                variant="outline"
                                className="h-11 px-6 font-bold border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 rounded-xl transition-all"
                            >
                                <RotateCcw className="mr-2 h-4 w-4" /> RESET
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Products Table Mapping Viewer */}
            {selectedBranchId && (
                <Card className="border-0 shadow-2xl bg-white dark:bg-brand-green-darker rounded-3xl overflow-hidden mt-8">
                    <CardContent className="p-0">
                        {isLoading ? (
                            <PageLoader label="LOADING PRODUCT CONFIGURATIONS..." fullScreen={false} />
                        ) : products.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-green-50/50 dark:bg-brand-green-darker/50">
                                <div className="p-4 bg-white dark:bg-sidebar-accent rounded-full shadow-sm mb-4">
                                    <PackageOpen className="h-8 w-8 text-primary" />
                                </div>
                                <h3 className="text-lg font-bold text-sidebar-accent dark:text-slate-200">No Catalog Available</h3>
                                <p className="text-sm text-slate-500 font-medium mt-1">
                                    There are no loan products set up in the master catalog yet.
                                </p>
                            </div>
                        ) : (
                            <div className="max-h-[600px] overflow-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 z-10 bg-primary shadow-md">
                                        <TableRow className="hover:bg-primary">
                                            <TableHead className="font-bold text-white py-4 pl-6">Product Name</TableHead>
                                            <TableHead className="font-bold text-white text-center">Frequency</TableHead>
                                            <TableHead className="font-bold text-white text-right">Loan Amount</TableHead>
                                            <TableHead className="font-bold text-white text-center">Total Dues</TableHead>
                                            <TableHead className="font-bold text-white text-right">Interest</TableHead>
                                            <TableHead className="font-bold text-white text-center pr-6">Accessibility Target</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredProducts.map((product) => {
                                            const isActive = productMappings[product.productId] || false;
                                            return (
                                                <TableRow
                                                    key={product.id}
                                                    className={cn(
                                                        "transition-all cursor-pointer",
                                                        isActive
                                                            ? "bg-green-50/50 dark:bg-brand-green-darker/10 hover:bg-primary/50 dark:hover:bg-brand-green-darker/20"
                                                            : "hover:bg-green-50 dark:hover:bg-sidebar-accent/50"
                                                    )}
                                                    onClick={() => !isSubmitting && handleToggle(product.productId, !isActive)}
                                                >
                                                    <TableCell className="font-bold text-sidebar-accent dark:text-slate-200 py-4 pl-6">
                                                        {product.productName}
                                                    </TableCell>
                                                    <TableCell className="font-bold text-sidebar-accent dark:text-slate-400 text-center">
                                                        <span className="px-2.5 py-1 bg-brand-green-tint dark:bg-sidebar-accent rounded-md text-xs tracking-wider">
                                                            {product.frequency.toUpperCase()}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="font-bold text-emerald-600 dark:text-emerald-400 text-right">
                                                        ₹ {formatCurrency(product.loanAmount)}
                                                    </TableCell>
                                                    <TableCell className="font-bold text-sidebar-accent dark:text-slate-300 text-center">
                                                        {product.totalDues}
                                                    </TableCell>
                                                    <TableCell className="font-bold text-orange-600 dark:text-orange-400 text-right">
                                                        ₹ {formatCurrency(product.interest)}
                                                    </TableCell>
                                                    <TableCell className="text-center pr-6" onClick={(e) => e.stopPropagation()}>
                                                        <Switch
                                                            checked={isActive}
                                                            onCheckedChange={(checked) => handleToggle(product.productId, checked)}
                                                            disabled={isSubmitting}
                                                            className="data-[state=checked]:bg-primary shadow-sm"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                        {filteredProducts.length === 0 && (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-10 text-slate-500 font-medium">
                                                    No products match your search query "{searchQuery}"
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Empty Context Overlay */}
            {!selectedBranchId && (
                <Card className="border-0 shadow-lg bg-green-50/50 dark:bg-brand-green-darker/20 rounded-3xl mt-8">
                    <CardContent className="flex flex-col items-center justify-center py-16">
                        <div className="rounded-full bg-primary/10 dark:bg-brand-green-darker/50 p-5 mb-5 shadow-inner">
                            <Building2 className="h-10 w-10 text-primary dark:text-primary opacity-80" />
                        </div>
                        <h3 className="text-xl font-bold text-sidebar-accent dark:text-slate-200 mb-2">Branch Context Required</h3>
                        <p className="text-sm font-medium text-slate-500 text-center max-w-sm">
                            Please select a Branch Name above to view and assign accessibility for its loan products.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
