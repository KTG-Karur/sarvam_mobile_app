'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    User,
    Building2,
    Save,
    Loader2,
    Map,
    MapPin,
    LocateFixed,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { QUALIFICATION_OPTIONS } from '@/app/lib/constants/form-options';
import { validateAadhaar, validatePAN, validateVoterID } from '@/app/lib/validations/field-validations';
import { type IdentityField } from '@/app/lib/identity-normalization';
import { tokenStorage } from '@/app/lib/token-storage';
import { AlertCircle } from 'lucide-react';
import { useDrivingDistance } from '@/hooks/useDrivingDistance';
import { CLIENT_UPDATE_FIELD_CONFIG_MAP } from '@/app/lib/constants/enrollment-field-config-map';
import { DateInput } from '@/components/ui/date-input';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import LocationPreview from '@/components/centers/LocationPreview';
import LocationSearchBox from '@/components/centers/LocationSearchBox';

const MapComponent = dynamic(() => import('@/components/centers/CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[300px] items-center justify-center rounded-lg border bg-muted">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
    ),
});

// Fallback map center when no coordinates are set yet (same default as Create Center).
const DEFAULT_MAP_LAT = 10.3624;
const DEFAULT_MAP_LNG = 77.9695;

const MIN_SINGLE_MARITAL_AGE = 35;
const RESTRICTED_MARITAL_STATUSES = ['Single', 'Widowed', 'Divorced'];

const formatKm = (meters: number | null): string => {
    if (meters == null) return '—';
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
};

const kycUpdateSchema = z.object({
    clientName: z.string().trim().optional().default(''),
    lastName: z.string().trim().optional().default(''),
    email: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), 'Email format is invalid'),
    dateOfBirth: z.string().optional().default(''),
    age: z.string().optional().default(''),
    gender: z.string().optional().default(''),
    fatherName: z.string().trim().optional().default(''),
    motherName: z.string().trim().optional().default(''),
    caste: z.string().optional().default(''),
    community: z.string().optional().default(''),
    religion: z.string().optional().default(''),
    economicActivityTypeId: z.string().optional().default(''),
    economicActivityId: z.string().optional().default(''),
    qualification: z.string().optional().default(''),
    maritalStatus: z.string().optional().default(''),
    spouseName: z.string().trim().optional().default(''),
    spouseDob: z.string().optional().default(''),
    spouseMobileNumber: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[0-9]{10}$/.test(val), 'Spouse mobile must be 10 digits'),
    spouseGender: z.string().optional().default(''),
    spouseEconomicActivityTypeId: z.string().optional().default(''),
    spouseEconomicActivityId: z.string().optional().default(''),
    noOfChildren: z.string().optional().default(''),
    monthlyFamilyIncome: z.string().optional().default(''),
    monthlyFamilyExpense: z.string().optional().default(''),
    houseStatus: z.string().optional().default(''),
    permanentAddress: z.string().trim().optional().default(''),
    pincode: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[0-9]{6}$/.test(val), 'Pincode must be 6 digits'),
    postOffice: z.string().trim().optional().default(''),
    district: z.string().trim().optional().default(''),
    state: z.string().trim().optional().default(''),
    country: z.string().trim().optional().default('India'),
    mobileNumber: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[0-9]{10}$/.test(val), 'Mobile number must be 10 digits'),
    bankName: z.string().trim().optional().default(''),
    bankBranch: z.string().trim().optional().default(''),
    bankIFSC: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(val), 'IFSC code format must be SBIN0001234'),
    bankAccountType: z.string().optional().default(''),
    passbookNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || /^\d{9,18}$/.test(val), { message: 'Bank account number must be 9-18 digits' }),
    retypePassbookNo: z.string().trim().optional().default(''),
    otherIdNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validateAadhaar(val, false).isValid, 'Aadhaar must be a valid 12-digit number'),
    smartCardNo: z.string().trim().optional().default(''),
    voterIdNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validateVoterID(val, false).isValid, 'Voter ID format is invalid'),
    pancardNo: z.string().trim().optional().default('')
        .refine((val) => val === '' || validatePAN(val, false).isValid, 'PAN card must be in format: ABCDE1234F'),
    requestedAmount: z.string().optional().default(''),
    latitude: z.string().trim().optional().default(''),
    longitude: z.string().trim().optional().default(''),
}).refine((data) => !data.passbookNo || data.passbookNo === data.retypePassbookNo, {
    message: 'Bank account numbers do not match',
    path: ['retypePassbookNo'],
}).refine((data) => {
    if (!RESTRICTED_MARITAL_STATUSES.includes(data.maritalStatus) || !data.dateOfBirth) return true;
    const age = parseInt(calculateAge(data.dateOfBirth), 10);
    return isNaN(age) || age >= MIN_SINGLE_MARITAL_AGE;
}, {
    message: `Age must be greater than or equal to ${MIN_SINGLE_MARITAL_AGE} years when marital status is Single, Widowed or Divorced`,
    path: ['maritalStatus'],
});

type KYCUpdateFormValues = z.infer<typeof kycUpdateSchema>;

const formatDate = (date: string | Date | null | undefined): string => {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
};

const calculateAge = (dob: string | null | undefined): string => {
    if (!dob) return '';
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age.toString();
};

const getMaxDobForMinAge = (minAge: number): string => {
    const today = new Date();
    const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
    return maxDate.toISOString().split('T')[0];
};

const CASTES = ['General', 'OBC', 'SC', 'ST', 'Other'];
const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Other'];

const COMMUNITY_OPTIONS = [
    'Vanniyar', 'Thevar', 'Kallar', 'Maravar', 'Agamudayar',
    'Gounder', 'Kongu Vellalar', 'Nadar', 'Mudaliar', 'Chettiar',
    'Pillai', 'Vellalar', 'Yadava', 'Konar', 'Idaiyar',
    'Devendra Kula Vellalar', 'Paraiyar', 'Arunthathiyar', 'Pallar',
    'Irular', 'Toda', 'Kota', 'Kurumba', 'Labbai',
    'Rowther', 'Marakkayar', 'Iyer', 'Iyengar', 'Others',
];

const maskAccountNumber = (val: string) => {
    if (!val) return '';
    return '•'.repeat(val.length);
};

interface KYCDetailsFlatFormProps {
    selectedClient: string;
    clientData: any;
    onSuccess?: () => void;
    visibleSection?: 'details' | 'other-details';
    onFormChange?: (partialClientData: Record<string, any>) => void;
    /**
     * When true, an Admin/Sub Admin editing an already-APPROVED client restarts
     * the approval workflow from BM verification on any real change. Only the
     * Client Update page passes this — leave unset everywhere else (e.g. the
     * Approval Workbench's "Edit Client" dialog) to keep their existing behavior.
     */
    enableFullApprovalRestart?: boolean;
}

export function KYCDetailsFlatForm({ selectedClient, clientData, onSuccess, visibleSection, onFormChange, enableFullApprovalRestart }: KYCDetailsFlatFormProps) {
    const { toast } = useToast();
    const { isRequired: configIsRequired } = useEnrollmentValidation();
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Once a client is fully APPROVED (final Admin/sub-admin approval), lock the
    // form for everyone except Admin/sub-admin, Branch Manager when the
    // Admin-controlled "Allow BM to edit approved clients" kill-switch is ON,
    // and FDO when the Admin-controlled "Allow FDO to edit approved clients"
    // kill-switch is ON — mirrors the server-side gate in PUT
    // /api/clients/[clientId] (isBmEditApproved / isFdoEditApproved).
    const currentUser = tokenStorage.getUser();
    const isAdminOrSubAdmin = currentUser?.role === 'ADMIN' || currentUser?.role === 'ADMIN_NON_HO_BRANCH_SWITCH' || !!currentUser?.isSubAdmin;
    const isBranchManager = currentUser?.role === 'BRANCH_MANAGER';
    const isFdo = currentUser?.role === 'FDO';
    const [allowFdoEditApproved, setAllowFdoEditApproved] = useState(true);
    const [allowBmEditApproved, setAllowBmEditApproved] = useState(true);
    useEffect(() => {
        if (!isFdo) return;
        apiClient.get<{ enabled: boolean }>('/settings/fdo-approved-client-edit')
            .then((res) => { if (res.success && res.data) setAllowFdoEditApproved(res.data.enabled); })
            .catch(() => { /* keep default (true) */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFdo]);
    useEffect(() => {
        if (!isBranchManager) return;
        apiClient.get<{ enabled: boolean }>('/settings/bm-approved-client-edit')
            .then((res) => { if (res.success && res.data) setAllowBmEditApproved(res.data.enabled); })
            .catch(() => { /* keep default (true) */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBranchManager]);
    const isLocked = clientData?.approvalStatus === 'APPROVED' && !isAdminOrSubAdmin
        && !(isBranchManager && allowBmEditApproved) && !(isFdo && allowFdoEditApproved);

    const [isPincodeVerifying, setIsPincodeVerifying] = useState(false);
    const [isIFSCVerifying, setIsIFSCVerifying] = useState(false);

    const [postOfficeOptions, setPostOfficeOptions] = useState<Array<{ Name: string; District: string; State: string; Country?: string }>>([]);
    const [showPostOfficeSelect, setShowPostOfficeSelect] = useState(false);

    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [spouseEconomicActivities, setSpouseEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);
    const [isLoadingSpouseActivities, setIsLoadingSpouseActivities] = useState(false);

    const form = useForm<KYCUpdateFormValues>({
        resolver: zodResolver(kycUpdateSchema),
        defaultValues: {
            clientName: clientData?.firstName || '',
            lastName: clientData?.lastName || '',
            email: clientData?.email || '',
            dateOfBirth: formatDate(clientData?.dateOfBirth),
            age: clientData?.age?.toString() || calculateAge(clientData?.dateOfBirth) || '',
            gender: clientData?.gender || '',
            fatherName: clientData?.fatherName || '',
            motherName: clientData?.motherName || '',
            caste: clientData?.caste || '',
            community: clientData?.community || '',
            religion: clientData?.religion || '',
            economicActivityTypeId: clientData?.economicActivityTypeId || '',
            economicActivityId: '',
            qualification: clientData?.qualification || '',
            maritalStatus: clientData?.maritalStatus || '',
            spouseName: clientData?.spouseName || '',
            spouseDob: formatDate(clientData?.spouseDob),
            spouseMobileNumber: clientData?.spouseMobileNumber || '',
            spouseGender: clientData?.spouseGender || '',
            spouseEconomicActivityTypeId: clientData?.spouseEconomicActivityTypeId || '',
            spouseEconomicActivityId: '',
            noOfChildren: clientData?.noOfChildren?.toString() || '',
            monthlyFamilyIncome: clientData?.monthlyFamilyIncome?.toString() || '',
            monthlyFamilyExpense: clientData?.monthlyFamilyExpense?.toString() || '',
            houseStatus: clientData?.houseStatus || '',
            permanentAddress: clientData?.permanentAddress || '',
            pincode: clientData?.pincode || '',
            postOffice: clientData?.postOffice || '',
            district: clientData?.district || '',
            state: clientData?.state || '',
            country: clientData?.country || 'India',
            mobileNumber: clientData?.mobileNumber || '',
            bankName: clientData?.bankName || '',
            bankAccountType: clientData?.bankAccountType || '',
            bankBranch: clientData?.bankBranch || '',
            bankIFSC: clientData?.ifscCode || '',
            passbookNo: clientData?.bankAcNo || '',
            retypePassbookNo: clientData?.bankAcNo || '',
            otherIdNo: clientData?.otherIdNo || '',
            smartCardNo: clientData?.smartCardNo || '',
            voterIdNo: clientData?.votersIdNo || '',
            pancardNo: clientData?.pancardNo || '',
            requestedAmount: clientData?.requestedAmount?.toString() || '',
            latitude: clientData?.latitude?.toString() || '',
            longitude: clientData?.longitude?.toString() || '',
        },
    });

    // ── Location: map picker + road (driving) distance from branch/center ──────
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);

    const watchedLat = parseFloat(form.watch('latitude') || '');
    const watchedLng = parseFloat(form.watch('longitude') || '');
    const clientMapLat = Number.isFinite(watchedLat) ? watchedLat : null;
    const clientMapLng = Number.isFinite(watchedLng) ? watchedLng : null;

    const centerLat = clientData?.center?.latitude ?? null;
    const centerLng = clientData?.center?.longitude ?? null;
    const branchLat = clientData?.center?.branch?.latitude ?? null;
    const branchLng = clientData?.center?.branch?.longitude ?? null;

    const kmFromCenter = useDrivingDistance(clientMapLat, clientMapLng, centerLat, centerLng);
    const kmFromBranch = useDrivingDistance(clientMapLat, clientMapLng, branchLat, branchLng);

    // Samples high-accuracy GPS and keeps the best fix; one final update only, since
    // each lat/long change recalculates the branch/center driving distances.
    const handleLocateClient = () =>
        locate({
            onPosition: (lat, lng) => {
                form.setValue('latitude', lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
                form.setValue('longitude', lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
            },
            subject: `${getPersonLabel(!!clientData?.hasLoan).singular} location`,
            liveUpdates: false,
        });

    // Live-synced while the marker is dragged / the map is clicked in the picker dialog.
    const handleMapLocationChange = (lat: number, lng: number) => {
        form.setValue('latitude', lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
        form.setValue('longitude', lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
    };

    /**
     * On-blur uniqueness check against /clients/check-identity-uniqueness.
     * excludeFamilyClientId is clientData.id (the cuid), NOT selectedClient
     * (which is the human-readable Client.clientId used for routing) — see
     * plan: family-exclusion must key off Client.id. Surfaced as a manual
     * react-hook-form error so it renders via the existing <FormMessage/>.
     * Co-applicant same-family cross-check is done server-side (the
     * co-applicant lives on a separate tab/form) via familyClientId.
     */
    const checkFieldUniqueness = async (
        field: IdentityField,
        formFieldName: 'mobileNumber' | 'otherIdNo' | 'pancardNo' | 'voterIdNo' | 'passbookNo',
        value: string
    ) => {
        if (!value) return;
        try {
            const res = await apiClient.post<{ isDuplicate: boolean; message: string | null }>(
                '/clients/check-identity-uniqueness',
                { field, value, side: 'CLIENT', familyClientId: clientData?.id }
            );
            if (res.success && res.data?.isDuplicate) {
                form.setError(formFieldName, { type: 'manual', message: res.data.message || 'Already exists.' });
            }
        } catch {
            // Non-blocking UX enhancement — submit-time validation is authoritative.
        }
    };

    const pendingEcoActivityIdRef = useRef('');
    const pendingSpouseEcoActivityIdRef = useRef('');

    useEffect(() => {
        const { unsubscribe } = form.watch((values) => {
            if (!onFormChange) return;
            onFormChange({
                firstName:                    values.clientName ?? '',
                lastName:                     values.lastName ?? '',
                email:                        values.email ?? '',
                dateOfBirth:                  values.dateOfBirth ?? '',
                gender:                       values.gender ?? '',
                fatherName:                   values.fatherName ?? '',
                motherName:                   values.motherName ?? '',
                caste:                        values.caste ?? '',
                community:                    values.community ?? '',
                religion:                     values.religion ?? '',
                economicActivityTypeId:       values.economicActivityTypeId ?? '',
                economicActivityId:           values.economicActivityId ?? '',
                qualification:                values.qualification ?? '',
                maritalStatus:                values.maritalStatus ?? '',
                spouseName:                   values.spouseName ?? '',
                spouseDob:                    values.spouseDob ?? '',
                spouseMobileNumber:           values.spouseMobileNumber ?? '',
                spouseGender:                 values.spouseGender ?? '',
                spouseEconomicActivityTypeId: values.spouseEconomicActivityTypeId ?? '',
                spouseEconomicActivityId:     values.spouseEconomicActivityId ?? '',
                noOfChildren:                 values.noOfChildren ?? '',
                monthlyFamilyIncome:          values.monthlyFamilyIncome ?? '',
                monthlyFamilyExpense:         values.monthlyFamilyExpense ?? '',
                houseStatus:                  values.houseStatus ?? '',
                permanentAddress:             values.permanentAddress ?? '',
                pincode:                      values.pincode ?? '',
                postOffice:                   values.postOffice ?? '',
                district:                     values.district ?? '',
                state:                        values.state ?? '',
                country:                      values.country ?? '',
                mobileNumber:                 values.mobileNumber ?? '',
                bankName:                     values.bankName ?? '',
                bankAccountType:              values.bankAccountType ?? '',
                bankBranch:                   values.bankBranch ?? '',
                ifscCode:                     values.bankIFSC ?? '',
                bankAcNo:                     values.passbookNo ?? '',
                otherIdNo:                    values.otherIdNo ?? '',
                smartCardNo:                  values.smartCardNo ?? '',
                votersIdNo:                   values.voterIdNo ?? '',
                pancardNo:                    values.pancardNo ?? '',
                latitude:                     values.latitude ?? '',
                longitude:                    values.longitude ?? '',
            });
        });
        return () => unsubscribe();
    }, [form, onFormChange]);

    const isFieldRequired = (fieldKey: string, defaultRequired: boolean = false): boolean => {
        return configIsRequired(fieldKey, defaultRequired);
    };

    const renderRequiredIndicator = (fieldKey: string) => {
        if (isFieldRequired(fieldKey)) {
            return <span className="text-red-500">*</span>;
        }
        return <span className="text-slate-400 text-xs">(Optional)</span>;
    };

    const fetchEconomicActivityTypes = useCallback(async () => {
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>('/economic-activity-types');
            if (result.success && result.data) {
                setEconomicActivityTypes(result.data);
                return result.data;
            }
        } catch (error) {
            console.error('Error fetching economic activity types:', error);
        }
        return [];
    }, []);

    const fetchEconomicActivities = useCallback(async (typeId: string) => {
        if (!typeId) {
            setEconomicActivities([]);
            return;
        }

        setIsLoadingActivities(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>(
                `/economic-activities?activityTypeId=${typeId}`
            );
            if (result.success && result.data) {
                setEconomicActivities(result.data);
            }
        } catch (error) {
            console.error('Error fetching economic activities:', error);
            setEconomicActivities([]);
        } finally {
            setIsLoadingActivities(false);
        }
    }, []);

    const fetchSpouseEconomicActivities = useCallback(async (typeId: string) => {
        if (!typeId) {
            setSpouseEconomicActivities([]);
            return;
        }

        setIsLoadingSpouseActivities(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>(
                `/economic-activities?activityTypeId=${typeId}`
            );
            if (result.success && result.data) {
                setSpouseEconomicActivities(result.data);
            }
        } catch (error) {
            console.error('Error fetching spouse economic activities:', error);
            setSpouseEconomicActivities([]);
        } finally {
            setIsLoadingSpouseActivities(false);
        }
    }, []);

    useEffect(() => {
        if (!clientData) return;
        let cancelled = false;

        // Store child activity IDs — set via useEffect after options commit to DOM
        pendingEcoActivityIdRef.current = clientData.economicActivityId || '';
        pendingSpouseEcoActivityIdRef.current = clientData.spouseEconomicActivityId || '';

        // Load dependent activity dropdowns asynchronously with cancellation guard
        const loadActivities = async () => {
            let types = economicActivityTypes;
            if (types.length === 0) {
                types = await fetchEconomicActivityTypes();
            }
            if (cancelled) return;

            const fetches: Promise<void>[] = [];
            if (clientData.economicActivityTypeId) {
                fetches.push(fetchEconomicActivities(clientData.economicActivityTypeId));
            }
            if (clientData.spouseEconomicActivityTypeId) {
                fetches.push(fetchSpouseEconomicActivities(clientData.spouseEconomicActivityTypeId));
            }
            await Promise.all(fetches);
        };

        void loadActivities();

        return () => {
            cancelled = true;
            pendingEcoActivityIdRef.current = '';
            pendingSpouseEcoActivityIdRef.current = '';
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientData, fetchEconomicActivityTypes, fetchEconomicActivities, fetchSpouseEconomicActivities]);

    useEffect(() => {
        void fetchEconomicActivityTypes();
    }, [fetchEconomicActivityTypes]);

    // Set economicActivityId only after options are committed to DOM
    useEffect(() => {
        if (economicActivities.length > 0 && pendingEcoActivityIdRef.current) {
            form.setValue('economicActivityId', pendingEcoActivityIdRef.current, { shouldDirty: false, shouldTouch: false });
            pendingEcoActivityIdRef.current = '';
        }
    }, [economicActivities, form]);

    // Set spouseEconomicActivityId only after options are committed to DOM
    useEffect(() => {
        if (spouseEconomicActivities.length > 0 && pendingSpouseEcoActivityIdRef.current) {
            form.setValue('spouseEconomicActivityId', pendingSpouseEcoActivityIdRef.current, { shouldDirty: false, shouldTouch: false });
            pendingSpouseEcoActivityIdRef.current = '';
        }
    }, [spouseEconomicActivities, form]);

    const watchDOB = form.watch('dateOfBirth');
    useEffect(() => {
        if (watchDOB) {
            const age = calculateAge(watchDOB);
            form.setValue('age', age);
        }
    }, [watchDOB, form]);

    // Single/Widowed/Divorced clients must be at least MIN_SINGLE_MARITAL_AGE years old —
    // re-validate live as either field changes, mirroring the enrollment form's rule.
    const watchMaritalStatus = form.watch('maritalStatus');
    useEffect(() => {
        if (watchDOB || watchMaritalStatus) {
            form.trigger('maritalStatus');
        }
    }, [watchDOB, watchMaritalStatus, form]);

    const handlePincodeVerify = async () => {
        const pincode = form.getValues('pincode');

        if (!pincode || pincode.length !== 6) {
            toast({
                title: 'Invalid pincode',
                description: 'Please enter a valid 6-digit pincode',
                variant: 'destructive',
            });
            return;
        }

        setIsPincodeVerifying(true);

        try {
            toast({
                title: 'Verifying Pincode',
                description: 'Fetching location details...',
            });

            const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
                cache: 'no-store',
            });

            const data = await response.json();

            if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
                const postOffices = data[0].PostOffice;

                if (postOffices && postOffices.length > 0) {
                    setPostOfficeOptions(postOffices);
                    setShowPostOfficeSelect(true);

                    const firstPO = postOffices[0];
                    form.setValue('postOffice', firstPO.Name || '');
                    form.setValue('district', firstPO.District || '');
                    form.setValue('state', firstPO.State || '');

                    if (postOffices.length > 1) {
                        toast({
                            title: 'Multiple Post Offices Found',
                            description: `Please select your post office from the dropdown. ${postOffices.length} options available.`,
                        });
                    } else {
                        toast({
                            title: 'Pincode verified',
                            description: `Location: ${firstPO.Name}, ${firstPO.District}, ${firstPO.State}`,
                        });
                    }
                } else {
                    setShowPostOfficeSelect(false);
                    setPostOfficeOptions([]);
                    toast({
                        title: 'Invalid Pincode',
                        description: 'No location details found for this pincode',
                        variant: 'destructive',
                    });
                }
            } else if (data[0]?.Status === 'Error') {
                setShowPostOfficeSelect(false);
                setPostOfficeOptions([]);
                toast({
                    title: 'Invalid Pincode',
                    description: data[0].Message || 'No location details found for this pincode',
                    variant: 'destructive',
                });
            } else {
                setShowPostOfficeSelect(false);
                setPostOfficeOptions([]);
                toast({
                    title: 'Invalid Pincode',
                    description: 'No location details found for this pincode',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error verifying pincode:', error);
            setShowPostOfficeSelect(false);
            setPostOfficeOptions([]);
            toast({
                title: 'Error',
                description: 'Failed to verify pincode. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsPincodeVerifying(false);
        }
    };

    const handlePostOfficeSelect = (postOfficeName: string) => {
        const selectedPO = postOfficeOptions.find(po => po.Name === postOfficeName);
        if (selectedPO) {
            form.setValue('postOffice', selectedPO.Name || '');
            form.setValue('district', selectedPO.District || '');
            form.setValue('state', selectedPO.State || '');
            setShowPostOfficeSelect(false);
            toast({
                title: 'Post Office Selected',
                description: `${selectedPO.Name}, ${selectedPO.District}, ${selectedPO.State}`,
            });
        }
    };

    const handleIFSCVerify = async () => {
        const ifsc = form.getValues('bankIFSC').trim().toUpperCase();
        if (!ifsc) {
            toast({
                title: 'Invalid IFSC',
                description: 'Please enter a valid IFSC code',
                variant: 'destructive',
            });
            return;
        }

        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
            toast({
                title: 'Invalid IFSC',
                description: 'IFSC code must be in format: SBIN0001234',
                variant: 'destructive',
            });
            return;
        }

        setIsIFSCVerifying(true);
        try {
            const result = await apiClient.get<{
                ifsc: string;
                bankName: string;
                branchName: string;
                address: string;
            }>(`/ifsc?code=${ifsc}`);

            if (!result.success || !result.data) {
                throw new Error(result.error || 'Unable to fetch bank details from IFSC');
            }

            form.setValue('bankIFSC', result.data.ifsc || ifsc, { shouldValidate: true });
            form.setValue('bankName', result.data.bankName || '', { shouldValidate: true });
            form.setValue('bankBranch', result.data.branchName || '', { shouldValidate: true });

            toast({
                title: 'IFSC verified',
                description: result.data.address
                    ? `Bank details populated. ${result.data.address}`
                    : 'Bank details populated successfully',
            });
        } catch (error) {
            console.error('Error verifying IFSC:', error);
            toast({
                title: 'IFSC verification failed',
                description: error instanceof Error ? error.message : 'Unable to fetch bank details from IFSC',
                variant: 'destructive',
            });
        } finally {
            setIsIFSCVerifying(false);
        }
    };

    const onSubmit = async (values: KYCUpdateFormValues) => {
        if (!selectedClient) {
            toast({
                title: 'Error',
                description: 'Please select a client first',
                variant: 'destructive',
            });
            return;
        }

        // Maps every enrollment-validation config fieldKey relevant to this form to its
        // KYCUpdateFormValues key + display label, so admin "Required" toggles are enforced
        // for every field, not just a hardcoded subset.
        const configKeyMap: { [configKey: string]: { formKey: keyof KYCUpdateFormValues; label: string } } = {
            clientName: { formKey: 'clientName', label: `${getPersonLabel(!!clientData?.hasLoan).singular} Name` },
            lastName: { formKey: 'lastName', label: 'Last Name' },
            mobileNumber: { formKey: 'mobileNumber', label: 'Mobile Number' },
            otherIdNo: { formKey: 'otherIdNo', label: 'Aadhaar Number' },
            pancardNo: { formKey: 'pancardNo', label: 'PAN Card Number' },
            votersIdNo: { formKey: 'voterIdNo', label: 'Voter ID Number' },
            dateOfBirth: { formKey: 'dateOfBirth', label: 'Date of Birth' },
            fatherName: { formKey: 'fatherName', label: 'Father Name' },
            gender: { formKey: 'gender', label: 'Gender' },
            permanentAddress: { formKey: 'permanentAddress', label: 'Permanent Address' },
            pincode: { formKey: 'pincode', label: 'Pincode' },
            postOffice: { formKey: 'postOffice', label: 'Post Office' },
            district: { formKey: 'district', label: 'City' },
            state: { formKey: 'state', label: 'State' },
            country: { formKey: 'country', label: 'Country' },
            email: { formKey: 'email', label: 'Email' },
            age: { formKey: 'age', label: 'Age' },
            religion: { formKey: 'religion', label: 'Religion' },
            caste: { formKey: 'caste', label: 'Caste' },
            community: { formKey: 'community', label: 'Community' },
            economicActivityTypeId: { formKey: 'economicActivityTypeId', label: 'Economic Activity Type' },
            economicActivityId: { formKey: 'economicActivityId', label: 'Economic Activity' },
            qualification: { formKey: 'qualification', label: 'Qualification' },
            maritalStatus: { formKey: 'maritalStatus', label: 'Marital Status' },
            spouseName: { formKey: 'spouseName', label: 'Spouse Name' },
            spouseDob: { formKey: 'spouseDob', label: 'Spouse DOB' },
            spouseMobileNumber: { formKey: 'spouseMobileNumber', label: 'Spouse Mobile Number' },
            spouseGender: { formKey: 'spouseGender', label: 'Spouse Gender' },
            spouseEconomicActivityTypeId: { formKey: 'spouseEconomicActivityTypeId', label: 'Spouse Economic Activity Type' },
            spouseEconomicActivityId: { formKey: 'spouseEconomicActivityId', label: 'Spouse Economic Activity' },
            noOfChildren: { formKey: 'noOfChildren', label: 'Number of Children' },
            monthlyFamilyIncome: { formKey: 'monthlyFamilyIncome', label: 'Monthly Family Income' },
            monthlyFamilyExpense: { formKey: 'monthlyFamilyExpense', label: 'Monthly Family Expense' },
            ifscCode: { formKey: 'bankIFSC', label: 'IFSC Code' },
            bankAcNo: { formKey: 'passbookNo', label: 'Bank Account Number' },
            bankName: { formKey: 'bankName', label: 'Bank Name' },
            bankBranch: { formKey: 'bankBranch', label: 'Bank Branch' },
            bankAccountType: { formKey: 'bankAccountType', label: 'Bank Account Type' },
            motherName: { formKey: 'motherName', label: 'Mother Name' },
            smartCardNo: { formKey: 'smartCardNo', label: 'Smart Card Number' },
            houseStatus: { formKey: 'houseStatus', label: 'House Status' },
            latitude: { formKey: 'latitude', label: 'Latitude' },
            longitude: { formKey: 'longitude', label: 'Longitude' },
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
            const nameParts = values.clientName.trim().split(/\s+/);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const updateData: any = {
                firstName,
                lastName: values.lastName || null,
                email: values.email || null,
                dateOfBirth: values.dateOfBirth || null,
                age: values.age ? parseInt(values.age) : null,
                gender: values.gender || null,
                fatherName: values.fatherName || null,
                motherName: values.motherName || null,
                caste: values.caste || null,
                community: values.community || null,
                religion: values.religion || null,
                economicActivityTypeId: values.economicActivityTypeId || null,
                economicActivityId: values.economicActivityId || null,
                qualification: values.qualification || null,
                maritalStatus: values.maritalStatus || null,
                spouseName: values.spouseName || null,
                spouseDob: values.spouseDob || null,
                spouseMobileNumber: values.spouseMobileNumber || null,
                spouseGender: values.spouseGender || null,
                spouseEconomicActivityTypeId: values.spouseEconomicActivityTypeId || null,
                spouseEconomicActivityId: values.spouseEconomicActivityId || null,
                noOfChildren: values.noOfChildren ? parseInt(values.noOfChildren) : null,
                monthlyFamilyIncome: values.monthlyFamilyIncome ? parseInt(values.monthlyFamilyIncome) : null,
                monthlyFamilyExpense: values.monthlyFamilyExpense ? parseInt(values.monthlyFamilyExpense) : null,
                houseStatus: values.houseStatus || null,
                bankAccountType: values.bankAccountType || null,
                permanentAddress: values.permanentAddress || null,
                pincode: values.pincode || null,
                postOffice: values.postOffice || null,
                district: values.district || null,
                state: values.state || null,
                country: values.country || null,
                mobileNumber: values.mobileNumber || null,
                bankName: values.bankName || null,
                bankBranch: values.bankBranch || null,
                bankIFSC: values.bankIFSC || null,
                bankAcNo: values.passbookNo || null,
                otherIdNo: values.otherIdNo || null,
                smartCardNo: values.smartCardNo || null,
                votersIdNo: values.voterIdNo || null,
                pancardNo: values.pancardNo || null,
                latitude: values.latitude || null,
                longitude: values.longitude || null,
                requestedAmount: values.requestedAmount || null,
            };

            Object.keys(updateData).forEach(key => {
                const isEmpty = updateData[key] === null || updateData[key] === undefined || updateData[key] === '';
                if (!isEmpty) return;
                // Blank OPTIONAL fields: strip so we don't touch the DB (unchanged
                // behavior). Blank REQUIRED fields: keep as explicit null so the
                // server-side required-fields check can catch a bypass of this
                // form's own configErrors gate above (defense-in-depth) — see
                // app/api/clients/[clientId]/route.ts.
                const configKey = CLIENT_UPDATE_FIELD_CONFIG_MAP[key];
                if (!configKey || !isFieldRequired(configKey)) {
                    delete updateData[key];
                }
            });

            const patchUrl = enableFullApprovalRestart
                ? `/clients/${selectedClient}?restartApprovalOnEdit=true`
                : `/clients/${selectedClient}`;
            const result = await apiClient.patch(patchUrl, updateData);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: `${getPersonLabel(!!clientData?.hasLoan).singular} KYC information has been updated successfully`,
                });

                form.reset();

                if (onSuccess) {
                    onSuccess();
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to update client information',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error updating client:', error);
            toast({
                title: 'Error',
                description: 'An error occurred while updating client information. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!selectedClient) {
        return (
            <div className="flex flex-col items-center justify-center py-16 px-4 border-2 border-dashed border-primary/30 dark:border-sidebar-accent rounded-lg bg-green-50 dark:bg-brand-green-darker/50">
                <User className="h-16 w-16 text-slate-400 dark:text-sidebar-accent mb-4" />
                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100 mb-2">
                    No Client Selected
                </h3>
                <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
                    Please select a client to view and update KYC information
                </p>
            </div>
        );
    }

    const showDetails = !visibleSection || visibleSection === 'details';
    const showOtherDetails = !visibleSection || visibleSection === 'other-details';

    return (
        <>
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                {isLocked && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        This {getPersonLabel(!!clientData?.hasLoan).singular.toLowerCase()} has already been approved — details are locked and cannot be edited.
                    </div>
                )}
                <fieldset disabled={isLocked} className="contents">

                {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SECTION 1: CLIENT DETAILS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                <div className={cn(showDetails ? '' : 'hidden')}>
                    <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <User className="h-5 w-5 text-primary" />
                                <CardTitle className="text-lg">{getPersonLabel(!!clientData?.hasLoan).singular} Details</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Row 1: Mobile | Aadhaar | First Name */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="mobileNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('mobileNumber')} Mobile Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="10-digit mobile number" maxLength={10}
                                                    onBlur={(e) => { field.onBlur(); checkFieldUniqueness('MOBILE', 'mobileNumber', e.target.value); }} />
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
                                            <FormLabel>{renderRequiredIndicator('otherIdNo')} Aadhaar Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="12-digit Aadhaar number" maxLength={12}
                                                    onBlur={(e) => { field.onBlur(); checkFieldUniqueness('AADHAAR', 'otherIdNo', e.target.value); }} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="clientName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('clientName')} First Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter first name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 2: Last Name | PAN Card | Voter ID */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="lastName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('lastName')} Last Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter last name" />
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
                                            <FormLabel>{renderRequiredIndicator('pancardNo')} PAN Card Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="ABCDE1234F" maxLength={10}
                                                    onBlur={(e) => { field.onBlur(); checkFieldUniqueness('PAN', 'pancardNo', e.target.value); }} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="voterIdNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('votersIdNo')} Voter ID Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter voter ID"
                                                    onBlur={(e) => { field.onBlur(); checkFieldUniqueness('VOTER_ID', 'voterIdNo', e.target.value); }} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 3: Date of Birth | Father Name | Gender */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="dateOfBirth"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('dateOfBirth')} Date of Birth</FormLabel>
                                            <FormControl>
                                                <DateInput {...field} max={RESTRICTED_MARITAL_STATUSES.includes(form.getValues('maritalStatus')) ? getMaxDobForMinAge(MIN_SINGLE_MARITAL_AGE) : undefined} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="fatherName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('fatherName')} Father's Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter father's name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="gender"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('gender')} Gender</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select gender" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Male">Male</SelectItem>
                                                    <SelectItem value="Female">Female</SelectItem>
                                                    <SelectItem value="Transgender">Transgender</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 4: Permanent Address | Pincode | Post Office */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="permanentAddress"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('permanentAddress')} Permanent Address</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter permanent address" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="pincode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('pincode')} Pincode</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl className="flex-1">
                                                    <Input {...field} placeholder="6-digit pincode" maxLength={6} />
                                                </FormControl>
                                                <Button type="button" onClick={handlePincodeVerify} disabled={isPincodeVerifying} size="sm" variant="outline">
                                                    {isPincodeVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                                                </Button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="postOffice"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('postOffice')} Post Office</FormLabel>
                                            {showPostOfficeSelect && postOfficeOptions.length > 1 ? (
                                                <Select value={field.value} onValueChange={handlePostOfficeSelect}>
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select post office" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {postOfficeOptions.map((po) => (
                                                            <SelectItem key={po.Name} value={po.Name}>
                                                                {po.Name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <FormControl>
                                                    <Input {...field} placeholder="Auto-filled from pincode" readOnly />
                                                </FormControl>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 5: State | City | Country */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('state')} State</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Auto-filled from pincode" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="district"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('district')} City / District</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Auto-filled from pincode" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="country"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('country')} Country</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Country" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                        </CardContent>
                    </Card>

                    {/* Save button for Section 1 */}
                    <div className="flex gap-3 pt-2">
                        <Button type="submit" disabled={isSubmitting} className="flex-1">
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            {isSubmitting ? 'Saving...' : `Save ${getPersonLabel(!!clientData?.hasLoan).singular} Details`}
                        </Button>
                    </div>
                </div>

                {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SECTION 2: CLIENT OTHER DETAILS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
                <div className={cn(showOtherDetails ? '' : 'hidden')}>

                    {/* Card A: Personal & Social */}
                    <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker mb-8">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <User className="h-5 w-5 text-primary" />
                                <CardTitle className="text-lg">Personal &amp; Social</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Row 1: Email | Age | Caste */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('email')} Email</FormLabel>
                                            <FormControl>
                                                <Input type="email" {...field} placeholder="Enter email" />
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
                                            <FormLabel>Age (Auto-calculated)</FormLabel>
                                            <FormControl>
                                                <Input {...field} disabled type="number" placeholder="Auto-calculated from DOB" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="caste"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('caste')} Caste</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {CASTES.map((c) => (
                                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 2: Community | Religion | Economic Activity Type */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="community"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('community')} Community</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select community" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {COMMUNITY_OPTIONS.map((c) => (
                                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="religion"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('religion')} Religion</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {RELIGIONS.map((r) => (
                                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="economicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('economicActivityTypeId')} Economic Activity Type</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('economicActivityId', '');
                                                    fetchEconomicActivities(value);
                                                }}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select activity type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {economicActivityTypes.map((type) => (
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
                            </div>

                            {/* Row 3: Economic Activity | Qualification | Marital Status */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="economicActivityId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('economicActivityId')} Economic Activity</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger disabled={isLoadingActivities}>
                                                        <SelectValue placeholder="Select activity" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {economicActivities.map((activity) => (
                                                        <SelectItem key={activity.id} value={activity.id}>
                                                            {activity.name}
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
                                    name="qualification"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('qualification')} Qualification</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select qualification" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {QUALIFICATION_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
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
                                    name="maritalStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('maritalStatus')} Marital Status</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select status" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Single">Single</SelectItem>
                                                    <SelectItem value="Married">Married</SelectItem>
                                                    <SelectItem value="Divorced">Divorced</SelectItem>
                                                    <SelectItem value="Widowed">Widowed</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 4: Spouse Name | Spouse DOB | Spouse Mobile */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="spouseName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseName')} Spouse Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter spouse name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="spouseDob"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseDob')} Spouse Date of Birth</FormLabel>
                                            <FormControl>
                                                <DateInput {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="spouseMobileNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseMobileNumber')} Spouse Mobile</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter spouse mobile" maxLength={10} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 5: Spouse Gender | Spouse Eco Type | Spouse Eco Activity */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="spouseGender"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseGender')} Spouse Gender</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select gender" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Male">Male</SelectItem>
                                                    <SelectItem value="Female">Female</SelectItem>
                                                    <SelectItem value="Transgender">Transgender</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="spouseEconomicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseEconomicActivityTypeId')} Spouse Economic Activity Type</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('spouseEconomicActivityId', '');
                                                    fetchSpouseEconomicActivities(value);
                                                }}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select activity type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {economicActivityTypes.map((type) => (
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
                                    name="spouseEconomicActivityId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('spouseEconomicActivityId')} Spouse Economic Activity</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger disabled={isLoadingSpouseActivities}>
                                                        <SelectValue placeholder="Select activity" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {spouseEconomicActivities.map((activity) => (
                                                        <SelectItem key={activity.id} value={activity.id}>
                                                            {activity.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 6: No. of Children | Monthly Income | Monthly Expense */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="noOfChildren"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('noOfChildren')} Number of Children</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} placeholder="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyIncome"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('monthlyFamilyIncome')} Monthly Family Income</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} placeholder="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyExpense"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('monthlyFamilyExpense')} Monthly Family Expense</FormLabel>
                                            <FormControl>
                                                <Input type="number" {...field} placeholder="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card B: Bank & Identity */}
                    <Card className="border-0 shadow-sm bg-white dark:bg-brand-green-darker">
                        <CardHeader className="pb-4">
                            <div className="flex items-center gap-3">
                                <Building2 className="h-5 w-5 text-primary" />
                                <CardTitle className="text-lg">Bank &amp; Identity</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {/* Row 1: Bank IFSC | Bank Name | Bank Branch */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="bankIFSC"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('ifscCode')} Bank IFSC</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl className="flex-1">
                                                    <Input {...field} placeholder="e.g., SBIN0001234" />
                                                </FormControl>
                                                <Button type="button" onClick={handleIFSCVerify} disabled={isIFSCVerifying} size="sm" variant="outline">
                                                    {isIFSCVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                                                </Button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="bankName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('bankName')} Bank Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Auto-filled from IFSC" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="bankBranch"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('bankBranch')} Bank Branch</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Auto-filled from IFSC" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 2: Bank Account Type | Account No | Retype Account No */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="bankAccountType"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('bankAccountType')} Bank Account Type</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select account type" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {['Savings Account', 'Current Account', 'Salary Account', 'Joint Account'].map((opt) => (
                                                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="passbookNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('bankAcNo')} Account / Passbook Number</FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    type="password"
                                                    onCopy={(e) => e.preventDefault()}
                                                    onCut={(e) => e.preventDefault()}
                                                    onPaste={(e) => e.preventDefault()}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    placeholder="Enter account number"
                                                    onBlur={(e) => { field.onBlur(); checkFieldUniqueness('BANK_ACCOUNT', 'passbookNo', e.target.value); }}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="retypePassbookNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('bankAcNo')} Retype Account Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Confirm account number" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Row 3: Mother Name | Smart Card | House Status */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                <FormField
                                    control={form.control}
                                    name="motherName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('motherName')} Mother's Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter mother's name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="smartCardNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('smartCardNo')} Smart Card Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} placeholder="Enter smart card number" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="houseStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{renderRequiredIndicator('houseStatus')} House Status</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select house status" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Owned">Owned</SelectItem>
                                                    <SelectItem value="Rented">Rented</SelectItem>
                                                    <SelectItem value="Leased">Leased</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                        </CardContent>
                    </Card>

                    {/* Location */}
                    <div className="pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <Button type="button" onClick={handleLocateClient} disabled={isLocating} variant="outline" className="w-full">
                                {isLocating ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {locatingLabel}</>
                                ) : (
                                    <><LocateFixed className="h-4 w-4 mr-2" /> Use My Location</>
                                )}
                            </Button>
                            <Button type="button" onClick={() => setIsMapPickerOpen(true)} variant="outline" className="w-full">
                                <Map className="h-4 w-4 mr-2" /> Select on Map
                            </Button>
                        </div>
                        <div className="mb-3">
                            <LocationSearchBox
                                onSelect={(lat, lng) => handleMapLocationChange(lat, lng)}
                                biasLat={clientMapLat ?? undefined}
                                biasLng={clientMapLng ?? undefined}
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <FormField
                                control={form.control}
                                name="latitude"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{renderRequiredIndicator('latitude')} Latitude</FormLabel>
                                        <FormControl>
                                            <Input {...field} type="number" step="0.000001" placeholder="Enter latitude" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="longitude"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{renderRequiredIndicator('longitude')} Longitude</FormLabel>
                                        <FormControl>
                                            <Input {...field} type="number" step="0.000001" placeholder="Enter longitude" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        {/* Road (driving) distance from branch/center — same OSRM calculation Create Center uses for "KM From Branch" */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                            <div className="rounded-lg border border-primary/20 bg-green-50 dark:bg-brand-green-darker/30 px-4 py-2.5">
                                <p className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Km From Branch</p>
                                <p className="text-sm font-semibold text-brand-green-darker dark:text-slate-100">
                                    {kmFromBranch.isLoading ? (
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground font-normal"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating…</span>
                                    ) : formatKm(kmFromBranch.distanceMeters)}
                                </p>
                            </div>
                            <div className="rounded-lg border border-primary/20 bg-green-50 dark:bg-brand-green-darker/30 px-4 py-2.5">
                                <p className="text-xs font-medium text-sidebar-accent dark:text-slate-400">Km From Center</p>
                                <p className="text-sm font-semibold text-brand-green-darker dark:text-slate-100">
                                    {kmFromCenter.isLoading ? (
                                        <span className="inline-flex items-center gap-1.5 text-muted-foreground font-normal"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating…</span>
                                    ) : formatKm(kmFromCenter.distanceMeters)}
                                </p>
                            </div>
                        </div>
                        {!isMapPickerOpen && (
                            <LocationPreview
                                className="mt-3"
                                latitude={form.watch('latitude')}
                                longitude={form.watch('longitude')}
                                title={`${getPersonLabel(!!clientData?.hasLoan).singular} Location`}
                            />
                        )}
                    </div>

                    {/* Save button for Section 2 */}
                    <div className="flex gap-3 pt-2">
                        <Button type="submit" disabled={isSubmitting} className="flex-1">
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                            {isSubmitting ? 'Saving...' : 'Save KYC Details'}
                        </Button>
                    </div>
                </div>

                </fieldset>
            </form>
        </Form>

        {/* Map Picker Dialog — click the map or drag the marker to set lat/long */}
        <Dialog open={isMapPickerOpen} onOpenChange={setIsMapPickerOpen}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        Select {getPersonLabel(!!clientData?.hasLoan).singular} Location
                    </DialogTitle>
                    <DialogDescription>
                        Click anywhere on the map, or drag the marker, to set the {getPersonLabel(!!clientData?.hasLoan).singular.toLowerCase()}&apos;s latitude and longitude.
                    </DialogDescription>
                </DialogHeader>
                <MapComponent
                    latitude={clientMapLat ?? DEFAULT_MAP_LAT}
                    longitude={clientMapLng ?? DEFAULT_MAP_LNG}
                    centerName={`${clientData?.firstName ?? ''} ${clientData?.lastName ?? ''}`.trim() || getPersonLabel(!!clientData?.hasLoan).singular}
                    centerCode={selectedClient}
                    address={form.watch('permanentAddress') || undefined}
                    editable
                    onLocationChange={handleMapLocationChange}
                    heightClassName="h-[50vh]"
                />
                <DialogFooter>
                    <Button type="button" onClick={() => setIsMapPickerOpen(false)} className="bg-primary hover:bg-sidebar-accent text-white">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        </>
    );
}
