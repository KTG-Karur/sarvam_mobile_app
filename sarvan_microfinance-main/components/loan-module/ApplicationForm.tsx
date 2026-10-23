'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    FileText,
    Save,
    RefreshCw,
    Building2,
    User,
    Calendar,
    Target,
    Loader2,
    IndianRupee,
    AlertCircle,
    Trash2,
    X,
    Layers,
    UserPlus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { LOAN_FEES } from '@/app/lib/config';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { usePermission } from '@/app/hooks/usePermission';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { PageLoader } from '@/components/ui/page-loader';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { HighmarkHistoryButton } from '@/components/highmark/HighmarkHistoryButton';

type OngoingLoan = {
    id: string;
    loanNumber: string;
    productName: string;
    indexNo?: string | null;
    disbursementDate: string;
    loanAmount: number;
    outstandingPrincipal: number;
    outstandingInterest: number;
    arrear: number;
    status: string;
};

// Updated schema with loanProductTypeId
const applicationSchema = z.object({
    centerId: z.string().min(1, 'Center is required'),
    clientId: z.string().min(1, 'Member / Client is required'),
    loanProductTypeId: z.string().min(1, 'Product type is required'),
    loanProductId: z.string().min(1, 'Loan product is required'),
    amount: z.string().min(1, 'Amount is required').refine(
        (val) => !isNaN(Number(val)) && Number(val) > 0,
        'Amount must be a valid positive number'
    ),
    interestRate: z.string().min(1, 'Interest rate is required'),
    tenureMonths: z.number().int().min(1, 'Tenure must be at least 1 month'),
    frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly'], {
        errorMap: () => ({ message: 'Frequency is required' }),
    }),
    loanPurposeTypeId: z.string().min(1, 'Purpose type is required'),
    loanPurposeId: z.string().min(1, 'Loan purpose is required'),
    // Optional — one of the client's approved/active co-applicants. Frozen
    // onto the loan permanently once submitted.
    coApplicantId: z.string().optional(),
    documentCharges: z.string().optional(),
    insuranceFee: z.string().optional(),
    admissionFee: z.string().optional(),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

const frequencyOptions = [
    { value: 'weekly', label: 'Weekly' },
];

type Branch = {
    id: string;
    name: string;
    code: string;
};

type Center = {
    id: string;
    name: string;
    code: string;
    branchId: string;
    status: string;
};

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    verificationStatus: string;
    hasGroup?: boolean;
    isDefaultMember?: boolean;
};

type LoanWithClient = {
    id: string;
    loanNumber: string;
    clientId: string;
    clientName: string;
    centerId: string;
    centerName: string;
    amount: string;
    interestRate: string;
    tenureMonths: number;
    applicationStatus: string;
    disbursementStatus: string;
    loanStatus: string;
    createdAt: string;
    indexId?: string | null;
    createdById?: string;
};

type LoanProductType = {
    id: string;
    typeId: string;
    name: string;
    isActive: boolean;
};

type LoanProduct = {
    id: string;
    productId: string;
    productName: string;
    frequency: string;
    loanAmount: number;
    interestRate: number;
    totalDues: number;
    interest: number;
    advanceSavingsAmount?: number;
    loanProductTypeId: string;
    insuranceFees: number | null;
    documentCharges: number | null;
};

type LoanPurposeType = {
    id: string;
    typeId: string;
    name: string;
};

type LoanPurpose = {
    id: string;
    purposeId: string;
    name: string;
    loanPurposeTypeId: string;
};

interface ApplicationFormProps {
    initialData?: Partial<ApplicationFormData>;
    onSuccess?: () => void;
}

export function ApplicationForm({ initialData, onSuccess }: ApplicationFormProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingData, setIsLoadingData] = useState(true);

    // Branch — selected first; scopes which centers are available below.
    // Locked to the user's own branch for BRANCH_MANAGER/FDO (both are
    // inherently single-branch identities); selectable for ADMIN/AREA_MANAGER.
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [isBranchLocked, setIsBranchLocked] = useState(false);
    const [currentUserId, setCurrentUserId] = useState('');
    const [isFdo, setIsFdo] = useState(false);

    const [centers, setCenters] = useState<Center[]>([]);
    const [eligibleClients, setEligibleClients] = useState<Client[]>([]);
    const [unindexedLoans, setUnindexedLoans] = useState<LoanWithClient[]>([]);
    const [loanProductTypes, setLoanProductTypes] = useState<LoanProductType[]>([]);
    const [loanProducts, setLoanProducts] = useState<LoanProduct[]>([]);
    const [filteredLoanProducts, setFilteredLoanProducts] = useState<LoanProduct[]>([]);
    const [purposeTypes, setPurposeTypes] = useState<LoanPurposeType[]>([]);
    const [loanPurposes, setLoanPurposes] = useState<LoanPurpose[]>([]);
    const [filteredLoanPurposes, setFilteredLoanPurposes] = useState<LoanPurpose[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedProductTypeId, setSelectedProductTypeId] = useState('');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedFrequency, setSelectedFrequency] = useState<string>('weekly');
    const [selectedPurposeTypeId, setSelectedPurposeTypeId] = useState<string>('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [loanToDelete, setLoanToDelete] = useState<LoanWithClient | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [eligibleClientCount, setEligibleClientCount] = useState(0);
    const [ongoingLoans, setOngoingLoans] = useState<OngoingLoan[]>([]);
    const [showOngoingLoanModal, setShowOngoingLoanModal] = useState(false);
    const [ongoingLoanAcknowledged, setOngoingLoanAcknowledged] = useState(false);
    const [eligibleCoApplicants, setEligibleCoApplicants] = useState<Array<{ id: string; name: string; relationWithClient: string; isPrimary: boolean }>>([]);
    const [isLoadingCoApplicants, setIsLoadingCoApplicants] = useState(false);
    const { toast } = useToast();
    const { canPage } = usePermission();
    const canCreateLoan  = canPage('/dashboard/loan-module/application', 'add');
    const canDeleteLoan  = canPage('/dashboard/loan-module/application', 'delete');
    
    // Refs to prevent duplicate calls
    const fetchingClientsRef = useRef(false);
    const fetchingProductsRef = useRef(false);
    const fetchingLoansRef = useRef(false);

    const form = useForm<ApplicationFormData>({
        resolver: zodResolver(applicationSchema),
        defaultValues: {
            centerId: '',
            clientId: '',
            loanProductTypeId: '',
            loanProductId: '',
            amount: '',
            interestRate: '',
            tenureMonths: 0,
            frequency: 'weekly',
            loanPurposeTypeId: '',
            loanPurposeId: '',
            coApplicantId: '',
            documentCharges: '',
            insuranceFee: '',
            admissionFee: '',
        },
    });

    // Recalculate document charges when loan amount changes.
    // Insurance fee is NOT percentage-based — it comes directly from the product
    // (set in handleProductChange) and is 0 when the product has no insuranceFees.
    useEffect(() => {
        const subscription = form.watch((value, { name }) => {
            if (name === 'amount') {
                const amount = Number(value.amount);
                if (!isNaN(amount) && amount > 0) {
                    const docCharges = (amount * LOAN_FEES.DOCUMENT_CHARGES_PERCENT) / 100;
                    form.setValue('documentCharges', docCharges.toFixed(2));
                } else {
                    form.setValue('documentCharges', '0');
                }
            }
        });
        return () => subscription.unsubscribe();
    }, [form]);

    // Calculate admission fee based on client history
    useEffect(() => {
        if (selectedClientId) {
            const checkClientLoans = async () => {
                try {
                    const result = await apiClient.get<{ loans: any[] }>(
                        `/loans?clientId=${selectedClientId}&includeInactive=false`
                    );
                    const hasPreviousLoans = result.success && result.data && result.data.loans && result.data.loans.length > 0;
                    if (!hasPreviousLoans) {
                        form.setValue('admissionFee', LOAN_FEES.ADMISSION_FEE.toString());
                    } else {
                        form.setValue('admissionFee', '0');
                    }
                } catch (error) {
                    console.error('Error checking client loans:', error);
                    form.setValue('admissionFee', LOAN_FEES.ADMISSION_FEE.toString());
                }
            };
            checkClientLoans();
        } else {
            form.setValue('admissionFee', '');
        }
    }, [selectedClientId, form]);

    // Fetch branches on mount — branch is selected first; centers (and every
    // downstream client/product/loan list) only load once a branch is chosen.
    // Locked to the user's own branch for BRANCH_MANAGER/FDO.
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                const storedUser = tokenStorage.getUser();
                const role = storedUser?.role ?? '';
                setCurrentUserId(storedUser?.id ?? '');
                setIsFdo(role === 'FDO');
                const isSingleBranchRole = role === 'BRANCH_MANAGER' || role === 'FDO';

                // BM/FDO need their own branch's name shown even if it's since
                // been deactivated — includeInactive=true guarantees it's in
                // the list (they can't pick a different one anyway, so
                // showing every branch here is harmless).
                const result = await apiClient.get<Branch[]>(
                    `/branches?includeInactive=${isSingleBranchRole ? 'true' : 'false'}`
                );
                if (result.success && result.data) {
                    // storedUser.branchId is the authoritative source for a
                    // single-branch role — it's refreshed on every token
                    // refresh. branchStorage's activeBranch is a cache meant
                    // for the ADMIN/AREA_MANAGER branch-switcher (FDO/BM never
                    // see it) and is only written at login, so it can go
                    // stale if the user's branch assignment changes mid-session.
                    const activeBranch = branchStorage.getActiveBranch();
                    const ownBranchId = storedUser?.branchId || activeBranch?.id || '';

                    if (isSingleBranchRole) {
                        // Always disabled for BM/FDO — they never choose a
                        // branch (only ADMIN/AREA_MANAGER do). Doesn't gate
                        // anything for FDO: the Center fetch works off
                        // Center.fdoId regardless of this field's value.
                        setIsBranchLocked(true);
                        const ownBranch = result.data.filter((b) => b.id === ownBranchId);
                        if (ownBranch.length > 0) {
                            setBranches(ownBranch);
                            setSelectedBranchId(ownBranchId);
                        } else if (activeBranch?.id) {
                            // Branch record itself couldn't be found (edge
                            // case) — fall back to the cached name/code from
                            // login so the field still shows something
                            // instead of a bare placeholder.
                            setBranches([{ id: activeBranch.id, name: activeBranch.name, code: activeBranch.code }]);
                            setSelectedBranchId(activeBranch.id);
                        } else {
                            setBranches(result.data);
                        }
                    } else {
                        setBranches(result.data);
                        setIsBranchLocked(false);
                    }
                }
            } catch (error) {
                console.error('Error fetching branches:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load branches.',
                    variant: 'destructive',
                });
            } finally {
                setIsLoadingData(false);
            }
        };

        fetchBranches();
    }, [toast]);

    // Fetch centers whenever the selected branch changes. FDOs are an
    // exception: the backend scopes their centers by Center.fdoId only, with
    // no branch fallback (see app/lib/filters/fdo-center-scope.ts) — an FDO
    // can be assigned centers in a branch other than their own home branch.
    // So for FDO we can (and must) fetch centers even before/without a
    // resolved branch selection, instead of gating on selectedBranchId.
    useEffect(() => {
        const fetchCenters = async () => {
            if (!selectedBranchId && !isFdo) {
                setCenters([]);
                return;
            }
            try {
                const branchParam = selectedBranchId ? `&branchId=${selectedBranchId}` : '';
                const result = await apiClient.get<Center[]>(
                    `/centers?status=APPROVED${branchParam}`
                );
                if (result.success && result.data) {
                    setCenters(result.data);
                    if (result.data.length === 1) {
                        setSelectedCenterId(result.data[0].id);
                    }
                } else {
                    setCenters([]);
                }
            } catch (error) {
                console.error('Error fetching centers:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        };

        fetchCenters();
        // Re-run when the branch changes, or once isFdo becomes known (FDOs
        // don't need a branch selected). selectedCenterId is reset by
        // handleBranchChange, not read here.
    }, [selectedBranchId, isFdo, toast]);

    const handleBranchChange = (branchId: string) => {
        setSelectedBranchId(branchId);
        setSelectedCenterId('');
        form.setValue('centerId', '');
        form.setValue('clientId', '');
        form.setValue('loanProductTypeId', '');
        form.setValue('loanProductId', '');
        form.setValue('loanPurposeTypeId', '');
        form.setValue('loanPurposeId', '');
        setSelectedClientId('');
        setSelectedProductTypeId('');
        setSelectedProductId('');
        setSelectedFrequency('weekly');
        setSelectedPurposeTypeId('');
        setEligibleClients([]);
        setUnindexedLoans([]);
        setLoanProducts([]);
        setFilteredLoanProducts([]);
        setFilteredLoanPurposes([]);
        setEligibleClientCount(0);
    };

    // Fetch loan product types on mount
    useEffect(() => {
        const fetchLoanProductTypes = async () => {
            try {
                const result = await apiClient.get<LoanProductType[]>('/loan-product-types?includeInactive=false');
                if (result.success && result.data) {
                    setLoanProductTypes(result.data);
                }
            } catch (error) {
                console.error('Error fetching loan product types:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load product types.',
                    variant: 'destructive',
                });
            }
        };
        fetchLoanProductTypes();
    }, [toast]);

    // Fetch purpose types on mount
    useEffect(() => {
        const fetchPurposeTypes = async () => {
            try {
                const result = await apiClient.get<LoanPurposeType[]>('/loan-purpose-types');
                if (result.success && result.data) {
                    setPurposeTypes(result.data);
                }
            } catch (error) {
                console.error('Error fetching purpose types:', error);
            }
        };
        fetchPurposeTypes();
    }, []);

    // Fetch loan purposes when purpose type is selected
    useEffect(() => {
        const fetchLoanPurposes = async () => {
            if (!selectedPurposeTypeId) {
                setFilteredLoanPurposes([]);
                return;
            }

            try {
                const result = await apiClient.get<LoanPurpose[]>(
                    `/loan-purposes?purposeTypeId=${selectedPurposeTypeId}&includeInactive=false`
                );
                if (result.success && result.data) {
                    setFilteredLoanPurposes(result.data);
                } else {
                    setFilteredLoanPurposes([]);
                }
            } catch (error) {
                console.error('Error fetching loan purposes:', error);
                setFilteredLoanPurposes([]);
            }
        };
        fetchLoanPurposes();
    }, [selectedPurposeTypeId]);

    // Fetch eligible clients when center is selected
    const fetchEligibleClients = useCallback(async () => {
        if (!selectedCenterId) {
            setEligibleClients([]);
            setEligibleClientCount(0);
            return;
        }

        if (fetchingClientsRef.current) return;
        fetchingClientsRef.current = true;

        try {
            const result = await apiClient.get<any>(
                `/loans/eligible-clients?centerId=${selectedCenterId}`
            );

            if (result.success && result.data) {
                let clientsData = [];
                
                if (Array.isArray(result.data)) {
                    clientsData = result.data;
                } 
                else if (result.data.data && Array.isArray(result.data.data)) {
                    clientsData = result.data.data;
                }
                else if (result.data.clients && Array.isArray(result.data.clients)) {
                    clientsData = result.data.clients;
                }
                else if (typeof result.data === 'object' && result.data !== null) {
                    const possibleArrays = Object.values(result.data).filter(val => Array.isArray(val));
                    if (possibleArrays.length > 0) {
                        clientsData = possibleArrays[0];
                    }
                }
                
                const clients = clientsData.map((client: any) => ({
                    id: client.id || client.clientId,
                    clientId: client.clientId || client.clientID || client.id,
                    firstName: client.name ? client.name.split(' ')[0] : (client.firstName || ''),
                    lastName: client.name ? client.name.split(' ').slice(1).join(' ') : (client.lastName || ''),
                    verificationStatus: client.verificationStatus || 'VERIFIED',
                    hasGroup: client.hasGroup ?? false,
                    isDefaultMember: client.isDefaultMember ?? false,
                }));
                
                setEligibleClients(clients);
                setEligibleClientCount(clients.length);
            } else {
                setEligibleClients([]);
                setEligibleClientCount(0);
            }
        } catch (error) {
            console.error('Error fetching eligible clients:', error);
            setEligibleClients([]);
            setEligibleClientCount(0);
        } finally {
            fetchingClientsRef.current = false;
        }
    }, [selectedCenterId]);

    const checkOngoingLoans = useCallback(async (clientId: string) => {
        try {
            const result = await apiClient.get<OngoingLoan[]>(`/clients/${clientId}/ongoing-loans`);
            if (result.success && result.data && result.data.length > 0) {
                setOngoingLoans(result.data);
                setShowOngoingLoanModal(true);
                setOngoingLoanAcknowledged(false);
            } else {
                setOngoingLoans([]);
                setOngoingLoanAcknowledged(false);
            }
        } catch (error) {
            console.error('Error checking ongoing loans:', error);
            setOngoingLoans([]);
            setOngoingLoanAcknowledged(false);
        }
    }, []);

    // Fetch this client's co-applicants that have passed full approval
    // (APPROVED or currently ACTIVE) — selectable for this new loan.
    const fetchEligibleCoApplicants = useCallback(async (clientId: string) => {
        setIsLoadingCoApplicants(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string; relationWithClient: string; isPrimary: boolean }>>(
                `/co-applicants?clientId=${clientId}&eligible=true`
            );
            setEligibleCoApplicants(result.success && Array.isArray(result.data) ? result.data : []);
        } catch (error) {
            console.error('Error fetching eligible co-applicants:', error);
            setEligibleCoApplicants([]);
        } finally {
            setIsLoadingCoApplicants(false);
        }
    }, []);

    // Fetch unindexed loans when center is selected
    const fetchUnindexedLoans = useCallback(async () => {
        if (!selectedCenterId) {
            setUnindexedLoans([]);
            return;
        }

        if (fetchingLoansRef.current) return;
        fetchingLoansRef.current = true;
        setIsLoadingLoans(true);

        try {
            // FDOs only see their own applications here — not every FDO's
            // applications for this center.
            const createdByParam = isFdo && currentUserId ? `&createdById=${currentUserId}` : '';
            const result = await apiClient.get<{ loans: LoanWithClient[] }>(
                `/loans?centerId=${selectedCenterId}&includeInactive=false${createdByParam}`
            );

            if (result.success && result.data && result.data.loans) {
                const filteredLoans = result.data.loans.filter(
                    (loan: LoanWithClient) =>
                        (loan.disbursementStatus === 'PENDING_LEVEL1' ||
                         loan.disbursementStatus === 'APPROVED_LEVEL1') &&
                        !loan.indexId
                );

                setUnindexedLoans(filteredLoans);
            } else {
                setUnindexedLoans([]);
            }
        } catch (error) {
            console.error('Error fetching unindexed loans:', error);
            setUnindexedLoans([]);
        } finally {
            setIsLoadingLoans(false);
            fetchingLoansRef.current = false;
        }
    }, [selectedCenterId, isFdo, currentUserId]);

    // Fetch loan products when center and product type are selected
    useEffect(() => {
        const fetchProducts = async () => {
            if (!selectedCenterId || !selectedProductTypeId) {
                setLoanProducts([]);
                setFilteredLoanProducts([]);
                return;
            }

            const center = centers.find((c) => c.id === selectedCenterId);
            if (!center?.branchId) {
                setLoanProducts([]);
                setFilteredLoanProducts([]);
                return;
            }

            if (fetchingProductsRef.current) return;
            fetchingProductsRef.current = true;

            try {
                const result = await apiClient.get<LoanProduct[]>(
                    `/products?branchId=${center.branchId}`
                );
                if (result.success && result.data) {
                    // Filter products by selected product type
                    const productsByType = result.data.filter(
                        product => product.loanProductTypeId === selectedProductTypeId
                    );
                    setLoanProducts(productsByType);
                    
                    if (selectedFrequency) {
                        const filtered = productsByType.filter(
                            product => product.frequency === selectedFrequency
                        );
                        setFilteredLoanProducts(filtered);
                    } else {
                        setFilteredLoanProducts([]);
                    }
                } else {
                    setLoanProducts([]);
                    setFilteredLoanProducts([]);
                }
            } catch (error) {
                console.error('Error fetching products:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to load loan products.',
                    variant: 'destructive',
                });
                setLoanProducts([]);
                setFilteredLoanProducts([]);
            } finally {
                fetchingProductsRef.current = false;
            }
        };

        fetchProducts();
        fetchEligibleClients();
        fetchUnindexedLoans();
    }, [selectedCenterId, selectedProductTypeId, centers, toast, fetchEligibleClients, fetchUnindexedLoans, selectedFrequency]);

    // Handle delete loan
    const handleDeleteLoan = async () => {
        if (!loanToDelete) return;

        setIsDeleting(true);
        try {
            const result = await apiClient.delete(`/loans?id=${loanToDelete.id}`);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: `Loan ${loanToDelete.loanNumber} has been deleted successfully.`,
                });

                await fetchUnindexedLoans();
                await fetchEligibleClients();

                if (selectedClientId === loanToDelete.clientId) {
                    setSelectedClientId('');
                    form.setValue('clientId', '');
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to delete loan.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting loan:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete loan. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
            setLoanToDelete(null);
        }
    };

    // Handle product type change
    const handleProductTypeChange = (productTypeId: string) => {
        setSelectedProductTypeId(productTypeId);
        form.setValue('loanProductTypeId', productTypeId);
        
        // Reset product selection
        setSelectedProductId('');
        form.setValue('loanProductId', '');
        form.setValue('amount', '');
        form.setValue('interestRate', '');
        setFilteredLoanProducts([]);
    };

    // Handle frequency change - filter products
    const handleFrequencyChange = (frequency: string) => {
        setSelectedFrequency(frequency);
        form.setValue('frequency', frequency as any);
        
        setSelectedProductId('');
        form.setValue('loanProductId', '');
        form.setValue('amount', '');
        form.setValue('interestRate', '');
        
        const filtered = loanProducts.filter(
            product => product.frequency === frequency
        );
        setFilteredLoanProducts(filtered);
    };

    // Handle purpose type change
    const handlePurposeTypeChange = (purposeTypeId: string) => {
        setSelectedPurposeTypeId(purposeTypeId);
        form.setValue('loanPurposeTypeId', purposeTypeId);
        form.setValue('loanPurposeId', '');
    };

    // Get selected product details
    const selectedProduct = loanProducts.find((p) => p.id === selectedProductId);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(unindexedLoans);

    const onSubmit = async (data: ApplicationFormData) => {
        // Gate: client must be assigned to a group before a loan application can be created
        const selectedClient = eligibleClients.find(
            c => c.id === data.clientId || c.clientId === data.clientId
        );
        if (selectedClient && selectedClient.hasGroup === false) {
            toast({
                title: 'Group Not Assigned',
                description: 'This member/client must be assigned to a Group before applying for a loan. Go to Client Operations → Assign Center & Group.',
                variant: 'destructive',
            });
            return;
        }

        // Gate: Default Member (Admin-flagged) clients can't receive a new loan
        if (selectedClient?.isDefaultMember) {
            toast({
                title: 'Default Member',
                description: 'This member is marked as a Default Member and cannot be given a new loan.',
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const payload = {
                clientId: data.clientId,
                centerId: data.centerId,
                loanProductId: data.loanProductId,
                amount: data.amount,
                interestRate: data.interestRate,
                tenureMonths: data.tenureMonths,
                frequency: data.frequency,
                loanPurposeId: data.loanPurposeId,
                coApplicantId: data.coApplicantId || undefined,
            };

            const result = await apiClient.post<{ loanId: string; loanNumber: string }>(
                '/loans',
                payload
            );

            if (result.success && result.data) {
                toast({
                    title: 'Success',
                    description: `Renewal loan application created successfully. Loan Number: ${result.data.loanNumber}`,
                });

                await fetchEligibleClients();
                await fetchUnindexedLoans();
                
                form.reset({
                    centerId: data.centerId,
                    clientId: '',
                    loanProductTypeId: '',
                    loanProductId: '',
                    amount: '',
                    interestRate: '',
                    tenureMonths: 0,
                    frequency: 'weekly',
                    loanPurposeTypeId: '',
                    loanPurposeId: '',
                    coApplicantId: '',
                    documentCharges: '',
                    insuranceFee: '',
                    admissionFee: '',
                });
                setSelectedClientId('');
                setEligibleCoApplicants([]);
                setSelectedProductTypeId('');
                setSelectedProductId('');
                setSelectedFrequency('weekly');
                setSelectedPurposeTypeId('');
                setFilteredLoanProducts([]);
                setFilteredLoanPurposes([]);

                if (onSuccess) {
                    onSuccess();
                }
            } else {
                // Expected/validation rejection from the server (e.g. Default Member
                // block) — just show the toast, no console.error/dev-overlay noise.
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to create renewal loan application',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error creating renewal loan application:', error);
            toast({
                title: 'Error',
                description:
                    error instanceof Error
                        ? error.message
                        : 'Failed to create renewal loan application. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReset = () => {
        form.reset({
            centerId: '',
            clientId: '',
            loanProductTypeId: '',
            loanProductId: '',
            amount: '',
            interestRate: '',
            tenureMonths: 0,
            frequency: 'weekly',
            loanPurposeTypeId: '',
            loanPurposeId: '',
        });
        setSelectedCenterId('');
        setSelectedClientId('');
        setSelectedProductTypeId('');
        setSelectedProductId('');
        setSelectedFrequency('weekly');
        setSelectedPurposeTypeId('');
        setEligibleClients([]);
        setUnindexedLoans([]);
        setLoanProducts([]);
        setFilteredLoanProducts([]);
        setFilteredLoanPurposes([]);
        setEligibleClientCount(0);
        form.setValue('documentCharges', '');
        form.setValue('insuranceFee', '');
        form.setValue('admissionFee', '');
    };

    const handleProductChange = (productId: string) => {
        setSelectedProductId(productId);
        const product = loanProducts.find((p) => p.id === productId);
        if (product) {
            form.setValue('loanProductId', productId);
            form.setValue('amount', product.loanAmount.toString());
            form.setValue('interestRate', product.interestRate.toString());

            let tenureMonths = product.totalDues;
            if (selectedFrequency === 'weekly') {
                tenureMonths = Math.ceil(product.totalDues / 4.33);
            } else if (selectedFrequency === 'forthnight') {
                tenureMonths = Math.ceil(product.totalDues / 2.17);
            } else if (selectedFrequency === 'daily') {
                tenureMonths = Math.ceil(product.totalDues / 30);
            }
            form.setValue('tenureMonths', tenureMonths);

            // Insurance fee: use product's configured value; 0 if not set
            const insFee = product.insuranceFees != null && product.insuranceFees > 0
                ? product.insuranceFees
                : 0;
            form.setValue('insuranceFee', insFee.toFixed(2));
        }
    };

    return (
        <div className="relative w-full max-w-6xl mx-auto">
            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && loanToDelete && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md mx-4">
                        <Alert variant="destructive" className="relative bg-white dark:bg-green-950 border-2 shadow-2xl">
                            <div className="absolute right-4 top-4">
                                <button
                                    onClick={() => {
                                        setShowDeleteConfirm(false);
                                        setLoanToDelete(null);
                                    }}
                                    className="rounded-md p-1 hover:bg-brand-green-tint dark:hover:bg-sidebar-accent transition-colors"
                                    disabled={isDeleting}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <AlertTitle className="text-lg font-semibold mb-2">
                                Are you sure?
                            </AlertTitle>
                            <AlertDescription className="space-y-4">
                                <p>
                                    This will permanently delete loan <strong className="font-semibold">{loanToDelete.loanNumber}</strong>.
                                    This action cannot be undone.
                                </p>
                                <div className="flex gap-3 pt-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => {
                                            setShowDeleteConfirm(false);
                                            setLoanToDelete(null);
                                        }}
                                        disabled={isDeleting}
                                        className="flex-1"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        onClick={handleDeleteLoan}
                                        disabled={isDeleting}
                                        className="flex-1"
                                    >
                                        {isDeleting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Deleting...
                                            </>
                                        ) : (
                                            'Delete'
                                        )}
                                    </Button>
                                </div>
                            </AlertDescription>
                        </Alert>
                    </div>
                </div>
            )}

            {/* Ongoing Loan Modal */}
            <Dialog open={showOngoingLoanModal} onOpenChange={() => {}}>
                <DialogContent
                    className="max-w-2xl max-h-[80vh] overflow-y-auto"
                    onInteractOutside={(e) => e.preventDefault()}
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-amber-600" />
                            Client Has Ongoing Loan(s)
                        </DialogTitle>
                        <DialogDescription>
                            This client already has active loan(s). Please review the details before proceeding.
                        </DialogDescription>
                    </DialogHeader>

                    {ongoingLoans.length > 0 && (
                        <div className="space-y-3 my-6">
                            {ongoingLoans.map((loan) => {
                                const totalOutstanding = loan.outstandingPrincipal + loan.outstandingInterest;

                                return (
                                    <div key={loan.id} className={cn(
                                        "border-l-4 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 p-4 shadow-sm",
                                        (loan.arrear ?? 0) > 0 ? "border-l-red-600" : "border-l-amber-600"
                                    )}>
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h4 className="font-bold text-amber-900 dark:text-amber-100">{loan.loanNumber}</h4>
                                                    <Badge className="bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100 text-xs">{loan.status}</Badge>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 text-sm">
                                                    <div>
                                                        <span className="text-sidebar-accent dark:text-slate-400">Product:</span>
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">{loan.productName}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-sidebar-accent dark:text-slate-400">Disbursed:</span>
                                                        <p className="font-semibold text-sidebar-accent dark:text-slate-100">{loan.disbursementDate}</p>
                                                    </div>
                                                    {loan.indexNo && (
                                                        <div>
                                                            <span className="text-sidebar-accent dark:text-slate-400">Index No.:</span>
                                                            <p className="font-semibold text-sidebar-accent dark:text-slate-100">{loan.indexNo}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="mb-3">
                                                    <span className="text-xs text-sidebar-accent dark:text-slate-400">Outstanding</span>
                                                    <p className="font-bold text-lg text-amber-700 dark:text-amber-300">
                                                        ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(totalOutstanding)}
                                                    </p>
                                                </div>
                                                <div className="space-y-1 text-xs text-sidebar-accent dark:text-slate-400">
                                                    <p>Principal: ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.outstandingPrincipal)}</p>
                                                    <p>Interest: ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.outstandingInterest)}</p>
                                                </div>
                                                {(loan.arrear ?? 0) > 0 && (
                                                    <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800">
                                                        <p className="text-xs font-semibold text-red-600 dark:text-red-400">Arrear</p>
                                                        <p className="font-bold text-base text-red-600 dark:text-red-400">
                                                            ₹{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(loan.arrear)}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            onClick={() => {
                                setShowOngoingLoanModal(false);
                                setOngoingLoanAcknowledged(true);
                            }}
                            className="bg-teal-600 hover:bg-teal-700"
                        >
                            OK
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Main Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-600" />

                <div className="bg-gradient-to-r from-slate-50 via-teal-50/60 to-cyan-50/60 px-4 sm:px-4 sm:px-8 py-4 sm:py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-teal-600 to-cyan-600 shadow-lg shadow-teal-500/30">
                            <FileText className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white">
                                Renewal Loan Application
                            </h1>
                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                Create a renewal loan application for existing members/clients
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-4 sm:px-4 sm:px-8 py-4 sm:py-6">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                            <div className="space-y-6">
                                <div className="flex items-center gap-2">
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-sidebar-accent" />
                                    <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        Basic Information
                                    </h2>
                                    <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-sidebar-accent" />
                                </div>

                                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    <div className="space-y-2">
                                        <Label className="flex min-h-7 items-center gap-2">
                                            <Building2 className="h-4 w-4" />
                                            Branch <span className="text-red-500">*</span>
                                        </Label>
                                        <Select
                                            onValueChange={handleBranchChange}
                                            value={selectedBranchId}
                                            disabled={isBranchLocked || isLoadingData}
                                        >
                                            <SelectTrigger className="h-11">
                                                <SelectValue placeholder="-- SELECT BRANCH --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {branches.map((branch) => (
                                                    <SelectItem key={branch.id} value={branch.id}>
                                                        {branch.code} - {branch.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="centerId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex min-h-7 items-center gap-2">
                                                    <Building2 className="h-4 w-4" />
                                                    Center <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={(value) => {
                                                        field.onChange(value);
                                                        setSelectedCenterId(value);
                                                        form.setValue('clientId', '');
                                                        form.setValue('loanProductTypeId', '');
                                                        form.setValue('loanProductId', '');
                                                        form.setValue('loanPurposeTypeId', '');
                                                        form.setValue('loanPurposeId', '');
                                                        setSelectedClientId('');
                                                        setSelectedProductTypeId('');
                                                        setSelectedProductId('');
                                                        setSelectedFrequency('weekly');
                                                        setSelectedPurposeTypeId('');
                                                        setEligibleClients([]);
                                                        setUnindexedLoans([]);
                                                        setLoanProducts([]);
                                                        setFilteredLoanProducts([]);
                                                        setFilteredLoanPurposes([]);
                                                        setEligibleClientCount(0);
                                                    }}
                                                    value={field.value}
                                                    disabled={!selectedBranchId && !isFdo}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={!selectedBranchId && !isFdo ? "Select branch first" : "-- SELECT CENTER --"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {centers.map((center) => (
                                                            <SelectItem key={center.id} value={center.id}>
                                                                {center.code} - {center.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="clientId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex min-h-7 items-center justify-between gap-2">
                                                    <FormLabel className="flex items-center gap-2">
                                                        <User className="h-4 w-4" />
                                                        Member / Client <span className="text-red-500">*</span>
                                                    </FormLabel>
                                                    {selectedClientId && (
                                                        <HighmarkHistoryButton
                                                            clientId={selectedClientId}
                                                            clientName={
                                                                eligibleClients.find((c) => c.id === selectedClientId)
                                                                    ? `${eligibleClients.find((c) => c.id === selectedClientId)!.firstName} ${eligibleClients.find((c) => c.id === selectedClientId)!.lastName}`.trim()
                                                                    : ''
                                                            }
                                                            centerName={centers.find((c) => c.id === selectedCenterId)?.name}
                                                            variant="outline"
                                                            className="h-7 text-xs"
                                                        />
                                                    )}
                                                </div>
                                                <Select
                                                    onValueChange={(value) => {
                                                        field.onChange(value);
                                                        setSelectedClientId(value);
                                                        setOngoingLoans([]);
                                                        setOngoingLoanAcknowledged(false);
                                                        setShowOngoingLoanModal(false);
                                                        form.setValue('coApplicantId', '');
                                                        setEligibleCoApplicants([]);
                                                        if (value) {
                                                            checkOngoingLoans(value);
                                                            fetchEligibleCoApplicants(value);
                                                        }
                                                    }}
                                                    value={field.value}
                                                    disabled={!selectedCenterId || isLoadingData}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={!selectedCenterId ? "Select center first" : "-- SELECT --"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {eligibleClients.length === 0 && selectedCenterId && !isLoadingData ? (
                                                            <div className="px-2 py-4 text-sm text-center text-amber-600">
                                                                No eligible members/clients found
                                                            </div>
                                                        ) : (
                                                            eligibleClients.map((client) => {
                                                                const displayName = client.firstName && client.lastName
                                                                    ? `${client.firstName} ${client.lastName}`
                                                                    : client.clientId;

                                                                return (
                                                                    <SelectItem key={client.id} value={client.id}>
                                                                        <span className="flex w-full min-w-0 items-center gap-1.5">
                                                                            <span className="truncate">{client.clientId} - {displayName}</span>
                                                                            {!client.hasGroup && (
                                                                                <span className="shrink-0 whitespace-nowrap text-amber-600 text-xs">⚠ No group</span>
                                                                            )}
                                                                            {client.isDefaultMember && (
                                                                                <span className="shrink-0 whitespace-nowrap rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/50 dark:text-red-400">
                                                                                    🚫 Default
                                                                                </span>
                                                                            )}
                                                                        </span>
                                                                    </SelectItem>
                                                                );
                                                            })
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                                {selectedCenterId && eligibleClients.length === 0 && !isLoadingData && (
                                                    <FormDescription className="text-xs text-amber-600 flex items-center gap-1 mt-1">
                                                        <AlertCircle className="h-3 w-3" />
                                                        No members eligible for renewal found. They must be verified, have at least one prior loan, and not have any active loan without index.
                                                    </FormDescription>
                                                )}
                                                {selectedCenterId && eligibleClientCount > 0 && (
                                                    <FormDescription className="text-xs text-green-600 mt-1">
                                                        {eligibleClientCount} member{eligibleClientCount > 1 ? 's' : ''} eligible for renewal
                                                    </FormDescription>
                                                )}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="coApplicantId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <UserPlus className="h-4 w-4" />
                                                    Co-Applicant <span className="text-xs text-slate-400 font-normal">(Optional)</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={!selectedClientId || isLoadingCoApplicants}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={
                                                                !selectedClientId
                                                                    ? 'Select member/client first'
                                                                    : isLoadingCoApplicants
                                                                        ? 'Loading co-applicants…'
                                                                        : eligibleCoApplicants.length === 0
                                                                            ? 'No approved co-applicants'
                                                                            : '-- SELECT CO-APPLICANT --'
                                                            } />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {eligibleCoApplicants.map((co) => (
                                                            <SelectItem key={co.id} value={co.id}>
                                                                {co.name} — {co.relationWithClient}
                                                                {co.isPrimary && <span className="ml-2 text-amber-600 text-xs">★ Primary</span>}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                {selectedClientId && !isLoadingCoApplicants && eligibleCoApplicants.length === 0 && (
                                                    <FormDescription className="text-xs text-slate-500 mt-1">
                                                        This member/client has no approved co-applicants yet — the loan can still be created without one.
                                                    </FormDescription>
                                                )}
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* NEW: Loan Product Type Dropdown */}
                                    <FormField
                                        control={form.control}
                                        name="loanProductTypeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <Layers className="h-4 w-4" />
                                                    Product Type <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={handleProductTypeChange}
                                                    value={field.value}
                                                    disabled={!selectedCenterId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={!selectedCenterId ? "Select center first" : "-- SELECT PRODUCT TYPE --"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {loanProductTypes.map((type) => (
                                                            <SelectItem key={type.id} value={type.id}>
                                                                {type.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="frequency"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <Calendar className="h-4 w-4" />
                                                    Frequency <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={handleFrequencyChange}
                                                    value={field.value}
                                                    disabled={!selectedCenterId || !selectedProductTypeId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={
                                                                !selectedCenterId 
                                                                    ? "Select center first" 
                                                                    : !selectedProductTypeId
                                                                        ? "Select product type first"
                                                                        : "-- SELECT FREQUENCY --"
                                                            } />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {frequencyOptions.map((option) => (
                                                            <SelectItem key={option.value} value={option.value}>
                                                                {option.label}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="loanProductId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <FileText className="h-4 w-4" />
                                                    Loan Product <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={handleProductChange}
                                                    value={field.value}
                                                    disabled={!selectedCenterId || !selectedProductTypeId || !selectedFrequency}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={
                                                                !selectedCenterId 
                                                                    ? "Select center first" 
                                                                    : !selectedProductTypeId
                                                                        ? "Select product type first"
                                                                        : !selectedFrequency 
                                                                            ? "Select frequency first" 
                                                                            : "-- SELECT PRODUCT --"
                                                            } />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {filteredLoanProducts.length === 0 && selectedFrequency && selectedProductTypeId && (
                                                            <div className="px-2 py-4 text-sm text-center text-amber-600">
                                                                No products available for selected type and frequency
                                                            </div>
                                                        )}
                                                        {filteredLoanProducts.map((product) => (
                                                            <SelectItem key={product.id} value={product.id}>
                                                                {product.productName} (₹{product.loanAmount.toLocaleString()})
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Purpose Type Dropdown */}
                                    <FormField
                                        control={form.control}
                                        name="loanPurposeTypeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <Layers className="h-4 w-4" />
                                                    Purpose Type <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={handlePurposeTypeChange}
                                                    value={field.value}
                                                    disabled={!selectedCenterId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={!selectedCenterId ? "Select center first" : "-- SELECT PURPOSE TYPE --"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {purposeTypes.map((type) => (
                                                            <SelectItem key={type.id} value={type.id}>
                                                                {type.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* Loan Purpose Dropdown (based on selected type) */}
                                    <FormField
                                        control={form.control}
                                        name="loanPurposeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <Target className="h-4 w-4" />
                                                    Loan Purpose <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <Select
                                                    onValueChange={field.onChange}
                                                    value={field.value}
                                                    disabled={!selectedPurposeTypeId}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={!selectedPurposeTypeId ? "Select purpose type first" : "-- SELECT PURPOSE --"} />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {filteredLoanPurposes.length === 0 && selectedPurposeTypeId && (
                                                            <div className="px-2 py-4 text-sm text-center text-amber-600">
                                                                No purposes available for selected type
                                                            </div>
                                                        )}
                                                        {filteredLoanPurposes.map((purpose) => (
                                                            <SelectItem key={purpose.id} value={purpose.id}>
                                                                {purpose.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-2">
                                                    <IndianRupee className="h-4 w-4" />
                                                    Loan Amount <span className="text-red-500">*</span>
                                                </FormLabel>
                                                <FormControl>
                                                    <Input type="number" placeholder="0.00" className="h-11" {...field} readOnly={!!selectedProductId} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="interestRate"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Interest Rate (%) <span className="text-red-500">*</span></FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" placeholder="0.00" className="h-11" {...field} readOnly={!!selectedProductId} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="tenureMonths"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Tenure (Months) <span className="text-red-500">*</span></FormLabel>
                                                <FormControl>
                                                    <Input type="number" placeholder="12" className="h-11" {...field} readOnly={!!selectedProductId} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="documentCharges"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Document Charges ({LOAN_FEES.DOCUMENT_CHARGES_PERCENT}%)</FormLabel>
                                                <FormControl>
                                                    <Input {...field} disabled className="h-11 bg-brand-green-tint" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="insuranceFee"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Insurance Fee (from product)</FormLabel>
                                                <FormControl>
                                                    <Input {...field} disabled className="h-11 bg-brand-green-tint" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            {/* Product Details Section */}
                            {selectedProduct && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                                        <h2 className="text-sm font-semibold uppercase tracking-wider">Product Details</h2>
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                                    </div>
                                    <Card className="border-teal-200 bg-teal-50/50">
                                        <CardContent className="pt-6">
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                                <div>
                                                    <span className="text-xs font-medium text-sidebar-accent">Product Name</span>
                                                    <p className="text-sm font-semibold">{selectedProduct.productName}</p>
                                                </div>
                                                <div>
                                                    <span className="text-xs font-medium text-sidebar-accent">Loan Amount</span>
                                                    <p className="text-sm font-semibold">₹{selectedProduct.loanAmount.toLocaleString()}</p>
                                                </div>
                                                <div>
                                                    <span className="text-xs font-medium text-sidebar-accent">Total Dues</span>
                                                    <p className="text-sm font-semibold">{selectedProduct.totalDues} {selectedFrequency}</p>
                                                </div>
                                                <div>
                                                    <span className="text-xs font-medium text-sidebar-accent">Total Interest</span>
                                                    <p className="text-sm font-semibold">₹{selectedProduct.interest.toLocaleString()}</p>
                                                </div>
                                                <div>
                                                    <span className="text-xs font-medium text-sidebar-accent">Loan Advance / Installment</span>
                                                    <p className="text-sm font-semibold">₹{(selectedProduct.advanceSavingsAmount ?? 0).toLocaleString()}</p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}

                            {/* Unindexed Loans Section */}
                            {selectedCenterId && unindexedLoans.length > 0 && (
                                <div className="space-y-4">
                                    <div className="flex items-center gap-2">
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                                        <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-600">
                                            Unindexed Loans ({searchedRows.length})
                                        </h2>
                                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-300 to-transparent" />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-4">
                                        <TableSearchInput
                                            value={tableSearchQuery}
                                            onChange={setTableSearchQuery}
                                            placeholder="Search unindexed loans..."
                                            className="ml-auto"
                                        />
                                    </div>

                                    {isLoadingLoans ? (
                                        <PageLoader label="Loading loans..." fullScreen={false} />
                                    ) : (
                                        <div className="overflow-x-auto rounded-lg border">
                                            <Table>
                                                <TableHeader className="bg-brand-green-darker dark:bg-sidebar-accent">
                                                    <TableRow className="hover:bg-brand-green-darker border-none">
                                                        <TableHead className="text-white">Loan Number</TableHead>
                                                        <TableHead className="text-white">Client Info</TableHead>
                                                        <TableHead className="text-white">Amount</TableHead>
                                                        <TableHead className="text-white">Interest Rate</TableHead>
                                                        <TableHead className="text-white">Tenure</TableHead>
                                                        <TableHead className="text-white">Status</TableHead>
                                                        <TableHead className="text-white text-center">Action</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {searchedRows.map((loan) => (
                                                        <TableRow
                                                            key={loan.id}
                                                            className="even:bg-green-50 dark:even:bg-brand-green-darker/50"
                                                        >
                                                            <TableCell className="font-medium">{loan.loanNumber}</TableCell>
                                                            <TableCell>
                                                                <div className="flex flex-col">
                                                                    <span className="font-bold text-foreground dark:text-slate-100">{loan.clientName}</span>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="font-bold text-primary">
                                                                ₹{Number(loan.amount).toLocaleString()}
                                                            </TableCell>
                                                            <TableCell>{Number(loan.interestRate).toFixed(2)}%</TableCell>
                                                            <TableCell>{loan.tenureMonths} months</TableCell>
                                                            <TableCell>
                                                                <Badge variant={loan.disbursementStatus === 'APPROVED_LEVEL1' ? 'default' : 'secondary'}>
                                                                    {loan.disbursementStatus === 'APPROVED_LEVEL1' ? 'Approved' : 'Pending'}
                                                                </Badge>
                                                            </TableCell>
                                                            <TableCell className="text-center">
                                                                {canDeleteLoan && (
                                                                    <TooltipProvider>
                                                                        <Tooltip>
                                                                            <TooltipTrigger asChild>
                                                                                <Button
                                                                                    type="button"
                                                                                    size="sm"
                                                                                    variant="outline"
                                                                                    onClick={() => {
                                                                                        setLoanToDelete(loan);
                                                                                        setShowDeleteConfirm(true);
                                                                                    }}
                                                                                    className="h-8 w-8 p-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                                                                                >
                                                                                    <Trash2 className="h-4 w-4" />
                                                                                </Button>
                                                                            </TooltipTrigger>
                                                                            <TooltipContent>
                                                                                <p>Delete this unindexed loan</p>
                                                                            </TooltipContent>
                                                                        </Tooltip>
                                                                    </TooltipProvider>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex items-center gap-3 pt-6 border-t">
                                {canCreateLoan && (
                                    <Button
                                        type="submit"
                                        disabled={isLoading || !selectedClientId || !selectedProductId || !selectedFrequency || !selectedProductTypeId || !selectedPurposeTypeId || !form.watch('loanPurposeId') || (ongoingLoans.length > 0 && !ongoingLoanAcknowledged)}
                                        className="h-11 px-8 text-sm font-semibold bg-teal-600 hover:bg-teal-700"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Saving...
                                            </>
                                        ) : (
                                            <>
                                                <Save className="mr-2 h-4 w-4" />
                                                Save Renewal Application
                                            </>
                                        )}
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleReset}
                                    disabled={isLoading}
                                    className="h-11 px-6 text-sm font-semibold"
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Reset
                                </Button>
                            </div>
                        </form>
                    </Form>
                </div>
            </Card>
        </div>
    );
}
