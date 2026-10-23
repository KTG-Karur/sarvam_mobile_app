'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tokenStorage } from '@/app/lib/token-storage';
import { downloadStorageFile } from '@/app/lib/storage-url-client';
import { StorageImage, StorageIframe } from '@/components/storage/StorageMedia';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Save,
    RotateCcw,
    Loader2,
    UserPlus,
    Edit3,
    User,
    Calendar,
    Phone,
    CreditCard,
    Users,
    Building2,
    ChevronRight,
    CheckCircle2,
    AlertCircle,
    Search,
    Briefcase,
    Upload,
    FileText,
    Eye,
    Download,
    Trash2,
    Camera,
    Clipboard,
    X,
    Image as ImageIcon,
} from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { compressImage, type CompressionResult } from '@/app/lib/image-compress';

function compressionNoteFor(result: CompressionResult): string {
    return result.wasCompressed
        ? `Compressed ${result.originalSizeLabel} → ${result.compressedSizeLabel} (saved ${result.reductionPercent}%)`
        : '';
}
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import {
    CO_APPLICANT_KYC_DOCUMENT_TYPES,
    type SupportedKycDocumentType,
    appendKycUploadOwnerAndCategory,
    getKycDocumentTypeLabel,
} from '@/components/client/kyc-document-types';
import { validateAadhaar, validatePAN, validateVoterID } from '@/app/lib/validations/field-validations';
import { type IdentityField } from '@/app/lib/identity-normalization';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDate } from '@/app/lib/date-format';

const GENDER_OPTIONS = [
    { value: 'MALE', label: 'Male' },
    { value: 'FEMALE', label: 'Female' },
    { value: 'OTHER', label: 'Other' },
];

const RELATION_OPTIONS = [
    { value: 'SPOUSE', label: 'Spouse' },
    { value: 'FATHER', label: 'Father' },
    { value: 'MOTHER', label: 'Mother' },
    { value: 'SON', label: 'Son' },
    { value: 'DAUGHTER', label: 'Daughter' },
    { value: 'BROTHER', label: 'Brother' },
    { value: 'SISTER', label: 'Sister' },
    { value: 'OTHER', label: 'Other' },
];

const FREQUENCY_OPTIONS = [
    { value: 'weekly', label: 'Weekly' },
];

const schema = z.object({
    name: z.string().trim().optional().default(''),
    gender: z.string().optional().default(''),
    dateOfBirth: z.string().optional().default(''),
    age: z.string().optional().default(''),
    economicActivityTypeId: z.string().optional().default(''),
    economicActivityId: z.string().optional().default(''),
    relationWithClient: z.string().optional().default(''),
    mobileNumber: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[0-9]{10}$/.test(val), 'Mobile number must be 10 digits'),
    voterIdNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validateVoterID(val, false).isValid, 'Voter ID format is invalid'),
    otherIdNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validateAadhaar(val, false).isValid, 'Aadhaar must be a valid 12-digit number'),
    pancardNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validatePAN(val, false).isValid, 'PAN card must be in format: ABCDE1234F'),
    requestedLoanProductTypeId: z.string().optional().default(''),
    requestedLoanFrequency: z.string().optional().default(''),
    requestedLoanProductId: z.string().optional().default(''),
});

type FormValues = z.infer<typeof schema>;

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface Client {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    centerId?: string | null;
    createdAt: string;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
}

interface CoApplicant {
    id: string;
    clientId: string;
    name: string;
    gender: string;
    dateOfBirth: string;
    age: number;
    economicActivityTypeId: string | null;
    economicActivityId: string | null;
    relationWithClient: string;
    mobileNumber: string;
    voterIdNo: string | null;
    otherIdNo: string | null;
    pancardNo: string | null;
}

interface CoApplicantDocument {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    fileSize: number | null;
    mimeType: string | null;
    uploadedAt: string;
}

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

interface PreselectedClientInfo {
    id: string;
    clientId: string;
    firstName?: string;
    lastName?: string;
    centerId?: string | null;
    createdAt?: string;
    spouseName?: string;
    spouseMobileNumber?: string;
    spouseDob?: string;
    spouseGender?: string;
    spouseEconomicActivityTypeId?: string;
    spouseEconomicActivityId?: string;
    branchId?: string;
    requestedLoanProductTypeId?: string;
    requestedLoanFrequency?: string;
    requestedLoanProductId?: string;
    /** Has at least one Loan record (any status) — false means still a Member, not yet a Client */
    hasLoan?: boolean;
}

function calculateAge(dob: string): number {
    if (!dob) return 0;
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return Math.max(0, age);
}

function formatDateForDisplay(dateStr: string): string {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '—';
    return toDisplayDate(date);
}

export function CoApplicantForm({ preselectedClient, permissionPage, uploadedDocumentTypes, onDocumentUploaded, hideKycSection = false, hideLoanProductSection = false, onSuccess, onFormChange }: {
    preselectedClient?: PreselectedClientInfo;
    permissionPage?: string;
    uploadedDocumentTypes?: string[];
    onDocumentUploaded?: (clientId: string) => void;
    hideKycSection?: boolean;
    /**
     * When true, this form no longer owns the Product Type/Frequency/Loan
     * Product fields — Client Update's dedicated Loan Details tab does
     * instead. Only the standalone /dashboard/client/co-applicant page (which
     * doesn't pass this prop) still shows and saves them here.
     */
    hideLoanProductSection?: boolean;
    onSuccess?: () => void;
    onFormChange?: (partialClientData: Record<string, any>) => void;
} = {}) {
    const { canPage } = usePermission();
    const canCreateClient = canPage(permissionPage ?? '/dashboard/client/co-applicant', 'add');
    const canEditClient   = canPage(permissionPage ?? '/dashboard/client/co-applicant', 'edit');
    const { toast } = useToast();
    const documentInputRef = useRef<HTMLInputElement>(null);
    const { isRequired: configIsRequired } = useEnrollmentValidation();
    const userRole = useMemo(() => tokenStorage.getUser()?.role, []);
    const isAdmin = userRole === 'ADMIN' || userRole === 'ADMIN_NON_HO_BRANCH_SWITCH';

    const isControlled = !!preselectedClient;
    const prevClientIdRef = useRef<string>('');
    const pendingProductIdRef = useRef<string>('');

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranch, setSelectedBranch] = useState('');
    const [loadingBranches, setLoadingBranches] = useState(false);

    const [clients, setClients] = useState<Client[]>([]);
    const [selectedClientId, setSelectedClientId] = useState(preselectedClient?.id ?? '');
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [existingCoApplicant, setExistingCoApplicant] = useState<CoApplicant | null>(null);
    const [isEditMode, setIsEditMode] = useState(false);

    const [loadingClients, setLoadingClients] = useState(false);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [loadingCoApplicant, setLoadingCoApplicant] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [documents, setDocuments] = useState<CoApplicantDocument[]>([]);
    const [loadingDocuments, setLoadingDocuments] = useState(false);
    const [selectedDocumentType, setSelectedDocumentType] = useState<SupportedKycDocumentType | ''>('');
    const [selectedDocumentFile, setSelectedDocumentFile] = useState<File | null>(null);
    const [documentFilePreview, setDocumentFilePreview] = useState<string | null>(null);
    const [documentCompressionNote, setDocumentCompressionNote] = useState('');
    const [isUploadingDocument, setIsUploadingDocument] = useState(false);
    const [documentToView, setDocumentToView] = useState<CoApplicantDocument | null>(null);
    const [documentToDelete, setDocumentToDelete] = useState<CoApplicantDocument | null>(null);
    const [isDeletingDocument, setIsDeletingDocument] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [photoCameraOpen, setPhotoCameraOpen] = useState(false);
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const [photoCompressionNote, setPhotoCompressionNote] = useState('');
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const photoFileInputRef = useRef<HTMLInputElement>(null);

    // Economic Activity states
    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivityTypes, setIsLoadingActivityTypes] = useState(false);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);

    // Loan product states
    const [loanProductTypes, setLoanProductTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [allLoanProducts, setAllLoanProducts] = useState<Array<{ id: string; name: string; loanAmount?: number; productTypeId?: string; frequency?: string }>>([]);
    const [isLoadingProductTypes, setIsLoadingProductTypes] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: {
            name: '',
            gender: '',
            dateOfBirth: '',
            age: '',
            economicActivityTypeId: '',
            economicActivityId: '',
            relationWithClient: '',
            mobileNumber: '',
            voterIdNo: '',
            otherIdNo: '',
            pancardNo: '',
            requestedLoanProductTypeId: '',
            requestedLoanFrequency: 'weekly',
            requestedLoanProductId: '',
        },
    });

    const watchDOB = form.watch('dateOfBirth');
    const watchProductType = form.watch('requestedLoanProductTypeId');
    const watchFrequency = form.watch('requestedLoanFrequency');
    const watchProductId = form.watch('requestedLoanProductId');

    /**
     * On-blur uniqueness check against /clients/check-identity-uniqueness.
     * selectedClientId is the parent Client's cuid (the internal UUID in
     * controlled mode, per the comment near the PATCH call below) — this is
     * exactly the family key the check endpoint expects, both to exclude this
     * co-applicant's own family and to compare against the parent client's
     * current values for the same-family cross-check.
     */
    const checkFieldUniqueness = async (
        field: IdentityField,
        formFieldName: 'mobileNumber' | 'voterIdNo' | 'otherIdNo' | 'pancardNo',
        value: string
    ) => {
        if (!value || !selectedClientId) return;
        try {
            const res = await apiClient.post<{ isDuplicate: boolean; message: string | null }>(
                '/clients/check-identity-uniqueness',
                { field, value, side: 'COAPPLICANT', familyClientId: selectedClientId }
            );
            if (res.success && res.data?.isDuplicate) {
                form.setError(formFieldName, { type: 'manual', message: res.data.message || 'Already exists.' });
            }
        } catch {
            // Non-blocking UX enhancement — submit-time validation is authoritative.
        }
    };

    useEffect(() => {
        const { unsubscribe } = form.watch((values) => {
            if (!onFormChange) return;
            onFormChange({
                requestedLoanProductTypeId: values.requestedLoanProductTypeId ?? '',
                requestedLoanFrequency:     values.requestedLoanFrequency ?? '',
                requestedLoanProductId:     values.requestedLoanProductId ?? '',
                coApplicant: {
                    name:                   values.name ?? '',
                    gender:                 values.gender ?? '',
                    dateOfBirth:            values.dateOfBirth ?? '',
                    age:                    values.age ?? '',
                    economicActivityTypeId: values.economicActivityTypeId ?? '',
                    economicActivityId:     values.economicActivityId ?? '',
                    relationWithClient:     values.relationWithClient ?? '',
                    mobileNumber:           values.mobileNumber ?? '',
                    voterIdNo:              values.voterIdNo ?? '',
                    otherIdNo:              values.otherIdNo ?? '',
                    pancardNo:              values.pancardNo ?? '',
                },
            });
        });
        return () => unsubscribe();
    }, [form, onFormChange]);

    const filteredLoanProducts = useMemo(() => {
        let products = allLoanProducts;
        if (watchProductType) {
            products = products.filter((p) => p.productTypeId === watchProductType || (p as any).loanProductTypeId === watchProductType);
        }
        if (watchFrequency) {
            products = products.filter((p) => (p.frequency || '').toLowerCase() === watchFrequency.toLowerCase());
        }
        return products;
    }, [watchProductType, watchFrequency, allLoanProducts]);

    const selectedProductAmount = useMemo(() => {
        if (!watchProductId) return null;
        const p = filteredLoanProducts.find((pr) => pr.id === watchProductId);
        return p?.loanAmount ?? null;
    }, [watchProductId, filteredLoanProducts]);

    // Define fetch functions with useCallback before useEffect
    const fetchEconomicActivityTypes = useCallback(async () => {
        setIsLoadingActivityTypes(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string }>>('/economic-activity-types');
            if (res.success && res.data) {
                setEconomicActivityTypes(res.data);
            }
        } catch (error) {
            console.error('Failed to load economic activity types:', error);
        } finally {
            setIsLoadingActivityTypes(false);
        }
    }, []);

    const fetchEconomicActivities = useCallback(async (typeId: string) => {
        if (!typeId) {
            setEconomicActivities([]);
            return;
        }
        setIsLoadingActivities(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string }>>(`/economic-activities?activityTypeId=${typeId}`);
            if (res.success && res.data) {
                setEconomicActivities(res.data);
            } else {
                setEconomicActivities([]);
            }
        } catch (error) {
            console.error('Failed to load economic activities:', error);
            setEconomicActivities([]);
        } finally {
            setIsLoadingActivities(false);
        }
    }, []);

    const fetchLoanProductTypes = useCallback(async () => {
        setIsLoadingProductTypes(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string }>>('/loan-product-types?includeInactive=false');
            if (res.success && res.data) setLoanProductTypes(res.data);
        } catch { /* ignore */ } finally {
            setIsLoadingProductTypes(false);
        }
    }, []);

    const fetchLoanProducts = useCallback(async (branchId: string) => {
        if (!branchId) return;
        try {
            const res = await apiClient.get<any>(`/products?branchId=${branchId}`);
            if (res.success && res.data) {
                const list = Array.isArray(res.data) ? res.data : (res.data.products || []);
                setAllLoanProducts(list);
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (watchDOB) {
            form.setValue('age', calculateAge(watchDOB).toString());
        }
    }, [watchDOB, form]);

    // Explicitly set gender and relationWithClient when existing co-applicant is loaded
    useEffect(() => {
        if (existingCoApplicant && isEditMode) {
            form.setValue('gender', existingCoApplicant.gender?.toUpperCase() || '');
            form.setValue('relationWithClient', existingCoApplicant.relationWithClient?.toUpperCase() || '');
        }
    }, [existingCoApplicant, isEditMode, form]);

    // Auto-fill spouse details when Relation = Spouse
    const watchRelation = form.watch('relationWithClient');
    useEffect(() => {
        if (!preselectedClient) return;
        if (watchRelation === 'SPOUSE') {
            if (preselectedClient.spouseName) form.setValue('name', preselectedClient.spouseName);
            if (preselectedClient.spouseMobileNumber) form.setValue('mobileNumber', preselectedClient.spouseMobileNumber);
            if (preselectedClient.spouseDob) form.setValue('dateOfBirth', preselectedClient.spouseDob.split('T')[0]);
            if (preselectedClient.spouseGender) {
                const genderMap: Record<string, string> = { Male: 'MALE', Female: 'FEMALE', Other: 'OTHER' };
                form.setValue('gender', genderMap[preselectedClient.spouseGender] ?? preselectedClient.spouseGender);
            }
            if (preselectedClient.spouseEconomicActivityTypeId) {
                form.setValue('economicActivityTypeId', preselectedClient.spouseEconomicActivityTypeId);
                form.setValue('economicActivityId', '');
                void fetchEconomicActivities(preselectedClient.spouseEconomicActivityTypeId).then(() => {
                    if (preselectedClient.spouseEconomicActivityId) {
                        form.setValue('economicActivityId', preselectedClient.spouseEconomicActivityId);
                    }
                });
            }
        }
    }, [watchRelation, preselectedClient, form, fetchEconomicActivities]);

    // Fetch economic activity types + branches + loan product types on mount
    useEffect(() => {
        void fetchEconomicActivityTypes();
        void fetchLoanProductTypes();
        const loanBranchId = preselectedClient?.branchId ?? tokenStorage.getUser()?.branchId ?? '';
        if (loanBranchId) void fetchLoanProducts(loanBranchId);
        if (isAdmin) {
            setLoadingBranches(true);
            apiClient.get<Branch[]>('/branches').then((res) => {
                setBranches(Array.isArray(res.data) ? res.data : []);
            }).catch(() => setBranches([])).finally(() => setLoadingBranches(false));
        }
    }, [isAdmin, fetchEconomicActivityTypes, fetchLoanProductTypes, fetchLoanProducts]);

    // Re-apply loan product type + frequency once allLoanProducts loads; product ID set after filteredLoanProducts updates
    useEffect(() => {
        if (!isControlled || !preselectedClient || allLoanProducts.length === 0) return;
        if (preselectedClient.requestedLoanProductTypeId) {
            form.setValue('requestedLoanProductTypeId', preselectedClient.requestedLoanProductTypeId, { shouldDirty: false, shouldTouch: false });
        }
        form.setValue('requestedLoanFrequency', preselectedClient.requestedLoanFrequency?.toLowerCase() || 'weekly', { shouldDirty: false, shouldTouch: false });
        if (preselectedClient.requestedLoanProductId) {
            pendingProductIdRef.current = preselectedClient.requestedLoanProductId;
        }
    }, [allLoanProducts, isControlled, preselectedClient, form]);

    // Set requestedLoanProductId only after filteredLoanProducts contains the product
    useEffect(() => {
        if (!pendingProductIdRef.current) return;
        const exists = filteredLoanProducts.some((p) => p.id === pendingProductIdRef.current);
        if (exists) {
            form.setValue('requestedLoanProductId', pendingProductIdRef.current, { shouldDirty: false, shouldTouch: false });
            pendingProductIdRef.current = '';
        }
    }, [filteredLoanProducts, form]);

    // Debounce search
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    // Global paste event listener for Ctrl+V support (document or photo)
    useEffect(() => {
        if (hideKycSection) return;
        const onPaste = async (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const items = Array.from(e.clipboardData.items);
            const imageItem = items.find((item) => item.type.startsWith('image/'));
            if (!imageItem) return;
            const file = imageItem.getAsFile();
            if (!file) return;
            if (selectedDocumentType) {
                const result = await compressImage(file, selectedDocumentType);
                setSelectedDocumentFile(result.compressedFile);
                setDocumentFilePreview(result.previewUrl);
                setDocumentCompressionNote(compressionNoteFor(result));
            } else if (existingCoApplicant) {
                const result = await compressImage(file, 'co_applicant_photo');
                setPhotoFile(result.compressedFile);
                setPhotoPreview(result.previewUrl);
                setPhotoCompressionNote(compressionNoteFor(result));
            }
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, [selectedDocumentType, existingCoApplicant, hideKycSection]);

    // Fetch clients whenever search or branch changes
    const fetchClients = useCallback(async () => {
        if (isControlled) return;
        if (isAdmin && !selectedBranch) { setClients([]); return; }
        setLoadingClients(true);
        try {
            const params = new URLSearchParams();
            params.set('allBranch', 'true');
            params.set('includeInactive', 'false');
            params.set('pageSize', '200');
            if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
            if (isAdmin && selectedBranch) params.set('branchId', selectedBranch);
            const res = await apiClient.get<{ clients: Client[] }>(`/clients?${params.toString()}`);
            if (res.success && res.data) {
                const list = Array.isArray(res.data) ? res.data : (res.data.clients || []);
                setClients(list as Client[]);
            } else {
                setClients([]);
            }
        } catch { setClients([]); }
        finally { setLoadingClients(false); }
    }, [debouncedSearch, selectedBranch, isAdmin, isControlled]);

    useEffect(() => { void fetchClients(); }, [fetchClients]);

    // Handle preselected client in controlled mode
    useEffect(() => {
        if (isControlled && preselectedClient && preselectedClient.id !== prevClientIdRef.current) {
            prevClientIdRef.current = preselectedClient.id;
            void handleClientChange(preselectedClient.id);
        }
    }, [isControlled, preselectedClient]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetFormState = useCallback(() => {
        setExistingCoApplicant(null);
        setIsEditMode(false);
        setDocuments([]);
        setSelectedDocumentType('');
        setSelectedDocumentFile(null);
        setDocumentFilePreview(null);
        if (documentInputRef.current) {
            documentInputRef.current.value = '';
        }
        form.reset({
            name: '',
            gender: '',
            dateOfBirth: '',
            age: '',
            economicActivityTypeId: '',
            economicActivityId: '',
            relationWithClient: '',
            mobileNumber: '',
            voterIdNo: '',
            otherIdNo: '',
            pancardNo: '',
            requestedLoanProductTypeId: '',
            requestedLoanFrequency: 'weekly',
            requestedLoanProductId: '',
        });
    }, [form]);

    const fetchCoApplicantDocuments = useCallback(async (clientAccountId: string) => {
        setLoadingDocuments(true);
        try {
            const res = await apiClient.get<{ clientId: string; documents: CoApplicantDocument[] }>(
                `/clients/${clientAccountId}/kyc-documents?scope=co_applicant`,
            );
            if (!res.success || !res.data) {
                throw new Error(res.error || 'Failed to fetch co-applicant documents');
            }
            setDocuments(res.data.documents || []);
        } catch (error) {
            setDocuments([]);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to fetch co-applicant documents',
                variant: 'destructive',
            });
        } finally {
            setLoadingDocuments(false);
        }
    }, [toast]);

    const handleBranchChange = useCallback((branchId: string) => {
        setSelectedBranch(branchId);
        setSelectedClientId('');
        setSelectedClient(null);
        setSearch('');
        resetFormState();
    }, [resetFormState]);

    const handleClientChange = useCallback(async (clientId: string) => {
        setSelectedClientId(clientId);
        resetFormState();

        let client = clients.find((entry) => entry.id === clientId) || null;

        // Fallback for controlled mode when clients array is empty
        if (!client && isControlled && preselectedClient?.id === clientId) {
            client = {
                id: preselectedClient.id,
                clientId: preselectedClient.clientId,
                firstName: preselectedClient.firstName ?? '',
                lastName: preselectedClient.lastName ?? '',
                centerId: preselectedClient.centerId ?? null,
                createdAt: preselectedClient.createdAt ?? '',
                hasLoan: preselectedClient.hasLoan,
            };
        }

        setSelectedClient(client);

        if (!clientId || !client) {
            return;
        }

        setLoadingCoApplicant(true);
        try {
            const res = await apiClient.get<CoApplicant>(`/co-applicants?clientId=${clientId}`);
            if (res.success && res.data) {
                const ca = res.data;
                setExistingCoApplicant(ca);
                setIsEditMode(true);
                const savedEconomicActivityId = ca.economicActivityId || '';
                form.reset({
                    name: ca.name,
                    gender: ca.gender?.toUpperCase() || '',
                    dateOfBirth: new Date(ca.dateOfBirth).toISOString().split('T')[0],
                    age: ca.age.toString(),
                    economicActivityTypeId: ca.economicActivityTypeId || '',
                    economicActivityId: '',
                    relationWithClient: ca.relationWithClient?.toUpperCase() || '',
                    mobileNumber: ca.mobileNumber,
                    voterIdNo: ca.voterIdNo || '',
                    otherIdNo: ca.otherIdNo || '',
                    pancardNo: ca.pancardNo || '',
                    requestedLoanProductTypeId: (isControlled ? preselectedClient?.requestedLoanProductTypeId : '') || '',
                    requestedLoanFrequency: (isControlled ? preselectedClient?.requestedLoanFrequency?.toLowerCase() : '') || 'weekly',
                    requestedLoanProductId: (isControlled ? preselectedClient?.requestedLoanProductId : '') || '',
                });
                if (ca.economicActivityTypeId) {
                    await fetchEconomicActivities(ca.economicActivityTypeId);
                    if (savedEconomicActivityId) {
                        form.setValue('economicActivityId', savedEconomicActivityId, { shouldDirty: false, shouldTouch: false });
                    }
                }
                toast({ title: 'Co-applicant found', description: 'Existing co-applicant details loaded for editing.' });
            } else {
                setIsEditMode(false);
                toast({ title: 'No co-applicant', description: 'No co-applicant found. You can create one below.' });
                if (isControlled && preselectedClient) {
                    form.setValue('requestedLoanProductTypeId', preselectedClient.requestedLoanProductTypeId || '');
                    form.setValue('requestedLoanFrequency', preselectedClient.requestedLoanFrequency?.toLowerCase() || 'weekly');
                    form.setValue('requestedLoanProductId', preselectedClient.requestedLoanProductId || '');
                } else {
                    form.setValue('requestedLoanFrequency', 'weekly');
                }
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to fetch co-applicant data', variant: 'destructive' });
        } finally {
            setLoadingCoApplicant(false);
        }

        void fetchCoApplicantDocuments(client.clientId);
    }, [clients, fetchCoApplicantDocuments, form, resetFormState, toast, isControlled, preselectedClient]);

    const onSubmit = async (values: FormValues) => {
        if (!selectedClientId) return;

        // Validate required fields based on admin configuration.
        // Maps each enrollment-validation config fieldKey to the corresponding
        // FormValues key and display label for this co-applicant form.
        const configKeyMap: { [configKey: string]: { formKey: keyof FormValues; label: string } } = {
            coApplicantName: { formKey: 'name', label: 'Co-Applicant Name' },
            coApplicantGender: { formKey: 'gender', label: 'Gender' },
            coApplicantDob: { formKey: 'dateOfBirth', label: 'Date of Birth' },
            coApplicantAge: { formKey: 'age', label: 'Age' },
            coApplicantRelation: { formKey: 'relationWithClient', label: `Relation with ${getPersonLabel(!!selectedClient?.hasLoan).singular}` },
            coApplicantEconomicActivityTypeId: { formKey: 'economicActivityTypeId', label: 'Economic Activity Type' },
            coApplicantEconomicActivityId: { formKey: 'economicActivityId', label: 'Economic Activity' },
            coApplicantMobileNumber: { formKey: 'mobileNumber', label: 'Mobile Number' },
            caVoterIdNo: { formKey: 'voterIdNo', label: 'Voter ID No.' },
            caPancardNo: { formKey: 'pancardNo', label: 'PAN Card No.' },
            caOtherIdNo: { formKey: 'otherIdNo', label: 'Aadhaar ID No.' },
            ...(hideLoanProductSection ? {} : {
                requestedLoanProductTypeId: { formKey: 'requestedLoanProductTypeId' as const, label: 'Product Type' },
                requestedLoanFrequency: { formKey: 'requestedLoanFrequency' as const, label: 'Frequency' },
                requestedLoanProductId: { formKey: 'requestedLoanProductId' as const, label: 'Loan Product' },
            }),
        };

        const configErrors: string[] = [];
        Object.entries(configKeyMap).forEach(([configKey, { formKey, label }]) => {
            if (isFieldRequired(configKey) && !values[formKey]?.toString().trim()) {
                configErrors.push(label);
            }
        });

        if (configErrors.length > 0) {
            toast({
                title: `Validation Error (${configErrors.length} field${configErrors.length > 1 ? 's' : ''})`,
                description: configErrors.map((f) => `${f}: This field is required`).join(' • '),
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const payload = {
                clientId: selectedClientId,
                name: values.name,
                gender: values.gender,
                dateOfBirth: values.dateOfBirth,
                age: parseInt(values.age, 10) || calculateAge(values.dateOfBirth),
                economicActivityTypeId: values.economicActivityTypeId || null,
                economicActivityId: values.economicActivityId || null,
                relationWithClient: values.relationWithClient,
                mobileNumber: values.mobileNumber,
                voterIdNo: values.voterIdNo || null,
                otherIdNo: values.otherIdNo || null,
                pancardNo: values.pancardNo || null,
            };

            const res = isEditMode && existingCoApplicant
                ? await apiClient.put<CoApplicant>(`/co-applicants/${existingCoApplicant.id}`, payload)
                : await apiClient.post<CoApplicant>('/co-applicants', payload);

            if (res.success && res.data) {
                setExistingCoApplicant(res.data);
                setIsEditMode(true);

                // Also PATCH client loan product fields if any are set. Skipped when
                // hideLoanProductSection is true — Client Update's Loan Details tab
                // owns these writes there instead (see prop doc above).
                // selectedClientId is the internal UUID in controlled mode; use the business
                // clientId from preselectedClient so the /clients/[clientId] route can find the record.
                if (!hideLoanProductSection && (values.requestedLoanProductTypeId || values.requestedLoanFrequency || values.requestedLoanProductId)) {
                    const patchClientId = isControlled ? (preselectedClient?.clientId ?? selectedClientId) : selectedClientId;
                    await apiClient.patch(`/clients/${patchClientId}`, {
                        requestedLoanProductTypeId: values.requestedLoanProductTypeId || null,
                        requestedLoanFrequency: values.requestedLoanFrequency || null,
                        requestedLoanProductId: values.requestedLoanProductId || null,
                    });
                }

                toast({
                    title: isEditMode ? 'Co-applicant updated!' : 'Co-applicant created!',
                    description: `Successfully ${isEditMode ? 'updated' : 'saved'} co-applicant details for ${selectedClient?.firstName} ${selectedClient?.lastName}.`,
                });
                onSuccess?.();
            } else {
                toast({ title: 'Error', description: res.error || 'Operation failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'An unexpected error occurred', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        if (isEditMode && existingCoApplicant) {
            form.reset({
                name: existingCoApplicant.name,
                gender: existingCoApplicant.gender,
                dateOfBirth: new Date(existingCoApplicant.dateOfBirth).toISOString().split('T')[0],
                age: existingCoApplicant.age.toString(),
                economicActivityTypeId: existingCoApplicant.economicActivityTypeId || '',
                economicActivityId: existingCoApplicant.economicActivityId || '',
                relationWithClient: existingCoApplicant.relationWithClient?.toUpperCase() || '',
                mobileNumber: existingCoApplicant.mobileNumber,
                voterIdNo: existingCoApplicant.voterIdNo || '',
                otherIdNo: existingCoApplicant.otherIdNo || '',
                pancardNo: existingCoApplicant.pancardNo || '',
                requestedLoanProductTypeId: (isControlled ? preselectedClient?.requestedLoanProductTypeId : '') || '',
                requestedLoanFrequency: (isControlled ? preselectedClient?.requestedLoanFrequency?.toLowerCase() : '') || 'weekly',
                requestedLoanProductId: (isControlled ? preselectedClient?.requestedLoanProductId : '') || '',
            });
            return;
        }

        form.reset({
            name: '',
            gender: '',
            dateOfBirth: '',
            age: '',
            economicActivityTypeId: '',
            economicActivityId: '',
            relationWithClient: '',
            mobileNumber: '',
            voterIdNo: '',
            otherIdNo: '',
            pancardNo: '',
            requestedLoanProductTypeId: '',
            requestedLoanFrequency: 'weekly',
            requestedLoanProductId: '',
        });
    };

    const handleDocumentFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            setSelectedDocumentFile(null);
            setDocumentFilePreview(null);
            return;
        }

        if (!selectedDocumentType) {
            toast({
                title: 'Document type required',
                description: 'Select a co-applicant document type before choosing a file.',
                variant: 'destructive',
            });
            return;
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
            toast({
                title: 'File too large',
                description: 'Please select a file smaller than 5MB.',
                variant: 'destructive',
            });
            return;
        }

        const config = CO_APPLICANT_KYC_DOCUMENT_TYPES.find((type) => type.value === selectedDocumentType);
        const allowedTypes = config?.accept.split(',') || ['image/jpeg', 'image/jpg', 'image/png'];
        if (!allowedTypes.includes(file.type)) {
            toast({
                title: 'Invalid file type',
                description: 'Selected file type is not supported for this document.',
                variant: 'destructive',
            });
            return;
        }

        if (file.type.startsWith('image/')) {
            const result = await compressImage(file, selectedDocumentType || 'other');
            setSelectedDocumentFile(result.compressedFile);
            setDocumentFilePreview(result.previewUrl);
            setDocumentCompressionNote(compressionNoteFor(result));
        } else {
            setSelectedDocumentFile(file);
            setDocumentCompressionNote('');
            const reader = new FileReader();
            reader.onloadend = () => setDocumentFilePreview(reader.result as string);
            reader.readAsDataURL(file);
        }
    };

    const handleCameraCapture = async (file: File) => {
        const result = await compressImage(file, selectedDocumentType || 'other');
        setSelectedDocumentFile(result.compressedFile);
        setDocumentFilePreview(result.previewUrl);
        setDocumentCompressionNote(compressionNoteFor(result));
    };

    const handlePhotoCapture = async (file: File) => {
        const result = await compressImage(file, 'co_applicant_photo');
        setPhotoFile(result.compressedFile);
        setPhotoPreview(result.previewUrl);
        setPhotoCompressionNote(compressionNoteFor(result));
        setPhotoCameraOpen(false);
    };

    const handleDocumentPasteFromClipboard = async () => {
        if (!selectedDocumentType) {
            toast({
                title: 'Document type required',
                description: 'Select a co-applicant document type before pasting.',
                variant: 'destructive',
            });
            return;
        }
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((t) => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `pasted_doc_${Date.now()}.png`, { type: imageType });
                    const result = await compressImage(file, selectedDocumentType || 'other');
                    setSelectedDocumentFile(result.compressedFile);
                    setDocumentFilePreview(result.previewUrl);
                    setDocumentCompressionNote(compressionNoteFor(result));
                    return;
                }
            }
            toast({
                title: 'No image found',
                description: 'Clipboard does not contain an image. Copy an image first.',
                variant: 'destructive',
            });
        } catch {
            toast({
                title: 'Paste failed',
                description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.',
                variant: 'destructive',
            });
        }
    };

    const handlePhotoPasteFromClipboard = async () => {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                const imageType = item.types.find((t) => t.startsWith('image/'));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const file = new File([blob], `pasted_photo_${Date.now()}.png`, { type: imageType });
                    const result = await compressImage(file, 'co_applicant_photo');
                    setPhotoFile(result.compressedFile);
                    setPhotoPreview(result.previewUrl);
                    setPhotoCompressionNote(compressionNoteFor(result));
                    return;
                }
            }
            toast({
                title: 'No image found',
                description: 'Clipboard does not contain an image. Copy an image first.',
                variant: 'destructive',
            });
        } catch {
            toast({
                title: 'Paste failed',
                description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.',
                variant: 'destructive',
            });
        }
    };

    const handleDocumentFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (!file || !documentInputRef.current) {
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        documentInputRef.current.files = dataTransfer.files;
        void handleDocumentFileChange({ target: documentInputRef.current } as React.ChangeEvent<HTMLInputElement>);
    };

    const handlePhotoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) { setPhotoFile(null); setPhotoPreview(null); return; }
        if (file.size > MAX_FILE_SIZE_BYTES) {
            toast({ title: 'File too large', description: 'Select a file smaller than 5MB.', variant: 'destructive' });
            return;
        }
        const result = await compressImage(file, 'co_applicant_photo');
        setPhotoFile(result.compressedFile);
        setPhotoPreview(result.previewUrl);
        setPhotoCompressionNote(compressionNoteFor(result));
    };

    const handlePhotoUpload = async () => {
        if (!selectedClient?.clientId || !existingCoApplicant || !photoFile) return;
        setIsUploadingPhoto(true);
        try {
            const body = new FormData();
            body.append('clientId', selectedClient.clientId);
            body.append('documentType', 'co_applicant_photo');
            body.append('file', photoFile);
            appendKycUploadOwnerAndCategory(body, 'co_applicant_photo', { explicitOwner: 'coApplicant' });
            const response = await fetch('/api/kyc/aadhaar/upload', { method: 'POST', body });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Failed to upload photo');
            setPhotoFile(null);
            setPhotoPreview(null);
            if (photoFileInputRef.current) photoFileInputRef.current.value = '';
            toast({ title: 'Photo uploaded', description: 'Co-applicant photo uploaded successfully.' });
            await fetchCoApplicantDocuments(selectedClient.clientId);
            onDocumentUploaded?.(selectedClient.clientId);
        } catch (error) {
            toast({
                title: 'Upload failed',
                description: error instanceof Error ? error.message : 'Failed to upload photo',
                variant: 'destructive',
            });
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handleUploadDocument = async () => {
        if (!selectedClient?.clientId) return;
        if (!existingCoApplicant) {
            toast({
                title: 'Save co-applicant first',
                description: 'Create or update the co-applicant before uploading co-applicant KYC.',
                variant: 'destructive',
            });
            return;
        }
        if (!selectedDocumentType || !selectedDocumentFile) {
            toast({
                title: 'Document details required',
                description: 'Select a document type and file before uploading.',
                variant: 'destructive',
            });
            return;
        }

        setIsUploadingDocument(true);
        try {
            const body = new FormData();
            body.append('clientId', selectedClient.clientId);
            body.append('documentType', selectedDocumentType);
            body.append('file', selectedDocumentFile);
            appendKycUploadOwnerAndCategory(body, selectedDocumentType, { explicitOwner: 'coApplicant' });

            const response = await fetch('/api/kyc/aadhaar/upload', {
                method: 'POST',
                body,
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Failed to upload document');
            }

            setSelectedDocumentType('');
            setSelectedDocumentFile(null);
            setDocumentFilePreview(null);
            if (documentInputRef.current) {
                documentInputRef.current.value = '';
            }

            toast({
                title: 'Document uploaded',
                description: 'Co-applicant KYC uploaded successfully.',
            });
            await fetchCoApplicantDocuments(selectedClient.clientId);
            onDocumentUploaded?.(selectedClient.clientId);
        } catch (error) {
            toast({
                title: 'Upload failed',
                description: error instanceof Error ? error.message : 'Failed to upload co-applicant KYC',
                variant: 'destructive',
            });
        } finally {
            setIsUploadingDocument(false);
        }
    };

    const handleDeleteDocument = async () => {
        if (!selectedClient?.clientId || !documentToDelete || isDeletingDocument) return;

        setIsDeletingDocument(true);
        try {
            const result = await apiClient.delete(
                `/clients/${selectedClient.clientId}/kyc-documents?documentId=${documentToDelete.id}`,
            );
            if (!result.success) {
                throw new Error(result.error || 'Failed to delete co-applicant document');
            }

            toast({
                title: 'Document deleted',
                description: `${documentToDelete.fileName || 'Selected document'} deleted successfully.`,
            });
            setDocumentToDelete(null);
            await fetchCoApplicantDocuments(selectedClient.clientId);
        } catch (error) {
            toast({
                title: 'Delete failed',
                description: error instanceof Error ? error.message : 'Failed to delete co-applicant document',
                variant: 'destructive',
            });
        } finally {
            setIsDeletingDocument(false);
        }
    };

    // Helper function to check if field is required based on admin configuration
    const isFieldRequired = (fieldKey: string, defaultRequired: boolean = false): boolean => {
        return configIsRequired(fieldKey, defaultRequired);
    };

    // Helper function to render required/optional indicator
    const renderRequiredIndicator = (fieldKey: string) => {
        if (isFieldRequired(fieldKey)) {
            return <span className="text-red-500">*</span>;
        }
        return <span className="text-slate-400 text-xs">(Optional)</span>;
    };

    const currentDocumentAccept = useMemo(() => {
        return CO_APPLICANT_KYC_DOCUMENT_TYPES.find((type) => type.value === selectedDocumentType)?.accept
            || 'image/jpeg,image/jpg,image/png';
    }, [selectedDocumentType]);

    const isFormDisabled = !selectedClientId || loadingCoApplicant;
    const coApplicantPhoto = documents.find((d) => d.documentType === 'co_applicant_photo');

    return (
        <div className="space-y-6">
            {!isControlled && (
                <div className="rounded-2xl border border-primary/20/80 bg-gradient-to-br from-slate-50 to-purple-50/30 p-6 dark:border-sidebar-accent/50 dark:from-brand-green-darker dark:to-purple-950/20">
                    <div className="mb-5 flex items-center gap-2">
                        <div className="h-5 w-1 rounded-full bg-gradient-to-b from-purple-500 to-pink-500" />
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-sidebar-accent dark:text-slate-300">
                            Filter Selection
                        </h3>
                    </div>
                    {/* Admin: Branch Selection */}
                    {isAdmin && (
                        <div className="mb-4">
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    <Building2 className="h-3.5 w-3.5 text-purple-500" />
                                    Branch Name <span className="text-red-500">*</span>
                                </label>
                                <Select value={selectedBranch} onValueChange={handleBranchChange} disabled={loadingBranches}>
                                    <SelectTrigger className="h-11 border-primary/20 bg-white hover:border-purple-400 focus:border-purple-500 focus:ring-purple-500/20 dark:border-sidebar-accent dark:bg-sidebar-accent">
                                        <SelectValue placeholder={loadingBranches ? 'Loading branches...' : '— Select Branch —'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {branches.map((branch) => (
                                            <SelectItem key={branch.id} value={branch.id}>
                                                {branch.code} — {branch.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        {/* Search Input */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                <Search className="h-3.5 w-3.5 text-purple-500" />
                                Search Member / Client
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <input
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Search by name, ID or phone…"
                                    disabled={isAdmin && !selectedBranch}
                                    className={cn(
                                        'h-11 w-full pl-9 rounded-md border border-primary/20 text-sm',
                                        'bg-white hover:border-purple-400 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500/20',
                                        'dark:bg-sidebar-accent dark:border-sidebar-accent dark:text-slate-100',
                                        isAdmin && !selectedBranch && 'cursor-not-allowed opacity-60',
                                    )}
                                />
                            </div>
                        </div>

                        {/* Member/Client Select */}
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                <Users className="h-3.5 w-3.5 text-purple-500" />
                                Name <span className="text-red-500">*</span>
                            </label>
                            <Select
                                value={selectedClientId}
                                onValueChange={handleClientChange}
                                disabled={loadingClients || (isAdmin && !selectedBranch)}
                            >
                                <SelectTrigger className={cn(
                                    'h-11 border-primary/20 bg-white hover:border-purple-400 focus:border-purple-500 focus:ring-purple-500/20 dark:border-sidebar-accent dark:bg-sidebar-accent',
                                    (loadingClients || (isAdmin && !selectedBranch)) && 'cursor-not-allowed opacity-60',
                                )}>
                                    <SelectValue
                                        placeholder={
                                            loadingClients
                                                ? 'Loading…'
                                                : isAdmin && !selectedBranch
                                                    ? '— Select branch first —'
                                                    : clients.length === 0
                                                        ? 'No records found'
                                                        : '— Select —'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.clientId} — {client.firstName} {client.lastName}
                                            {!client.centerId && <span className="ml-1 text-amber-600 text-xs"> ⚠ No center</span>}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {clients.length > 0 && !loadingClients && (
                                <p className="text-xs text-slate-500">{clients.length} result{clients.length !== 1 ? 's' : ''} found{search ? ` for "${search}"` : ''}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {selectedClient && (
                <div className="rounded-xl border border-primary/30/60 bg-green-50/60 px-5 py-4 dark:border-sidebar-accent/40 dark:bg-green-950/20">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-primary" />
                            <span className="text-xs text-slate-500 dark:text-slate-400">{getPersonLabel(!!selectedClient.hasLoan).singular}</span>
                            <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">
                                {selectedClient.firstName} {selectedClient.lastName}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4 text-primary" />
                            <span className="text-xs text-slate-500 dark:text-slate-400">{getPersonLabel(!!selectedClient.hasLoan).singular} ID</span>
                            <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">
                                {selectedClient.clientId}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span className="text-xs text-slate-500 dark:text-slate-400">Joined</span>
                            <span className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">
                                {formatDateForDisplay(selectedClient.createdAt)}
                            </span>
                        </div>
                        <div className="ml-auto">
                            {loadingCoApplicant ? (
                                <Badge variant="outline" className="gap-1.5 border-amber-300 bg-amber-50 text-amber-700">
                                    <Loader2 className="h-3 w-3 animate-spin" /> Checking...
                                </Badge>
                            ) : isEditMode ? (
                                <Badge className="gap-1.5 border border-emerald-200 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                    <CheckCircle2 className="h-3 w-3" /> Co-applicant exists
                                </Badge>
                            ) : (
                                <Badge variant="outline" className="gap-1.5 border-orange-300 bg-orange-50 text-orange-600">
                                    <AlertCircle className="h-3 w-3" /> No co-applicant yet
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>
            )}


            {!selectedClientId && (
                <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/20 bg-green-50/50 py-14 dark:border-sidebar-accent dark:bg-brand-green-darker/30">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-100 dark:bg-purple-900/30">
                        <Search className="h-8 w-8 text-purple-500" />
                    </div>
                    <p className="text-base font-semibold text-sidebar-accent dark:text-slate-300">Select a Client</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Search and select a client above to manage co-applicant details and KYC.
                    </p>
                </div>
            )}

            {selectedClientId && !loadingCoApplicant && (
                <>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <div className={cn(
                                'flex items-center gap-3 rounded-xl border px-5 py-3.5',
                                isEditMode
                                    ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/20'
                                    : 'border-purple-200 bg-purple-50 dark:border-purple-800/40 dark:bg-purple-950/20',
                            )}>
                                {isEditMode ? (
                                    <Edit3 className="h-5 w-5 text-emerald-600" />
                                ) : (
                                    <UserPlus className="h-5 w-5 text-purple-600" />
                                )}
                                <div>
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-100">
                                        {isEditMode ? 'Edit Co-Applicant' : 'Create New Co-Applicant'}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {isEditMode
                                            ? 'Modify the existing co-applicant details and save.'
                                            : 'Fill in the details below to add a new co-applicant for this client.'}
                                    </p>
                                </div>
                                {isEditMode && existingCoApplicant && (
                                    <ChevronRight className="ml-auto h-4 w-4 text-emerald-400" />
                                )}
                            </div>

                            <div className="rounded-2xl border border-primary/20/80 bg-white p-6 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/50">
                                <div className="flex flex-col lg:flex-row gap-6">
                                <div className="flex-1 space-y-6">
                                {/* Row 1: Relation | Name | Mobile */}
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="relationWithClient"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Users className="h-3.5 w-3.5 text-purple-500" />
                                                    Relation with {getPersonLabel(!!selectedClient?.hasLoan).singular} {renderRequiredIndicator('coApplicantRelation')}
                                                </FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value} disabled={isFormDisabled}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="— Select Relation —" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {RELATION_OPTIONS.map((option) => (
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
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <User className="h-3.5 w-3.5 text-purple-500" />
                                                    Co-Applicant Name {renderRequiredIndicator('coApplicantName')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Enter full name" disabled={isFormDisabled} className="h-11" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="mobileNumber"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Phone className="h-3.5 w-3.5 text-purple-500" />
                                                    Mobile Number {renderRequiredIndicator('coApplicantMobileNumber')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} maxLength={10} placeholder="10-digit mobile number" disabled={isFormDisabled} className="h-11"
                                                        onBlur={(e) => { field.onBlur(); checkFieldUniqueness('MOBILE', 'mobileNumber', e.target.value); }} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Row 2: Gender | Date of Birth | Age */}
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="gender"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Users className="h-3.5 w-3.5 text-purple-500" />
                                                    Gender {renderRequiredIndicator('coApplicantGender')}
                                                </FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value} disabled={isFormDisabled}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="— Select Gender —" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {GENDER_OPTIONS.map((option) => (
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
                                        name="dateOfBirth"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Calendar className="h-3.5 w-3.5 text-purple-500" />
                                                    Date of Birth {renderRequiredIndicator('coApplicantDob')}
                                                </FormLabel>
                                                <FormControl>
                                                    <DateInput {...field} disabled={isFormDisabled} className="h-11" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="age"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    Age {renderRequiredIndicator('coApplicantAge')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} readOnly className="h-11 cursor-default bg-green-50 text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-400" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                {/* Row 3: Eco Type | Eco Activity | Product Type */}
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="economicActivityTypeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Briefcase className="h-3.5 w-3.5 text-purple-500" />
                                                    Economic Activity Type {renderRequiredIndicator('coApplicantEconomicActivityTypeId')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={(value) => {
                                                            field.onChange(value);
                                                            form.setValue('economicActivityId', '');
                                                            fetchEconomicActivities(value);
                                                        }}
                                                        disabled={isFormDisabled}
                                                    >
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {economicActivityTypes.map((type) => (
                                                                <SelectItem key={type.id} value={type.id}>
                                                                    {type.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="economicActivityId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <Briefcase className="h-3.5 w-3.5 text-purple-500" />
                                                    Economic Activity {renderRequiredIndicator('coApplicantEconomicActivityId')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                        disabled={isFormDisabled || !form.getValues('economicActivityTypeId') || isLoadingActivities}
                                                    >
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={isLoadingActivities ? "Loading..." : "-- SELECT --"} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {economicActivities.map((activity) => (
                                                                <SelectItem key={activity.id} value={activity.id}>
                                                                    {activity.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {!hideLoanProductSection && (
                                    <FormField
                                        control={form.control}
                                        name="requestedLoanProductTypeId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    Product Type {renderRequiredIndicator('requestedLoanProductTypeId')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={(value) => {
                                                            field.onChange(value);
                                                            form.setValue('requestedLoanFrequency', 'weekly');
                                                            form.setValue('requestedLoanProductId', '');
                                                        }}
                                                        disabled={isFormDisabled || isLoadingProductTypes}
                                                    >
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder={isLoadingProductTypes ? 'Loading...' : '-- SELECT --'} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {loanProductTypes.map((type) => (
                                                                <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    )}
                                </div>

                                {/* Row 4: Frequency | Loan Product | Loan Amount */}
                                {!hideLoanProductSection && (
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="requestedLoanFrequency"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    Frequency {renderRequiredIndicator('requestedLoanFrequency')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={(value) => {
                                                            field.onChange(value);
                                                            form.setValue('requestedLoanProductId', '');
                                                        }}
                                                        disabled={isFormDisabled || !watchProductType}
                                                    >
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {FREQUENCY_OPTIONS.map((opt) => (
                                                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="requestedLoanProductId"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    Loan Product {renderRequiredIndicator('requestedLoanProductId')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                        disabled={isFormDisabled || !watchProductType}
                                                    >
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {filteredLoanProducts.map((product) => (
                                                                <SelectItem key={product.id} value={product.id}>{(product as any).productName || product.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormItem>
                                        <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                            Loan Amount
                                        </FormLabel>
                                        <Input
                                            value={selectedProductAmount != null ? `₹${selectedProductAmount.toLocaleString('en-IN')}` : ''}
                                            readOnly
                                            disabled
                                            className="h-11 cursor-default bg-green-50 text-sidebar-accent dark:bg-sidebar-accent dark:text-slate-400"
                                            placeholder="Auto-filled from product"
                                        />
                                    </FormItem>
                                </div>
                                )}

                                {/* Row 5: Voter ID | PAN Card | Aadhaar */}
                                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 items-start">
                                    <FormField
                                        control={form.control}
                                        name="voterIdNo"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                                                    Voter ID No. {renderRequiredIndicator('caVoterIdNo')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Enter voter ID" disabled={isFormDisabled} className="h-11 uppercase"
                                                        onBlur={(e) => { field.onBlur(); checkFieldUniqueness('VOTER_ID', 'voterIdNo', e.target.value); }} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="pancardNo"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                                                    PAN Card No. {renderRequiredIndicator('caPancardNo')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        placeholder="ABCDE1234F"
                                                        maxLength={10}
                                                        disabled={isFormDisabled}
                                                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                                                        onBlur={(e) => { field.onBlur(); checkFieldUniqueness('PAN', 'pancardNo', e.target.value); }}
                                                        className="h-11 uppercase tracking-widest"
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="otherIdNo"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                                    <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                                                    Aadhaar ID No. {renderRequiredIndicator('caOtherIdNo')}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} placeholder="Enter 12-digit Aadhaar number" disabled={isFormDisabled} className="h-11" maxLength={12}
                                                        onChange={(e) => { field.onChange(e); form.trigger('otherIdNo'); }}
                                                        onBlur={(e) => { field.onBlur(); checkFieldUniqueness('AADHAAR', 'otherIdNo', e.target.value); }} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                </div>

                                {!hideKycSection && (
                                <div className="flex flex-col items-center gap-3 w-full lg:w-44 shrink-0 pt-1">
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">Co-Applicant Photo</p>
                                    <div className="relative w-36 h-44 rounded-xl border-2 border-dashed border-primary/30 bg-green-50 dark:border-sidebar-accent dark:bg-brand-green-darker/60 overflow-hidden">
                                        {photoPreview ? (
                                            <img src={photoPreview} alt="Preview" className="h-full w-full object-cover" />
                                        ) : coApplicantPhoto?.fileUrl ? (
                                            <StorageImage src={coApplicantPhoto.fileUrl} alt="Co-Applicant" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center">
                                                <User className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                                                <p className="text-xs text-slate-400 dark:text-slate-500">No photo yet</p>
                                            </div>
                                        )}
                                    </div>
                                    <input ref={photoFileInputRef} type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handlePhotoFileChange} disabled={!existingCoApplicant || isUploadingPhoto} />
                                    <div className="flex gap-2">
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => photoFileInputRef.current?.click()} disabled={!existingCoApplicant || isUploadingPhoto} title="Upload photo from file">
                                            <Upload className="h-4 w-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={() => setPhotoCameraOpen(true)} disabled={!existingCoApplicant || isUploadingPhoto} title="Take photo with camera">
                                            <Camera className="h-4 w-4" />
                                        </Button>
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9" onClick={handlePhotoPasteFromClipboard} disabled={!existingCoApplicant || isUploadingPhoto} title="Paste photo from clipboard (Ctrl+V)">
                                            <Clipboard className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    {photoFile && (
                                        <Button type="button" size="sm" className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white" onClick={handlePhotoUpload} disabled={isUploadingPhoto}>
                                            {isUploadingPhoto ? (
                                                <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                                            ) : (
                                                <><Upload className="h-3 w-3" /> Save Photo</>
                                            )}
                                        </Button>
                                    )}
                                    {photoCompressionNote && (
                                        <p className="text-[10px] text-blue-600 dark:text-blue-400 text-center">{photoCompressionNote}</p>
                                    )}
                                    {!existingCoApplicant && (
                                        <p className="text-xs text-center text-slate-400 dark:text-slate-500">Save co-applicant first to upload photo</p>
                                    )}
                                </div>
                                )}
                                </div>
                            </div>

                            <div className="flex items-center gap-3 pt-2">
                                <Button
                                    type="submit"
                                    disabled={isSubmitting || isFormDisabled || (isEditMode ? !canEditClient : !canCreateClient)}
                                    className={cn(
                                        'h-11 gap-2 px-8 font-semibold shadow-md transition-all',
                                        isEditMode
                                            ? 'bg-emerald-600 shadow-emerald-500/25 hover:bg-emerald-700'
                                            : 'bg-gradient-to-r from-purple-600 to-pink-600 shadow-purple-500/25 hover:from-purple-700 hover:to-pink-700',
                                    )}
                                >
                                    {isSubmitting ? (
                                        <><Loader2 className="h-4 w-4 animate-spin" /> {isEditMode ? 'Updating...' : 'Saving...'}</>
                                    ) : (
                                        <><Save className="h-4 w-4" /> {isEditMode ? 'Update Co-Applicant' : 'Save Co-Applicant'}</>
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={handleReset}
                                    disabled={isSubmitting}
                                    className="h-11 gap-2 px-6 font-semibold"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    Reset
                                </Button>
                            </div>
                        </form>
                    </Form>

                    {!hideKycSection && (
                    <div className="rounded-2xl border border-primary/20/80 bg-white p-6 dark:border-sidebar-accent/50 dark:bg-brand-green-darker/50">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100">Co-Applicant KYC</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Upload and review co-applicant KYC documents under the same BM/AM verification workflow.
                                </p>
                            </div>
                            <Badge variant="outline" className="border-primary/30 text-sidebar-accent dark:border-sidebar-accent dark:text-slate-300">
                                {documents.length} documents
                            </Badge>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Document Type <span className="text-red-500">*</span>
                                </label>
                                <Select
                                    value={selectedDocumentType}
                                    onValueChange={(value) => setSelectedDocumentType(value as SupportedKycDocumentType)}
                                    disabled={!existingCoApplicant || isUploadingDocument}
                                >
                                    <SelectTrigger className="h-11">
                                        <SelectValue placeholder="Select co-applicant document" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CO_APPLICANT_KYC_DOCUMENT_TYPES
                                            .filter((type) => !uploadedDocumentTypes?.includes(type.value))
                                            .map((type) => (
                                                <SelectItem key={type.value} value={type.value}>
                                                    {type.label}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                    Document Image <span className="text-red-500">*</span>
                                </label>
                                <div
                                    className={cn(
                                        'relative border-2 border-dashed rounded-lg p-6 transition-colors',
                                        'border-primary/30 hover:border-primary dark:border-sidebar-accent dark:hover:border-primary',
                                        'bg-green-50 dark:bg-brand-green-darker/50',
                                    )}
                                    onDrop={handleDocumentFileDrop}
                                    onDragOver={(event) => event.preventDefault()}
                                >
                                    <input
                                        ref={documentInputRef}
                                        type="file"
                                        accept={currentDocumentAccept}
                                        onChange={handleDocumentFileChange}
                                        disabled={!existingCoApplicant || isUploadingDocument}
                                        className="hidden"
                                    />

                                    {selectedDocumentFile ? (
                                        <div className="space-y-3">
                                            {documentFilePreview && (
                                                <div className="relative w-full h-48 rounded-lg overflow-hidden bg-brand-green-tint dark:bg-sidebar-accent">
                                                    <img src={documentFilePreview} alt="Preview" className="w-full h-full object-contain" />
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between p-3 bg-white dark:bg-sidebar-accent rounded-lg border border-primary/20 dark:border-sidebar-accent">
                                                <div className="flex items-center gap-3">
                                                    {selectedDocumentFile.type === 'application/pdf' ? (
                                                        <FileText className="h-8 w-8 text-red-500" />
                                                    ) : (
                                                        <ImageIcon className="h-8 w-8 text-primary" />
                                                    )}
                                                    <div>
                                                        <p className="text-sm font-medium text-foreground dark:text-slate-100">{selectedDocumentFile.name}</p>
                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                            {(selectedDocumentFile.size / 1024).toFixed(2)} KB
                                                        </p>
                                                        {documentCompressionNote && (
                                                            <p className="text-[10px] text-blue-600 dark:text-blue-400">{documentCompressionNote}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => {
                                                        setSelectedDocumentFile(null);
                                                        setDocumentFilePreview(null);
                                                        setDocumentCompressionNote('');
                                                        if (documentInputRef.current) {
                                                            documentInputRef.current.value = '';
                                                        }
                                                    }}
                                                    className="h-8 w-8 text-slate-500 hover:text-red-600"
                                                    disabled={isUploadingDocument}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-center">
                                            <Upload className="mx-auto h-12 w-12 text-slate-400" />
                                            <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => documentInputRef.current?.click()}
                                                    className="text-sm font-medium"
                                                    disabled={!existingCoApplicant || isUploadingDocument}
                                                >
                                                    Choose File
                                                </Button>
                                                <span className="text-xs text-slate-400">or</span>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={() => setCameraOpen(true)}
                                                    className="text-sm font-medium gap-2"
                                                    disabled={!existingCoApplicant || isUploadingDocument}
                                                >
                                                    <Camera className="h-4 w-4" />
                                                    Take Photo
                                                </Button>
                                                <span className="text-xs text-slate-400">or</span>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleDocumentPasteFromClipboard}
                                                    className="text-sm font-medium gap-2"
                                                    disabled={!existingCoApplicant || isUploadingDocument}
                                                >
                                                    <Clipboard className="h-4 w-4" />
                                                    Paste Photo
                                                </Button>
                                            </div>
                                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">or drag and drop / press Ctrl+V to paste</p>
                                            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                                                JPG, PNG{selectedDocumentType === 'bank_passbook' ? ' or PDF' : ''} (max 5MB)
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <Button
                                type="button"
                                onClick={handleUploadDocument}
                                disabled={!existingCoApplicant || !selectedDocumentType || !selectedDocumentFile || isUploadingDocument}
                                className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white"
                            >
                                {isUploadingDocument ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Uploading...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-4 w-4 mr-2" />
                                        Upload
                                    </>
                                )}
                            </Button>

                            {!existingCoApplicant && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                                    Save co-applicant details first. Co-applicant KYC is linked to the client and enters the same BM/AM verification queue.
                                </div>
                            )}
                        </div>

                        <div className="mt-6">
                            {loadingDocuments ? (
                                <div className="flex items-center justify-center rounded-xl border border-dashed border-primary/20 py-12 dark:border-sidebar-accent">
                                    <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-500" />
                                    <span className="text-sm text-slate-500">Loading co-applicant documents...</span>
                                </div>
                            ) : documents.length === 0 ? (
                                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/20 px-4 py-12 text-center dark:border-sidebar-accent">
                                    <FileText className="mb-3 h-10 w-10 text-slate-400" />
                                    <p className="text-sm font-semibold text-sidebar-accent dark:text-slate-300">No co-applicant KYC uploaded yet</p>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        Upload the required co-applicant documents to complete Flow #73.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                    {documents.map((document) => (
                                        <div key={document.id} className="rounded-xl border border-primary/20 bg-green-50 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/60">
                                            <div className="mb-4 flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground dark:text-slate-100">
                                                        {getKycDocumentTypeLabel(document.documentType)}
                                                    </p>
                                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                                        {document.fileName || 'Unnamed file'} • {formatDateForDisplay(document.uploadedAt)}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Button type="button" variant="ghost" size="icon" onClick={() => setDocumentToView(document)} className="h-8 w-8">
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => {
                                                            void downloadStorageFile(document.fileUrl, document.fileName || 'co-applicant-document');
                                                        }}
                                                        className="h-8 w-8"
                                                        disabled={!document.fileUrl}
                                                    >
                                                        <Download className="h-4 w-4" />
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="icon" onClick={() => setDocumentToDelete(document)} className="h-8 w-8 text-red-600">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </div>

                                            {document.fileUrl ? (
                                                document.mimeType?.startsWith('image/') ? (
                                                    <StorageImage
                                                        src={document.fileUrl}
                                                        alt={document.fileName || document.documentType}
                                                        className="h-48 w-full rounded-lg border border-primary/20 bg-white object-contain dark:border-sidebar-accent dark:bg-green-950"
                                                    />
                                                ) : (
                                                    <StorageIframe
                                                        src={document.fileUrl}
                                                        title={document.fileName || document.documentType}
                                                        className="h-48 w-full rounded-lg border border-primary/20 bg-white dark:border-sidebar-accent"
                                                    />
                                                )
                                            ) : (
                                                <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-primary/30 text-sm text-slate-500 dark:border-sidebar-accent dark:text-slate-400">
                                                    Preview unavailable
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    )}
                </>
            )}

            {loadingCoApplicant && selectedClientId && (
                <div className="flex items-center justify-center rounded-xl border border-dashed border-primary/20 py-12 dark:border-sidebar-accent">
                    <div className="space-y-3 text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-500" />
                        <p className="text-sm text-slate-500">Checking for existing co-applicant...</p>
                    </div>
                </div>
            )}

            <Dialog open={!!documentToView} onOpenChange={(open) => !open && setDocumentToView(null)}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>
                            {documentToView ? getKycDocumentTypeLabel(documentToView.documentType) : 'Document Preview'}
                        </DialogTitle>
                        <DialogDescription>{documentToView?.fileName || 'Preview uploaded document'}</DialogDescription>
                    </DialogHeader>
                    <div className="mt-4">
                        {!documentToView?.fileUrl ? (
                            <div className="flex h-96 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-sidebar-accent">
                                <p className="text-slate-500 dark:text-slate-400">Preview unavailable</p>
                            </div>
                        ) : documentToView.mimeType?.startsWith('image/') ? (
                            <div className="flex h-96 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-sidebar-accent">
                                <StorageImage src={documentToView.fileUrl} alt={documentToView.fileName || ''} className="max-h-full max-w-full object-contain" />
                            </div>
                        ) : (
                            <StorageIframe src={documentToView.fileUrl} title={documentToView.fileName || ''} className="h-96 w-full rounded-lg border border-primary/20 dark:border-sidebar-accent" />
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!documentToDelete} onOpenChange={(open) => !open && setDocumentToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Co-Applicant Document</DialogTitle>
                        <DialogDescription>
                            This removes the selected co-applicant KYC document and sends the client back to BM/AM re-verification.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
                        {documentToDelete?.fileName || getKycDocumentTypeLabel(documentToDelete?.documentType || '')}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDocumentToDelete(null)} disabled={isDeletingDocument}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={handleDeleteDocument} disabled={isDeletingDocument}>
                            {isDeletingDocument ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</> : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <CameraCapture
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={handleCameraCapture}
                label="Co-Applicant Document"
            />
            <CameraCapture
                open={photoCameraOpen}
                onClose={() => setPhotoCameraOpen(false)}
                onCapture={handlePhotoCapture}
                label="Co-Applicant Photo"
            />
        </div>
    );
}

function SummaryItem({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        <div className="rounded-xl border border-emerald-200/60 bg-white/80 px-4 py-3 dark:border-emerald-900/40 dark:bg-brand-green-darker/60">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {label}
            </p>
            <p className="mt-1 break-words text-sm font-medium text-foreground dark:text-slate-100">
                {value?.trim() ? value : '—'}
            </p>
        </div>
    );
}
