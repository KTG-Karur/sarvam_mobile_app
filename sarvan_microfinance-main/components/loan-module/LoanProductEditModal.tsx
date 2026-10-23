'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';

type LoanProductType = {
    id: string;
    name: string;
};

type LoanProduct = {
    id: string;
    productName: string;
    loanAmount: number;
    interestRate: number;
    numberOfDues: number;
    frequency: string;
    loanProductTypeId: string;
};

export type UpdatedLoanProduct = {
    loanProductId: string;
    productName: string;
    amount: number;
    interestRate: number;
    tenureMonths: number;
    frequency: string;
};

interface LoanProductEditModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loanId: string;
    currentProductId?: string | null;
    role: 'BM' | 'AM';
    stage?: 'MEMBER_INDIVIDUAL' | 'DISBURSEMENT';
    branchId?: string;
    maxAllowedAmount: number;
    onSaved: (result: UpdatedLoanProduct) => void;
}

const FREQUENCY_LABELS: Record<string, string> = {
    daily: 'Daily',
    weekly: 'Weekly',
    forthnight: 'ForthNight',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
};

function calcTenureMonths(numberOfDues: number, frequency: string): number {
    const freq = frequency.toLowerCase();
    if (freq === 'weekly') return Math.ceil(numberOfDues / 4.33);
    if (freq === 'forthnight') return Math.ceil(numberOfDues / 2.17);
    if (freq === 'daily') return Math.ceil(numberOfDues / 30);
    if (freq === 'quarterly') return numberOfDues * 3;
    return numberOfDues;
}

export function LoanProductEditModal({
    open,
    onOpenChange,
    loanId,
    currentProductId,
    role,
    stage,
    branchId: branchIdProp,
    maxAllowedAmount,
    onSaved,
}: LoanProductEditModalProps) {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [productTypes, setProductTypes] = useState<LoanProductType[]>([]);
    const [allProducts, setAllProducts] = useState<LoanProduct[]>([]);
    const [selectedProductTypeId, setSelectedProductTypeId] = useState('');
    const [selectedFrequency, setSelectedFrequency] = useState('');
    const [selectedProductId, setSelectedProductId] = useState('');

    // Base-role ADMIN may pick a product above the approved amount (mirrors the server
    // exemption in both update-product routes). Read in an effect, not during render —
    // tokenStorage is localStorage-backed and would cause a hydration mismatch.
    const [isBaseAdminRole, setIsBaseAdminRole] = useState(false);
    useEffect(() => {
        setIsBaseAdminRole(tokenStorage.getUser()?.role === 'ADMIN');
    }, []);

    const productsForType = allProducts.filter(
        (p) => p.loanProductTypeId === selectedProductTypeId && (isBaseAdminRole || p.loanAmount <= maxAllowedAmount)
    );
    const availableFrequencies = [...new Set(productsForType.map((p) => p.frequency.toLowerCase()))];
    const filteredProducts = productsForType.filter(
        (p) => p.frequency.toLowerCase() === selectedFrequency
    );
    const selectedProduct = filteredProducts.find((p) => p.id === selectedProductId) || null;

    useEffect(() => {
        if (!open) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const activeBranch = branchStorage.getActiveBranch();
                const storedUser = tokenStorage.getUser();
                const branchId = branchIdProp || activeBranch?.id || storedUser?.branchId;

                const [typesResult, productsResult] = await Promise.all([
                    apiClient.get<LoanProductType[]>('/loan-product-types?includeInactive=false'),
                    branchId
                        ? apiClient.get<LoanProduct[]>(`/products?branchId=${branchId}`)
                        : Promise.resolve({ success: false as const, data: undefined, error: 'No branch' }),
                ]);

                const types = (typesResult.success && typesResult.data) ? typesResult.data : [];
                const products = (productsResult.success && productsResult.data) ? productsResult.data as LoanProduct[] : [];

                setProductTypes(types);
                setAllProducts(products);

                if (currentProductId && products.length > 0) {
                    const current = products.find((p) => p.id === currentProductId);
                    if (current) {
                        setSelectedProductTypeId(current.loanProductTypeId);
                        setSelectedFrequency(current.frequency.toLowerCase());
                        setSelectedProductId(current.id);
                    }
                }
            } catch {
                toast({ title: 'Error', description: 'Failed to load product data.', variant: 'destructive' });
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleClose = () => {
        setSelectedProductTypeId('');
        setSelectedFrequency('');
        setSelectedProductId('');
        onOpenChange(false);
    };

    const handleProductTypeChange = (typeId: string) => {
        setSelectedProductTypeId(typeId);
        setSelectedFrequency('');
        setSelectedProductId('');
    };

    const handleFrequencyChange = (freq: string) => {
        setSelectedFrequency(freq);
        setSelectedProductId('');
    };

    const handleSave = async () => {
        if (!selectedProductId) {
            toast({ title: 'Validation Error', description: 'Please select a loan product.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            const apiPath =
                role === 'BM'
                    ? `/loans/${loanId}/update-product`
                    : `/disbursements/${loanId}/update-product`;

            const result = await apiClient.patch<UpdatedLoanProduct>(apiPath, {
                loanProductId: selectedProductId,
                ...(role === 'AM' ? { stage: stage ?? 'DISBURSEMENT' } : {}),
            });

            if (result.success && result.data) {
                toast({ title: 'Product Updated', description: `Loan product changed to ${selectedProduct?.productName}.` });
                onSaved(result.data);
                handleClose();
            } else {
                toast({ title: 'Error', description: result.error || 'Failed to update product.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to update loan product.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const tenureMonths = selectedProduct
        ? calcTenureMonths(selectedProduct.numberOfDues, selectedProduct.frequency)
        : null;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit Loan Product</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <PageLoader label="Loading products..." fullScreen={false} />
                ) : (
                    <div className="space-y-5 py-2">
                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Product Type</Label>
                            <Select value={selectedProductTypeId} onValueChange={handleProductTypeChange}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select product type" />
                                </SelectTrigger>
                                <SelectContent>
                                    {productTypes.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                            {t.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Frequency</Label>
                            <Select
                                value={selectedFrequency}
                                onValueChange={handleFrequencyChange}
                                disabled={!selectedProductTypeId || availableFrequencies.length === 0}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableFrequencies.map((freq) => (
                                        <SelectItem key={freq} value={freq}>
                                            {FREQUENCY_LABELS[freq] || freq}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedProductTypeId && availableFrequencies.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    Only frequencies with existing products for this type are shown.
                                </p>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-sm font-medium">Loan Product</Label>
                            <Select
                                value={selectedProductId}
                                onValueChange={setSelectedProductId}
                                disabled={!selectedFrequency || filteredProducts.length === 0}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select loan product" />
                                </SelectTrigger>
                                <SelectContent>
                                    {filteredProducts.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.productName} — ₹{p.loanAmount.toLocaleString('en-IN')}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {isBaseAdminRole && selectedProduct && selectedProduct.loanAmount > maxAllowedAmount && (
                                <p className="text-xs font-medium text-amber-600">
                                    Admin override: this product is above the approved amount of ₹{maxAllowedAmount.toLocaleString('en-IN')}. The loan amount will be increased to ₹{selectedProduct.loanAmount.toLocaleString('en-IN')}.
                                </p>
                            )}
                            {selectedFrequency && filteredProducts.length === 0 && (
                                <p className="text-xs text-destructive">
                                    No loan products available within the approved amount of ₹{maxAllowedAmount.toLocaleString('en-IN')}.
                                </p>
                            )}
                        </div>

                        {selectedProduct && (
                            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/40">
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">Loan Amount</Label>
                                    <Input
                                        value={`₹${selectedProduct.loanAmount.toLocaleString('en-IN')}`}
                                        readOnly
                                        className="bg-muted/50 text-sm font-medium"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">Interest Rate</Label>
                                    <Input
                                        value={`${selectedProduct.interestRate}%`}
                                        readOnly
                                        className="bg-muted/50 text-sm font-medium"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-xs text-muted-foreground">Tenure</Label>
                                    <Input
                                        value={`${tenureMonths} mo`}
                                        readOnly
                                        className="bg-muted/50 text-sm font-medium"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={isSaving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={!selectedProductId || isSaving || isLoading}
                        className="bg-primary hover:bg-primary text-white"
                    >
                        {isSaving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                            </>
                        ) : (
                            'Save Changes'
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
