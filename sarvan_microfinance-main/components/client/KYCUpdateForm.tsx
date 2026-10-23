'use client';

import { useState, useEffect, useMemo } from 'react';
import { StorageImage } from '@/components/storage/StorageMedia';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
    User,
    MapPin,
    Building2,
    CreditCard,
    IdCard,
    Save,
    RotateCcw,
    Loader2,
    CheckCircle2,
    Map,
    ChevronRight,
    ChevronLeft,
    FileImage,
    Trash2,
    Camera,
    AlertCircle,
} from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { compressImage } from '@/app/lib/image-compress';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getPersonLabel } from '@/app/lib/person-label';
import { appendKycUploadOwnerAndCategory } from '@/app/lib/kyc-document-types';
import { tokenStorage } from '@/app/lib/token-storage';
import { CLIENT_UPDATE_FIELD_CONFIG_MAP } from '@/app/lib/constants/enrollment-field-config-map';
import { DateInput } from '@/components/ui/date-input';
import { useAccurateLocation } from '@/hooks/useAccurateLocation';
import LocationPreview from '@/components/centers/LocationPreview';
import LocationPickerDialog from '@/components/centers/LocationPickerDialog';

// Step configuration
const STEPS = [
    { id: 'personal', label: 'Personal Information', icon: User },
    { id: 'social', label: 'Social & Family', icon: User },
    { id: 'contact', label: 'Contact & Address', icon: MapPin },
    { id: 'bank', label: 'Bank Details', icon: Building2 },
    { id: 'identity', label: 'Identity Documents', icon: IdCard },
    { id: 'location', label: 'Location', icon: Map },
];

const MIN_SINGLE_MARITAL_AGE = 35;
const RESTRICTED_MARITAL_STATUSES = ['Single', 'Widowed', 'Divorced'];

const getMaxDobForMinAge = (minAge: number): string => {
    const today = new Date();
    const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
    return maxDate.toISOString().split('T')[0];
};

const calculateAgeFromDob = (dob: string): number => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
};

// Flexible Validation schema - all fields optional with format-only validation
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
    spouseEconomicActivityTypeId: z.string().optional().default(''),
    spouseEconomicActivityId: z.string().optional().default(''),
    noOfChildren: z.string().optional().default(''),
    monthlyFamilyIncome: z.string().optional().default(''),
    monthlyFamilyExpense: z.string().optional().default(''),
    houseStatus: z.string().optional().default(''),
    presentAddress: z.string().trim().optional().default(''),
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
    passbookNo: z.string().trim().optional().default(''),
    retypePassbookNo: z.string().trim().optional().default(''),
    otherIdNo: z.string().trim().optional().default(''),
    smartCardNo: z.string().trim().optional().default(''),
    voterIdNo: z.string().trim().optional().default(''),
    pancardNo: z.string().trim().optional().default(''),
    requestedAmount: z.string().optional().default(''),
    latitude: z.string().trim().optional().default(''),
    longitude: z.string().trim().optional().default(''),
}).refine((data) => data.passbookNo === '' || data.retypePassbookNo === '' || data.passbookNo === data.retypePassbookNo, {
    message: 'Passbook numbers do not match',
    path: ['retypePassbookNo'],
}).refine((data) => {
    if (!RESTRICTED_MARITAL_STATUSES.includes(data.maritalStatus) || !data.dateOfBirth) return true;
    const age = calculateAgeFromDob(data.dateOfBirth);
    return isNaN(age) || age >= MIN_SINGLE_MARITAL_AGE;
}, {
    message: `Age must be greater than or equal to ${MIN_SINGLE_MARITAL_AGE} years when marital status is Single, Widowed or Divorced`,
    path: ['maritalStatus'],
});

type KYCUpdateFormValues = z.infer<typeof kycUpdateSchema>;

interface KYCUpdateFormProps {
    selectedCenter?: string;
    selectedClient: string;
    clientData: any;
    onSuccess?: () => void;
}

type KycDocument = {
    id: string;
    documentType: 'aadhaar_front' | 'aadhaar_back';
    fileUrl: string | null;
    fileName: string | null;
};

type DeleteState = {
    front: boolean;
    back: boolean;
};

export function KYCUpdateForm({ selectedCenter, selectedClient, clientData, onSuccess }: KYCUpdateFormProps) {
    const { toast } = useToast();
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    const [isLocationMapOpen, setIsLocationMapOpen] = useState(false);
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
    const [currentStep, setCurrentStep] = useState(0);
    
    // Aadhar image upload states
    const [aadhaarFrontUploading, setAadhaarFrontUploading] = useState(false);
    const [aadhaarBackUploading, setAadhaarBackUploading] = useState(false);
    const [cameraFrontOpen, setCameraFrontOpen] = useState(false);
    const [cameraBackOpen, setCameraBackOpen] = useState(false);
    const [aadhaarFrontFileName, setAadhaarFrontFileName] = useState('');
    const [aadhaarBackFileName, setAadhaarBackFileName] = useState('');
    const [aadhaarFrontCompressionNote, setAadhaarFrontCompressionNote] = useState('');
    const [aadhaarBackCompressionNote, setAadhaarBackCompressionNote] = useState('');
    const [existingKycDocuments, setExistingKycDocuments] = useState<KycDocument[]>([]);
    const [isLoadingKycDocuments, setIsLoadingKycDocuments] = useState(false);
    const [isDeleting, setIsDeleting] = useState<DeleteState>({ front: false, back: false });

    // Post office selection states
    const [postOfficeOptions, setPostOfficeOptions] = useState<Array<{ Name: string; District: string; State: string; Country?: string }>>([]);
    const [showPostOfficeSelect, setShowPostOfficeSelect] = useState(false);

    // Economic activity states
    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [spouseEconomicActivities, setSpouseEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);
    const [isLoadingSpouseActivities, setIsLoadingSpouseActivities] = useState(false);

    const form = useForm<KYCUpdateFormValues>({
        resolver: zodResolver(kycUpdateSchema),
        defaultValues: {
            clientName: '',
            lastName: '',
            email: '',
            dateOfBirth: '',
            age: '',
            gender: '',
            fatherName: '',
            motherName: '',
            caste: '',
            community: '',
            religion: '',
            economicActivityTypeId: '',
            economicActivityId: '',
            qualification: '',
            maritalStatus: '',
            spouseName: '',
            spouseEconomicActivityTypeId: '',
            spouseEconomicActivityId: '',
            noOfChildren: '',
            monthlyFamilyIncome: '',
            monthlyFamilyExpense: '',
            houseStatus: '',
            presentAddress: '',
            pincode: '',
            postOffice: '',
            district: '',
            state: '',
            country: 'India',
            mobileNumber: '',
            bankName: '',
            bankBranch: '',
            bankIFSC: '',
            passbookNo: '',
            retypePassbookNo: '',
            otherIdNo: '',
            smartCardNo: '',
            voterIdNo: '',
            pancardNo: '',
            requestedAmount: '',
            latitude: '',
            longitude: '',
        },
    });

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

    // Navigation functions
    const nextStep = () => {
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(currentStep + 1);
        }
    };

    const previousStep = () => {
        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const resetFormToStart = () => {
        form.reset();
        setCurrentStep(0);
        setAadhaarFrontFileName('');
        setAadhaarBackFileName('');
        setExistingKycDocuments([]);
    };

    const isFirstStep = currentStep === 0;
    const isLastStep = currentStep === STEPS.length - 1;

    // Fetch existing KYC documents when client is selected
    useEffect(() => {
        if (selectedClient) {
            fetchKycDocuments();
        } else {
            setExistingKycDocuments([]);
            setAadhaarFrontFileName('');
            setAadhaarBackFileName('');
        }
    }, [selectedClient]);

    // Load client data when selected
    useEffect(() => {
        if (clientData) {
            // Format date of birth for input field (YYYY-MM-DD)
            const formatDate = (date: string | Date | null | undefined) => {
                if (!date) return '';
                const d = typeof date === 'string' ? new Date(date) : date;
                if (isNaN(d.getTime())) return '';
                return d.toISOString().split('T')[0];
            };

            // Debug log to check incoming client data
            console.log('[KYC Update] Client data loaded:', {
                firstName: clientData.firstName,
                lastName: clientData.lastName,
                dateOfBirth: clientData.dateOfBirth,
                mobileNumber: clientData.mobileNumber,
                permanentAddress: clientData.permanentAddress,
                bankName: clientData.bankName,
                ifscCode: clientData.ifscCode,
            });

            const formValues = {
                clientName: clientData.firstName || '',
                lastName: clientData.lastName || '',
                email: clientData.email || '',
                dateOfBirth: formatDate(clientData.dateOfBirth),
                age: clientData.age?.toString() || calculateAge(clientData.dateOfBirth) || '',
                gender: clientData.gender || '',
                fatherName: clientData.fatherName || '',
                motherName: clientData.motherName || '',
                caste: clientData.caste || '',
                community: clientData.community || '',
                religion: clientData.religion || '',
                economicActivityTypeId: clientData.economicActivityTypeId || '',
                economicActivityId: clientData.economicActivityId || '',
                qualification: clientData.qualification || '',
                maritalStatus: clientData.maritalStatus || '',
                spouseName: clientData.spouseName || '',
                spouseEconomicActivityTypeId: clientData.spouseEconomicActivityTypeId || '',
                spouseEconomicActivityId: clientData.spouseEconomicActivityId || '',
                noOfChildren: clientData.noOfChildren?.toString() || '',
                monthlyFamilyIncome: clientData.monthlyFamilyIncome?.toString() || '',
                monthlyFamilyExpense: clientData.monthlyFamilyExpense?.toString() || '',
                houseStatus: clientData.houseStatus || '',
                presentAddress: clientData.permanentAddress || '',
                pincode: clientData.pincode || '',
                postOffice: clientData.postOffice || '',
                district: clientData.district || '',
                state: clientData.state || '',
                country: clientData.country || 'India',
                mobileNumber: clientData.mobileNumber || '',
                bankName: clientData.bankName || '',
                bankBranch: clientData.bankBranch || '',
                bankIFSC: clientData.ifscCode || '',
                passbookNo: clientData.bankAcNo || '',
                retypePassbookNo: clientData.bankAcNo || '',
                otherIdNo: clientData.otherIdNo || '',
                smartCardNo: clientData.smartCardNo || '',
                voterIdNo: clientData.votersIdNo || '',
                pancardNo: clientData.pancardNo || '',
                requestedAmount: clientData.requestedAmount?.toString() || '',
                latitude: clientData.latitude?.toString() || '',
                longitude: clientData.longitude?.toString() || '',
            };

            console.log('[KYC Update] Form values to set:', formValues);
            form.reset(formValues);

            // Fetch economic activities if type is selected
            if (clientData.economicActivityTypeId) {
                fetchEconomicActivities(clientData.economicActivityTypeId);
            }
            if (clientData.spouseEconomicActivityTypeId) {
                fetchSpouseEconomicActivities(clientData.spouseEconomicActivityTypeId);
            }
        }
    }, [clientData, form]);

    // Fetch existing KYC documents
    const fetchKycDocuments = async () => {
        if (!selectedClient) return;

        setIsLoadingKycDocuments(true);
        try {
            const result = await apiClient.get<{
                clientId: string;
                documents: Array<{
                    id: string;
                    documentType: string;
                    fileUrl: string | null;
                    fileName: string | null;
                    fileSize: number | null;
                    mimeType: string | null;
                    uploadedAt: Date;
                }>;
            }>(`/clients/${selectedClient}/kyc-documents`);

            if (result.success && result.data) {
                const documents: KycDocument[] = result.data.documents
                    .filter((doc) => doc.fileUrl && (doc.documentType === 'aadhaar_front' || doc.documentType === 'aadhaar_back'))
                    .map((doc) => ({
                        id: doc.id,
                        documentType: doc.documentType as 'aadhaar_front' | 'aadhaar_back',
                        fileUrl: doc.fileUrl,
                        fileName: doc.fileName,
                    }));

                setExistingKycDocuments(documents);

                // Set file names for display
                const frontDoc = documents.find((doc) => doc.documentType === 'aadhaar_front');
                const backDoc = documents.find((doc) => doc.documentType === 'aadhaar_back');
                
                if (frontDoc) {
                    setAadhaarFrontFileName(frontDoc.fileName || '');
                }
                if (backDoc) {
                    setAadhaarBackFileName(backDoc.fileName || '');
                }
            }
        } catch (error) {
            console.error('Error fetching KYC documents:', error);
        } finally {
            setIsLoadingKycDocuments(false);
        }
    };

    // Fetch economic activity types
    const fetchEconomicActivityTypes = async () => {
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>('/economic-activity-types');
            if (result.success && result.data) {
                setEconomicActivityTypes(result.data);
            }
        } catch (error) {
            console.error('Error fetching economic activity types:', error);
        }
    };

    // Fetch economic activities for selected type
    const fetchEconomicActivities = async (typeId: string) => {
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
    };

    // Fetch spouse economic activities for selected type
    const fetchSpouseEconomicActivities = async (typeId: string) => {
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
    };

    // Fetch economic activity types on component mount
    useEffect(() => {
        fetchEconomicActivityTypes();
    }, []);

    // Upload Aadhar image
    const uploadAadhaarImage = async (file: File, side: 'front' | 'back') => {
        if (!selectedClient) {
            toast({
                title: 'Error',
                description: 'Please select a member/client first',
                variant: 'destructive',
            });
            return;
        }

        const maxSizeBytes = 5 * 1024 * 1024;
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];

        if (file.size > maxSizeBytes) {
            toast({
                title: 'File too large',
                description: 'Please select an image smaller than 5MB',
                variant: 'destructive',
            });
            return;
        }

        if (!allowedTypes.includes(file.type)) {
            toast({
                title: 'Invalid file type',
                description: 'Please upload Aadhaar image as JPG or PNG',
                variant: 'destructive',
            });
            return;
        }

        const isFront = side === 'front';

        if (isFront) {
            setAadhaarFrontUploading(true);
        } else {
            setAadhaarBackUploading(true);
        }

        try {
            const formData = new FormData();
            const documentType = isFront ? 'aadhaar_front' : 'aadhaar_back';
            formData.append('clientId', selectedClient);
            formData.append('documentType', documentType);
            formData.append('file', file);
            appendKycUploadOwnerAndCategory(formData, documentType);

            const response = await fetch('/api/kyc/aadhaar/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();

            if (!response.ok || !result?.success) {
                const message: string =
                    (result && typeof result.message === 'string' && result.message) ||
                    (result && typeof result.error === 'string' && result.error) ||
                    'Failed to upload Aadhaar image';

                toast({
                    title: 'Upload failed',
                    description: message,
                    variant: 'destructive',
                });
                return;
            }

            const data = result.data as {
                fileUrl: string;
                fileName: string;
                fileSize: number;
                mimeType: string;
                documentType: 'aadhaar_front' | 'aadhaar_back';
            };

            // Update existing documents
            await fetchKycDocuments();

            if (data.documentType === 'aadhaar_front') {
                setAadhaarFrontFileName(data.fileName);
            } else {
                setAadhaarBackFileName(data.fileName);
            }

            toast({
                title: 'Aadhaar image uploaded',
                description: `${data.documentType === 'aadhaar_front' ? 'Front' : 'Back'} side saved successfully`,
            });
        } catch {
            toast({
                title: 'Upload error',
                description: 'Unable to upload Aadhaar image. Please try again.',
                variant: 'destructive',
            });
        } finally {
            if (isFront) {
                setAadhaarFrontUploading(false);
            } else {
                setAadhaarBackUploading(false);
            }
        }
    };

    // Calculate age from DOB
    const calculateAge = (dob: string) => {
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

    // Watch DOB changes to update age
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

    // Verify pincode
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

                    // Auto-fill with first post office
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

    // Handle post office selection
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

    // Verify IFSC
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
            console.error('Error verifying IFSC in KYC update:', error);
            toast({
                title: 'IFSC verification failed',
                description: error instanceof Error ? error.message : 'Unable to fetch bank details from IFSC',
                variant: 'destructive',
            });
        } finally {
            setIsIFSCVerifying(false);
        }
    };

    // Locate client — samples high-accuracy GPS and keeps the best fix
    const setClientLocation = (lat: number, lng: number) => {
        form.setValue('latitude', lat.toFixed(6), { shouldValidate: true, shouldDirty: true });
        form.setValue('longitude', lng.toFixed(6), { shouldValidate: true, shouldDirty: true });
    };
    const handleLocateClient = () =>
        locate({
            onPosition: setClientLocation,
            subject: `${getPersonLabel(!!clientData?.hasLoan).singular} location`,
        });

    // Delete Aadhar image
    const deleteAadhaarImage = async (side: 'front' | 'back') => {
        if (!selectedClient) {
            toast({
                title: 'Error',
                description: 'Please select a member/client first',
                variant: 'destructive',
            });
            return;
        }

        const document = existingKycDocuments.find(
            (doc) => doc.documentType === (side === 'front' ? 'aadhaar_front' : 'aadhaar_back')
        );

        if (!document) {
            toast({
                title: 'Error',
                description: 'No document found to delete',
                variant: 'destructive',
            });
            return;
        }

        const isFront = side === 'front';
        setIsDeleting((prev) => ({ ...prev, [side]: true }));

        try {
            const response = await apiClient.delete(
                `/clients/${selectedClient}/kyc-documents?documentId=${document.id}`
            );

            if (response.success) {
                toast({
                    title: 'Document deleted',
                    description: `Aadhaar ${side} image has been deleted successfully`,
                });

                await fetchKycDocuments();

                if (isFront) {
                    setAadhaarFrontFileName('');
                } else {
                    setAadhaarBackFileName('');
                }
            } else {
                toast({
                    title: 'Delete failed',
                    description: response.error || 'Failed to delete document',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting document:', error);
            toast({
                title: 'Delete error',
                description: 'Unable to delete document. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting((prev) => ({ ...prev, [side]: false }));
        }
    };

    // Submit form
    const onSubmit = async (values: KYCUpdateFormValues) => {
        if (currentStep !== STEPS.length - 1) {
            return;
        }

        if (!selectedClient) {
            toast({
                title: 'Error',
                description: 'Please select a member/client first',
                variant: 'destructive',
            });
            return;
        }

        // Validate required fields based on admin configuration
        const requiredFieldsMap: { [key in keyof KYCUpdateFormValues]?: string } = {
            clientName: `${getPersonLabel(!!clientData?.hasLoan).singular} Name`,
            dateOfBirth: 'Date of Birth',
            presentAddress: 'Permanent Address',
            mobileNumber: 'Mobile Number',
            pincode: 'Pincode',
            postOffice: 'Post Office',
            district: 'District',
            state: 'State',
            country: 'Country',
            bankName: 'Bank Name',
            bankBranch: 'Bank Branch',
            bankIFSC: 'Bank IFSC',
            passbookNo: 'Passbook No.',
        };

        const configErrors: string[] = [];
        Object.entries(requiredFieldsMap).forEach(([fieldKey, fieldLabel]) => {
            const configKey = fieldKey === 'presentAddress' ? 'permanentAddress' : fieldKey === 'bankIFSC' ? 'ifscCode' : fieldKey === 'passbookNo' ? 'bankAcNo' : fieldKey;
            if (isFieldRequired(configKey) && !values[fieldKey as keyof KYCUpdateFormValues]?.toString().trim()) {
                configErrors.push(fieldLabel);
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
                spouseEconomicActivityTypeId: values.spouseEconomicActivityTypeId || null,
                spouseEconomicActivityId: values.spouseEconomicActivityId || null,
                noOfChildren: values.noOfChildren ? parseInt(values.noOfChildren) : null,
                monthlyFamilyIncome: values.monthlyFamilyIncome ? parseInt(values.monthlyFamilyIncome) : null,
                monthlyFamilyExpense: values.monthlyFamilyExpense ? parseInt(values.monthlyFamilyExpense) : null,
                houseStatus: values.houseStatus || null,
                permanentAddress: values.presentAddress || null,
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

            const result = await apiClient.patch(`/clients/${selectedClient}`, updateData);

            if (result.success) {
                toast({
                    title: 'Success',
                    description: `${getPersonLabel(!!clientData?.hasLoan).singular} KYC information has been updated successfully`,
                });
                
                // Reset form to initial state
                resetFormToStart();
                
                // Notify parent to clear selections
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
                    No Member / Client Selected
                </h3>
                <p className="text-sm text-sidebar-accent dark:text-slate-400 text-center max-w-md">
                    Please select a member or client to view and update KYC information
                </p>
            </div>
        );
    }

    return (
        <Form {...form}>
            <form className="space-y-6">
                {isLocked && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        This {getPersonLabel(!!clientData?.hasLoan).singular.toLowerCase()} has already been approved — details are locked and cannot be edited.
                    </div>
                )}
                {/* Step Indicator */}
                <div className="mb-8">
                    <div className="flex items-center justify-between">
                        {STEPS.map((step, index) => {
                            const StepIcon = step.icon;
                            const isActive = index === currentStep;
                            const isCompleted = index < currentStep;

                            return (
                                <div key={step.id} className="flex items-center flex-1">
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className={cn(
                                                'flex h-12 w-12 items-center justify-center rounded-full border-2 transition-all',
                                                isActive && 'border-green-600 bg-green-600 text-white shadow-lg shadow-green-500/30',
                                                isCompleted && 'border-green-600 bg-green-600 text-white',
                                                !isActive && !isCompleted && 'border-primary/30 bg-white text-slate-400 dark:border-sidebar-accent dark:bg-brand-green-darker'
                                            )}
                                        >
                                            {isCompleted ? (
                                                <CheckCircle2 className="h-6 w-6" />
                                            ) : (
                                                <StepIcon className="h-6 w-6" />
                                            )}
                                        </div>
                                        <div className="mt-2 text-center">
                                            <p className={cn(
                                                'text-xs font-medium',
                                                isActive && 'text-green-600 dark:text-green-400',
                                                isCompleted && 'text-green-600 dark:text-green-400',
                                                !isActive && !isCompleted && 'text-slate-500 dark:text-slate-400'
                                            )}>
                                                Step {index + 1}
                                            </p>
                                            <p className={cn(
                                                'text-xs mt-0.5 hidden sm:block',
                                                isActive && 'text-foreground dark:text-slate-100 font-semibold',
                                                !isActive && 'text-sidebar-accent dark:text-slate-400'
                                            )}>
                                                {step.label}
                                            </p>
                                        </div>
                                    </div>
                                    {index < STEPS.length - 1 && (
                                        <div
                                            className={cn(
                                                'h-0.5 flex-1 mx-2 transition-all',
                                                index < currentStep ? 'bg-green-600' : 'bg-green-200 dark:bg-sidebar-accent'
                                            )}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Step Content */}
                <fieldset disabled={isLocked} className="contents">
                <div className="min-h-[400px]">
                    {/* Personal Information Step */}
                    {currentStep === 0 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="clientName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>First Name {renderRequiredIndicator('clientName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="lastName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Last Name {renderRequiredIndicator('lastName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="dateOfBirth"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Date of Birth {renderRequiredIndicator('dateOfBirth')}</FormLabel>
                                            <FormControl>
                                                <DateInput {...field} className="h-11" max={RESTRICTED_MARITAL_STATUSES.includes(form.getValues('maritalStatus')) ? getMaxDobForMinAge(MIN_SINGLE_MARITAL_AGE) : undefined} />
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
                                            <FormLabel>Age {renderRequiredIndicator('age')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} readOnly className="h-11 bg-brand-green-tint dark:bg-sidebar-accent" />
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
                                            <FormLabel>Gender {renderRequiredIndicator('gender')}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
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
                                    name="fatherName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Father Name {renderRequiredIndicator('fatherName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="motherName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Mother Name {renderRequiredIndicator('motherName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
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
                                            <FormLabel>Caste {renderRequiredIndicator('caste')}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="Select caste" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="General">General</SelectItem>
                                                    <SelectItem value="OBC">OBC</SelectItem>
                                                    <SelectItem value="SC">SC</SelectItem>
                                                    <SelectItem value="ST">ST</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
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
                                            <FormLabel>Religion {renderRequiredIndicator('religion')}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="Select religion" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="Hindu">Hindu</SelectItem>
                                                    <SelectItem value="Muslim">Muslim</SelectItem>
                                                    <SelectItem value="Christian">Christian</SelectItem>
                                                    <SelectItem value="Sikh">Sikh</SelectItem>
                                                    <SelectItem value="Other">Other</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="community"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Community {renderRequiredIndicator('community')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}

                    {/* Social & Family Step */}
                    {currentStep === 1 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="economicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Economic Activity Type {renderRequiredIndicator('economicActivityTypeId')}</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('economicActivityId', '');
                                                    if (value) {
                                                        fetchEconomicActivities(value);
                                                    }
                                                }}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
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
                                    name="economicActivityId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Economic Activity {renderRequiredIndicator('economicActivityId')}</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                disabled={!form.watch('economicActivityTypeId') || isLoadingActivities}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue
                                                            placeholder={isLoadingActivities ? 'Loading...' : 'Select activity'}
                                                        />
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
                                            <FormLabel>Qualification {renderRequiredIndicator('qualification')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="maritalStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Marital Status {renderRequiredIndicator('maritalStatus')}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
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

                                <FormField
                                    control={form.control}
                                    name="spouseName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spouse Name {renderRequiredIndicator('spouseName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="spouseEconomicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spouse Economic Activity Type {renderRequiredIndicator('spouseEconomicActivityTypeId')}</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('spouseEconomicActivityId', '');
                                                    if (value) {
                                                        fetchSpouseEconomicActivities(value);
                                                    }
                                                }}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="Select spouse activity type" />
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
                                            <FormLabel>Spouse Economic Activity {renderRequiredIndicator('spouseEconomicActivityId')}</FormLabel>
                                            <Select
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                disabled={!form.watch('spouseEconomicActivityTypeId') || isLoadingSpouseActivities}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue
                                                            placeholder={isLoadingSpouseActivities ? 'Loading...' : 'Select spouse activity'}
                                                        />
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

                                <FormField
                                    control={form.control}
                                    name="noOfChildren"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Number of Children {renderRequiredIndicator('noOfChildren')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-11" />
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
                                            <FormLabel>House Status {renderRequiredIndicator('houseStatus')}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="Select status" />
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

                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyIncome"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly Family Income {renderRequiredIndicator('monthlyFamilyIncome')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyExpense"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Monthly Family Expense {renderRequiredIndicator('monthlyFamilyExpense')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}

                    {/* Contact & Address Step */}
                    {currentStep === 2 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="mobileNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Mobile Number {renderRequiredIndicator('mobileNumber')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} maxLength={10} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Email {renderRequiredIndicator('email')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="email" className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="presentAddress"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Present Address {renderRequiredIndicator('address')}</FormLabel>
                                            <FormControl>
                                                <Textarea {...field} rows={3} />
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
                                            <FormLabel>Pincode {renderRequiredIndicator('pincode')}</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input {...field} maxLength={6} className="h-11" />
                                                </FormControl>
                                                <Button
                                                    type="button"
                                                    onClick={handlePincodeVerify}
                                                    disabled={isPincodeVerifying}
                                                    className="h-11"
                                                >
                                                    {isPincodeVerifying ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        'Verify'
                                                    )}
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
                                            <FormLabel>Post Office {renderRequiredIndicator('postOffice')}</FormLabel>
                                            <FormControl>
                                                {showPostOfficeSelect && postOfficeOptions.length > 1 ? (
                                                    <Select value={field.value} onValueChange={handlePostOfficeSelect}>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="Select post office" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {postOfficeOptions.map((po) => (
                                                                <SelectItem key={po.Name} value={po.Name}>
                                                                    {po.Name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Input
                                                        {...field}
                                                        className="h-11"
                                                        placeholder="Enter post office (auto-filled from pincode)"
                                                        readOnly
                                                    />
                                                )}
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
                                            <FormLabel>District {renderRequiredIndicator('district')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>State {renderRequiredIndicator('state')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="country"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Country {renderRequiredIndicator('country')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}

                    {/* Bank Details Step */}
                    {currentStep === 3 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="bankIFSC"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank IFSC {renderRequiredIndicator('ifscCode')}</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input {...field} className="h-11 uppercase" />
                                                </FormControl>
                                                <Button
                                                    type="button"
                                                    onClick={handleIFSCVerify}
                                                    disabled={isIFSCVerifying}
                                                    className="h-11"
                                                >
                                                    {isIFSCVerifying ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        'Verify'
                                                    )}
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
                                            <FormLabel>Bank Name {renderRequiredIndicator('bankName')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
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
                                            <FormLabel>Bank Branch {renderRequiredIndicator('bankBranch')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="passbookNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Passbook No. {renderRequiredIndicator('bankAcNo')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="retypePassbookNo"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Re-type Passbook No. {renderRequiredIndicator('bankAcNo')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="requestedAmount"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2">
                                            <FormLabel>Requested Amount {renderRequiredIndicator('requestedAmount')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    )}

                    {/* Identity Documents Step */}
                    {currentStep === 4 && (
                        <div className="space-y-6">
                            {/* Aadhaar Image Upload Section */}
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 mb-4">
                                    <FileImage className="h-5 w-5 text-emerald-600" />
                                    <h3 className="text-lg font-semibold text-foreground dark:text-slate-100">
                                        Aadhaar Card Images
                                    </h3>
                                </div>
                                
                                {isLoadingKycDocuments ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                                        <span className="ml-2 text-sm text-sidebar-accent dark:text-slate-400">
                                            Loading existing documents...
                                        </span>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {/* Aadhaar Front Image */}
                                        <div className="space-y-3">
                                            <Label className="text-sm font-semibold">
                                                Aadhaar Front Image
                                            </Label>
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="file"
                                                        accept="image/jpeg,image/jpg,image/png"
                                                        disabled={aadhaarFrontUploading}
                                                        onChange={async (event) => {
                                                            const raw = event.target.files?.[0];
                                                            if (raw) {
                                                                const result = await compressImage(raw, 'aadhaar_front');
                                                                URL.revokeObjectURL(result.previewUrl);
                                                                setAadhaarFrontCompressionNote(result.wasCompressed ? `Compressed ${result.originalSizeLabel} → ${result.compressedSizeLabel} (saved ${result.reductionPercent}%)` : '');
                                                                void uploadAadhaarImage(result.compressedFile, 'front');
                                                            }
                                                        }}
                                                        className="h-11 flex-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-11 w-11 shrink-0"
                                                        onClick={() => setCameraFrontOpen(true)}
                                                        disabled={aadhaarFrontUploading}
                                                        title="Take photo for Aadhaar Front"
                                                    >
                                                        <Camera className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                {aadhaarFrontUploading && (
                                                    <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-slate-400">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        <span>Uploading...</span>
                                                    </div>
                                                )}
                                                {aadhaarFrontFileName && !aadhaarFrontUploading && (
                                                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                                                        <CheckCircle2 className="h-4 w-4" />
                                                        <span>Uploaded: {aadhaarFrontFileName}</span>
                                                    </div>
                                                )}
                                                {aadhaarFrontCompressionNote && !aadhaarFrontUploading && (
                                                    <div className="text-[10px] text-blue-600 dark:text-blue-400">
                                                        {aadhaarFrontCompressionNote}
                                                    </div>
                                                )}
                                                {existingKycDocuments.find((doc) => doc.documentType === 'aadhaar_front') && (
                                                    <div className="mt-2 p-3 bg-green-50 dark:bg-brand-green-darker rounded-lg border border-primary/20 dark:border-sidebar-accent">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-xs font-medium text-sidebar-accent dark:text-slate-300">
                                                                Current Image
                                                            </span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => deleteAadhaarImage('front')}
                                                                disabled={isDeleting.front}
                                                                className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                                            >
                                                                {isDeleting.front ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="h-3 w-3" />
                                                                )}
                                                            </Button>
                                                        </div>
                                                        <div className="relative w-full h-32 bg-brand-green-tint dark:bg-sidebar-accent rounded overflow-hidden">
                                                            <StorageImage
                                                                src={existingKycDocuments.find((doc) => doc.documentType === 'aadhaar_front')?.fileUrl || ''}
                                                                alt="Aadhaar Front"
                                                                className="w-full h-full object-contain"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Aadhaar Back Image */}
                                        <div className="space-y-3">
                                            <Label className="text-sm font-semibold">
                                                Aadhaar Back Image
                                            </Label>
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="file"
                                                        accept="image/jpeg,image/jpg,image/png"
                                                        disabled={aadhaarBackUploading}
                                                        onChange={async (event) => {
                                                            const raw = event.target.files?.[0];
                                                            if (raw) {
                                                                const result = await compressImage(raw, 'aadhaar_back');
                                                                URL.revokeObjectURL(result.previewUrl);
                                                                setAadhaarBackCompressionNote(result.wasCompressed ? `Compressed ${result.originalSizeLabel} → ${result.compressedSizeLabel} (saved ${result.reductionPercent}%)` : '');
                                                                void uploadAadhaarImage(result.compressedFile, 'back');
                                                            }
                                                        }}
                                                        className="h-11 flex-1"
                                                    />
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="icon"
                                                        className="h-11 w-11 shrink-0"
                                                        onClick={() => setCameraBackOpen(true)}
                                                        disabled={aadhaarBackUploading}
                                                        title="Take photo for Aadhaar Back"
                                                    >
                                                        <Camera className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                                {aadhaarBackUploading && (
                                                    <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-slate-400">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        <span>Uploading...</span>
                                                    </div>
                                                )}
                                                {aadhaarBackFileName && !aadhaarBackUploading && (
                                                    <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                                                        <CheckCircle2 className="h-4 w-4" />
                                                        <span>Uploaded: {aadhaarBackFileName}</span>
                                                    </div>
                                                )}
                                                {aadhaarBackCompressionNote && !aadhaarBackUploading && (
                                                    <div className="text-[10px] text-blue-600 dark:text-blue-400">
                                                        {aadhaarBackCompressionNote}
                                                    </div>
                                                )}
                                                {existingKycDocuments.find((doc) => doc.documentType === 'aadhaar_back') && (
                                                    <div className="mt-2 p-3 bg-green-50 dark:bg-brand-green-darker rounded-lg border border-primary/20 dark:border-sidebar-accent">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-xs font-medium text-sidebar-accent dark:text-slate-300">
                                                                Current Image
                                                            </span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => deleteAadhaarImage('back')}
                                                                disabled={isDeleting.back}
                                                                className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                                                            >
                                                                {isDeleting.back ? (
                                                                    <Loader2 className="h-3 w-3 animate-spin" />
                                                                ) : (
                                                                    <Trash2 className="h-3 w-3" />
                                                                )}
                                                            </Button>
                                                        </div>
                                                        <div className="relative w-full h-32 bg-brand-green-tint dark:bg-sidebar-accent rounded overflow-hidden">
                                                            <StorageImage
                                                                src={existingKycDocuments.find((doc) => doc.documentType === 'aadhaar_back')?.fileUrl || ''}
                                                                alt="Aadhaar Back"
                                                                className="w-full h-full object-contain"
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Other Identity Documents */}
                            <div className="space-y-4 pt-4 border-t border-primary/20 dark:border-sidebar-accent">
                                <h3 className="text-lg font-semibold text-foreground dark:text-slate-100">
                                    Other Identity Documents
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="otherIdNo"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Other ID No. (Aadhaar) {renderRequiredIndicator('otherIdNo')}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className="h-11" />
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
                                                <FormLabel>Smart Card No. {renderRequiredIndicator('smartCardNo')}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className="h-11" />
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
                                                <FormLabel>Voter ID No. {renderRequiredIndicator('votersIdNo')}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className="h-11" />
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
                                                <FormLabel>Pancard No. {renderRequiredIndicator('pancardNo')}</FormLabel>
                                                <FormControl>
                                                    <Input {...field} className="h-11 uppercase" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Location Step */}
                    {currentStep === 5 && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="latitude"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Latitude {renderRequiredIndicator('latitude')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" step="any" className="h-11" />
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
                                            <FormLabel>Longitude {renderRequiredIndicator('longitude')}</FormLabel>
                                            <FormControl>
                                                <Input {...field} type="number" step="any" className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleLocateClient}
                                        disabled={isLocating}
                                        className="w-full h-11"
                                    >
                                        {isLocating
                                            ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            : <Map className="h-4 w-4 mr-2" />}
                                        {isLocating ? locatingLabel : 'Locate Client'}
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setIsLocationMapOpen(true)}
                                        className="w-full h-11"
                                    >
                                        <MapPin className="h-4 w-4 mr-2" />
                                        Select on Map
                                    </Button>
                                </div>
                            </div>
                            {!isLocationMapOpen && (
                                <LocationPreview
                                    latitude={form.watch('latitude')}
                                    longitude={form.watch('longitude')}
                                    title={`${getPersonLabel(!!clientData?.hasLoan).singular} Location`}
                                />
                            )}
                            <LocationPickerDialog
                                open={isLocationMapOpen}
                                onOpenChange={setIsLocationMapOpen}
                                latitude={form.watch('latitude')}
                                longitude={form.watch('longitude')}
                                title={`Select ${getPersonLabel(!!clientData?.hasLoan).singular} Location`}
                                markerTitle={`${getPersonLabel(!!clientData?.hasLoan).singular} Location`}
                                onLocationChange={setClientLocation}
                            />
                        </div>
                    )}
                </div>
                </fieldset>

                {/* Navigation Buttons */}
                <div className="flex items-center justify-between pt-6 border-t">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={previousStep}
                        disabled={isFirstStep}
                        className="h-11 px-6"
                    >
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Previous
                    </Button>

                    <div className="flex items-center gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={resetFormToStart}
                            disabled={isSubmitting}
                            className="h-11 px-6"
                        >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Reset
                        </Button>

                        {!isLastStep ? (
                            <Button
                                type="button"
                                onClick={nextStep}
                                className="h-11 px-8 bg-green-600 hover:bg-green-700"
                            >
                                Next
                                <ChevronRight className="h-4 w-4 ml-2" />
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                onClick={form.handleSubmit(onSubmit)}
                                disabled={isSubmitting || isLocked}
                                className="h-11 px-8 bg-green-600 hover:bg-green-700"
                            >
                                {isSubmitting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <Save className="h-4 w-4 mr-2" />
                                        Save Changes
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
            </form>

            <CameraCapture
                open={cameraFrontOpen}
                onClose={() => setCameraFrontOpen(false)}
                onCapture={async (file) => {
                    const result = await compressImage(file, 'aadhaar_front');
                    URL.revokeObjectURL(result.previewUrl);
                    setAadhaarFrontCompressionNote(result.wasCompressed ? `Compressed ${result.originalSizeLabel} → ${result.compressedSizeLabel} (saved ${result.reductionPercent}%)` : '');
                    void uploadAadhaarImage(result.compressedFile, 'front');
                }}
                label="Aadhaar Front"
            />
            <CameraCapture
                open={cameraBackOpen}
                onClose={() => setCameraBackOpen(false)}
                onCapture={async (file) => {
                    const result = await compressImage(file, 'aadhaar_back');
                    URL.revokeObjectURL(result.previewUrl);
                    setAadhaarBackCompressionNote(result.wasCompressed ? `Compressed ${result.originalSizeLabel} → ${result.compressedSizeLabel} (saved ${result.reductionPercent}%)` : '');
                    void uploadAadhaarImage(result.compressedFile, 'back');
                }}
                label="Aadhaar Back"
            />
        </Form>
    );
}