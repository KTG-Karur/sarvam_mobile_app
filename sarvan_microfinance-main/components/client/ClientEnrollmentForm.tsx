'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    UserPlus,
    FileText,
    Users,
    CheckCircle2,
    AlertCircle,
    Save,
    X,
    ChevronRight,
    ChevronLeft,
    Loader2,
    Shield,
    Phone,
    CreditCard,
    MapPin,
    Calendar,
    Building2,
    Home,
    ShieldCheck,
    Send,
    Info,
    CheckCircle,
    XCircle,
    ImageIcon,
    History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { CreditReportResult } from '@/components/highmark/RunCreditCheckClient';
import type { HighmarkReportSummary } from '@/components/highmark/types';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/app/hooks/usePermission';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { branchStorage, type StoredBranch } from '@/app/lib/branch-storage';
import { InlineBranchSwitcher } from '@/components/branch/InlineBranchSwitcher';
import { LOAN_FEES } from '@/app/lib/config';
import { QRCodeCanvas } from 'qrcode.react';
import { useFileUpload } from '@/hooks/useFileUpload';
import { useEnrollmentValidation } from '@/hooks/useEnrollmentValidation';
import { useLocalDraft } from '@/hooks/useLocalDraft';
import {
    DocumentInputWithUpload,
    type DocumentFieldOutput,
} from '@/components/enrollment/DocumentInputWithUpload';
import { type AadhaarQRData } from '@/components/enrollment/AadhaarQRScanner';
import { valuesMatchAfterNormalization, type IdentityField } from '@/app/lib/identity-normalization';
import {
    validateMobile,
    validatePAN,
    validateVoterID,
    validateAadhaar,
    validateEmail,
    validateName,
    validatePincode,
    validateIFSC,
    validateBankAccount,
    validateAmount,
    validateAge,
    formatPAN,
    formatIFSC,
    formatVoterID,
    formatAadhaar,
    sanitizeInput,
} from '@/app/lib/validations/field-validations';
import { clientEnrollmentSchema, type ClientEnrollmentData } from '@/app/lib/validations/client-enrollment.validation';
import { QUALIFICATION_OPTIONS } from '@/app/lib/constants/form-options';
import { DateInput } from '@/components/ui/date-input';
import { useAccurateLocation, LOW_ACCURACY_WARN_METERS } from '@/hooks/useAccurateLocation';
import LocationPreview from '@/components/centers/LocationPreview';
import LocationPickerDialog from '@/components/centers/LocationPickerDialog';
import LocationSearchBox from '@/components/centers/LocationSearchBox';

interface PostOffice {
    Name: string;
    District: string;
    State: string;
    Country: string;
}

interface PincodeResponse {
    Status: string;
    PostOffice?: PostOffice[];
    Message?: string;
}

interface KYCVerificationData {
    mobileNumber: string;
    caVoterIdNo: string;
    votersIdNo: string;
    caOtherIdNo: string;
    otherIdNo: string;
    pancardNo: string;
    caPancardNo: string;
    smartCardNo: string;
    aadhaarFrontFileUrl?: string;
    aadhaarFrontFileName?: string;
    aadhaarFrontFileSize?: number;
    aadhaarFrontMimeType?: string;
    aadhaarBackFileUrl?: string;
    aadhaarBackFileName?: string;
    aadhaarBackFileSize?: number;
    aadhaarBackMimeType?: string;
}

interface ClientDetailsData {
    clientId: string;
    clientName: string;
    lastName: string;
    phone: string;
    email: string;
    permanentAddress: string;
    pincode: string;
    postOffice: string;
    district: string;
    state: string;
    country: string;
    dateOfBirth: string;
    age: string;
    gender: string;
    caste: string;
    community: string;
    religion: string;
    economicActivityTypeId: string;
    economicActivityId: string;
    qualification: string;
    maritalStatus: string;
    spouseName: string;
    spouseDob: string;
    spouseMobileNumber: string;
    spouseGender: string;
    spouseEconomicActivityTypeId: string;
    spouseEconomicActivityId: string;
    noOfChildren: string;
    monthlyFamilyIncome: string;
    monthlyFamilyExpense: string;
    ifscCode: string;
    bankAcNo: string;
    retypeBankAcNo: string;
    bankName: string;
    bankBranch: string;
    bankAccountType: string;
    houseStatus: string;
    fatherName: string;
    motherName: string;
    memberGroupStatus: string;
    requestedCenterId: string;
    requestedGroupId: string;
}

interface NomineeData {
    nomineeName: string;
    phoneNumber: string;
    gender: string;
    dateOfBirth: string;
    age: string;
    relationWithClient: string;
    requestedLoanProductTypeId: string;
    requestedLoanFrequency: string;
    requestedLoanProductId: string;
    requestedLoanPurposeTypeId: string;
    requestedLoanPurposeId: string;
    coApplicantEconomicActivityTypeId: string;
    coApplicantEconomicActivityId: string;
}

interface ValidationErrors {
    [key: string]: string;
}

// Response of GET /api/clients/[clientId]/renewal-prefill — the approved
// member snapshot used to hydrate every tab in Renewal Loan mode.
interface RenewalPrefill {
    clientId: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    email?: string | null;
    mobileNumber?: string | null;
    otherIdNo?: string | null;
    pancardNo?: string | null;
    votersIdNo?: string | null;
    smartCardNo?: string | null;
    caOtherIdNo?: string | null;
    caPancardNo?: string | null;
    caVoterIdNo?: string | null;
    dateOfBirth?: string | null;
    age?: number | string | null;
    gender?: string | null;
    caste?: string | null;
    community?: string | null;
    religion?: string | null;
    qualification?: string | null;
    maritalStatus?: string | null;
    fatherName?: string | null;
    motherName?: string | null;
    spouseName?: string | null;
    spouseDob?: string | null;
    spouseMobileNumber?: string | null;
    spouseGender?: string | null;
    spouseEconomicActivityTypeId?: string | null;
    spouseEconomicActivityId?: string | null;
    noOfChildren?: number | string | null;
    monthlyFamilyIncome?: number | string | null;
    monthlyFamilyExpense?: number | string | null;
    economicActivityTypeId?: string | null;
    economicActivityId?: string | null;
    houseStatus?: string | null;
    ifscCode?: string | null;
    bankAcNo?: string | null;
    bankName?: string | null;
    bankBranch?: string | null;
    bankAccountType?: string | null;
    permanentAddress?: string | null;
    pincode?: string | null;
    postOffice?: string | null;
    district?: string | null;
    state?: string | null;
    country?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    center?: { id: string; name?: string; code?: string; branchId?: string } | null;
    group?: { id: string; name?: string; code?: string } | null;
    latestHighmark?: { creditScore: number | null; status: string | null } | null;
    kycDocuments?: Array<{ documentType: string; fileUrl: string | null; fileName: string | null; mimeType: string | null }>;
}

interface IfscLookupResult {
    ifsc: string;
    bankName: string;
    branchName: string;
    address: string;
    city?: string;
    district?: string;
    state?: string;
    contact?: string;
    centre?: string;
    micr?: string;
}

type TabId = 'highmark' | 'credit-check' | 'client' | 'nominee' | 'loan-details' | 'kyc-uploads';

const TABS: Array<{ id: TabId; name: string; shortName: string; icon: React.ElementType }> = [
    { id: 'highmark',     name: 'Member Details',        shortName: 'Details', icon: Shield      },
    { id: 'credit-check', name: 'Credit Check',          shortName: 'Credit',  icon: ShieldCheck },
    { id: 'client',       name: 'Member Other Details',  shortName: 'Other',   icon: FileText    },
    { id: 'nominee',      name: 'Co-Applicant Details',  shortName: 'Co-App',  icon: Users       },
    { id: 'loan-details', name: 'Loan Details',          shortName: 'Loan',    icon: CreditCard  },
    { id: 'kyc-uploads',  name: 'KYC Details',           shortName: 'KYC',     icon: ImageIcon   },
];
const TAB_ORDER: TabId[] = ['highmark', 'credit-check', 'client', 'nominee', 'loan-details', 'kyc-uploads'];

const FIELD_TO_TAB: Record<string, TabId> = {
    mobileNumber: 'highmark',
    otherIdNo: 'highmark',
    pancardNo: 'highmark',
    smartCardNo: 'highmark',

    clientName: 'client',
    firstName: 'client',
    lastName: 'client',
    phone: 'client',
    email: 'client',
    dateOfBirth: 'client',
    age: 'client',
    gender: 'client',
    caste: 'client',
    community: 'client',
    religion: 'client',
    qualification: 'client',
    maritalStatus: 'client',
    houseStatus: 'client',
    fatherName: 'client',
    motherName: 'client',
    noOfChildren: 'client',
    permanentAddress: 'client',
    pincode: 'client',
    postOffice: 'client',
    district: 'client',
    state: 'client',
    country: 'client',
    economicActivityTypeId: 'client',
    economicActivityId: 'client',
    monthlyFamilyIncome: 'client',
    monthlyFamilyExpense: 'client',
    ifscCode: 'client',
    bankAcNo: 'client',
    retypeBankAcNo: 'client',
    bankName: 'client',
    bankBranch: 'client',
    bankAccountType: 'client',
    votersIdNo: 'client',
    latitude: 'client',
    longitude: 'client',

    nomineeName: 'nominee',
    coApplicantName: 'nominee',
    nomineePhoneNumber: 'nominee',
    coApplicantMobileNumber: 'nominee',
    nomineeGender: 'nominee',
    coApplicantGender: 'nominee',
    nomineeDateOfBirth: 'nominee',
    coApplicantDob: 'nominee',
    nomineeAge: 'nominee',
    coApplicantAge: 'nominee',
    nomineeRelation: 'nominee',
    coApplicantRelation: 'nominee',
    caOtherIdNo: 'nominee',
    caPancardNo: 'nominee',
    caVoterIdNo: 'nominee',
    coApplicantEconomicActivityTypeId: 'nominee',
    coApplicantEconomicActivityId: 'nominee',

    memberGroupStatus: 'loan-details',
    requestedCenterId: 'loan-details',
    requestedGroupId: 'loan-details',
    requestedLoanProductTypeId: 'loan-details',
    requestedLoanFrequency: 'loan-details',
    requestedLoanProductId: 'loan-details',
    requestedLoanPurposeTypeId: 'loan-details',
    requestedLoanPurposeId: 'loan-details',
};

// Required document types for client - Voter ID and Signature removed
const REQUIRED_CLIENT_DOCS = [
    { key: 'client_photo', label: 'Member Photo', accept: 'image/jpeg,image/jpg,image/png' },
    { key: 'pan_card', label: 'PAN Card', accept: 'image/jpeg,image/jpg,image/png' },
    { key: 'bank_passbook', label: 'Bank Passbook', accept: 'image/jpeg,image/jpg,image/png,application/pdf' },
];

// Required document types for co-applicant - Voter ID removed
const REQUIRED_COAPPLICANT_DOCS = [
    { key: 'co_applicant_photo', label: 'Co-Applicant Photo', accept: 'image/jpeg,image/jpg,image/png' },
    { key: 'co_applicant_aadhaar_back', label: 'Co-Applicant Aadhaar - Back', accept: 'image/jpeg,image/jpg,image/png' },
    { key: 'co_applicant_pan_card', label: 'Co-Applicant PAN Card', accept: 'image/jpeg,image/jpg,image/png' },
    { key: 'co_applicant_other_id', label: 'Co-Applicant Aadhaar - Front', accept: 'image/jpeg,image/jpg,image/png,application/pdf' },
];

const GENDERS = ['Male', 'Female', 'Transgender', 'Other'];
const CASTES = ['General', 'OBC', 'SC', 'ST', 'Other'];
const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Other'];
const MARITAL_STATUS = ['Single', 'Married', 'Divorced', 'Widowed'];
const MIN_SINGLE_MARITAL_AGE = 35;
const RESTRICTED_MARITAL_STATUSES = ['Single', 'Widowed', 'Divorced'];
const HOUSE_STATUS = ['Owned', 'Rented', 'Leased', 'Other'];
const RELATIONSHIPS = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister'];
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

// Mirrors app/api/loans/[loanId]/update-product/route.ts's tenureMonths derivation
// so the enrollment form's auto-fetched "Tenure" display matches what the loan
// would actually get if auto-created from these same product/frequency values.
function computeTenureMonths(numberOfDues: number, frequency: string): number {
    const freq = (frequency || '').toLowerCase();
    if (freq === 'weekly') return Math.ceil(numberOfDues / 4.33);
    if (freq === 'forthnight') return Math.ceil(numberOfDues / 2.17);
    if (freq === 'daily') return Math.ceil(numberOfDues / 30);
    if (freq === 'quarterly') return numberOfDues * 3;
    return numberOfDues;
}

const RESIDENCE_DOC_LABELS: Record<string, string> = {
    house_image_1: 'House Image 1',
    house_image_2: 'House Image 2',
    house_image_3: 'House Image 3',
    gas_bill: 'NOC (Gas Bill)',
    noc_image_1: 'NOC Image 1',
    noc_image_2: 'NOC Image 2',
    noc_image_3: 'NOC Image 3',
};

export function ClientEnrollmentForm() {
    const router = useRouter();
    const { canPage } = usePermission();
    const canCreateClient = canPage('/dashboard/client/enrollment', 'add');
    const { toast } = useToast();
    const { config: validationConfig, isLoading: isLoadingValidation } = useEnrollmentValidation();
    const [activeTab, setActiveTab] = useState<TabId>('highmark');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ── Loan Type: New Member enrollment vs Renewal Loan ────────────────────
    // Renewal reuses this exact 6-tab form: the member is picked from
    // Center → Group → Member, every tab is pre-filled from the approved
    // member record (shown but frozen), and only the address/location,
    // co-applicant, Loan Details and house KYC are editable. On submit it goes
    // to POST /api/loans/renewal-application (FDO → BM → AM → QC → Admin chain).
    const searchParams = useSearchParams();
    const [loanType, setLoanType] = useState<'MEMBER_ENROLLMENT' | 'RENEWAL_LOAN'>(
        searchParams.get('loanType') === 'renewal' ? 'RENEWAL_LOAN' : 'MEMBER_ENROLLMENT'
    );
    const renewalMode = loanType === 'RENEWAL_LOAN';
    const [rnCenters, setRnCenters] = useState<Array<{ id: string; name: string; code: string }>>([]);
    const [rnCenterId, setRnCenterId] = useState('');
    const [rnGroupId, setRnGroupId] = useState('');
    const [rnEligibleMembers, setRnEligibleMembers] = useState<Array<{
        id: string; clientId: string; name: string; hasGroup?: boolean; isDefaultMember?: boolean;
        groupId?: string | null; groupName?: string | null; groupCode?: string | null;
    }>>([]);
    const [rnMemberId, setRnMemberId] = useState(''); // Client.id of the picked member
    const [rnLoadingPrefill, setRnLoadingPrefill] = useState(false);
    const [rnPrefilled, setRnPrefilled] = useState(false);
    const [rnCoMode, setRnCoMode] = useState<'existing' | 'new'>('existing');
    const [rnCoApplicantId, setRnCoApplicantId] = useState('');
    const [rnExistingCoApplicants, setRnExistingCoApplicants] = useState<Array<{
        id: string; name: string; relationWithClient: string; isPrimary: boolean;
        gender?: string | null; dateOfBirth?: string | null; age?: number | null;
        mobileNumber?: string | null; voterIdNo?: string | null; otherIdNo?: string | null; pancardNo?: string | null;
        economicActivityTypeId?: string | null; economicActivityId?: string | null;
    }>>([]);
    const [rnSubmitting, setRnSubmitting] = useState(false);

    const [isMounted, setIsMounted] = useState(false);
    const [isMobileLooking, setIsMobileLooking] = useState(false);
    // Generic identity-uniqueness conflict messages, keyed by form field name
    // (mobileNumber, otherIdNo, pancardNo, votersIdNo, bankAcNo, nomineePhoneNumber,
    // caOtherIdNo, caPancardNo, caVoterIdNo). Populated by onBlur checks against
    // /clients/check-identity-uniqueness.
    const [identityConflicts, setIdentityConflicts] = useState<Record<string, string>>({});
    const [isFetchingIfsc, setIsFetchingIfsc] = useState(false);
    const [ifscLookupAddress, setIfscLookupAddress] = useState('');
    const ifscLookupRequestRef = useRef(0);

    // Validation Errors State
    const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

    // Pincode post office options
    const [postOfficeOptions, setPostOfficeOptions] = useState<PostOffice[]>([]);
    const [showPostOfficeSelect, setShowPostOfficeSelect] = useState(false);
    const [isFetchingPincode, setIsFetchingPincode] = useState(false);

    // Aadhaar QR Scanner State
    const [aadhaarQRData, setAadhaarQRData] = useState<AadhaarQRData | null>(null);

    // Form Data States
    const [kycData, setKycData] = useState<KYCVerificationData>({
        mobileNumber: '',
        caVoterIdNo: '',
        votersIdNo: '',
        caOtherIdNo: '',
        otherIdNo: '',
        pancardNo: '',
        caPancardNo: '',
        smartCardNo: '',
        aadhaarFrontFileUrl: '',
        aadhaarFrontFileName: '',
        aadhaarFrontFileSize: undefined,
        aadhaarFrontMimeType: '',
        aadhaarBackFileUrl: '',
        aadhaarBackFileName: '',
        aadhaarBackFileSize: undefined,
        aadhaarBackMimeType: '',
    });

    const [clientData, setClientData] = useState<ClientDetailsData>({
        clientId: '',
        clientName: '',
        lastName:'',
        phone: '',
        email: '',
        permanentAddress: '',
        pincode: '',
        postOffice: '',
        district: '',
        state: '',
        country: 'India',
        dateOfBirth: '',
        age: '',
        gender: '',
        caste: '',
        community: '',
        religion: '',
        economicActivityTypeId: '',
        economicActivityId: '',
        qualification: '',
        maritalStatus: '',
        spouseName: '',
        spouseDob: '',
        spouseMobileNumber: '',
        spouseGender: '',
        spouseEconomicActivityTypeId: '',
        spouseEconomicActivityId: '',
        noOfChildren: '',
        monthlyFamilyIncome: '',
        monthlyFamilyExpense: '',
        ifscCode: '',
        bankAcNo: '',
        retypeBankAcNo: '',
        bankName: '',
        bankBranch: '',
        bankAccountType: '',
        houseStatus: '',
        fatherName: '',
        motherName: '',
        memberGroupStatus: '',
        requestedCenterId: '',
        requestedGroupId: '',
    });
    const isIfscLocked = validateIFSC(clientData.ifscCode || '', true).isValid;

    const [nomineeData, setNomineeData] = useState<NomineeData>({
        nomineeName: '',
        phoneNumber: '',
        gender: '',
        dateOfBirth: '',
        age: '',
        relationWithClient: '',
        requestedLoanProductTypeId: '',
        requestedLoanFrequency: 'weekly',
        requestedLoanProductId: '',
        requestedLoanPurposeTypeId: '',
        requestedLoanPurposeId: '',
        coApplicantEconomicActivityTypeId: '',
        coApplicantEconomicActivityId: '',
    });

    // First-render snapshots — used to wipe a fetched renewal member's data when the
    // FDO re-picks Center / Group / Member (see resetRenewalMember).
    const initialKycDataRef = useRef(kycData);
    const initialClientDataRef = useRef(clientData);
    const initialNomineeDataRef = useRef(nomineeData);

    // Economic Activity Type and Activity states
    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [spouseEconomicActivities, setSpouseEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [coApplicantEconomicActivities, setCoApplicantEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);
    const [isLoadingSpouseActivities, setIsLoadingSpouseActivities] = useState(false);
    const [isLoadingCoApplicantActivities, setIsLoadingCoApplicantActivities] = useState(false);

    // Branch-first selector (ADMIN / AREA_MANAGER only — see InlineBranchSwitcher).
    // Center/product lists for these roles are scoped to whichever branch is active here,
    // instead of the enroller's own (possibly HO) home branch.
    const [enrollerRole, setEnrollerRole] = useState<string | null>(null);
    const [enrollmentBranchId, setEnrollmentBranchId] = useState<string | null>(null);
    const needsBranchSelection = enrollerRole === 'ADMIN' || enrollerRole === 'AREA_MANAGER';
    // Page-local branch (the selector above the tabs runs in pageLocal mode, so the
    // session/header branch never changes). Mirrored in a ref because the fetch
    // helpers are called from stale closures (mount effect, memoized handler).
    const enrollmentBranchIdRef = useRef<string | null>(null);

    // Group Request state (FDO's preference; BM finalizes via Group Assign)
    const [fdoCenters, setFdoCenters] = useState<Array<{ id: string; name: string; code: string; clientCount: number }>>([]);
    const [isLoadingFdoCenters, setIsLoadingFdoCenters] = useState(false);
    const [requestedGroups, setRequestedGroups] = useState<Array<{ id: string; name: string; memberCount: number; maxMembersPerGroup: number }>>([]);
    const [isLoadingRequestedGroups, setIsLoadingRequestedGroups] = useState(false);

    // Loan product chain state (Tab 3)
    const [loanProductTypes, setLoanProductTypes] = useState<Array<{ id: string; name: string }>>([]);
    type LoanProductOption = {
        id: string; productName: string; loanAmount: number; frequency: string; loanProductTypeId: string;
        interestRate?: number; insuranceFees?: number | null; numberOfDues?: number; documentCharges?: number | null;
    };
    const [allLoanProducts, setAllLoanProducts] = useState<LoanProductOption[]>([]);
    const [filteredLoanProducts, setFilteredLoanProducts] = useState<LoanProductOption[]>([]);

    // Loan purpose chain state (Loan Details tab)
    const [loanPurposeTypes, setLoanPurposeTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [loanPurposes, setLoanPurposes] = useState<Array<{ id: string; name: string; loanPurposeTypeId: string }>>([]);
    const [isLoadingLoanPurposes, setIsLoadingLoanPurposes] = useState(false);
    const [selectedLoanProductAmount, setSelectedLoanProductAmount] = useState<string>('');

    // Holds typeId values that need cascaded data loaded after a draft restore.
    // Set in handleMobileLookup, consumed by the effects below.
    const pendingRestoreRef = useRef<{
        economicActivityTypeId?: string;
        spouseEconomicActivityTypeId?: string;
        loanProductTypeId?: string;
        loanFrequency?: string;
        nomineeName?: string;
        nomineeRelation?: string;
    } | null>(null);

    // After allLoanProducts loads, apply any pending draft restore that needed the list.
    useEffect(() => {
        if (!allLoanProducts.length) return;
        const pending = pendingRestoreRef.current;
        if (!pending?.loanProductTypeId) return;

        const byType = allLoanProducts.filter(p => p.loanProductTypeId === pending.loanProductTypeId);
        const filtered = pending.loanFrequency
            ? byType.filter(p => p.frequency === pending.loanFrequency)
            : byType;
        setFilteredLoanProducts(filtered);

        // Also restore the loan amount display
        const productId = nomineeData.requestedLoanProductId;
        if (productId) {
            const product = allLoanProducts.find(p => p.id === productId);
            if (product) setSelectedLoanProductAmount(String(product.loanAmount));
        }

        pendingRestoreRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allLoanProducts]);

    const prevNomineeRelationRef = useRef('');
    // True while handleMobileLookup is restoring a draft — suppresses the auto-fill
    // from spouse fields so the saved co-applicant name is not overwritten.
    const isDraftRestoringRef = useRef(false);
    useEffect(() => {
        const rel = nomineeData.relationWithClient;
        // Skip auto-fill during draft restore; the saved nomineeName is already correct.
        if (!isDraftRestoringRef.current) {
            if (rel === 'Spouse') {
                const dob = clientData.spouseDob;
                let ageStr = '';
                if (dob) {
                    const birthDate = new Date(dob);
                    const today = new Date();
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const m = today.getMonth() - birthDate.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                    ageStr = age > 0 ? age.toString() : '';
                }
                setNomineeData(prev => ({
                    ...prev,
                    nomineeName: clientData.spouseName,
                    phoneNumber: clientData.spouseMobileNumber,
                    dateOfBirth: dob,
                    age: ageStr,
                    gender: clientData.spouseGender,
                    coApplicantEconomicActivityTypeId: clientData.spouseEconomicActivityTypeId,
                    coApplicantEconomicActivityId: clientData.spouseEconomicActivityId,
                }));
                if (clientData.spouseEconomicActivityTypeId) {
                    fetchCoApplicantEconomicActivities(clientData.spouseEconomicActivityTypeId);
                }
            } else if (prevNomineeRelationRef.current === 'Spouse' && rel !== 'Spouse') {
                setNomineeData(prev => ({
                    ...prev,
                    nomineeName: '',
                    phoneNumber: '',
                    dateOfBirth: '',
                    age: '',
                    gender: '',
                    coApplicantEconomicActivityTypeId: '',
                    coApplicantEconomicActivityId: '',
                }));
                setCoApplicantEconomicActivities([]);
            }
        }
        prevNomineeRelationRef.current = rel;
    }, [
        nomineeData.relationWithClient,
        clientData.spouseName,
        clientData.spouseMobileNumber,
        clientData.spouseDob,
        clientData.spouseGender,
        clientData.spouseEconomicActivityTypeId,
        clientData.spouseEconomicActivityId,
    ]);

    const clientIdentifier = useMemo(
        () => clientData.clientId || 'pending-client',
        [clientData.clientId],
    );

    const [inlineDocs, setInlineDocs] = useState<Record<string, DocumentFieldOutput>>({});

    const handleInlineDocChange = useCallback((output: DocumentFieldOutput) => {
        setInlineDocs((prev) => ({ ...prev, [output.documentType]: output }));

        if (output.documentType === 'aadhaar_front') {
            setKycData((prev) => ({
                ...prev,
                aadhaarFrontFileUrl: output.fileUrl ?? '',
                aadhaarFrontFileName: output.fileName ?? '',
                aadhaarFrontFileSize: output.fileSize ?? undefined,
                aadhaarFrontMimeType: output.mimeType ?? '',
            }));
        }

        if (output.documentType === 'aadhaar_back') {
            setKycData((prev) => ({
                ...prev,
                aadhaarBackFileUrl: output.fileUrl ?? '',
                aadhaarBackFileName: output.fileName ?? '',
                aadhaarBackFileSize: output.fileSize ?? undefined,
                aadhaarBackMimeType: output.mimeType ?? '',
            }));
        }
    }, []);

    // ────────────────────────────────────────────────────────────────
    // Optional Residence proof: GPS + QR
    // ────────────────────────────────────────────────────────────────
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    // Accuracy (meters) of the last GPS fix — cleared when set by map/search/typing
    const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
    const [isLocationMapOpen, setIsLocationMapOpen] = useState(false);
    const [locationError, setLocationError] = useState('');
    // Tracks the DB id of a saved draft so repeated "Save Draft" clicks update, not duplicate
    const [draftDbId, setDraftDbId] = useState<string | null>(null);
    const [isSavingDraft, setIsSavingDraft] = useState(false);

    // ────────────────────────────────────────────────────────────────
    // Offline autosave: mirrors the in-progress form to localStorage on every
    // change (debounced) so a network drop / accidental tab close never loses
    // what's been typed. This is independent of the DB draft above — that one
    // needs a network round-trip; this one works with no connection at all.
    // Single slot (one in-progress enrollment per browser at a time), cleared
    // once the data is safely on the server (draft save or final submit).
    const localDraft = useLocalDraft<{
        kycData: KYCVerificationData;
        clientData: ClientDetailsData;
        nomineeData: NomineeData;
        inlineDocs: Record<string, DocumentFieldOutput>;
        latitude: string;
        longitude: string;
    }>('enrollment');
    // True while applying a restored draft to state — suppresses the autosave
    // effect from immediately re-writing back what was just read.
    const isApplyingLocalDraftRef = useRef(false);
    const [hasRestoredLocalDraft, setHasRestoredLocalDraft] = useState(false);

    // ────────────────────────────────────────────────────────────────
    // Credit Check (CRIF) — uses the Aadhaar/phone/name already entered
    // in the Member Details tab; not required to submit the enrollment.
    // ────────────────────────────────────────────────────────────────
    const [creditCheckConsent, setCreditCheckConsent] = useState(false);
    const [isCreditChecking, setIsCreditChecking] = useState(false);
    const [creditCheckResult, setCreditCheckResult] = useState<HighmarkReportSummary | null>(null);
    const [creditCheckReused, setCreditCheckReused] = useState(false);
    const [creditCheckError, setCreditCheckError] = useState('');
    const [creditCheckAutoLoaded, setCreditCheckAutoLoaded] = useState(false);
    const [isCreditCheckAutoLoading, setIsCreditCheckAutoLoading] = useState(false);

    // Auto-surface an existing Highmark report for this Aadhaar — whether it was
    // pulled moments ago by another FDO/branch, or resumed from a saved draft —
    // instead of making the FDO click "Run" again. Respects the freshness window
    // set in Masters > Highmark Settings; a stale/absent report falls through to
    // the normal manual "Run Credit Check" flow.
    useEffect(() => {
        const aadhaar = (kycData.otherIdNo || '').replace(/\D/g, '');
        if (!/^\d{12}$/.test(aadhaar) || creditCheckResult) return;
        let cancelled = false;
        setIsCreditCheckAutoLoading(true);
        apiClient
            .get<HighmarkReportSummary | null>(`/highmark/latest?aadhaar=${aadhaar}`)
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) {
                    setCreditCheckResult(res.data);
                    setCreditCheckReused(true);
                    setCreditCheckAutoLoaded(true);
                }
            })
            .finally(() => { if (!cancelled) setIsCreditCheckAutoLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kycData.otherIdNo]);

    const mapsUrl = useMemo(() => {
        // Number('') is 0 — without this, empty fields produced a 0,0 URL and
        // auto-uploaded a Location QR pointing at the middle of the ocean.
        if (!latitude.trim() || !longitude.trim()) return '';
        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
        return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    }, [latitude, longitude]);

    const qrWrapRef = useRef<HTMLDivElement>(null);

    const locationQrUpload = useFileUpload({
        clientIdentifier,
        isEnrollment: true,
        allowedTypes: ['image/png'],
        extraFormFields: { owner: 'client', category: 'kyc' },
        onSuccess: (file) => {
            handleInlineDocChange({
                documentType: 'location_qr',
                documentNumber: mapsUrl || null,
                fileUrl: file.fileUrl,
                fileName: file.fileName,
                fileSize: file.fileSize,
                mimeType: file.mimeType,
                status: 'uploaded',
            });
        },
    });

    // Samples high-accuracy GPS and keeps the best fix (the browser's first reading is
    // often a coarse Wi-Fi/IP guess). One final update only — each lat/long change
    // regenerates and re-uploads the location QR.
    const handleGetCurrentLocation = useCallback(() => {
        setLocationError('');
        setLocationAccuracy(null);
        locate({
            onPosition: (lat, lng) => {
                setLatitude(lat.toFixed(6));
                setLongitude(lng.toFixed(6));
            },
            onDone: (pos) => setLocationAccuracy(pos.accuracy),
            onError: setLocationError,
            silent: true,
            liveUpdates: false,
        });
    }, [locate]);

    const handlePickedLocation = (lat: number, lng: number) => {
        setLocationError('');
        setLocationAccuracy(null);
        setLatitude(lat.toFixed(6));
        setLongitude(lng.toFixed(6));
    };

    const lastUploadedMapsUrlRef = useRef('');

    const handleGenerateAndUploadQr = useCallback(async () => {
        setLocationError('');
        if (!mapsUrl) {
            setLocationError('Enter valid latitude and longitude (or use current location) to generate QR.');
            return;
        }
        if (locationQrUpload.status === 'uploading' || locationQrUpload.status === 'validating') return;

        const canvas = qrWrapRef.current?.querySelector('canvas');
        if (!canvas) {
            setLocationError('QR preview not ready yet. Try again.');
            return;
        }

        const blob: Blob | null = await new Promise((resolve) =>
            canvas.toBlob((b) => resolve(b), 'image/png'),
        );
        if (!blob) {
            setLocationError('Unable to generate QR image.');
            return;
        }

        lastUploadedMapsUrlRef.current = mapsUrl;
        const file = new File([blob], 'location-qr.png', { type: 'image/png' });
        await locationQrUpload.upload(file, 'location_qr');
    }, [locationQrUpload, mapsUrl]);

    // Auto-generate and upload the location QR whenever coordinates change —
    // via "Use current location" or manual lat/lng entry — no separate action needed.
    useEffect(() => {
        if (!mapsUrl || mapsUrl === lastUploadedMapsUrlRef.current) return;
        const timer = setTimeout(() => { void handleGenerateAndUploadQr(); }, 800);
        return () => clearTimeout(timer);
    }, [mapsUrl, handleGenerateAndUploadQr]);

    const isDocUploaded = useCallback(
        (key: string) => Boolean(inlineDocs[key]?.fileUrl),
        [inlineDocs],
    );

    // Helper functions for field validation and indicators (must be before aadhaarImagesReady)
    const isFieldRequired = (fieldKey: string): boolean => {
        // Check dynamic config first
        if (validationConfig[fieldKey]) {
            return validationConfig[fieldKey].isRequired;
        }
        // Default fallbacks for always-required fields
        if (['mobileNumber', 'clientName'].includes(fieldKey)) {
            return true;
        }
        return false;
    };

    const getFieldLabel = (fieldKey: string, labelText: string): string => {
        const required = isFieldRequired(fieldKey);
        if (required) {
            return labelText;
        }
        return labelText;
    };

    // Field keys that stay editable (and can be marked required) in Renewal Loan
    // mode — everything else is read-only pre-filled data, so its new-member
    // required/optional marker would be misleading.
    const RENEWAL_EDITABLE_KEYS = new Set([
        'permanentAddress', 'pincode', 'postOffice', 'district', 'state', 'country', 'latitude', 'longitude',
        'requestedLoanProductTypeId', 'requestedLoanFrequency', 'requestedLoanProductId',
        'requestedLoanPurposeTypeId', 'requestedLoanPurposeId',
        'coApplicantName', 'coApplicantRelation', 'nomineeRelation', 'coApplicantMobileNumber',
        'coApplicantGender', 'coApplicantDob', 'coApplicantAge',
        'coApplicantEconomicActivityTypeId', 'coApplicantEconomicActivityId',
        'house_image_1', 'location_qr',
    ]);

    const renderRequiredIndicator = (fieldKey: string): React.ReactNode => {
        if (renewalMode && !RENEWAL_EDITABLE_KEYS.has(fieldKey)) {
            return null;
        }
        const required = isFieldRequired(fieldKey);
        if (required) {
            return <span className="text-red-500">*</span>;
        }
        return <span className="text-slate-400 text-xs">(Optional)</span>;
    };

    /** Single source of truth with `inlineDocs` (avoids desync vs separate upload flags). */
    const aadhaarImagesReady = useMemo(
        () => {
            // Check if aadhaar front is required
            const frontRequired = isFieldRequired('aadhaarFrontFileUrl') || isFieldRequired('aadhaarFront');
            const backRequired = isFieldRequired('aadhaarBackFileUrl') || isFieldRequired('aadhaarBack');

            const frontReady = !frontRequired || Boolean(inlineDocs['aadhaar_front']?.fileUrl);
            const backReady = !backRequired || Boolean(inlineDocs['aadhaar_back']?.fileUrl);

            return frontReady && backReady;
        },
        [inlineDocs, validationConfig],
    );

    // Check if all required KYC fields are filled based on dynamic validation config
    const step1FieldsComplete = useMemo(() => {
        // Mobile number is always required
        if (!kycData.mobileNumber?.trim()) return false;

        // Check Primary ID (otherIdNo) if required by config
        if (isFieldRequired('otherIdNo')) {
            if (!kycData.otherIdNo?.trim()) return false;
        }

        // Check CA Aadhaar ID if required by config
        if (isFieldRequired('caOtherIdNo')) {
            if (!kycData.caOtherIdNo?.trim()) return false;
        }

        return true;
    }, [kycData, validationConfig]);

    // STEP 1: Check for required documents based on dynamic config
    const step1UploadsComplete = useMemo(() => {
        // Only require documents that are marked as required in config
        const potentialDocs = [
            { key: 'pan_card', fieldKey: 'pancardNo' },
            { key: 'co_applicant_pan_card', fieldKey: 'caPancardNo' },
            { key: 'co_applicant_other_id', fieldKey: 'caOtherIdNo' },
        ];

        // Filter to only required documents based on config
        const requiredDocs = potentialDocs
            .filter(doc => isFieldRequired(doc.fieldKey))
            .map(doc => doc.key);

        // Check if all required documents are uploaded
        const docsUploaded = requiredDocs.length === 0 || requiredDocs.every(isDocUploaded);

        // Check if Aadhaar images are ready (based on dynamic config)
        return docsUploaded && aadhaarImagesReady;
    }, [aadhaarImagesReady, isDocUploaded, validationConfig]);

    // STEP 2: Only check for client_photo and bank_passbook (signature removed)
    const step2UploadsComplete = useMemo(() => {
        const step2Uploads = [
            { key: 'client_photo', fieldKey: 'client_photo' },
            { key: 'bank_passbook', fieldKey: 'bank_passbook' },
        ];
        const requiredUploads = step2Uploads.filter((d) => isFieldRequired(d.fieldKey));
        return requiredUploads.length === 0 || requiredUploads.every((d) => isDocUploaded(d.key));
    }, [isDocUploaded, validationConfig]);

    // STEP 3: Check for co_applicant_photo, co_applicant_aadhaar_back based on config
    const step3UploadsComplete = useMemo(() => {
        const step3Uploads = [
            { key: 'co_applicant_photo', fieldKey: 'co_applicant_photo' },
            { key: 'co_applicant_aadhaar_back', fieldKey: 'coApplicantAadhaarBack' },
        ];
        const requiredUploads = step3Uploads.filter((d) => isFieldRequired(d.fieldKey));
        return requiredUploads.length === 0 || requiredUploads.every((d) => isDocUploaded(d.key));
    }, [isDocUploaded, validationConfig]);

    const allRequiredUploadsComplete = useMemo(() => {
        // All document upload fields that might be required
        const allPossibleDocs = [
            // KYC step uploads
            { key: 'aadhaar_front', fieldKey: 'aadhaarFrontFileUrl' },
            { key: 'aadhaar_back', fieldKey: 'aadhaarBackFileUrl' },
            { key: 'pan_card', fieldKey: 'pancardNo' },
            { key: 'co_applicant_pan_card', fieldKey: 'caPancardNo' },
            { key: 'co_applicant_other_id', fieldKey: 'caOtherIdNo' },
            { key: 'co_applicant_aadhaar_back', fieldKey: 'coApplicantAadhaarBack' },
            // Step 2 uploads
            { key: 'client_photo', fieldKey: 'client_photo' },
            { key: 'bank_passbook', fieldKey: 'bank_passbook' },
            // Step 3 uploads
            { key: 'co_applicant_photo', fieldKey: 'co_applicant_photo' },
        ];

        // Filter to only required documents based on admin config
        const requiredDocs = allPossibleDocs.filter((d) => isFieldRequired(d.fieldKey));

        // Check if all required documents are uploaded
        return requiredDocs.length === 0 || requiredDocs.every((d) => Boolean(inlineDocs[d.key]?.fileUrl));
    }, [inlineDocs, validationConfig]);

    const nomineeIsCoApplicant = true;

    // ── Tab completion indicators ─────────────────────────────────────────
    const tab1Complete = useMemo(() => {
        if (!kycData.mobileNumber?.trim()) return false;
        if (!clientData.clientName?.trim()) return false;
        if (!clientData.lastName?.trim()) return false;
        const checks: Array<[string, string | undefined]> = [
            ['otherIdNo', kycData.otherIdNo],
            ['pancardNo', kycData.pancardNo],
            ['votersIdNo', kycData.votersIdNo],
            ['dateOfBirth', clientData.dateOfBirth],
            ['fatherName', clientData.fatherName],
            ['gender', clientData.gender],
            ['permanentAddress', clientData.permanentAddress],
            ['pincode', clientData.pincode],
            ['postOffice', clientData.postOffice],
            ['state', clientData.state],
            ['district', clientData.district],
            ['country', clientData.country],
        ];
        return checks.every(([key, val]) => !isFieldRequired(key) || Boolean(val?.trim()));
    }, [kycData, clientData, validationConfig]);

    const tab2Complete = useMemo(() => {
        const checks: Array<[string, string | undefined]> = [
            ['email', clientData.email],
            ['age', clientData.age],
            ['religion', clientData.religion],
            ['caste', clientData.caste],
            ['community', clientData.community],
            ['economicActivityTypeId', clientData.economicActivityTypeId],
            ['economicActivityId', clientData.economicActivityId],
            ['qualification', clientData.qualification],
            ['maritalStatus', clientData.maritalStatus],
            ['spouseName', clientData.spouseName],
            ['spouseDob', clientData.spouseDob],
            ['spouseMobileNumber', clientData.spouseMobileNumber],
            ['spouseGender', clientData.spouseGender],
            ['spouseEconomicActivityTypeId', clientData.spouseEconomicActivityTypeId],
            ['spouseEconomicActivityId', clientData.spouseEconomicActivityId],
            ['noOfChildren', clientData.noOfChildren],
            ['monthlyFamilyIncome', clientData.monthlyFamilyIncome],
            ['monthlyFamilyExpense', clientData.monthlyFamilyExpense],
            ['ifscCode', clientData.ifscCode],
            ['bankAcNo', clientData.bankAcNo],
            ['bankName', clientData.bankName],
            ['bankBranch', clientData.bankBranch],
            ['bankAccountType', clientData.bankAccountType],
            ['motherName', clientData.motherName],
            ['smartCardNo', kycData.smartCardNo],
        ];
        return checks.every(([key, val]) => !isFieldRequired(key) || Boolean(val?.trim()));
    }, [clientData, kycData, validationConfig]);

    const tab3Complete = useMemo(() => {
        const checks: Array<[string, string | undefined]> = [
            ['coApplicantName', nomineeData.nomineeName],
            ['coApplicantMobileNumber', nomineeData.phoneNumber],
            ['coApplicantGender', nomineeData.gender],
            ['coApplicantDob', nomineeData.dateOfBirth],
            ['coApplicantAge', nomineeData.age],
            ['coApplicantRelation', nomineeData.relationWithClient],
            ['coApplicantEconomicActivityTypeId', nomineeData.coApplicantEconomicActivityTypeId],
            ['coApplicantEconomicActivityId', nomineeData.coApplicantEconomicActivityId],
            ['caPancardNo', kycData.caPancardNo],
            ['caVoterIdNo', kycData.caVoterIdNo],
            ['caOtherIdNo', kycData.caOtherIdNo],
        ];
        return checks.every(([key, val]) => !isFieldRequired(key) || Boolean(val?.trim()));
    }, [nomineeData, kycData, validationConfig]);

    const tabLoanDetailsComplete = useMemo(() => {
        const checks: Array<[string, string | undefined]> = [
            ['requestedLoanProductTypeId', nomineeData.requestedLoanProductTypeId],
            ['requestedLoanFrequency', nomineeData.requestedLoanFrequency],
            ['requestedLoanProductId', nomineeData.requestedLoanProductId],
            ['requestedLoanPurposeTypeId', nomineeData.requestedLoanPurposeTypeId],
            ['requestedLoanPurposeId', nomineeData.requestedLoanPurposeId],
        ];
        // Group Request fields are hardcoded mandatory — not gated by isFieldRequired.
        const groupRequestComplete = Boolean(clientData.memberGroupStatus)
            && Boolean(clientData.requestedCenterId) && Boolean(clientData.requestedGroupId);
        return groupRequestComplete && checks.every(([key, val]) => !isFieldRequired(key) || Boolean(val?.trim()));
    }, [nomineeData, clientData.memberGroupStatus, clientData.requestedCenterId, clientData.requestedGroupId, validationConfig]);

    const tab4Complete = useMemo(() => aadhaarImagesReady && allRequiredUploadsComplete,
        [aadhaarImagesReady, allRequiredUploadsComplete]);

    // Advisory only — a bureau outage should never block client creation,
    // so this is not part of the submit-button gating.
    const tabCreditComplete = useMemo(() => creditCheckResult !== null, [creditCheckResult]);

    async function handleRunCreditCheck() {
        const aadhaar = (kycData.otherIdNo || '').replace(/\D/g, '');
        const phone = (kycData.mobileNumber || '').replace(/\D/g, '');
        if (!clientData.clientName?.trim() || !/^\d{12}$/.test(aadhaar) || !/^\d{10}$/.test(phone)) {
            setCreditCheckError('Enter a valid Aadhaar and mobile number in Member Details first.');
            return;
        }
        if (!creditCheckConsent) {
            setCreditCheckError('Member consent is required before running a credit check.');
            return;
        }
        setCreditCheckError('');
        setIsCreditChecking(true);
        try {
            const res = await apiClient.post<HighmarkReportSummary>('/highmark/check', {
                firstName: clientData.clientName.trim(),
                lastName: clientData.lastName?.trim() || undefined,
                aadhaar,
                phone,
                consentObtained: true,
                clientId: draftDbId || undefined,
            });
            if (res.success && res.data) {
                setCreditCheckResult(res.data);
                setCreditCheckReused(!!res.message?.startsWith('Reused'));
                toast({ title: 'Credit report ready', description: res.message });
            } else {
                setCreditCheckError(res.error || 'Failed to run credit check');
            }
        } catch (error: any) {
            setCreditCheckError(error.message || 'Failed to run credit check');
        } finally {
            setIsCreditChecking(false);
        }
    }

    useEffect(() => {
        setIsMounted(true);
        const role = tokenStorage.getUser()?.role ?? null;
        setEnrollerRole(role);
        const initialActiveBranch = branchStorage.getActiveBranch();
        enrollmentBranchIdRef.current = initialActiveBranch?.id ?? null;
        setEnrollmentBranchId(initialActiveBranch?.id ?? null);

        fetchEconomicActivityTypes();
        fetchLoanProductTypes();
        fetchLoanPurposeTypes();

        // FDO / BRANCH_MANAGER: unchanged — always own-branch scoped server-side.
        // ADMIN / AREA_MANAGER: only fetch once a branch has been explicitly selected
        // (see the InlineBranchSwitcher above the tabs + handleEnrollmentBranchChange).
        const isMultiBranchRole = role === 'ADMIN' || role === 'AREA_MANAGER';
        if (!isMultiBranchRole) {
            fetchAllLoanProducts();
            fetchFdoCenters();
        } else if (enrollmentBranchIdRef.current) {
            fetchAllLoanProducts();
            fetchFdoCenters();
        }
    }, []);

    // Fired by the InlineBranchSwitcher above the tabs when an ADMIN/AREA_MANAGER
    // picks (or auto-selects) a branch. Re-scopes Center/Product lists to it and
    // clears any center/group chosen under a previously-active branch.
    const handleEnrollmentBranchChange = useCallback((branch: StoredBranch) => {
        enrollmentBranchIdRef.current = branch.id;
        setEnrollmentBranchId(branch.id);
        setClientData((prev) => ({ ...prev, requestedCenterId: '', requestedGroupId: '' }));
        setRequestedGroups([]);
        fetchFdoCenters();
        fetchAllLoanProducts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Restore any locally-autosaved, not-yet-synced draft on first load (e.g. after a
    // crash, closed tab, or filling the form fully offline). The DB draft fetched via
    // mobile-number lookup (handleMobileLookup) still wins for any field it has a value
    // for — this restore only seeds state so nothing typed is lost before that lookup runs.
    useEffect(() => {
        const stored = localDraft.load();
        if (!stored?.data) return;
        const { kycData: savedKyc, clientData: savedClient, nomineeData: savedNominee, inlineDocs: savedDocs, latitude: savedLat, longitude: savedLng } = stored.data;

        isApplyingLocalDraftRef.current = true;
        isDraftRestoringRef.current = true;
        setKycData(savedKyc);
        setClientData(savedClient);
        setNomineeData(savedNominee);
        setInlineDocs(savedDocs || {});
        if (savedLat) setLatitude(savedLat);
        if (savedLng) setLongitude(savedLng);

        if (savedClient.economicActivityTypeId) fetchEconomicActivities(savedClient.economicActivityTypeId);
        if (savedClient.spouseEconomicActivityTypeId) fetchSpouseEconomicActivities(savedClient.spouseEconomicActivityTypeId);
        if (savedNominee.coApplicantEconomicActivityTypeId) fetchCoApplicantEconomicActivities(savedNominee.coApplicantEconomicActivityTypeId);
        if (savedNominee.requestedLoanProductTypeId) {
            pendingRestoreRef.current = {
                loanProductTypeId: savedNominee.requestedLoanProductTypeId,
                loanFrequency: savedNominee.requestedLoanFrequency,
            };
        }
        if (savedNominee.requestedLoanPurposeTypeId) fetchLoanPurposes(savedNominee.requestedLoanPurposeTypeId);

        setHasRestoredLocalDraft(true);
        toast({
            title: 'Unsaved Data Restored',
            description: `Recovered form data autosaved locally at ${new Date(stored.savedAt).toLocaleTimeString()}.`,
        });

        setTimeout(() => {
            isApplyingLocalDraftRef.current = false;
            isDraftRestoringRef.current = false;
        }, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced offline autosave — fires on every edit, online or not.
    useEffect(() => {
        if (!isMounted || isApplyingLocalDraftRef.current) return;
        localDraft.save({ kycData, clientData, nomineeData, inlineDocs, latitude, longitude });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kycData, clientData, nomineeData, inlineDocs, latitude, longitude, isMounted]);

    const handleApiError = (error: unknown): { title: string; description: string } => {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            return {
                title: 'Network Error',
                description: 'Unable to connect to server. Please check your internet connection and try again.',
            };
        }

        if (error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('timeout'))) {
            return {
                title: 'Request Timeout',
                description: 'The request took too long. Please try again.',
            };
        }

        if (error instanceof Error) {
            return {
                title: 'Error',
                description: error.message || 'An unexpected error occurred. Please try again.',
            };
        }

        return {
            title: 'Error',
            description: 'An unexpected error occurred. Please try again.',
        };
    };

    const fetchEconomicActivityTypes = async () => {
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>('/economic-activity-types');
            if (result.success && result.data) {
                setEconomicActivityTypes(result.data);
            }
        } catch (error) {
            console.error('Failed to load economic activity types:', error);
        }
    };

    const fetchEconomicActivities = async (typeId: string) => {
        if (!typeId) {
            setEconomicActivities([]);
            return;
        }
        setIsLoadingActivities(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>(`/economic-activities?activityTypeId=${typeId}`);
            if (result.success && result.data) {
                setEconomicActivities(result.data);
            } else {
                setEconomicActivities([]);
            }
        } catch (error) {
            console.error('Failed to load economic activities:', error);
            setEconomicActivities([]);
        } finally {
            setIsLoadingActivities(false);
        }
    };

    const fetchSpouseEconomicActivities = async (typeId: string) => {
        if (!typeId) {
            setSpouseEconomicActivities([]);
            return;
        }
        setIsLoadingSpouseActivities(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>(`/economic-activities?activityTypeId=${typeId}`);
            if (result.success && result.data) {
                setSpouseEconomicActivities(result.data);
            } else {
                setSpouseEconomicActivities([]);
            }
        } catch (error) {
            console.error('Failed to load spouse economic activities:', error);
            setSpouseEconomicActivities([]);
        } finally {
            setIsLoadingSpouseActivities(false);
        }
    };

    const fetchCoApplicantEconomicActivities = async (typeId: string) => {
        if (!typeId) {
            setCoApplicantEconomicActivities([]);
            return;
        }
        setIsLoadingCoApplicantActivities(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>(`/economic-activities?activityTypeId=${typeId}`);
            if (result.success && result.data) {
                setCoApplicantEconomicActivities(result.data);
            } else {
                setCoApplicantEconomicActivities([]);
            }
        } catch (error) {
            console.error('Failed to load co-applicant economic activities:', error);
            setCoApplicantEconomicActivities([]);
        } finally {
            setIsLoadingCoApplicantActivities(false);
        }
    };

    const fetchFdoCenters = async () => {
        const role = tokenStorage.getUser()?.role ?? null;
        const isMultiBranchRole = role === 'ADMIN' || role === 'AREA_MANAGER';
        const activeBranchId = enrollmentBranchIdRef.current;

        // ADMIN / AREA_MANAGER must pick a (non-HO) branch first — never fall back to an
        // unfiltered/HO-wide center list for these roles.
        if (isMultiBranchRole && !activeBranchId) {
            setFdoCenters([]);
            return;
        }

        setIsLoadingFdoCenters(true);
        try {
            const query = isMultiBranchRole
                ? `/centers?status=APPROVED&includeInactive=false&branchId=${activeBranchId}`
                : '/centers?status=APPROVED&includeInactive=false';
            const result = await apiClient.get<Array<{ id: string; name: string; code: string; clientCount: number }>>(query);
            if (result.success && result.data) {
                setFdoCenters(result.data);
            }
        } catch (error) {
            console.error('Failed to load centers:', error);
        } finally {
            setIsLoadingFdoCenters(false);
        }
    };

    const fetchRequestedGroups = async (centerId: string) => {
        setIsLoadingRequestedGroups(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string; memberCount: number; maxMembersPerGroup: number }>>(`/groups?centerId=${centerId}&includeInactive=false&availableOnly=true`);
            if (result.success && result.data) {
                setRequestedGroups(result.data);
            }
        } catch (error) {
            console.error('Failed to load groups:', error);
        } finally {
            setIsLoadingRequestedGroups(false);
        }
    };

    const fetchLoanProductTypes = async () => {
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>('/loan-product-types?includeInactive=false');
            if (result.success && result.data) {
                setLoanProductTypes(result.data);
            }
        } catch (error) {
            console.error('Failed to load loan product types:', error);
        }
    };

    const fetchAllLoanProducts = async () => {
        try {
            const storedUser = tokenStorage.getUser();
            // Page-local enrollment branch (ADMIN/AREA_MANAGER selector) takes
            // precedence over the enroller's static home branch — same convention as
            // components/client-operations/EnrollmentForm.tsx.
            const branchId = enrollmentBranchIdRef.current || storedUser?.branchId;
            if (!branchId) return;
            const result = await apiClient.get<LoanProductOption[]>(`/products?branchId=${branchId}`);
            if (result.success && result.data) {
                setAllLoanProducts(result.data);
            }
        } catch (error) {
            console.error('Failed to load loan products:', error);
        }
    };

    const fetchLoanPurposeTypes = async () => {
        try {
            const result = await apiClient.get<Array<{ id: string; name: string }>>('/loan-purpose-types?includeInactive=false');
            if (result.success && result.data) {
                setLoanPurposeTypes(result.data);
            }
        } catch (error) {
            console.error('Failed to load loan purpose types:', error);
        }
    };

    const fetchLoanPurposes = async (purposeTypeId: string) => {
        setIsLoadingLoanPurposes(true);
        try {
            const result = await apiClient.get<Array<{ id: string; name: string; loanPurposeTypeId: string }>>(`/loan-purposes?purposeTypeId=${purposeTypeId}&includeInactive=false`);
            if (result.success && result.data) {
                setLoanPurposes(result.data);
            }
        } catch (error) {
            console.error('Failed to load loan purposes:', error);
        } finally {
            setIsLoadingLoanPurposes(false);
        }
    };

    const setValidationError = (field: string, error: string) => {
        setValidationErrors((prev) => ({ ...prev, [field]: error }));
    };

    const clearValidationError = (field: string) => {
        setValidationErrors((prev) => {
            const newErrors = { ...prev };
            delete newErrors[field];
            return newErrors;
        });
    };

    const clearIdentityConflict = (stateKey: string) => {
        setIdentityConflicts((prev) => {
            if (!(stateKey in prev)) return prev;
            const next = { ...prev };
            delete next[stateKey];
            return next;
        });
    };

    /**
     * On-blur global + same-family uniqueness check against
     * /clients/check-identity-uniqueness. Both client and co-applicant values
     * are already in local form state, so the same-family comparison is done
     * client-side first (siblingValue) — cheaper, and this is a brand-new
     * enrollment so there's no familyClientId yet to fetch a sibling from.
     */
    const checkIdentityFieldUniqueness = async (
        field: IdentityField,
        value: string,
        side: 'CLIENT' | 'COAPPLICANT',
        stateKey: string,
        siblingValue?: string
    ) => {
        if (!value) {
            clearIdentityConflict(stateKey);
            return;
        }
        if (valuesMatchAfterNormalization(field, value, siblingValue)) {
            setIdentityConflicts((prev) => ({
                ...prev,
                [stateKey]: `Member and Co-Applicant cannot use the same ${field === 'MOBILE' ? 'Mobile Number' : field === 'AADHAAR' ? 'Aadhaar Number' : field === 'PAN' ? 'PAN Card Number' : 'Voter ID Number'}.`,
            }));
            return;
        }
        try {
            const res = await apiClient.post<{ isDuplicate: boolean; message: string | null }>(
                '/clients/check-identity-uniqueness',
                { field, value, side, siblingValue: siblingValue || undefined }
            );
            if (res.success && res.data?.isDuplicate) {
                setIdentityConflicts((prev) => ({ ...prev, [stateKey]: res.data!.message || `${stateKey} already exists.` }));
            } else {
                clearIdentityConflict(stateKey);
            }
        } catch {
            // Non-blocking UX enhancement — submit-time validation is authoritative.
        }
    };

    const handleOtherIdChange = (value: string) => {
        setKycData({ ...kycData, otherIdNo: value });

        if (value) {
            const validation = validateAadhaar(value, false);
            if (!validation.isValid && validation.error) {
                const errorMsg = validation.error;
                setValidationErrors((prev) => ({ ...prev, otherIdNo: errorMsg }));
            } else {
                clearValidationError('otherIdNo');
            }
        } else {
            clearValidationError('otherIdNo');
        }
    };

    const handleMobileChange = (value: string) => {
        setKycData({ ...kycData, mobileNumber: value });

        if (value) {
            const validation = validateMobile(value, true);
            if (!validation.isValid && validation.error) {
                setValidationError('mobileNumber', validation.error);
            } else {
                clearValidationError('mobileNumber');
            }
        } else {
            clearValidationError('mobileNumber');
        }
    };

    const handleMobileLookup = async (mobile: string) => {
        if (mobile.length < 10) { clearIdentityConflict('mobileNumber'); return; }

        setIsMobileLooking(true);
        try {
            // 1. Fetch draft from DB (source of truth — no localStorage)
            const draftRes = await apiClient.get<{
                id: string; clientId: string;
                firstName: string; lastName: string; phone?: string; email?: string;
                mobileNumber: string;
                dateOfBirth?: string; age?: number; gender?: string;
                caste?: string; community?: string; religion?: string; qualification?: string;
                maritalStatus?: string; houseStatus?: string;
                fatherName?: string; motherName?: string; noOfChildren?: number;
                permanentAddress?: string; pincode?: string; postOffice?: string;
                district?: string; state?: string; country?: string;
                economicActivityTypeId?: string; economicActivityId?: string;
                monthlyFamilyIncome?: string; monthlyFamilyExpense?: string;
                spouseName?: string; spouseDob?: string; spouseMobileNumber?: string;
                spouseGender?: string;
                spouseEconomicActivityTypeId?: string; spouseEconomicActivityId?: string;
                coApplicantEconomicActivityTypeId?: string; coApplicantEconomicActivityId?: string;
                memberGroupStatus?: string; requestedCenterId?: string; requestedGroupId?: string;
                ifscCode?: string; bankAcNo?: string; bankName?: string;
                bankBranch?: string; bankAccountType?: string;
                votersIdNo?: string; caVoterIdNo?: string;
                otherIdNo?: string; caOtherIdNo?: string;
                pancardNo?: string; caPancardNo?: string; smartCardNo?: string;
                nomineeName?: string; nomineeRelation?: string; nomineePhone?: string;
                nomineeGender?: string; nomineeDateOfBirth?: string; nomineeAge?: number;
                requestedLoanProductId?: string;
                requestedLoanProductTypeId?: string;
                requestedLoanFrequency?: string;
                requestedLoanPurposeTypeId?: string;
                requestedLoanPurposeId?: string;
                kycDocuments?: Array<{
                    documentType: string; documentNumber?: string | null;
                    fileUrl?: string | null; fileName?: string | null;
                    fileSize?: number | null; mimeType?: string | null;
                }>;
            } | null>(`/clients/draft?mobile=${encodeURIComponent(mobile)}`);

            if (draftRes.success && draftRes.data) {
                const d = draftRes.data;
                setDraftDbId(d.id);

                // Suppress the spouse→nominee auto-fill effect during restore
                isDraftRestoringRef.current = true;

                // ── KYC ID fields ─────────────────────────────────────────
                setKycData(prev => ({
                    ...prev,
                    mobileNumber: d.mobileNumber || prev.mobileNumber,
                    votersIdNo:   d.votersIdNo   || prev.votersIdNo,
                    caVoterIdNo:  d.caVoterIdNo  || prev.caVoterIdNo,
                    otherIdNo:    d.otherIdNo    || prev.otherIdNo,
                    caOtherIdNo:  d.caOtherIdNo  || prev.caOtherIdNo,
                    pancardNo:    d.pancardNo    || prev.pancardNo,
                    caPancardNo:  d.caPancardNo  || prev.caPancardNo,
                    smartCardNo:  d.smartCardNo  || prev.smartCardNo,
                }));

                // ── Client details ────────────────────────────────────────
                setClientData(prev => ({
                    ...prev,
                    clientName:    d.firstName || prev.clientName,
                    lastName:      d.lastName  || prev.lastName,
                    phone:         d.phone     || prev.phone,
                    email:         d.email     || prev.email,
                    dateOfBirth:   d.dateOfBirth
                        ? new Date(d.dateOfBirth).toISOString().split('T')[0]
                        : prev.dateOfBirth,
                    age:           d.age != null ? String(d.age) : prev.age,
                    gender:        d.gender        || prev.gender,
                    caste:         d.caste         || prev.caste,
                    community:     d.community     || prev.community,
                    religion:      d.religion      || prev.religion,
                    qualification: d.qualification || prev.qualification,
                    maritalStatus: d.maritalStatus || prev.maritalStatus,
                    houseStatus:   d.houseStatus   || prev.houseStatus,
                    fatherName:    d.fatherName    || prev.fatherName,
                    motherName:    d.motherName    || prev.motherName,
                    noOfChildren:  d.noOfChildren != null ? String(d.noOfChildren) : prev.noOfChildren,
                    permanentAddress: d.permanentAddress || prev.permanentAddress,
                    pincode:       d.pincode    || prev.pincode,
                    postOffice:    d.postOffice || prev.postOffice,
                    district:      d.district   || prev.district,
                    state:         d.state      || prev.state,
                    country:       d.country    || prev.country,
                    economicActivityTypeId: d.economicActivityTypeId || prev.economicActivityTypeId,
                    economicActivityId:     d.economicActivityId     || prev.economicActivityId,
                    monthlyFamilyIncome:  d.monthlyFamilyIncome  ? String(d.monthlyFamilyIncome)  : prev.monthlyFamilyIncome,
                    monthlyFamilyExpense: d.monthlyFamilyExpense ? String(d.monthlyFamilyExpense) : prev.monthlyFamilyExpense,
                    spouseName:                  d.spouseName                  || prev.spouseName,
                    spouseDob:                   d.spouseDob
                        ? new Date(d.spouseDob).toISOString().split('T')[0]
                        : prev.spouseDob,
                    spouseMobileNumber:          d.spouseMobileNumber          || prev.spouseMobileNumber,
                    spouseGender:                d.spouseGender                || prev.spouseGender,
                    spouseEconomicActivityTypeId:d.spouseEconomicActivityTypeId || prev.spouseEconomicActivityTypeId,
                    spouseEconomicActivityId:    d.spouseEconomicActivityId    || prev.spouseEconomicActivityId,
                    memberGroupStatus:           d.memberGroupStatus           || prev.memberGroupStatus,
                    requestedCenterId:           d.requestedCenterId           || prev.requestedCenterId,
                    requestedGroupId:            d.requestedGroupId            || prev.requestedGroupId,
                    ifscCode:        d.ifscCode        || prev.ifscCode,
                    bankAcNo:        d.bankAcNo        || prev.bankAcNo,
                    retypeBankAcNo:  d.bankAcNo        || prev.retypeBankAcNo, // mirror bankAcNo on restore
                    bankName:        d.bankName        || prev.bankName,
                    bankBranch:      d.bankBranch      || prev.bankBranch,
                    bankAccountType: d.bankAccountType || prev.bankAccountType,
                }));

                // ── Nominee / loan product ────────────────────────────────
                setNomineeData(prev => ({
                    ...prev,
                    nomineeName:                d.nomineeName              || prev.nomineeName,
                    relationWithClient:         d.nomineeRelation          || prev.relationWithClient,
                    phoneNumber:                d.nomineePhone             || prev.phoneNumber,
                    gender:                     d.nomineeGender            || prev.gender,
                    dateOfBirth:                d.nomineeDateOfBirth
                        ? new Date(d.nomineeDateOfBirth).toISOString().split('T')[0]
                        : prev.dateOfBirth,
                    age:                        d.nomineeAge != null ? String(d.nomineeAge) : prev.age,
                    coApplicantEconomicActivityTypeId: d.coApplicantEconomicActivityTypeId || prev.coApplicantEconomicActivityTypeId,
                    coApplicantEconomicActivityId:     d.coApplicantEconomicActivityId     || prev.coApplicantEconomicActivityId,
                    requestedLoanProductId:     d.requestedLoanProductId     || prev.requestedLoanProductId,
                    requestedLoanProductTypeId: d.requestedLoanProductTypeId || prev.requestedLoanProductTypeId,
                    requestedLoanFrequency:     d.requestedLoanFrequency     || prev.requestedLoanFrequency,
                    requestedLoanPurposeTypeId: d.requestedLoanPurposeTypeId || prev.requestedLoanPurposeTypeId,
                    requestedLoanPurposeId:     d.requestedLoanPurposeId     || prev.requestedLoanPurposeId,
                }));

                // ── KYC documents — restore uploaded files into inlineDocs ─
                if (d.kycDocuments?.length) {
                    const restoredDocs: Record<string, DocumentFieldOutput> = {};
                    for (const doc of d.kycDocuments) {
                        if (!doc.fileUrl) continue;
                        restoredDocs[doc.documentType] = {
                            documentType:   doc.documentType,
                            documentNumber: doc.documentNumber ?? null,
                            fileUrl:        doc.fileUrl,
                            fileName:       doc.fileName ?? null,
                            fileSize:       doc.fileSize ?? null,
                            mimeType:       doc.mimeType ?? null,
                            status:         'uploaded',
                        };
                    }
                    if (Object.keys(restoredDocs).length > 0) {
                        setInlineDocs(prev => ({ ...prev, ...restoredDocs }));
                    }
                }

                // ── Trigger cascaded data loads that depend on a parent selection ─
                // Economic activity options (depend on type)
                if (d.economicActivityTypeId) {
                    fetchEconomicActivities(d.economicActivityTypeId);
                }
                // Spouse economic activity options (depend on spouse type)
                if (d.spouseEconomicActivityTypeId) {
                    fetchSpouseEconomicActivities(d.spouseEconomicActivityTypeId);
                }
                // Co-applicant economic activity options
                if (d.coApplicantEconomicActivityTypeId) {
                    fetchCoApplicantEconomicActivities(d.coApplicantEconomicActivityTypeId);
                }
                // Requested center -> groups
                if (d.requestedCenterId) {
                    fetchRequestedGroups(d.requestedCenterId);
                }
                // Loan product filtered list (depends on type + frequency)
                if (d.requestedLoanProductTypeId) {
                    if (allLoanProducts.length > 0) {
                        // Products already loaded — filter immediately
                        const byType = allLoanProducts.filter(p => p.loanProductTypeId === d.requestedLoanProductTypeId);
                        const filtered = d.requestedLoanFrequency
                            ? byType.filter(p => p.frequency === d.requestedLoanFrequency)
                            : byType;
                        setFilteredLoanProducts(filtered);
                    } else {
                        // Products not loaded yet — store for the useEffect to pick up
                        pendingRestoreRef.current = {
                            loanProductTypeId: d.requestedLoanProductTypeId,
                            loanFrequency:     d.requestedLoanFrequency,
                        };
                    }
                }
                // Also set the loan product amount display if the product is known
                if (d.requestedLoanProductId && allLoanProducts.length > 0) {
                    const product = allLoanProducts.find(p => p.id === d.requestedLoanProductId);
                    if (product) setSelectedLoanProductAmount(String(product.loanAmount));
                }
                // Loan purpose list (depends on purpose type)
                if (d.requestedLoanPurposeTypeId) {
                    fetchLoanPurposes(d.requestedLoanPurposeTypeId);
                }

                // Release the suppress flag after React has flushed the state updates
                setTimeout(() => { isDraftRestoringRef.current = false; }, 0);

                toast({ title: 'Draft Restored', description: `All saved data loaded. Member ID: ${d.clientId}` });
            }

            // 2. Uniqueness/conflict check — global duplicate + same-family cross-check
            await checkIdentityFieldUniqueness('MOBILE', mobile, 'CLIENT', 'mobileNumber', nomineeData.phoneNumber);
        } catch { clearIdentityConflict('mobileNumber'); }
        finally { setIsMobileLooking(false); }
    };

    const handleSaveDraft = async () => {
        const mobile = kycData.mobileNumber;
        if (!mobile || mobile.length < 10) {
            toast({ title: 'Enter Mobile Number', description: 'Please enter a 10-digit mobile number before saving.', variant: 'destructive' });
            return;
        }

        setIsSavingDraft(true);
        try {
            // Collect every uploaded KYC document from inlineDocs state
            const kycDocuments = Object.values(inlineDocs)
                .filter(d => d.fileUrl)
                .map(d => ({
                    documentType:   d.documentType,
                    documentNumber: d.documentNumber ?? null,
                    fileUrl:        d.fileUrl        ?? null,
                    fileName:       d.fileName       ?? null,
                    fileSize:       d.fileSize       ?? null,
                    mimeType:       d.mimeType       ?? null,
                }));

            const payload = {
                // ── KYC IDs ──────────────────────────────────────────────
                mobileNumber:  mobile,
                votersIdNo:    kycData.votersIdNo   || null,
                caVoterIdNo:   kycData.caVoterIdNo  || null,
                otherIdNo:     kycData.otherIdNo    || null,
                caOtherIdNo:   kycData.caOtherIdNo  || null,
                pancardNo:     kycData.pancardNo    || null,
                caPancardNo:   kycData.caPancardNo  || null,
                smartCardNo:   kycData.smartCardNo  || null,
                // ── Client personal ───────────────────────────────────────
                firstName:     clientData.clientName        || null,
                lastName:      clientData.lastName          || null,
                phone:         clientData.phone             || null,
                email:         clientData.email             || null,
                dateOfBirth:   clientData.dateOfBirth       || null,
                age:           clientData.age               || null,
                gender:        clientData.gender            || null,
                caste:         clientData.caste             || null,
                community:     clientData.community         || null,
                religion:      clientData.religion          || null,
                qualification: clientData.qualification     || null,
                maritalStatus: clientData.maritalStatus     || null,
                houseStatus:   clientData.houseStatus       || null,
                fatherName:    clientData.fatherName        || null,
                motherName:    clientData.motherName        || null,
                noOfChildren:  clientData.noOfChildren      || null,
                // ── Address ───────────────────────────────────────────────
                permanentAddress: clientData.permanentAddress || null,
                pincode:          clientData.pincode          || null,
                postOffice:       clientData.postOffice       || null,
                district:         clientData.district         || null,
                state:            clientData.state            || null,
                country:          clientData.country          || 'India',
                // ── Occupation / income ───────────────────────────────────
                economicActivityTypeId: clientData.economicActivityTypeId || null,
                economicActivityId:     clientData.economicActivityId     || null,
                monthlyFamilyIncome:    clientData.monthlyFamilyIncome    || null,
                monthlyFamilyExpense:   clientData.monthlyFamilyExpense   || null,
                // ── Spouse ────────────────────────────────────────────────
                spouseName:                   clientData.spouseName                   || null,
                spouseDob:                    clientData.spouseDob                    || null,
                spouseMobileNumber:           clientData.spouseMobileNumber           || null,
                spouseGender:                 clientData.spouseGender                 || null,
                spouseEconomicActivityTypeId: clientData.spouseEconomicActivityTypeId || null,
                spouseEconomicActivityId:     clientData.spouseEconomicActivityId     || null,
                // ── Banking ───────────────────────────────────────────────
                ifscCode:        clientData.ifscCode        || null,
                bankAcNo:        clientData.bankAcNo        || null,
                bankName:        clientData.bankName        || null,
                bankBranch:      clientData.bankBranch      || null,
                bankAccountType: clientData.bankAccountType || null,
                // ── Nominee ───────────────────────────────────────────────
                nomineeName:        (nomineeData.relationWithClient === 'Spouse' ? clientData.spouseName : nomineeData.nomineeName) || null,
                nomineeRelation:    nomineeData.relationWithClient || null,
                nomineePhone:       nomineeData.phoneNumber        || null,
                nomineeGender:      nomineeData.gender             || null,
                nomineeDateOfBirth: nomineeData.dateOfBirth        || null,
                nomineeAge:         nomineeData.age                || null,
                // ── Loan product ──────────────────────────────────────────
                requestedLoanProductId:     nomineeData.requestedLoanProductId     || null,
                requestedLoanProductTypeId: nomineeData.requestedLoanProductTypeId || null,
                requestedLoanFrequency:     nomineeData.requestedLoanFrequency     || null,
                requestedLoanPurposeTypeId: nomineeData.requestedLoanPurposeTypeId || null,
                requestedLoanPurposeId:     nomineeData.requestedLoanPurposeId     || null,
                // ── Group Request ─────────────────────────────────────────
                memberGroupStatus:          clientData.memberGroupStatus          || null,
                requestedCenterId:          clientData.requestedCenterId          || null,
                requestedGroupId:           clientData.requestedGroupId           || null,
                // ── Co-Applicant ──────────────────────────────────────────
                coApplicantEconomicActivityTypeId: nomineeData.coApplicantEconomicActivityTypeId || null,
                coApplicantEconomicActivityId:     nomineeData.coApplicantEconomicActivityId     || null,
                // ── KYC documents ─────────────────────────────────────────
                kycDocuments,
                // ── Meta ──────────────────────────────────────────────────
                existingClientId: draftDbId || null,
            };

            const res = await apiClient.post<{ clientId: string; id: string }>('/clients/draft', payload);

            if (res.success && res.data) {
                setDraftDbId(res.data.id);
                localDraft.clear();
                setHasRestoredLocalDraft(false);
                toast({
                    title: 'Draft Saved',
                    description: `All details saved. Member ID: ${res.data.clientId} — visible in Loan Tracker → Draft tab.`,
                });
            } else {
                toast({ title: 'Save Failed', description: res.error || 'Could not save draft. Please try again.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Save Failed', description: 'Could not reach server. Please try again.', variant: 'destructive' });
        } finally {
            setIsSavingDraft(false);
        }
    };

    const handlePANChange = (field: keyof KYCVerificationData, value: string) => {
        const formatted = formatPAN(value);
        setKycData({ ...kycData, [field]: formatted });

        if (value) {
            const validation = validatePAN(value, true);
            if (!validation.isValid && validation.error) {
                setValidationError(field, validation.error);
            } else {
                clearValidationError(field);
            }
        } else {
            clearValidationError(field);
        }
    };

    const handleVoterIDChange = (field: keyof KYCVerificationData, value: string) => {
    const formatted = formatVoterID(value);
    setKycData({ ...kycData, [field]: formatted });

    // Only validate if there's a value (since Voter ID is optional)
    if (value && value.trim()) {
        const validation = validateVoterID(value, false); // false because it's optional
        if (!validation.isValid && validation.error) {
            setValidationError(field, validation.error);
        } else {
            clearValidationError(field);
        }
    } else {
        // Clear error if empty (since it's optional)
        clearValidationError(field);
    }
};

    const handleEmailChange = (value: string) => {
        setClientData({ ...clientData, email: value });

        if (value) {
            const validation = validateEmail(value, false);
            if (!validation.isValid && validation.error) {
                setValidationError('email', validation.error);
            } else {
                clearValidationError('email');
            }
        } else {
            clearValidationError('email');
        }
    };

    const handleNameChange = (field: keyof ClientDetailsData, value: string) => {
        const sanitized = sanitizeInput(value);
        setClientData({ ...clientData, [field]: sanitized });

        if (field === 'lastName') {
            if (value && value.length >= 1) {
                clearValidationError(field);
            } else if (!value) {
                setValidationError(field, 'Last name is required (minimum 1 character)');
            }
        } else if (value) {
            const validation = validateName(value, field === 'clientName');
            if (!validation.isValid && validation.error) {
                setValidationError(field, validation.error);
            } else {
                clearValidationError(field);
            }
        } else if (field === 'clientName') {
            setValidationError(field, 'Member name is required');
        } else {
            clearValidationError(field);
        }
    };

    const handlePincodeChange = async (value: string) => {
        setClientData((prev) => ({ ...prev, pincode: value }));

        if (value) {
            const validation = validatePincode(value, false);
            if (!validation.isValid && validation.error) {
                setValidationError('pincode', validation.error);
                setShowPostOfficeSelect(false);
                setPostOfficeOptions([]);
                setClientData((prev) => ({
                    ...prev,
                    postOffice: '',
                    district: '',
                    state: '',
                    country: 'India',
                }));
            } else {
                clearValidationError('pincode');

                if (value.length === 6) {
                    setIsFetchingPincode(true);
                    try {
                        const apiUrl = `https://api.postalpincode.in/pincode/${value}`;
                        const response = await fetch(apiUrl, {
                            cache: 'no-store',
                        });

                        const data: PincodeResponse[] = await response.json();

                        if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
                            const postOffices = data[0].PostOffice || [];
                            
                            if (postOffices.length > 0) {
                                setPostOfficeOptions(postOffices);
                                setShowPostOfficeSelect(true);
                                
                                const firstPO = postOffices[0];
                                setClientData((prev) => ({
                                    ...prev,
                                    postOffice: firstPO.Name,
                                    district: firstPO.District,
                                    state: firstPO.State,
                                    country: firstPO.Country || 'India',
                                }));
                                
                                toast({
                                    title: 'Multiple Post Offices Found',
                                    description: `Please select your post office from the dropdown. ${postOffices.length} options available.`,
                                });
                            } else {
                                setShowPostOfficeSelect(false);
                                setPostOfficeOptions([]);
                                toast({
                                    title: 'Invalid Pincode',
                                    description: 'No post office details found for this pincode.',
                                    variant: 'destructive',
                                });
                            }
                        } else if (data[0]?.Status === 'Error') {
                            setShowPostOfficeSelect(false);
                            setPostOfficeOptions([]);
                            toast({
                                title: 'Invalid Pincode',
                                description: data[0].Message || 'No location details found for this pincode.',
                                variant: 'destructive',
                            });
                        } else {
                            setShowPostOfficeSelect(false);
                            setPostOfficeOptions([]);
                            toast({
                                title: 'Invalid Pincode',
                                description: 'No location details found for this pincode.',
                                variant: 'destructive',
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching pincode details:', error);
                        setShowPostOfficeSelect(false);
                        setPostOfficeOptions([]);
                        toast({
                            title: 'Error',
                            description: 'Failed to fetch pincode details. Please enter manually.',
                            variant: 'destructive',
                        });
                    } finally {
                        setIsFetchingPincode(false);
                    }
                } else {
                    setShowPostOfficeSelect(false);
                    setPostOfficeOptions([]);
                    setClientData((prev) => ({
                        ...prev,
                        postOffice: '',
                        district: '',
                        state: '',
                        country: 'India',
                    }));
                }
            }
        } else {
            clearValidationError('pincode');
            setShowPostOfficeSelect(false);
            setPostOfficeOptions([]);
            setClientData((prev) => ({
                ...prev,
                postOffice: '',
                district: '',
                state: '',
                country: 'India',
            }));
        }
    };

    const handlePostOfficeSelect = (postOfficeName: string) => {
        const selectedPO = postOfficeOptions.find(po => po.Name === postOfficeName);
        if (selectedPO) {
            setClientData((prev) => ({
                ...prev,
                postOffice: selectedPO.Name,
                district: selectedPO.District,
                state: selectedPO.State,
                country: selectedPO.Country || 'India',
            }));
        }
        setShowPostOfficeSelect(false);
    };

    const handleIFSCChange = async (value: string) => {
        const formatted = formatIFSC(value);
        setClientData((prev) => ({ ...prev, ifscCode: formatted }));

        if (value) {
            const validation = validateIFSC(value, false);
            if (!validation.isValid && validation.error) {
                setValidationError('ifscCode', validation.error);
                setIfscLookupAddress('');
                setIsFetchingIfsc(false);
            } else {
                clearValidationError('ifscCode');

                if (formatted.length === 11) {
                    const requestId = ++ifscLookupRequestRef.current;
                    setIsFetchingIfsc(true);

                    try {
                        const result = await apiClient.get<IfscLookupResult>(`/ifsc?code=${formatted}`);

                        if (requestId !== ifscLookupRequestRef.current) {
                            return;
                        }

                        if (result.success && result.data) {
                            setClientData((prev) => ({
                                ...prev,
                                ifscCode: formatted,
                                bankName: result.data?.bankName || prev.bankName,
                                bankBranch: result.data?.branchName || prev.bankBranch,
                            }));
                            setIfscLookupAddress(result.data.address || '');
                        } else {
                            setIfscLookupAddress('');
                            toast({
                                title: 'IFSC Lookup Failed',
                                description: result.error || 'Unable to fetch bank details from IFSC.',
                                variant: 'destructive',
                            });
                        }
                    } catch (error) {
                        console.error('Error fetching IFSC details:', error);
                        setIfscLookupAddress('');
                        toast({
                            title: 'IFSC Lookup Error',
                            description: 'Unable to fetch bank details. Please enter them manually.',
                            variant: 'destructive',
                        });
                    } finally {
                        if (requestId === ifscLookupRequestRef.current) {
                            setIsFetchingIfsc(false);
                        }
                    }
                } else {
                    setIfscLookupAddress('');
                }
            }
        } else {
            clearValidationError('ifscCode');
            setIfscLookupAddress('');
            setIsFetchingIfsc(false);
        }
    };

    const handleBankAccountChange = (field: 'bankAcNo' | 'retypeBankAcNo', value: string) => {
        setClientData({ ...clientData, [field]: value });

        if (value) {
            const validation = validateBankAccount(value, false);
            if (!validation.isValid && validation.error) {
                setValidationError(field, validation.error);
            } else {
                clearValidationError(field);

                if (field === 'retypeBankAcNo' && clientData.bankAcNo && value !== clientData.bankAcNo) {
                    setValidationError(field, 'Bank account numbers do not match');
                } else if (field === 'bankAcNo' && clientData.retypeBankAcNo && value !== clientData.retypeBankAcNo) {
                    setValidationError('retypeBankAcNo', 'Bank account numbers do not match');
                } else {
                    clearValidationError('retypeBankAcNo');
                }
            }
        } else {
            clearValidationError(field);
        }
    };

    const handleAmountChange = (field: keyof ClientDetailsData | keyof NomineeData, value: string) => {
        if (field in clientData) {
            setClientData({ ...clientData, [field]: value });
        } else {
            setNomineeData({ ...nomineeData, [field]: value });
        }

        if (value && field !== 'monthlyFamilyIncome') {
            const validation = validateAmount(value, false);
            if (!validation.isValid && validation.error) {
                setValidationError(field, validation.error);
            } else {
                clearValidationError(field);
            }
        } else if (field !== 'monthlyFamilyIncome') {
            clearValidationError(field);
        }
    };

    // Handler for Aadhaar QR scan success
    const handleQRScanSuccess = (qrData: AadhaarQRData) => {
        setAadhaarQRData(qrData);

        // Auto-fill KYC and client details from QR data
        setKycData((prev) => ({
            ...prev,
            otherIdNo: qrData.uid || prev.otherIdNo,
        }));

        setClientData((prev) => ({
            ...prev,
            clientName: qrData.name || prev.clientName,
            lastName: qrData.name ? qrData.name.split(' ').slice(1).join(' ') : prev.lastName,
            dateOfBirth: qrData.dob || prev.dateOfBirth,
            gender: qrData.gender || prev.gender,
            permanentAddress: qrData.address || prev.permanentAddress,
        }));

        toast({
            title: 'Aadhaar Scanned Successfully',
            description: 'Member information has been auto-filled. You can edit any field if needed.',
        });
    };


    const handleTabNext = () => {
        const idx = TAB_ORDER.indexOf(activeTab);
        // Must mirror TAB_ORDER exactly: highmark, credit-check, client, nominee, loan-details, kyc-uploads.
        // Credit Check has no required fields — it's always "complete" as a gate.
        const currentTabComplete = [tab1Complete, true, tab2Complete, tab3Complete, tabLoanDetailsComplete, tab4Complete][idx];
        // Renewal Loan mode has its own submit-time validation (handleRenewalSubmit)
        // and most tabs are read-only pre-filled data, so never block navigation here.
        if (!renewalMode && !currentTabComplete) {
            toast({
                title: 'Required fields missing',
                description: 'Please fill in all required fields on this tab before continuing.',
                variant: 'destructive',
            });
            return;
        }
        if (idx < TAB_ORDER.length - 1) setActiveTab(TAB_ORDER[idx + 1]);
    };

    const handleTabPrev = () => {
        const idx = TAB_ORDER.indexOf(activeTab);
        if (idx > 0) setActiveTab(TAB_ORDER[idx - 1]);
    };

    // Kept for compatibility — now just advances the tab
    const handleKYCVerify = () => {
        const errors: ValidationErrors = {};

        // Validate Mobile Number (always required)
        if (!kycData.mobileNumber) {
            errors.mobileNumber = 'Mobile number is required';
        } else {
            const validation = validateMobile(kycData.mobileNumber, true);
            if (!validation.isValid && validation.error) {
                errors.mobileNumber = validation.error;
            }
        }

        // Validate Primary ID (Aadhaar) - check config if it's required
        if (isFieldRequired('otherIdNo')) {
            if (!kycData.otherIdNo?.trim()) {
                errors.otherIdNo = 'Aadhaar Number is required';
            } else {
                const validation = validateAadhaar(kycData.otherIdNo, false);
                if (!validation.isValid && validation.error) {
                    errors.otherIdNo = validation.error;
                }
            }
        }

        // Validate CA Aadhaar ID - check config if it's required
        if (isFieldRequired('caOtherIdNo')) {
            if (!kycData.caOtherIdNo?.trim()) {
                errors.caOtherIdNo = 'CA Aadhaar ID is required';
            }
        }

        // PAN Card - validate if required
        if (isFieldRequired('pancardNo')) {
            if (!kycData.pancardNo?.trim()) {
                errors.pancardNo = 'PAN Card is required';
            } else {
                const validation = validatePAN(kycData.pancardNo, true);
                if (!validation.isValid && validation.error) {
                    errors.pancardNo = validation.error;
                }
            }
        } else if (kycData.pancardNo?.trim()) {
            // Optional field: validate format only if provided
            const validation = validatePAN(kycData.pancardNo, true);
            if (!validation.isValid && validation.error) {
                errors.pancardNo = validation.error;
            }
        }

        // CA PAN Card - validate if required
        if (isFieldRequired('caPancardNo')) {
            if (!kycData.caPancardNo?.trim()) {
                errors.caPancardNo = 'CA PAN Card is required';
            } else {
                const validation = validatePAN(kycData.caPancardNo, true);
                if (!validation.isValid && validation.error) {
                    errors.caPancardNo = validation.error;
                }
            }
        } else if (kycData.caPancardNo?.trim()) {
            // Optional field: validate format only if provided
            const validation = validatePAN(kycData.caPancardNo, true);
            if (!validation.isValid && validation.error) {
                errors.caPancardNo = validation.error;
            }
        }

        const smartCardNo = kycData.smartCardNo?.trim() ?? '';
        const smartCardFrontUploaded = Boolean(inlineDocs['smart_card_front']?.fileUrl);
        const smartCardBackUploaded = Boolean(inlineDocs['smart_card_back']?.fileUrl);
        const anySmartCardImage = smartCardFrontUploaded || smartCardBackUploaded;

        // Smart card is optional. Number alone is allowed without images.
        // If either image is uploaded, require the number and both front + back.
        if (anySmartCardImage) {
            if (!smartCardNo) {
                errors.smartCardNo = 'Smart card number is required when uploading Smart Card images';
            }
            if (!smartCardFrontUploaded || !smartCardBackUploaded) {
                toast({
                    title: 'Smart Card Images Required',
                    description:
                        'Please upload both front and back images of Smart Card, or remove the partial upload(s).',
                    variant: 'destructive',
                });
                setValidationErrors((prev) => ({
                    ...prev,
                    ...(errors.smartCardNo ? { smartCardNo: errors.smartCardNo } : {}),
                }));
                return;
            }
        }

        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);

            const errorFields = Object.keys(errors);
        const fieldLabels: { [key: string]: string } = {
                mobileNumber: 'Mobile Number',
                aadhaarNumber: 'Aadhaar Number',
                smartCardNo: 'Smart Card',
                pancardNo: 'PAN Card',
                caPancardNo: 'CA PAN Card',
                caOtherIdNo: 'CA Aadhaar ID',
            };

            const errorList = errorFields
                .map((field) => `• ${fieldLabels[field] || field}: ${errors[field]}`)
                .join('\n');

            toast({
                title: `Validation Error (${errorFields.length} field${errorFields.length > 1 ? 's' : ''})`,
                description: errorList,
                variant: 'destructive',
            });

            const firstErrorField = errorFields[0];
            const element = document.getElementById(firstErrorField);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                element.focus();
            }

            return;
        }

        if (!aadhaarImagesReady) {
            toast({
                title: 'Aadhaar Images Required',
                description: 'Please upload both front and back images of Aadhaar before proceeding',
                variant: 'destructive',
            });
            return;
        }

        // Check for required KYC documents based on dynamic config
        const allKycDocs = [
            { key: 'co_applicant_other_id', label: 'Co-Applicant Aadhaar ID', fieldKey: 'caOtherIdNo' },
            { key: 'pan_card', label: 'PAN Card', fieldKey: 'pancardNo' },
            { key: 'co_applicant_pan_card', label: 'Co-Applicant PAN Card', fieldKey: 'caPancardNo' },
        ] as const;

        // Filter to only required documents based on config
        const kycInlineRequiredDocs = allKycDocs.filter((d) => isFieldRequired(d.fieldKey));

        const missingKycDocs = kycInlineRequiredDocs.filter((d) => !inlineDocs[d.key]?.fileUrl);
        if (missingKycDocs.length > 0) {
            toast({
                title: `Missing Uploads (${missingKycDocs.length})`,
                description: missingKycDocs.map((d) => `• ${d.label}`).join('\n'),
                variant: 'destructive',
            });
            return;
        }

        setActiveTab('client');
    };

    // handleNext / handlePrevious kept as no-ops — navigation handled by handleTabNext/handleTabPrev

    // ── Renewal Loan: centers for the Center → Group → Member picker ──────────
    useEffect(() => {
        if (!renewalMode) return;
        let cancelled = false;
        (async () => {
            const branchParam = enrollmentBranchId ? `&branchId=${enrollmentBranchId}` : '';
            const res = await apiClient.get<Array<{ id: string; name: string; code: string }>>(
                `/centers?status=APPROVED${branchParam}`
            );
            if (cancelled) return;
            setRnCenters(res.success && Array.isArray(res.data) ? res.data : []);
        })();
        return () => { cancelled = true; };
    }, [renewalMode, enrollmentBranchId]);

    // ── Renewal Loan: renewal-eligible members for the chosen center / group ──
    useEffect(() => {
        if (!renewalMode || !rnCenterId) { setRnEligibleMembers([]); return; }
        let cancelled = false;
        (async () => {
            // Fetch the whole center (no groupId) — the Group dropdown is derived from
            // this list, so filtering server-side by group left only the chosen group
            // in it and the FDO could never switch to another group.
            const res = await apiClient.get<typeof rnEligibleMembers>(
                `/loans/eligible-clients?centerId=${rnCenterId}`
            );
            if (cancelled) return;
            setRnEligibleMembers(res.success && Array.isArray(res.data) ? res.data : []);
        })();
        return () => { cancelled = true; };
    }, [renewalMode, rnCenterId]);

    const rnGroupMembers = useMemo(
        () => (rnGroupId ? rnEligibleMembers.filter((m) => m.groupId === rnGroupId) : rnEligibleMembers),
        [rnEligibleMembers, rnGroupId]
    );

    const rnGroupOptions = useMemo(() => {
        const seen = new Map<string, { id: string; label: string }>();
        rnEligibleMembers.forEach((m) => {
            if (m.groupId && !seen.has(m.groupId)) {
                seen.set(m.groupId, { id: m.groupId, label: `${m.groupCode ?? ''} ${m.groupName ?? ''}`.trim() || m.groupId });
            }
        });
        return Array.from(seen.values());
    }, [rnEligibleMembers]);

    // Clears the fetched renewal member (tabs, docs, co-applicant, location) so the
    // Center → Group → Member picker can be re-selected from scratch — otherwise the
    // previous member's frozen record stayed on screen after changing Center/Group.
    const resetRenewalMember = useCallback(() => {
        setRnMemberId('');
        setRnPrefilled(false);
        setRnExistingCoApplicants([]);
        setRnCoApplicantId('');
        setRnCoMode('existing');
        setKycData(initialKycDataRef.current);
        setClientData(initialClientDataRef.current);
        setNomineeData(initialNomineeDataRef.current);
        setInlineDocs({});
        setLatitude('');
        setLongitude('');
        setValidationErrors({});
        setActiveTab('highmark');
    }, []);

    // Pull the approved member's record into every tab (frozen except the
    // editable areas). `clientId` here is the internal Client.id.
    const loadRenewalPrefill = useCallback(async (clientId: string) => {
        setRnLoadingPrefill(true);
        setRnPrefilled(false);
        try {
            const res = await apiClient.get<RenewalPrefill>(`/clients/${clientId}/renewal-prefill`);
            if (!res.success || !res.data) {
                toast({ title: 'Error', description: res.error || 'Could not load member details', variant: 'destructive' });
                setRnMemberId('');
                return;
            }
            const d = res.data;
            setKycData((prev) => ({
                ...prev,
                mobileNumber: d.mobileNumber || d.phone || '',
                otherIdNo: d.otherIdNo || '',
                pancardNo: d.pancardNo || '',
                votersIdNo: d.votersIdNo || '',
                smartCardNo: d.smartCardNo || '',
                caOtherIdNo: d.caOtherIdNo || '',
                caPancardNo: d.caPancardNo || '',
                caVoterIdNo: d.caVoterIdNo || '',
            }));
            setClientData((prev) => ({
                ...prev,
                clientId: d.clientId || '',
                clientName: d.firstName || '',
                lastName: d.lastName || '',
                phone: d.phone || d.mobileNumber || '',
                email: d.email || '',
                permanentAddress: d.permanentAddress || '',
                pincode: d.pincode || '',
                postOffice: d.postOffice || '',
                district: d.district || '',
                state: d.state || '',
                country: d.country || 'India',
                dateOfBirth: d.dateOfBirth ? String(d.dateOfBirth).slice(0, 10) : '',
                age: d.age != null ? String(d.age) : '',
                gender: d.gender || '',
                caste: d.caste || '',
                community: d.community || '',
                religion: d.religion || '',
                economicActivityTypeId: d.economicActivityTypeId || '',
                economicActivityId: d.economicActivityId || '',
                qualification: d.qualification || '',
                maritalStatus: d.maritalStatus || '',
                spouseName: d.spouseName || '',
                spouseDob: d.spouseDob ? String(d.spouseDob).slice(0, 10) : '',
                spouseMobileNumber: d.spouseMobileNumber || '',
                spouseGender: d.spouseGender || '',
                spouseEconomicActivityTypeId: d.spouseEconomicActivityTypeId || '',
                spouseEconomicActivityId: d.spouseEconomicActivityId || '',
                noOfChildren: d.noOfChildren != null ? String(d.noOfChildren) : '',
                monthlyFamilyIncome: d.monthlyFamilyIncome != null ? String(d.monthlyFamilyIncome) : '',
                monthlyFamilyExpense: d.monthlyFamilyExpense != null ? String(d.monthlyFamilyExpense) : '',
                ifscCode: d.ifscCode || '',
                bankAcNo: d.bankAcNo || '',
                retypeBankAcNo: d.bankAcNo || '',
                bankName: d.bankName || '',
                bankBranch: d.bankBranch || '',
                bankAccountType: d.bankAccountType || '',
                houseStatus: d.houseStatus || '',
                fatherName: d.fatherName || '',
                motherName: d.motherName || '',
                requestedCenterId: d.center?.id || rnCenterId || '',
                requestedGroupId: d.group?.id || rnGroupId || '',
            }));
            // Loan Details must always start fresh for a renewal — the FDO picks a
            // new product/frequency/purpose/amount for this cycle, it must never be
            // whatever a stale local-draft autosave (or a previously-viewed member,
            // in the same browser session) left sitting in nomineeData. Without
            // this, those fields silently carry over untouched — loadRenewalPrefill
            // only ever overwrites clientData/kycData, never nomineeData.
            setNomineeData((prev) => ({
                ...prev,
                requestedLoanProductTypeId: '',
                requestedLoanFrequency: 'weekly',
                requestedLoanProductId: '',
                requestedLoanPurposeTypeId: '',
                requestedLoanPurposeId: '',
            }));
            pendingRestoreRef.current = null;
            setFilteredLoanProducts([]);
            setSelectedLoanProductAmount('');
            setLoanPurposes([]);
            // Location + house KYC are mandatory fresh captures on a renewal —
            // start them blank so the FDO must re-capture on site.
            setLatitude('');
            setLongitude('');
            if (d.economicActivityTypeId) fetchEconomicActivities(d.economicActivityTypeId);
            if (d.spouseEconomicActivityTypeId) fetchSpouseEconomicActivities(d.spouseEconomicActivityTypeId);

            // Existing approved KYC docs — carried over for reference, EXCEPT the
            // residence proofs which must be re-uploaded for the renewal.
            const RN_EXCLUDE = new Set(['house_image_1', 'house_image_2', 'house_image_3', 'location_qr', 'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3']);
            const restoredDocs: Record<string, DocumentFieldOutput> = {};
            (d.kycDocuments || []).forEach((doc: { documentType: string; fileUrl: string | null; fileName: string | null; mimeType: string | null }) => {
                if (doc.fileUrl && !RN_EXCLUDE.has(doc.documentType)) {
                    restoredDocs[doc.documentType] = {
                        documentType: doc.documentType,
                        documentNumber: null,
                        fileUrl: doc.fileUrl,
                        fileName: doc.fileName,
                        fileSize: null,
                        mimeType: doc.mimeType ?? null,
                        status: 'uploaded',
                    };
                }
            });
            setInlineDocs((prev) => ({ ...prev, ...restoredDocs }));

            // Member snapshot is in — the form is usable now. The co-applicant
            // list is best-effort; a failure there must not leave the form stuck.
            setValidationErrors({});
            setRnMemberId(clientId);
            setRnPrefilled(true);
            setActiveTab('highmark');

            try {
                const coRes = await apiClient.get<Array<{
                    id: string; name: string; relationWithClient: string; isPrimary: boolean;
                    gender?: string | null; dateOfBirth?: string | null; age?: number | null;
                    mobileNumber?: string | null; voterIdNo?: string | null; otherIdNo?: string | null; pancardNo?: string | null;
                    economicActivityTypeId?: string | null; economicActivityId?: string | null;
                }>>(`/co-applicants?clientId=${clientId}&eligible=true`);
                const coList = coRes.success && Array.isArray(coRes.data) ? coRes.data : [];
                setRnExistingCoApplicants(coList);
                setRnCoMode(coList.length > 0 ? 'existing' : 'new');
                setRnCoApplicantId(coList.find((c) => c.isPrimary)?.id || coList[0]?.id || '');
            } catch {
                setRnExistingCoApplicants([]);
                setRnCoMode('new');
            }
        } finally {
            setRnLoadingPrefill(false);
        }
    }, [toast, rnCenterId, rnGroupId]);

    // Renewal — "Use existing" co-applicant: auto-fill the Co-Applicant Details
    // tab's display fields from the selected member so the FDO/BM can review
    // who was picked, instead of showing blank fields. Re-runs whenever the
    // selection or mode changes (initial auto-pick of the primary co-applicant,
    // a manual dropdown change, or switching back from "Add new"). Submission
    // for 'existing' mode only ever sends `coApplicantId` (see handleRenewalSubmit)
    // — these fields are for display only and never override the frozen record.
    useEffect(() => {
        if (rnCoMode !== 'existing' || !rnCoApplicantId) return;
        const co = rnExistingCoApplicants.find((c) => c.id === rnCoApplicantId);
        if (!co) return;
        setNomineeData((prev) => ({
            ...prev,
            relationWithClient: co.relationWithClient,
            nomineeName: co.name,
            phoneNumber: co.mobileNumber || '',
            gender: co.gender || '',
            dateOfBirth: co.dateOfBirth ? String(co.dateOfBirth).slice(0, 10) : '',
            age: co.age != null ? String(co.age) : '',
            coApplicantEconomicActivityTypeId: co.economicActivityTypeId || '',
            coApplicantEconomicActivityId: co.economicActivityId || '',
        }));
        setKycData((prev) => ({
            ...prev,
            caPancardNo: co.pancardNo || '',
            caVoterIdNo: co.voterIdNo || '',
            caOtherIdNo: co.otherIdNo || '',
        }));
        if (co.economicActivityTypeId) fetchCoApplicantEconomicActivities(co.economicActivityTypeId);
    }, [rnCoMode, rnCoApplicantId, rnExistingCoApplicants]);

    const handleRenewalSubmit = async () => {
        if (!rnPrefilled || !rnMemberId) {
            toast({ title: 'Select a member', description: 'Pick Center → Group → Member first.', variant: 'destructive' });
            return;
        }
        const product = allLoanProducts.find((p) => p.id === nomineeData.requestedLoanProductId);
        if (!nomineeData.requestedLoanProductId || !product || !selectedLoanProductAmount) {
            toast({ title: 'Loan Details incomplete', description: 'Choose a product type, product and purpose in the Loan Details tab.', variant: 'destructive' });
            setActiveTab('loan-details');
            return;
        }
        if (!nomineeData.requestedLoanPurposeId) {
            toast({ title: 'Loan purpose required', description: 'Select a loan purpose in the Loan Details tab.', variant: 'destructive' });
            setActiveTab('loan-details');
            return;
        }
        const houseKeys = ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr', 'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3'] as const;
        const houseDocuments = houseKeys
            .map((k) => inlineDocs[k])
            .filter((d): d is DocumentFieldOutput => Boolean(d?.fileUrl))
            .map((d) => ({ documentType: d.documentType, fileUrl: d.fileUrl as string, fileName: d.fileName }));
        // Renewal: House Image 1, latitude/longitude and the Location QR are all
        // mandatory re-uploads (the member may have relocated).
        if (!inlineDocs['house_image_1']?.fileUrl) {
            toast({ title: 'House Image 1 required', description: 'Re-upload House Image 1 in the KYC tab.', variant: 'destructive' });
            setActiveTab('kyc-uploads');
            return;
        }
        if (!latitude.trim() || !longitude.trim()) {
            toast({ title: 'Location required', description: 'Enter latitude & longitude (or use current location) in the KYC tab.', variant: 'destructive' });
            setActiveTab('kyc-uploads');
            return;
        }
        if (!inlineDocs['location_qr']?.fileUrl) {
            toast({ title: 'Location QR required', description: 'Generate / upload the Location QR in the KYC tab.', variant: 'destructive' });
            setActiveTab('kyc-uploads');
            return;
        }
        if (rnCoMode === 'existing' && !rnCoApplicantId) {
            toast({ title: 'Co-applicant required', description: 'Select an existing co-applicant, or switch to "Add new".', variant: 'destructive' });
            setActiveTab('nominee');
            return;
        }
        if (rnCoMode === 'new' && (!nomineeData.nomineeName || !nomineeData.relationWithClient || !nomineeData.phoneNumber)) {
            toast({ title: 'New co-applicant incomplete', description: 'Name, relation and mobile are required for a new co-applicant.', variant: 'destructive' });
            setActiveTab('nominee');
            return;
        }

        const tenureMonths = product.numberOfDues != null
            ? computeTenureMonths(product.numberOfDues, product.frequency)
            : 12;

        const payload: Record<string, unknown> = {
            clientId: rnMemberId,
            centerId: clientData.requestedCenterId || rnCenterId,
            loanProductId: nomineeData.requestedLoanProductId,
            amount: String(selectedLoanProductAmount),
            interestRate: String(product.interestRate ?? 0),
            tenureMonths,
            frequency: nomineeData.requestedLoanFrequency || 'weekly',
            loanPurposeId: nomineeData.requestedLoanPurposeId,
            proposedAddress: {
                permanentAddress: clientData.permanentAddress || null,
                pincode: clientData.pincode || null,
                postOffice: clientData.postOffice || null,
                district: clientData.district || null,
                state: clientData.state || null,
                country: clientData.country || null,
                latitude: latitude || null,
                longitude: longitude || null,
            },
            houseDocuments,
        };
        if (rnCoMode === 'existing') {
            payload.coApplicant = { mode: 'existing', coApplicantId: rnCoApplicantId };
        } else {
            payload.coApplicant = {
                mode: 'new',
                name: nomineeData.nomineeName,
                gender: nomineeData.gender || 'Other',
                dateOfBirth: nomineeData.dateOfBirth || new Date().toISOString().slice(0, 10),
                age: Number(nomineeData.age) || 0,
                relationWithClient: nomineeData.relationWithClient,
                mobileNumber: nomineeData.phoneNumber,
                economicActivityTypeId: nomineeData.coApplicantEconomicActivityTypeId || null,
                economicActivityId: nomineeData.coApplicantEconomicActivityId || null,
                voterIdNo: kycData.caVoterIdNo || null,
                otherIdNo: kycData.caOtherIdNo || null,
                pancardNo: kycData.caPancardNo || null,
            };
            const caKeys = ['co_applicant_photo', 'co_applicant_other_id', 'co_applicant_aadhaar_back', 'co_applicant_pan_card'] as const;
            payload.coApplicantDocuments = caKeys
                .map((k) => inlineDocs[k])
                .filter((d): d is DocumentFieldOutput => Boolean(d?.fileUrl))
                .map((d) => ({ documentType: d.documentType, fileUrl: d.fileUrl as string, fileName: d.fileName }));
        }

        setRnSubmitting(true);
        try {
            const res = await apiClient.post<{ loanId: string; loanNumber: string }>('/loans/renewal-application', payload);
            if (res.success && res.data) {
                toast({
                    title: 'Renewal loan submitted',
                    description: `Loan ${res.data.loanNumber} is now in the BM → AM → QC → Admin approval queue.`,
                });
                localDraft.clear();
                router.push('/dashboard/loan-module/loan-tracker');
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to submit renewal loan', variant: 'destructive' });
            }
        } catch (error) {
            toast({ title: 'Error', description: error instanceof Error ? error.message : 'Failed to submit renewal loan', variant: 'destructive' });
        } finally {
            setRnSubmitting(false);
        }
    };

    const handleSubmit = async () => {
        // Check for required documents based on admin config
        const allPossibleDocs = [
            // KYC step uploads
            { key: 'aadhaar_front', fieldKey: 'aadhaarFrontFileUrl', label: 'Aadhaar Front Image' },
            { key: 'aadhaar_back', fieldKey: 'aadhaarBackFileUrl', label: 'Aadhaar Back Image' },
            { key: 'pan_card', fieldKey: 'pancardNo', label: 'PAN Card' },
            { key: 'co_applicant_pan_card', fieldKey: 'caPancardNo', label: 'Co-Applicant PAN Card' },
            { key: 'co_applicant_other_id', fieldKey: 'caOtherIdNo', label: 'Co-Applicant Aadhaar ID' },
            { key: 'co_applicant_aadhaar_back', fieldKey: 'coApplicantAadhaarBack', label: 'Co-Applicant Aadhaar - Back' },
            // Step 2 uploads
            { key: 'client_photo', fieldKey: 'clientPhoto', label: 'Member Photo' },
            { key: 'bank_passbook', fieldKey: 'bankPassbook', label: 'Bank Passbook' },
            // Step 3 uploads
            { key: 'co_applicant_photo', fieldKey: 'coApplicantPhoto', label: 'Co-Applicant Photo' },
            // KYC Details tab uploads previously shown with a dynamic required/optional
            // label but never actually checked here — closing that gap so "Required"
            // genuinely blocks submission for every doc field that shows the asterisk.
            { key: 'voter_id', fieldKey: 'voterIdImage', label: 'Voter ID - Front' },
            { key: 'voter_id_back', fieldKey: 'voterIdBackImage', label: 'Voter ID - Back' },
            { key: 'smart_card_front', fieldKey: 'smart_card_front', label: 'Smart Card Front Upload' },
            { key: 'smart_card_back', fieldKey: 'smart_card_back', label: 'Smart Card Back Upload' },
            { key: 'house_image_1', fieldKey: 'house_image_1', label: 'House Image 1' },
            { key: 'house_image_2', fieldKey: 'house_image_2', label: 'House Image 2' },
            { key: 'house_image_3', fieldKey: 'house_image_3', label: 'House Image 3' },
            { key: 'gas_bill', fieldKey: 'gas_bill', label: 'NOC (Gas Bill)' },
            { key: 'noc_image_1', fieldKey: 'noc_image_1', label: 'NOC Image 1' },
            { key: 'noc_image_2', fieldKey: 'noc_image_2', label: 'NOC Image 2' },
            { key: 'noc_image_3', fieldKey: 'noc_image_3', label: 'NOC Image 3' },
            { key: 'location_qr', fieldKey: 'location_qr', label: 'Location QR' },
        ];

        // Filter to only required documents based on admin config
        const requiredDocs = allPossibleDocs.filter((d) => isFieldRequired(d.fieldKey));
        const missingDocs = requiredDocs.filter((d) => !inlineDocs[d.key]?.fileUrl);
        if (missingDocs.length > 0) {
            setActiveTab('kyc-uploads');
            toast({
                title: `Missing Documents (${missingDocs.length})`,
                description: missingDocs.map((d) => `• ${d.label}`).join('\n'),
                variant: 'destructive',
                duration: 5000,
            });
            return;
        }
        
        const firstName = clientData.clientName || '';
        const lastName = clientData.lastName || '';

        const payloadToValidate = {
            kyc: {
                ...kycData,
                otherIdNo: kycData.otherIdNo || aadhaarQRData?.uid || '',
                mobileNumber: kycData.mobileNumber || clientData.phone || '',
            },
            client: {
                centerId: '',
                groupId: '',
                memberGroupStatus: clientData.memberGroupStatus,
                requestedCenterId: clientData.requestedCenterId,
                requestedGroupId: clientData.requestedGroupId,
                firstName,
                lastName,
                phone: clientData.phone || kycData.mobileNumber || '',
                email: clientData.email,
                permanentAddress: clientData.permanentAddress,
                pincode: clientData.pincode,
                postOffice: clientData.postOffice,
                district: clientData.district,
                state: clientData.state,
                country: clientData.country || 'India',
                dateOfBirth: clientData.dateOfBirth,
                age: clientData.age,
                gender: clientData.gender,
                caste: clientData.caste,
                community: clientData.community,
                religion: clientData.religion,
                economicActivityTypeId: clientData.economicActivityTypeId,
                economicActivityId: clientData.economicActivityId,
                qualification: clientData.qualification,
                maritalStatus: clientData.maritalStatus,
                spouseName: clientData.spouseName,
                spouseDob: clientData.spouseDob,
                spouseMobileNumber: clientData.spouseMobileNumber,
                spouseGender: clientData.spouseGender,
                spouseEconomicActivityTypeId: clientData.spouseEconomicActivityTypeId,
                spouseEconomicActivityId: clientData.spouseEconomicActivityId,
                fatherName: clientData.fatherName,
                motherName: clientData.motherName,
                noOfChildren: clientData.noOfChildren,
                monthlyFamilyIncome: clientData.monthlyFamilyIncome,
                monthlyFamilyExpense: clientData.monthlyFamilyExpense,
                ifscCode: clientData.ifscCode,
                bankAcNo: clientData.bankAcNo,
                bankName: clientData.bankName,
                bankBranch: clientData.bankBranch,
                bankAccountType: clientData.bankAccountType,
                houseStatus: clientData.houseStatus,
                latitude: latitude || '',
                longitude: longitude || '',
            },
            nominee: {
                nomineeName: nomineeData.relationWithClient === 'Spouse' ? clientData.spouseName : nomineeData.nomineeName,
                nomineePhoneNumber: nomineeData.phoneNumber,
                nomineeGender: nomineeData.gender,
                nomineeDateOfBirth: nomineeData.dateOfBirth,
                nomineeAge: nomineeData.age,
                nomineeRelation: nomineeData.relationWithClient,
                requestedLoanProductTypeId: nomineeData.requestedLoanProductTypeId,
                requestedLoanFrequency: nomineeData.requestedLoanFrequency,
                requestedLoanProductId: nomineeData.requestedLoanProductId,
                requestedLoanPurposeTypeId: nomineeData.requestedLoanPurposeTypeId,
                requestedLoanPurposeId: nomineeData.requestedLoanPurposeId,
                coApplicantEconomicActivityTypeId: nomineeData.coApplicantEconomicActivityTypeId,
                coApplicantEconomicActivityId: nomineeData.coApplicantEconomicActivityId,
            },
            nomineeIsCoApplicant,
        };

        // Validate required fields based on enrollment validation config
        const configErrors: ValidationErrors = {};
        const fieldMap = {
            // KYC fields
            mobileNumber: { page: 'kyc', path: payloadToValidate.kyc.mobileNumber },
            otherIdNo: { page: 'kyc', path: payloadToValidate.kyc.otherIdNo },
            votersIdNo: { page: 'client_details', path: payloadToValidate.kyc.votersIdNo },
            caOtherIdNo: { page: 'co_applicant', path: payloadToValidate.kyc.caOtherIdNo },
            caPancardNo: { page: 'co_applicant', path: payloadToValidate.kyc.caPancardNo },
            caVoterIdNo: { page: 'co_applicant', path: payloadToValidate.kyc.caVoterIdNo },
            // Member Details fields
            clientName: { page: 'client_details', path: payloadToValidate.client.firstName },
            lastName: { page: 'client_details', path: payloadToValidate.client.lastName },
            permanentAddress: { page: 'client_details', path: payloadToValidate.client.permanentAddress },
            pincode: { page: 'client_details', path: payloadToValidate.client.pincode },
            postOffice: { page: 'client_details', path: payloadToValidate.client.postOffice },
            district: { page: 'client_details', path: payloadToValidate.client.district },
            state: { page: 'client_details', path: payloadToValidate.client.state },
            country: { page: 'client_details', path: payloadToValidate.client.country },
            dateOfBirth: { page: 'client_details', path: payloadToValidate.client.dateOfBirth },
            age: { page: 'client_details', path: payloadToValidate.client.age },
            gender: { page: 'client_details', path: payloadToValidate.client.gender },
            caste: { page: 'client_details', path: payloadToValidate.client.caste },
            community: { page: 'client_details', path: payloadToValidate.client.community },
            religion: { page: 'client_details', path: payloadToValidate.client.religion },
            economicActivityTypeId: { page: 'client_details', path: payloadToValidate.client.economicActivityTypeId },
            economicActivityId: { page: 'client_details', path: payloadToValidate.client.economicActivityId },
            qualification: { page: 'client_details', path: payloadToValidate.client.qualification },
            maritalStatus: { page: 'client_details', path: payloadToValidate.client.maritalStatus },
            spouseName: { page: 'client_details', path: payloadToValidate.client.spouseName },
            spouseDob: { page: 'client_details', path: payloadToValidate.client.spouseDob },
            spouseMobileNumber: { page: 'client_details', path: payloadToValidate.client.spouseMobileNumber },
            spouseGender: { page: 'client_details', path: payloadToValidate.client.spouseGender },
            bankAccountType: { page: 'client_details', path: payloadToValidate.client.bankAccountType },
            spouseEconomicActivityTypeId: { page: 'client_details', path: payloadToValidate.client.spouseEconomicActivityTypeId },
            spouseEconomicActivityId: { page: 'client_details', path: payloadToValidate.client.spouseEconomicActivityId },
            fatherName: { page: 'client_details', path: payloadToValidate.client.fatherName },
            motherName: { page: 'client_details', path: payloadToValidate.client.motherName },
            noOfChildren: { page: 'client_details', path: payloadToValidate.client.noOfChildren },
            monthlyFamilyIncome: { page: 'client_details', path: payloadToValidate.client.monthlyFamilyIncome },
            monthlyFamilyExpense: { page: 'client_details', path: payloadToValidate.client.monthlyFamilyExpense },
            ifscCode: { page: 'client_details', path: payloadToValidate.client.ifscCode },
            bankAcNo: { page: 'client_details', path: payloadToValidate.client.bankAcNo },
            bankName: { page: 'client_details', path: payloadToValidate.client.bankName },
            bankBranch: { page: 'client_details', path: payloadToValidate.client.bankBranch },
            houseStatus: { page: 'client_details', path: payloadToValidate.client.houseStatus },
            latitude: { page: 'client_details', path: payloadToValidate.client.latitude },
            longitude: { page: 'client_details', path: payloadToValidate.client.longitude },
            // Nominee / Co-Applicant fields (internal keys kept as "nominee*" since they
            // double as validationErrors state keys referenced in the Co-Applicant tab JSX;
            // CONFIG_KEY_OVERRIDE below maps them to the actual enrollment-validation fieldKey)
            nomineeName: { page: 'co_applicant', path: nomineeData.relationWithClient === 'Spouse' ? clientData.spouseName : payloadToValidate.nominee.nomineeName },
            nomineePhoneNumber: { page: 'co_applicant', path: payloadToValidate.nominee.nomineePhoneNumber },
            nomineeGender: { page: 'co_applicant', path: payloadToValidate.nominee.nomineeGender },
            nomineeDateOfBirth: { page: 'co_applicant', path: payloadToValidate.nominee.nomineeDateOfBirth },
            nomineeAge: { page: 'co_applicant', path: payloadToValidate.nominee.nomineeAge },
            nomineeRelation: { page: 'co_applicant', path: payloadToValidate.nominee.nomineeRelation },
            requestedLoanProductTypeId: { page: 'co_applicant', path: payloadToValidate.nominee.requestedLoanProductTypeId },
            requestedLoanFrequency: { page: 'co_applicant', path: payloadToValidate.nominee.requestedLoanFrequency },
            requestedLoanProductId: { page: 'co_applicant', path: payloadToValidate.nominee.requestedLoanProductId },
            requestedLoanPurposeTypeId: { page: 'loan_details', path: payloadToValidate.nominee.requestedLoanPurposeTypeId },
            requestedLoanPurposeId: { page: 'loan_details', path: payloadToValidate.nominee.requestedLoanPurposeId },
            coApplicantEconomicActivityTypeId: { page: 'co_applicant', path: payloadToValidate.nominee.coApplicantEconomicActivityTypeId },
            coApplicantEconomicActivityId: { page: 'co_applicant', path: payloadToValidate.nominee.coApplicantEconomicActivityId },
        };

        // Internal fieldMap keys that don't match the enrollment-validation fieldKey
        // (kept distinct so existing validationErrors.nominee* state/JSX wiring is unaffected)
        const CONFIG_KEY_OVERRIDE: Record<string, string> = {
            nomineeName: 'coApplicantName',
            nomineePhoneNumber: 'coApplicantMobileNumber',
            nomineeGender: 'coApplicantGender',
            nomineeDateOfBirth: 'coApplicantDob',
            nomineeAge: 'coApplicantAge',
            nomineeRelation: 'coApplicantRelation',
        };

        // Check each field against the config
        for (const [fieldKey, fieldInfo] of Object.entries(fieldMap)) {
            const configKey = CONFIG_KEY_OVERRIDE[fieldKey] ?? fieldKey;
            if (isFieldRequired(configKey)) {
                const value = fieldInfo.path;
                if (!value || (typeof value === 'string' && !value.trim())) {
                    configErrors[fieldKey] = 'This field is required';
                }
            }
        }

        // Single/Widowed/Divorced clients must be at least MIN_SINGLE_MARITAL_AGE years old
        const singleAgeError = getSingleMaritalAgeError(clientData.dateOfBirth, clientData.maritalStatus);
        if (singleAgeError) {
            configErrors.maritalStatus = singleAgeError;
        }

        if (Object.keys(configErrors).length > 0) {
            setValidationErrors(configErrors);
            const errorFields = Object.keys(configErrors);
            const firstErrorField = errorFields[0];
            const targetTab = FIELD_TO_TAB[firstErrorField] || FIELD_TO_TAB[CONFIG_KEY_OVERRIDE[firstErrorField]] || 'client';
            setActiveTab(targetTab);

            setTimeout(() => {
                const element = document.getElementById(firstErrorField);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => element.focus(), 100);
                }
            }, 100);

            const fieldLabels: { [key: string]: string } = {
                mobileNumber: 'Mobile Number',
                otherIdNo: 'Aadhaar Number',
                votersIdNo: 'Voter ID Number',
                caOtherIdNo: 'CA Aadhaar ID',
                caPancardNo: 'CA PAN Card',
                caVoterIdNo: 'CA Voter ID',
                clientName: 'Member Name',
                lastName: 'Last Name',
                permanentAddress: 'Permanent Address',
                pincode: 'Pincode',
                postOffice: 'Post Office',
                district: 'District',
                state: 'State',
                country: 'Country',
                dateOfBirth: 'Date of Birth',
                age: 'Age',
                gender: 'Gender',
                caste: 'Caste',
                community: 'Community',
                religion: 'Religion',
                economicActivityTypeId: 'Economic Activity Type',
                economicActivityId: 'Economic Activity',
                qualification: 'Qualification',
                maritalStatus: 'Marital Status',
                spouseName: 'Spouse Name',
                spouseDob: 'Spouse Date of Birth',
                spouseMobileNumber: 'Spouse Mobile Number',
                spouseGender: 'Spouse Gender',
                spouseEconomicActivityTypeId: 'Spouse Economic Activity Type',
                spouseEconomicActivityId: 'Spouse Economic Activity',
                fatherName: 'Father Name',
                motherName: 'Mother Name',
                noOfChildren: 'Number of Children',
                monthlyFamilyIncome: 'Monthly Family Income',
                monthlyFamilyExpense: 'Monthly Family Expense',
                ifscCode: 'IFSC Code',
                bankAcNo: 'Bank Account Number',
                bankName: 'Bank Name',
                bankBranch: 'Bank Branch',
                bankAccountType: 'Bank Account Type',
                houseStatus: 'House Status',
                latitude: 'Latitude',
                longitude: 'Longitude',
                nomineeName: 'Co-Applicant Name',
                nomineePhoneNumber: 'Co-Applicant Phone',
                nomineeGender: 'Co-Applicant Gender',
                nomineeDateOfBirth: 'Co-Applicant Date of Birth',
                nomineeAge: 'Co-Applicant Age',
                nomineeRelation: 'Co-Applicant Relation',
                requestedLoanProductTypeId: 'Loan Product Type',
                requestedLoanFrequency: 'Loan Frequency',
                requestedLoanProductId: 'Loan Product',
                requestedLoanPurposeTypeId: 'Loan Purpose Type',
                requestedLoanPurposeId: 'Loan Purpose',
                coApplicantEconomicActivityTypeId: 'Co-Applicant Economic Activity Type',
                coApplicantEconomicActivityId: 'Co-Applicant Economic Activity',
            };

            const errorList = errorFields
                .map((field) => `• ${fieldLabels[field] || field}: ${configErrors[field]}`)
                .join('\n');

            toast({
                title: `Validation Error (${errorFields.length} field${errorFields.length > 1 ? 's' : ''})`,
                description: errorList,
                variant: 'destructive',
                duration: 5000,
            });

            return;
        }

        const validationResult = clientEnrollmentSchema.safeParse(payloadToValidate);

        if (!validationResult.success) {
            const errors: ValidationErrors = {};
            const fieldLabels: { [key: string]: string } = {
                'kyc.mobileNumber': 'Mobile Number',
                'kyc.caVoterIdNo': 'CA Voter ID',
                'kyc.caOtherIdNo': 'CA Aadhaar ID',
                'kyc.otherIdNo': 'Aadhaar Number',
                'kyc.pancardNo': 'PAN Card',
                'kyc.caPancardNo': 'CA PAN Card',
                'kyc.votersIdNo': 'Voter ID',
                'kyc.smartCardNo': 'Smart Card Number',
                'kyc.aadhaarFrontFileUrl': 'Aadhaar Front Image',
                'kyc.aadhaarFrontFileName': 'Aadhaar Front Image Name',
                'kyc.aadhaarFrontFileSize': 'Aadhaar Front Image Size',
                'kyc.aadhaarFrontMimeType': 'Aadhaar Front Image Type',
                'kyc.aadhaarBackFileUrl': 'Aadhaar Back Image',
                'kyc.aadhaarBackFileName': 'Aadhaar Back Image Name',
                'kyc.aadhaarBackFileSize': 'Aadhaar Back Image Size',
                'kyc.aadhaarBackMimeType': 'Aadhaar Back Image Type',
                'client.firstName': 'First Name',
                'client.lastName': 'Last Name',
                'client.phone': 'Phone',
                'client.email': 'Email',
                'client.permanentAddress': 'Permanent Address',
                'client.pincode': 'Pincode',
                'client.postOffice': 'Post Office',
                'client.district': 'District',
                'client.state': 'State',
                'client.country': 'Country',
                'client.dateOfBirth': 'Date of Birth',
                'client.age': 'Age',
                'client.gender': 'Gender',
                'client.caste': 'Caste',
                'client.community': 'Community',
                'client.religion': 'Religion',
                'client.economicActivityTypeId': 'Economic Activity Type',
                'client.economicActivityId': 'Economic Activity',
                'client.qualification': 'Qualification',
                'client.maritalStatus': 'Marital Status',
                'client.spouseName': 'Spouse Name',
                'client.spouseGender': 'Spouse Gender',
                'client.spouseEconomicActivityTypeId': 'Spouse Economic Activity Type',
                'client.spouseEconomicActivityId': 'Spouse Economic Activity',
                'client.fatherName': 'Father Name',
                'client.motherName': 'Mother Name',
                'client.ifscCode': 'IFSC Code',
                'client.bankAcNo': 'Bank Account Number',
                'client.bankName': 'Bank Name',
                'client.bankBranch': 'Bank Branch',
                'client.houseStatus': 'House Status',
                'client.latitude': 'Latitude',
                'client.longitude': 'Longitude',
                'client.monthlyFamilyIncome': 'Monthly Family Income',
                'client.monthlyFamilyExpense': 'Monthly Family Expense',
                'client.noOfChildren': 'Number of Children',
                'nominee.nomineeName': 'Co-Applicant Name',
                'nominee.phoneNumber': 'Co-Applicant Phone Number',
                'nominee.nomineeGender': 'Co-Applicant Gender',
                'nominee.nomineeDateOfBirth': 'Co-Applicant Date of Birth',
                'nominee.nomineeRelation': 'Co-Applicant Relation',
                'nominee.nomineeAge': 'Co-Applicant Age',
                'nominee.requestedLoanProductTypeId': 'Loan Product Type',
                'nominee.requestedLoanFrequency': 'Loan Frequency',
                'nominee.requestedLoanProductId': 'Loan Product',
                'nominee.coApplicantEconomicActivityTypeId': 'Co-Applicant Economic Activity Type',
                'nominee.coApplicantEconomicActivityId': 'Co-Applicant Economic Activity',
            };

            validationResult.error.errors.forEach((err) => {
                const fieldPath = err.path.join('.');
                const fieldName = fieldPath.split('.').pop() || fieldPath;
                const label = fieldLabels[fieldPath] || fieldLabels[fieldName] || fieldName;
                errors[fieldName] = err.message;
            });

            if (clientData.bankAcNo && clientData.retypeBankAcNo) {
                if (clientData.bankAcNo !== clientData.retypeBankAcNo) {
                    errors.retypeBankAcNo = 'Bank account numbers do not match';
                }
            }

            setValidationErrors(errors);

            const errorFields = Object.keys(errors);

            const errorList = errorFields
                .map((field) => {
                    const label = fieldLabels[`client.${field}`] || fieldLabels[`kyc.${field}`] || fieldLabels[`nominee.${field}`] || field;
                    return `• ${label}: ${errors[field]}`;
                })
                .join('\n');

            toast({
                title: `Validation Error (${errorFields.length} field${errorFields.length > 1 ? 's' : ''})`,
                description: errorList,
                variant: 'destructive',
                duration: 5000,
            });

            const firstErrorField = errorFields[0];
            const targetTab = FIELD_TO_TAB[firstErrorField] || 'client';
            setActiveTab(targetTab);

            setTimeout(() => {
                const element = document.getElementById(firstErrorField);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => element.focus(), 100);
                }
            }, 100);

            return;
        }

        if (clientData.bankAcNo && clientData.retypeBankAcNo) {
            if (clientData.bankAcNo !== clientData.retypeBankAcNo) {
                setValidationErrors({ retypeBankAcNo: 'Bank account numbers do not match' });
                setActiveTab('client');
                toast({
                    title: 'Validation Error',
                    description: 'Bank account numbers do not match',
                    variant: 'destructive',
                });
                setTimeout(() => {
                    const element = document.getElementById('retypeBankAcNo');
                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setTimeout(() => element.focus(), 100);
                    }
                }, 100);
                return;
            }
        }

        setIsSubmitting(true);
        try {
            const payload = validationResult.data;

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            const result = await apiClient.post<{ clientId: string }>('/clients/enrollment', {
                ...payload,
                // Page-local branch picked above the tabs (ADMIN/AREA_MANAGER); the
                // server validates it instead of the session's active branch.
                enrollmentBranchId: needsBranchSelection ? enrollmentBranchId : undefined,
                additionalDocuments: Object.values(inlineDocs)
                    .filter((d) => Boolean(d.fileUrl))
                    .filter((d) => d.documentType !== 'aadhaar_front' && d.documentType !== 'aadhaar_back')
                    .map((d) => ({
                        documentType: d.documentType,
                        documentNumber: d.documentNumber,
                        fileUrl: d.fileUrl,
                        fileName: d.fileName,
                    })),
            });

            clearTimeout(timeoutId);

            if (result.success) {
                toast({
                    title: 'Enrollment Successful',
                    description: `Member ID: ${result.data?.clientId} created. Now go to Client Operations → Assign Center & Group to complete the assignment before applying for a loan.`,
                });
                router.push('/dashboard/client-operations/group-assign');

                // Delete the DB draft (if one existed) since enrollment is now complete.
                // The server also auto-deletes any DRAFT with the same mobile inside
                // the transaction, so this is belt-and-suspenders for the draftDbId path.
                if (draftDbId) {
                    apiClient.delete(`/clients/draft?id=${draftDbId}`).catch(() => {/* best-effort */});
                    setDraftDbId(null);
                }
                localDraft.clear();
                setHasRestoredLocalDraft(false);
                setIdentityConflicts({});

                // Suppress the autosave effect while resetting to a blank form so it
                // doesn't immediately re-populate localStorage with empty values.
                isApplyingLocalDraftRef.current = true;
                setTimeout(() => { isApplyingLocalDraftRef.current = false; }, 0);

                setActiveTab('highmark');
                setKycData({
                    mobileNumber: '',
                    caVoterIdNo: '',
                    votersIdNo: '',
                    caOtherIdNo: '',
                    otherIdNo: '',
                    pancardNo: '',
                    caPancardNo: '',
                    smartCardNo: '',
                });
                setClientData({
                    clientId: '',
                    clientName: '',
                    lastName: '',
                    phone: '',
                    email: '',
                    permanentAddress: '',
                    pincode: '',
                    postOffice: '',
                    district: '',
                    state: '',
                    country: 'India',
                    dateOfBirth: '',
                    age: '',
                    gender: '',
                    caste: '',
                    community: '',
                    religion: '',
                    economicActivityTypeId: '',
                    economicActivityId: '',
                    qualification: '',
                    maritalStatus: '',
                    spouseName: '',
                    spouseDob: '',
                    spouseMobileNumber: '',
                    spouseGender: '',
                    spouseEconomicActivityTypeId: '',
                    spouseEconomicActivityId: '',
                    noOfChildren: '',
                    monthlyFamilyIncome: '',
                    monthlyFamilyExpense: '',
                    ifscCode: '',
                    bankAcNo: '',
                    retypeBankAcNo: '',
                    bankName: '',
                    bankBranch: '',
                    bankAccountType: '',
                    houseStatus: '',
                    fatherName: '',
                    motherName: '',
                    memberGroupStatus: '',
                    requestedCenterId: '',
                    requestedGroupId: '',
                });
                setRequestedGroups([]);
                setNomineeData({
                    nomineeName: '',
                    gender: '',
                    phoneNumber: '',
                    dateOfBirth: '',
                    age: '',
                    relationWithClient: '',
                    requestedLoanProductTypeId: '',
                    requestedLoanFrequency: 'weekly',
                    requestedLoanProductId: '',
                    requestedLoanPurposeTypeId: '',
                    requestedLoanPurposeId: '',
                    coApplicantEconomicActivityTypeId: '',
                    coApplicantEconomicActivityId: '',
                });
                setLoanPurposes([]);
                setCoApplicantEconomicActivities([]);
                setLatitude('');
                setLongitude('');
                setValidationErrors({});
                setAadhaarQRData(null);
                setPostOfficeOptions([]);
                setShowPostOfficeSelect(false);
                setInlineDocs({});
            } else {
                const errorMessage = result.error || 'Failed to create client enrollment';

                let errorDescription = errorMessage;
                if (typeof result.error === 'object' && result.error !== null) {
                    const errorObj = result.error as { message?: string; errors?: Record<string, string> };
                    if (errorObj.message) {
                        errorDescription = errorObj.message;
                    } else if (errorObj.errors) {
                        const errorList = Object.entries(errorObj.errors)
                            .map(([field, msg]) => `• ${field}: ${msg}`)
                            .join('\n');
                        errorDescription = errorList;
                    }
                }

                toast({
                    title: 'Error',
                    description: errorDescription,
                    variant: 'destructive',
                    duration: 5000,
                });
            }
        } catch (error) {
            const errorInfo = handleApiError(error);
            toast({
                title: errorInfo.title,
                description: errorInfo.description,
                variant: 'destructive',
                duration: 5000,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

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

    // Latest DOB (YYYY-MM-DD) that still satisfies a minimum age — used both as the
    // <input type="date"> max bound and to validate the Single/Widowed/Divorced marital-status rule.
    const getMaxDobForMinAge = (minAge: number) => {
        const today = new Date();
        const maxDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
        return maxDate.toISOString().split('T')[0];
    };

    const getSingleMaritalAgeError = (dob: string, maritalStatus: string) => {
        if (!RESTRICTED_MARITAL_STATUSES.includes(maritalStatus) || !dob) return '';
        const age = parseInt(calculateAge(dob), 10);
        if (!isNaN(age) && age < MIN_SINGLE_MARITAL_AGE) {
            return `Age must be greater than or equal to ${MIN_SINGLE_MARITAL_AGE} years when marital status is ${maritalStatus}`;
        }
        return '';
    };

    const tabIdx = TAB_ORDER.indexOf(activeTab);
    // In Renewal Loan mode the strip reflects what actually has to be done on a
    // renewal (identity/socio-economic tabs are read-only pre-filled data).
    const rnLoanDetailsDone = Boolean(
        nomineeData.requestedLoanProductId && selectedLoanProductAmount && nomineeData.requestedLoanPurposeId
    );
    const rnCoApplicantDone = rnCoMode === 'existing'
        ? Boolean(rnCoApplicantId)
        : Boolean(nomineeData.nomineeName && nomineeData.relationWithClient && nomineeData.phoneNumber);
    const rnHouseDone = Boolean(
        inlineDocs['house_image_1']?.fileUrl &&
        inlineDocs['location_qr']?.fileUrl &&
        latitude.trim() && longitude.trim()
    );
    const tabComplete = renewalMode
        ? [rnPrefilled, true, rnPrefilled, rnCoApplicantDone, rnLoanDetailsDone, rnHouseDone]
        : [tab1Complete, tabCreditComplete, tab2Complete, tab3Complete, tabLoanDetailsComplete, tab4Complete];

    return (
        <div className="relative w-full max-w-7xl mx-auto">
            <div className="absolute -inset-6 -z-10 rounded-3xl bg-gradient-to-br from-primary/10 via-primary/10 to-purple-500/10 blur-3xl" />

            <div
                className={cn(
                    'relative rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl backdrop-blur-md transition-all duration-700 dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95',
                    isMounted && 'animate-in fade-in slide-in-from-bottom-4 duration-700'
                )}
            >
                <div className="h-1.5 rounded-tl-3xl rounded-tr-3xl bg-gradient-to-r from-primary via-primary to-purple-600 bg-[length:200%_100%] animate-shimmer" />

                {/* ── Header ───────────────────────────────────────── */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 py-4 sm:px-8 sm:py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="relative flex h-10 w-10 sm:h-14 sm:w-14 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                                <UserPlus className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
                                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground dark:text-white">
                                    Member Enrollment
                                </h1>
                                <p className="text-xs sm:text-sm text-sidebar-accent dark:text-slate-400">
                                    Create new member enrollment with KYC verification
                                </p>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" onClick={() => router.back()}
                            className="h-10 w-10 text-sidebar-accent hover:text-foreground dark:text-slate-400 dark:hover:text-white">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                {/* ── Branch selector (ADMIN / AREA_MANAGER only) ─────────
                    Must be picked before Center selection below — Center/Loan
                    Product lists stay empty until a branch is active. HO is
                    excluded: this form always enrolls into a real operating
                    branch, never Head Office. Self-hidden for FDO/BRANCH_MANAGER. ── */}
                <InlineBranchSwitcher
                    pageLocal
                    excludeHeadOffice
                    autoSelectSingleOption
                    onBranchChange={handleEnrollmentBranchChange}
                    className="px-4 py-3 sm:px-8 border-b border-primary/20 bg-white dark:bg-brand-green-darker"
                />

                {/* ── Loan Type + Renewal member picker ─────────────────────
                    One form for both flows: "Member Enrollment (New)" is the
                    standard 6-tab enrollment; "Renewal Loan" pre-fills every
                    tab from an existing approved member (frozen except address,
                    co-applicant, Loan Details and house KYC) and submits to the
                    renewal approval chain. ── */}
                <div className="border-b border-primary/20 bg-white px-4 py-3 sm:px-8 dark:bg-brand-green-darker">
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="space-y-1">
                            <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                Loan Type <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={loanType}
                                onValueChange={(v) => {
                                    setLoanType(v as 'MEMBER_ENROLLMENT' | 'RENEWAL_LOAN');
                                    if (v === 'MEMBER_ENROLLMENT') {
                                        setRnCenterId(''); setRnGroupId('');
                                        setRnEligibleMembers([]); resetRenewalMember();
                                    }
                                }}
                            >
                                <SelectTrigger className="h-10 w-72 max-w-full font-semibold">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="MEMBER_ENROLLMENT">Member Enrollment (New)</SelectItem>
                                    <SelectItem value="RENEWAL_LOAN">Renewal Loan</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {renewalMode && rnPrefilled && (
                            <span className="mb-1 rounded border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                                ● Renewal — member details fetched from the approved record (editable fields only)
                            </span>
                        )}
                    </div>

                    {renewalMode && (
                        <div className="mt-3 rounded-xl border border-amber-300/80 bg-amber-50/70 p-3.5 dark:border-amber-800/70 dark:bg-amber-950/20">
                            <div className="mb-2 flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" />
                                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-950 dark:text-amber-300">
                                    Renewal Loan — select the existing member
                                </span>
                            </div>
                            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3">
                                <div className="space-y-1">
                                    <Label className="font-semibold">Center <span className="text-red-500">*</span></Label>
                                    <Select
                                        value={rnCenterId}
                                        onValueChange={(v) => { setRnCenterId(v); setRnGroupId(''); resetRenewalMember(); }}
                                        disabled={rnLoadingPrefill || rnSubmitting}
                                    >
                                        <SelectTrigger className="h-10"><SelectValue placeholder="-- SELECT CENTER --" /></SelectTrigger>
                                        <SelectContent>
                                            {rnCenters.map((c) => <SelectItem key={c.id} value={c.id}>{c.code} - {c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="font-semibold">Group <span className="text-red-500">*</span></Label>
                                    <Select
                                        value={rnGroupId}
                                        onValueChange={(v) => { setRnGroupId(v); resetRenewalMember(); }}
                                        disabled={!rnCenterId || rnLoadingPrefill || rnSubmitting}
                                    >
                                        <SelectTrigger className="h-10"><SelectValue placeholder={rnCenterId ? 'All groups' : 'Select center first'} /></SelectTrigger>
                                        <SelectContent>
                                            {rnGroupOptions.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="font-semibold">Member <span className="text-red-500">*</span></Label>
                                    <Select
                                        value={rnMemberId}
                                        onValueChange={(v) => { resetRenewalMember(); setRnMemberId(v); loadRenewalPrefill(v); }}
                                        disabled={!rnCenterId || rnLoadingPrefill || rnSubmitting}
                                    >
                                        <SelectTrigger className="h-10">
                                            <SelectValue placeholder={rnLoadingPrefill ? 'Loading…' : 'Select member'} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {rnGroupMembers.length === 0 ? (
                                                <div className="px-2 py-3 text-center text-xs text-amber-600">No renewal-eligible members</div>
                                            ) : rnGroupMembers.map((m) => (
                                                <SelectItem key={m.id} value={m.id} disabled={m.isDefaultMember || m.hasGroup === false}>
                                                    {m.clientId} - {m.name}{m.isDefaultMember ? ' 🚫' : ''}{m.hasGroup === false ? ' ⚠' : ''}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <p className="mt-2 text-[10px] font-semibold text-amber-800 dark:text-amber-400">
                                {rnPrefilled
                                    ? 'Fetched — review every tab; edit address, co-applicant, Loan Details and house KYC, then submit for BM approval.'
                                    : 'Pick Center, Group and Member — all tabs auto-fill from the last approved record.'}
                            </p>
                        </div>
                    )}
                </div>

                {/* ── Tab Bar ──────────────────────────────────────────────
                    sticky top-0 — after removing padding-top from <main>, top-0
                    maps directly to <main>'s border edge so the bar snaps flush
                    below the app header with zero gap.
                    z-30 sits above the card's shadow (z-20) and any dropdowns.
                    grid grid-cols-6 (not flex min-w-max) so each tab occupies an
                    equal share of the card width — no wasted space on the right.
                    Keep this in sync with TABS.length. ── */}
                <div className="sticky top-0 z-30 border-b border-primary/20 bg-white shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
                    <div className="grid grid-cols-6">
                        {TABS.map((tab, i) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            const isDone = tabComplete[i];
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'flex w-full items-center justify-between gap-2 px-3 sm:px-5 py-3.5 text-sm font-medium border-b-2 transition-all duration-200',
                                        isActive
                                            ? 'border-secondary bg-secondary text-white font-semibold dark:bg-brand-green-darker dark:text-primary'
                                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50 hover:border-slate-300 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-green-950'
                                    )}
                                >
                                    <span className="flex items-center gap-2 min-w-0">
                                        <Icon className="h-4 w-4 shrink-0" />
                                        <span className="hidden sm:inline truncate font-medium">{tab.name}</span>
                                        <span className="sm:hidden text-xs font-medium">{tab.shortName}</span>
                                    </span>
                                    {isDone
                                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                                        : <XCircle className="h-4 w-4 shrink-0 text-red-400" />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className={cn('p-4 sm:p-6', renewalMode && rnPrefilled && 'renewal-locked')}>
                    {/* ══ TAB 1: HighMark Details ══ */}
                    {activeTab === 'highmark' && (
                        <Card className="border-primary/20 shadow-md dark:border-sidebar-accent">
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Shield className="h-5 w-5 text-primary" />
                                    Member Details
                                </CardTitle>
                                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                                    Primary identity and contact details
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-4">
                                {identityConflicts.mobileNumber && (
                                    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                                        <AlertCircle className="h-4 w-4 shrink-0" />
                                        <span>{identityConflicts.mobileNumber}</span>
                                    </div>
                                )}

                                {/* Phone + Aadhaar + First Name */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="mobileNumber" className="flex items-center gap-1.5 text-sm font-semibold text-sidebar-accent dark:text-slate-300">
                                            <Phone className="h-3.5 w-3.5 text-primary" />Phone Number {renderRequiredIndicator('mobileNumber')}
                                        </Label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input id="mobileNumber" value={kycData.mobileNumber} type="tel" maxLength={15}
                                                onChange={(e) => { handleMobileChange(e.target.value); clearIdentityConflict('mobileNumber'); }}
                                                onBlur={(e) => handleMobileLookup(e.target.value)}
                                                placeholder="Enter 10-digit mobile number"
                                                className={cn('pl-10 bg-white dark:bg-brand-green-darker', validationErrors.mobileNumber && 'border-red-500 focus-visible:ring-red-500')} />
                                            {isMobileLooking && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
                                        </div>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.mobileNumber && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.mobileNumber}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="otherIdNo" className="flex items-center gap-1.5 text-sm font-semibold dark:text-slate-300">
                                            <CreditCard className="h-3.5 w-3.5 text-primary" />Aadhaar Number {renderRequiredIndicator('otherIdNo')}
                                        </Label>
                                        <Input id="otherIdNo" value={kycData.otherIdNo} maxLength={12}
                                            onChange={(e) => { handleOtherIdChange(e.target.value); clearIdentityConflict('otherIdNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('AADHAAR', e.target.value, 'CLIENT', 'otherIdNo', kycData.caOtherIdNo)}
                                            placeholder="12-digit Aadhaar number"
                                            className={cn((validationErrors.otherIdNo || identityConflicts.otherIdNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.otherIdNo || identityConflicts.otherIdNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.otherIdNo || identityConflicts.otherIdNo}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="clientName" className="text-sm font-semibold">First Name {renderRequiredIndicator('clientName')}</Label>
                                        <Input id="clientName" value={clientData.clientName} placeholder="Enter first name"
                                            onChange={(e) => handleNameChange('clientName', e.target.value)}
                                            className={cn(validationErrors.clientName && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.clientName && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.clientName}</p>
                                    </div>
                                </div>

                                {/* Last Name + PAN + Voter ID */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="lastName" className="text-sm font-semibold">Last Name {renderRequiredIndicator('lastName')}</Label>
                                        <Input id="lastName" value={clientData.lastName} placeholder="Enter last name"
                                            onChange={(e) => handleNameChange('lastName', e.target.value)}
                                            className={cn(validationErrors.lastName && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.lastName && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.lastName}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="pancardNo" className="text-sm font-semibold">PAN Card Number {renderRequiredIndicator('pancardNo')}</Label>
                                        <Input id="pancardNo" value={kycData.pancardNo} maxLength={10} placeholder="ABCDE1234F"
                                            onChange={(e) => { handlePANChange('pancardNo', e.target.value); clearIdentityConflict('pancardNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('PAN', e.target.value, 'CLIENT', 'pancardNo', kycData.caPancardNo)}
                                            className={cn((validationErrors.pancardNo || identityConflicts.pancardNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.pancardNo || identityConflicts.pancardNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.pancardNo || identityConflicts.pancardNo}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="votersIdNo" className="text-sm font-semibold">Voter ID Number {renderRequiredIndicator('votersIdNo')}</Label>
                                        <Input id="votersIdNo" value={kycData.votersIdNo} maxLength={30} placeholder="ABC1234567"
                                            onChange={(e) => { handleVoterIDChange('votersIdNo', e.target.value); clearIdentityConflict('votersIdNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('VOTER_ID', e.target.value, 'CLIENT', 'votersIdNo', kycData.caVoterIdNo)}
                                            className={cn((validationErrors.votersIdNo || identityConflicts.votersIdNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.votersIdNo || identityConflicts.votersIdNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.votersIdNo || identityConflicts.votersIdNo}</p>
                                    </div>
                                </div>

                                {/* Date of Birth + Father Name + Gender */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="dateOfBirth" className="text-sm font-semibold">Date of Birth {renderRequiredIndicator('dateOfBirth')}</Label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput id="dateOfBirth" value={clientData.dateOfBirth} className={cn("pl-10", validationErrors.dateOfBirth && 'border-red-500 focus-visible:ring-red-500')}
                                                max={RESTRICTED_MARITAL_STATUSES.includes(clientData.maritalStatus) ? getMaxDobForMinAge(MIN_SINGLE_MARITAL_AGE) : undefined}
                                                onChange={(e) => {
                                                    const dob = e.target.value;
                                                    setClientData({ ...clientData, dateOfBirth: dob, age: calculateAge(dob) });
                                                    const ageError = getSingleMaritalAgeError(dob, clientData.maritalStatus);
                                                    if (ageError) setValidationError('maritalStatus', ageError);
                                                    else clearValidationError('maritalStatus');
                                                }} />
                                        </div>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.dateOfBirth && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.dateOfBirth}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="fatherName" className="text-sm font-semibold">Father Name {renderRequiredIndicator('fatherName')}</Label>
                                        <Input id="fatherName" value={clientData.fatherName} placeholder="Enter father's name"
                                            onChange={(e) => setClientData({ ...clientData, fatherName: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="gender-hm" className="text-sm font-semibold">Gender {renderRequiredIndicator('gender')}</Label>
                                        <Select value={clientData.gender} onValueChange={(v) => setClientData({ ...clientData, gender: v })}>
                                            <SelectTrigger id="gender-hm"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Permanent Address + Pincode + Post Office
                                    — editable on a renewal (member may have relocated) */}
                                <div className="renewal-editable space-y-3">
                                {renewalMode && rnPrefilled && (
                                    <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                        <MapPin className="h-3.5 w-3.5" /> Address &amp; location are editable for this renewal.
                                    </p>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="permanentAddress" className="text-sm font-semibold">Permanent Address {renderRequiredIndicator('permanentAddress')}</Label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input id="permanentAddress" value={clientData.permanentAddress} placeholder="Enter permanent address" className="pl-10"
                                                onChange={(e) => setClientData({ ...clientData, permanentAddress: e.target.value })} />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="pincode" className="text-sm font-semibold">Pincode {renderRequiredIndicator('pincode')}</Label>
                                        <Input id="pincode" value={clientData.pincode} maxLength={6} placeholder="6-digit pincode"
                                            onChange={(e) => handlePincodeChange(e.target.value)}
                                            className={cn(validationErrors.pincode && 'border-red-500 focus-visible:ring-red-500')} />
                                        {isFetchingPincode && <p className="flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" />Fetching location...</p>}
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.pincode && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.pincode}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="postOffice" className="text-sm font-semibold">Post Office {renderRequiredIndicator('postOffice')}</Label>
                                        {showPostOfficeSelect && postOfficeOptions.length > 0 ? (
                                            <Select value={clientData.postOffice} onValueChange={handlePostOfficeSelect}>
                                                <SelectTrigger id="postOffice"><SelectValue placeholder="Select Post Office" /></SelectTrigger>
                                                <SelectContent>{postOfficeOptions.map((po) => <SelectItem key={po.Name} value={po.Name}>{po.Name} - {po.District}, {po.State}</SelectItem>)}</SelectContent>
                                            </Select>
                                        ) : (
                                            <Input id="postOffice" value={clientData.postOffice} placeholder="Enter post office"
                                                onChange={(e) => setClientData({ ...clientData, postOffice: e.target.value })} />
                                        )}
                                    </div>
                                </div>

                                {/* State + City + Country */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="state" className="text-sm font-semibold">State {renderRequiredIndicator('state')}</Label>
                                        <Input id="state" value={clientData.state} placeholder="Enter state"
                                            onChange={(e) => setClientData({ ...clientData, state: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="district" className="text-sm font-semibold">City {renderRequiredIndicator('district')}</Label>
                                        <Input id="district" value={clientData.district} placeholder="Enter city"
                                            onChange={(e) => setClientData({ ...clientData, district: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="country" className="text-sm font-semibold">Country {renderRequiredIndicator('country')}</Label>
                                        <Input id="country" value={clientData.country} placeholder="Enter country"
                                            onChange={(e) => setClientData({ ...clientData, country: e.target.value })} />
                                    </div>
                                </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* ══ TAB: Credit Check (CRIF) ══ */}
                    {activeTab === 'credit-check' && (
                        // renewal-editable: a credit recheck is an action, not a piece of the
                        // member's frozen approved record — it must stay clickable under
                        // .renewal-locked (the tab-content wrapper set on a renewal), same as
                        // Address/Co-Applicant/Loan Details below. Without it, the consent
                        // checkbox and Run Credit Check/Run again buttons render but are inert
                        // (pointer-events: none from the lock).
                        <Card className="renewal-editable border-primary/20 shadow-md dark:border-sidebar-accent">
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <ShieldCheck className="h-5 w-5 text-primary" />
                                    Credit Check
                                </CardTitle>
                                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                                    Optional CRIF bureau check for {clientData.clientName || 'this client'} — reuses a recent report for the same Aadhaar automatically. Not required to save the enrollment.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-4">
                                {creditCheckError && (
                                    <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                                        <AlertCircle className="h-4 w-4 shrink-0" />{creditCheckError}
                                    </div>
                                )}

                                {!creditCheckResult && isCreditCheckAutoLoading && (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Checking for an existing Highmark report for this Aadhaar…
                                    </div>
                                )}

                                {!creditCheckResult && !isCreditCheckAutoLoading && (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                                            <div>
                                                <div className="text-xs text-muted-foreground">Name</div>
                                                <div className="font-medium">{clientData.clientName} {clientData.lastName}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground">Aadhaar</div>
                                                <div className="font-medium">{kycData.otherIdNo || '—'}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground">Mobile</div>
                                                <div className="font-medium">{kycData.mobileNumber || '—'}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <Checkbox id="creditConsent" checked={creditCheckConsent}
                                                onCheckedChange={(v) => setCreditCheckConsent(v === true)} />
                                            <Label htmlFor="creditConsent" className="text-sm font-normal leading-snug">
                                                The client has given explicit consent for a Highmark check to be run on their behalf.
                                            </Label>
                                        </div>
                                        <Button type="button" onClick={() => void handleRunCreditCheck()}
                                            disabled={isCreditChecking || !creditCheckConsent}
                                            className="bg-primary hover:bg-sidebar-accent text-white">
                                            {isCreditChecking
                                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking…</>
                                                : <><ShieldCheck className="mr-2 h-4 w-4" />Run Credit Check</>}
                                        </Button>
                                    </>
                                )}

                                {creditCheckResult && (
                                    <div className="space-y-3">
                                        {creditCheckAutoLoaded && (
                                            <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-green-50 px-3 py-2 text-xs text-sidebar-accent dark:border-sidebar-accent dark:bg-brand-green-darker/30 dark:text-slate-300">
                                                <History className="h-3.5 w-3.5 shrink-0" />
                                                An existing Highmark report for this Aadhaar was found automatically — no new bureau pull was made.
                                            </div>
                                        )}
                                        <CreditReportResult report={creditCheckResult} reused={creditCheckReused} />
                                        <Button type="button" variant="outline"
                                            onClick={() => { setCreditCheckResult(null); setCreditCheckAutoLoaded(false); setCreditCheckError(''); }}
                                            className="border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300">
                                            Run again
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* ══ TAB 2: Member Details ══ */}
                    {activeTab === 'client' && (
                        <Card className="border-primary/20 shadow-md dark:border-sidebar-accent">
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <FileText className="h-5 w-5 text-primary" />Member Details
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-4">
                               
                            

                                {/* Email + Age + Caste */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="email" className="text-sm font-semibold">Email {renderRequiredIndicator('email')}</Label>
                                        <Input id="email" type="email" value={clientData.email} placeholder="Enter email"
                                            onChange={(e) => handleEmailChange(e.target.value)}
                                            className={cn(validationErrors.email && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.email && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.email}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="age" className="text-sm font-semibold">Age {renderRequiredIndicator('age')}</Label>
                                        <Input id="age" value={clientData.age} placeholder="Auto-calculated from DOB" disabled />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="caste" className="text-sm font-semibold">Caste {renderRequiredIndicator('caste')}</Label>
                                        <Select value={clientData.caste} onValueChange={(v) => setClientData({ ...clientData, caste: v })}>
                                            <SelectTrigger id="caste"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{CASTES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Community + Economic Activity Type + Economic Activity */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="community" className="text-sm font-semibold">Community {renderRequiredIndicator('community')}</Label>
                                        <Select value={clientData.community} onValueChange={(v) => setClientData({ ...clientData, community: v })}>
                                            <SelectTrigger id="community" className={cn(validationErrors.community && 'border-red-500')}><SelectValue placeholder="Select community" /></SelectTrigger>
                                            <SelectContent>{COMMUNITY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="economicActivityTypeId" className="text-sm font-semibold">Economic Activity Type {renderRequiredIndicator('economicActivityTypeId')}</Label>
                                        <Select value={clientData.economicActivityTypeId} onValueChange={(v) => { setClientData({ ...clientData, economicActivityTypeId: v, economicActivityId: '' }); fetchEconomicActivities(v); }}>
                                            <SelectTrigger id="economicActivityTypeId"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{economicActivityTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="economicActivityId" className="text-sm font-semibold">Economic Activity {renderRequiredIndicator('economicActivityId')}</Label>
                                        <Select value={clientData.economicActivityId} onValueChange={(v) => setClientData({ ...clientData, economicActivityId: v })} disabled={!clientData.economicActivityTypeId || isLoadingActivities}>
                                            <SelectTrigger id="economicActivityId"><SelectValue placeholder={isLoadingActivities ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                            <SelectContent>{economicActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Religion + Qualification + Marital Status */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="religion" className="text-sm font-semibold">Religion {renderRequiredIndicator('religion')}</Label>
                                        <Select value={clientData.religion} onValueChange={(v) => setClientData({ ...clientData, religion: v })}>
                                            <SelectTrigger id="religion"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{RELIGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="qualification" className="text-sm font-semibold">Qualification {renderRequiredIndicator('qualification')}</Label>
                                        <Select value={clientData.qualification} onValueChange={(v) => setClientData({ ...clientData, qualification: v })}>
                                            <SelectTrigger id="qualification">
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {QUALIFICATION_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="maritalStatus" className="text-sm font-semibold">Marital Status {renderRequiredIndicator('maritalStatus')}</Label>
                                        <Select value={clientData.maritalStatus} onValueChange={(v) => {
                                            setClientData({ ...clientData, maritalStatus: v });
                                            const ageError = getSingleMaritalAgeError(clientData.dateOfBirth, v);
                                            if (ageError) setValidationError('maritalStatus', ageError);
                                            else clearValidationError('maritalStatus');
                                        }}>
                                            <SelectTrigger id="maritalStatus" className={cn(validationErrors.maritalStatus && 'border-red-500 focus:ring-red-500')}><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{MARITAL_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.maritalStatus && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.maritalStatus}</p>
                                    </div>
                                </div>

                                {/* Spouse Name + Spouse DOB + Spouse Mobile Number */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseName" className="text-sm font-semibold">Spouse Name {renderRequiredIndicator('spouseName')}</Label>
                                        <Input id="spouseName" value={clientData.spouseName} placeholder="Enter spouse name"
                                            onChange={(e) => setClientData({ ...clientData, spouseName: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseDob" className="text-sm font-semibold">Spouse DOB {renderRequiredIndicator('spouseDob')}</Label>
                                        <DateInput id="spouseDob" value={clientData.spouseDob}
                                            onChange={(e) => setClientData({ ...clientData, spouseDob: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseMobileNumber" className="text-sm font-semibold">Spouse Mobile Number {renderRequiredIndicator('spouseMobileNumber')}</Label>
                                        <Input id="spouseMobileNumber" value={clientData.spouseMobileNumber} placeholder="Enter spouse mobile number" maxLength={10}
                                            onChange={(e) => setClientData({ ...clientData, spouseMobileNumber: e.target.value.replace(/\D/g, '') })} />
                                    </div>
                                </div>

                                {/* Spouse Gender + Spouse Economic Activity Type + Spouse Economic Activity */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseGender" className="text-sm font-semibold">Spouse Gender {renderRequiredIndicator('spouseGender')}</Label>
                                        <Select value={clientData.spouseGender} onValueChange={(v) => setClientData({ ...clientData, spouseGender: v })}>
                                            <SelectTrigger id="spouseGender"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseEconomicActivityTypeId" className="text-sm font-semibold">Spouse Economic Activity Type {renderRequiredIndicator('spouseEconomicActivityTypeId')}</Label>
                                        <Select value={clientData.spouseEconomicActivityTypeId} onValueChange={(v) => { setClientData({ ...clientData, spouseEconomicActivityTypeId: v, spouseEconomicActivityId: '' }); fetchSpouseEconomicActivities(v); }}>
                                            <SelectTrigger id="spouseEconomicActivityTypeId"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{economicActivityTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="spouseEconomicActivityId" className="text-sm font-semibold">Spouse Economic Activity {renderRequiredIndicator('spouseEconomicActivityId')}</Label>
                                        <Select value={clientData.spouseEconomicActivityId} onValueChange={(v) => setClientData({ ...clientData, spouseEconomicActivityId: v })} disabled={!clientData.spouseEconomicActivityTypeId || isLoadingSpouseActivities}>
                                            <SelectTrigger id="spouseEconomicActivityId"><SelectValue placeholder={isLoadingSpouseActivities ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                            <SelectContent>{spouseEconomicActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Children + Income + Expense */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="noOfChildren" className="text-sm font-semibold">No. of Children {renderRequiredIndicator('noOfChildren')}</Label>
                                        <Input id="noOfChildren" type="number" value={clientData.noOfChildren} placeholder="Enter number"
                                            onChange={(e) => setClientData({ ...clientData, noOfChildren: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="monthlyFamilyIncome" className="text-sm font-semibold">Monthly Family Income {renderRequiredIndicator('monthlyFamilyIncome')}</Label>
                                        <Input id="monthlyFamilyIncome" type="number" value={clientData.monthlyFamilyIncome} placeholder="Enter amount"
                                            onChange={(e) => handleAmountChange('monthlyFamilyIncome', e.target.value)}
                                            className={cn(validationErrors.monthlyFamilyIncome && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.monthlyFamilyIncome && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.monthlyFamilyIncome}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="monthlyFamilyExpense" className="text-sm font-semibold">Monthly Family Expense {renderRequiredIndicator('monthlyFamilyExpense')}</Label>
                                        <Input id="monthlyFamilyExpense" type="number" value={clientData.monthlyFamilyExpense} placeholder="Enter amount"
                                            onChange={(e) => setClientData({ ...clientData, monthlyFamilyExpense: e.target.value })} />
                                    </div>
                                </div>

                                {/* IFSC + Bank Account */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="ifscCode" className="text-sm font-semibold">IFSC Code {renderRequiredIndicator('ifscCode')}</Label>
                                        <div className="relative">
                                            <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input id="ifscCode" value={clientData.ifscCode} maxLength={11} placeholder="SBIN0001234"
                                                onChange={(e) => handleIFSCChange(e.target.value)}
                                                className={cn('pl-10', validationErrors.ifscCode && 'border-red-500 focus-visible:ring-red-500')} />
                                        </div>
                                        {isFetchingIfsc && <p className="flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" />Fetching bank details...</p>}
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.ifscCode && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.ifscCode}</p>
                                        {!validationErrors.ifscCode && ifscLookupAddress && <p className="text-xs text-sidebar-accent">Bank Address: {ifscLookupAddress}</p>}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="bankAcNo" className="text-sm font-semibold">Bank A/c No {renderRequiredIndicator('bankAcNo')}</Label>
                                        <Input id="bankAcNo" type="password" value={clientData.bankAcNo} placeholder="Enter account number"
                                            onChange={(e) => { handleBankAccountChange('bankAcNo', e.target.value); clearIdentityConflict('bankAcNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('BANK_ACCOUNT', e.target.value, 'CLIENT', 'bankAcNo')}
                                            onCopy={(e) => e.preventDefault()} onCut={(e) => e.preventDefault()} onPaste={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}
                                            className={cn((validationErrors.bankAcNo || identityConflicts.bankAcNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.bankAcNo || identityConflicts.bankAcNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.bankAcNo || identityConflicts.bankAcNo}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="retypeBankAcNo" className="text-sm font-semibold">Retype Bank A/c No {renderRequiredIndicator('retypeBankAcNo')}</Label>
                                        <Input id="retypeBankAcNo" value={clientData.retypeBankAcNo} placeholder="Re-enter account number"
                                            onChange={(e) => handleBankAccountChange('retypeBankAcNo', e.target.value)}
                                            className={cn(validationErrors.retypeBankAcNo && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.retypeBankAcNo && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.retypeBankAcNo}</p>
                                    </div>
                                </div>

                                {/* Bank Name + Branch + Account Type */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="bankName" className="text-sm font-semibold">Bank Name {renderRequiredIndicator('bankName')}</Label>
                                        <Input id="bankName" value={clientData.bankName} placeholder="Enter bank name"
                                            onChange={(e) => setClientData({ ...clientData, bankName: e.target.value })}
                                            disabled={isIfscLocked || isFetchingIfsc} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="bankBranch" className="text-sm font-semibold">Bank Branch {renderRequiredIndicator('bankBranch')}</Label>
                                        <Input id="bankBranch" value={clientData.bankBranch} placeholder="Enter branch name"
                                            onChange={(e) => setClientData({ ...clientData, bankBranch: e.target.value })}
                                            disabled={isIfscLocked || isFetchingIfsc} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="bankAccountType" className="text-sm font-semibold">Bank Account Type {renderRequiredIndicator('bankAccountType')}</Label>
                                        <Select value={clientData.bankAccountType} onValueChange={(v) => setClientData({ ...clientData, bankAccountType: v })}>
                                            <SelectTrigger id="bankAccountType"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Savings Account">Savings Account</SelectItem>
                                                <SelectItem value="Current Account">Current Account</SelectItem>
                                                <SelectItem value="Salary Account">Salary Account</SelectItem>
                                                <SelectItem value="Joint Account">Joint Account</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* House Status + Mother Name + Smart Card Number */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="houseStatus" className="text-sm font-semibold">House Status {renderRequiredIndicator('houseStatus')}</Label>
                                        <Select value={clientData.houseStatus} onValueChange={(v) => setClientData({ ...clientData, houseStatus: v })}>
                                            <SelectTrigger id="houseStatus"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{HOUSE_STATUS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="motherName" className="text-sm font-semibold">Mother Name {renderRequiredIndicator('motherName')}</Label>
                                        <Input id="motherName" value={clientData.motherName} placeholder="Enter mother's name"
                                            onChange={(e) => setClientData({ ...clientData, motherName: e.target.value })} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="smartCardNo" className="text-sm font-semibold">Smart Card Number {renderRequiredIndicator('smartCardNo')}</Label>
                                        <Input id="smartCardNo" value={kycData.smartCardNo} placeholder="Enter smart card number"
                                            onChange={(e) => setKycData({ ...kycData, smartCardNo: e.target.value })}
                                            className={cn(validationErrors.smartCardNo && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.smartCardNo && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.smartCardNo}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* ══ TAB 3: Co-Applicant Details ══ */}
                    {activeTab === 'nominee' && (
                        <Card className="renewal-editable border-primary/20 shadow-md dark:border-sidebar-accent">
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Users className="h-5 w-5 text-primary" />Co-Applicant Details
                                </CardTitle>
                                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                                    Enter co-applicant details for this enrollment.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-4">
                                {renewalMode && rnPrefilled && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                                        <div className="flex flex-wrap items-center gap-4 text-xs">
                                            <span className="font-semibold text-emerald-800 dark:text-emerald-300">Co-applicant for this renewal:</span>
                                            <label className="flex items-center gap-1.5">
                                                <input type="radio" checked={rnCoMode === 'existing'} onChange={() => setRnCoMode('existing')} />
                                                Use existing
                                            </label>
                                            <label className="flex items-center gap-1.5">
                                                <input type="radio" checked={rnCoMode === 'new'} onChange={() => setRnCoMode('new')} />
                                                Add new
                                            </label>
                                            {rnCoMode === 'existing' && (
                                                <Select value={rnCoApplicantId} onValueChange={setRnCoApplicantId}>
                                                    <SelectTrigger className="h-9 w-64"><SelectValue placeholder={rnExistingCoApplicants.length ? 'Select co-applicant' : 'No approved co-applicants'} /></SelectTrigger>
                                                    <SelectContent>
                                                        {rnExistingCoApplicants.map((co) => (
                                                            <SelectItem key={co.id} value={co.id}>{co.name} — {co.relationWithClient}{co.isPrimary ? ' ★' : ''}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </div>
                                        <p className="mt-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                                            {rnCoMode === 'existing'
                                                ? 'The selected co-applicant is frozen onto the renewal loan.'
                                                : 'Fill the fields below and upload the new co-applicant’s documents in the KYC tab — they pass through the approval chain too.'}
                                        </p>
                                    </div>
                                )}
                                <Alert className="border-primary/30 bg-green-50/40 dark:border-sidebar-accent dark:bg-green-950/20">
                                    <Info className="h-4 w-4 text-primary" />
                                    <AlertDescription className="text-xs text-sidebar-accent dark:text-primary">
                                        Co-Applicant document uploads are in the <strong>KYC Details</strong> tab.
                                    </AlertDescription>
                                </Alert>

                                {/* Relation + Name + Phone */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="relationWithClient" className="text-sm font-semibold">Relation With Member {renderRequiredIndicator('coApplicantRelation')}</Label>
                                        <Select value={nomineeData.relationWithClient} onValueChange={(v) => { setNomineeData({ ...nomineeData, relationWithClient: v }); clearValidationError('nomineeRelation'); }}>
                                            <SelectTrigger id="relationWithClient" className={cn(validationErrors.nomineeRelation && 'border-red-500 focus:ring-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>{RELATIONSHIPS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.nomineeRelation && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.nomineeRelation}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="nomineeName" className="text-sm font-semibold">
                                            Co-Applicant Name {renderRequiredIndicator('coApplicantName')}
                                        </Label>
                                        {nomineeData.relationWithClient === 'Spouse' ? (
                                            <>
                                                <Input
                                                    id="nomineeName"
                                                    value={clientData.spouseName}
                                                    readOnly
                                                    disabled
                                                    placeholder="Auto-filled from Spouse Name"
                                                    className="bg-muted cursor-not-allowed"
                                                />
                                                <p className="flex items-center gap-1 text-xs text-primary">
                                                    <Info className="h-3 w-3" />Auto-filled from Spouse Name in Member Details
                                                </p>
                                            </>
                                        ) : (
                                            <Input id="nomineeName" value={nomineeData.nomineeName} placeholder="Enter co-applicant name"
                                                onChange={(e) => { setNomineeData({ ...nomineeData, nomineeName: e.target.value }); if (e.target.value.trim()) clearValidationError('nomineeName'); }}
                                                className={cn(validationErrors.nomineeName && 'border-red-500 focus-visible:ring-red-500')} />
                                        )}
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.nomineeName && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.nomineeName}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="caMobileNumber" className="flex items-center gap-1.5 text-sm font-semibold">
                                            <Phone className="h-3.5 w-3.5 text-primary" />Phone Number {renderRequiredIndicator('coApplicantMobileNumber')}
                                        </Label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input id="caMobileNumber" type="tel" maxLength={10} value={nomineeData.phoneNumber}
                                                placeholder="10-digit mobile number"
                                                onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 10); setNomineeData({ ...nomineeData, phoneNumber: v }); if (v.length === 10) clearValidationError('nomineePhoneNumber'); clearIdentityConflict('nomineePhoneNumber'); }}
                                                onBlur={(e) => checkIdentityFieldUniqueness('MOBILE', e.target.value, 'COAPPLICANT', 'nomineePhoneNumber', kycData.mobileNumber)}
                                                className={cn('pl-10', (validationErrors.nomineePhoneNumber || identityConflicts.nomineePhoneNumber) && 'border-red-500 focus-visible:ring-red-500')} />
                                        </div>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.nomineePhoneNumber || identityConflicts.nomineePhoneNumber) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.nomineePhoneNumber || identityConflicts.nomineePhoneNumber}</p>
                                    </div>
                                </div>

                                {/* Gender + DOB + Age */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="nomineeGender" className="text-sm font-semibold">Gender {renderRequiredIndicator('coApplicantGender')}</Label>
                                        <Select value={nomineeData.gender} onValueChange={(v) => { setNomineeData({ ...nomineeData, gender: v }); clearValidationError('nomineeGender'); }}>
                                            <SelectTrigger id="nomineeGender" className={cn(validationErrors.nomineeGender && 'border-red-500 focus:ring-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>{GENDERS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.nomineeGender && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.nomineeGender}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="nomineeDOB" className="text-sm font-semibold">Date of Birth {renderRequiredIndicator('coApplicantDob')}</Label>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <DateInput id="nomineeDOB" value={nomineeData.dateOfBirth}
                                                onChange={(e) => { const dob = e.target.value; setNomineeData({ ...nomineeData, dateOfBirth: dob, age: calculateAge(dob) }); if (dob) clearValidationError('nomineeDateOfBirth'); }}
                                                className={cn('pl-10', validationErrors.nomineeDateOfBirth && 'border-red-500 focus-visible:ring-red-500')} />
                                        </div>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.nomineeDateOfBirth && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.nomineeDateOfBirth}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="nomineeAge" className="text-sm font-semibold">Age {renderRequiredIndicator('coApplicantAge')}</Label>
                                        <Input id="nomineeAge" value={nomineeData.age} placeholder="Auto-calculated" disabled />
                                    </div>
                                </div>

                                {/* Co-Applicant Economic Activity Type + Activity */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="coApplicantEconomicActivityTypeId" className="text-sm font-semibold">Co-Applicant Economic Activity Type {renderRequiredIndicator('coApplicantEconomicActivityTypeId')}</Label>
                                        <Select value={nomineeData.coApplicantEconomicActivityTypeId} onValueChange={(v) => { setNomineeData({ ...nomineeData, coApplicantEconomicActivityTypeId: v, coApplicantEconomicActivityId: '' }); fetchCoApplicantEconomicActivities(v); }}>
                                            <SelectTrigger id="coApplicantEconomicActivityTypeId"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>{economicActivityTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="coApplicantEconomicActivityId" className="text-sm font-semibold">Co-Applicant Economic Activity {renderRequiredIndicator('coApplicantEconomicActivityId')}</Label>
                                        <Select value={nomineeData.coApplicantEconomicActivityId} onValueChange={(v) => setNomineeData({ ...nomineeData, coApplicantEconomicActivityId: v })} disabled={!nomineeData.coApplicantEconomicActivityTypeId || isLoadingCoApplicantActivities}>
                                            <SelectTrigger id="coApplicantEconomicActivityId"><SelectValue placeholder={isLoadingCoApplicantActivities ? 'Loading...' : '-- SELECT --'} /></SelectTrigger>
                                            <SelectContent>{coApplicantEconomicActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Co-Applicant ID Numbers */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="caPancardNo" className="text-sm font-semibold">Co-Applicant PAN Card Number {renderRequiredIndicator('caPancardNo')}</Label>
                                        <Input id="caPancardNo" value={kycData.caPancardNo} maxLength={10} placeholder="ABCDE1234F"
                                            onChange={(e) => { handlePANChange('caPancardNo', e.target.value); clearIdentityConflict('caPancardNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('PAN', e.target.value, 'COAPPLICANT', 'caPancardNo', kycData.pancardNo)}
                                            className={cn((validationErrors.caPancardNo || identityConflicts.caPancardNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.caPancardNo || identityConflicts.caPancardNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.caPancardNo || identityConflicts.caPancardNo}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="caVoterIdNo" className="text-sm font-semibold">Co-Applicant Voter ID Number {renderRequiredIndicator('caVoterIdNo')}</Label>
                                        <Input id="caVoterIdNo" value={kycData.caVoterIdNo} maxLength={30} placeholder="ABC1234567"
                                            onChange={(e) => { handleVoterIDChange('caVoterIdNo', e.target.value); clearIdentityConflict('caVoterIdNo'); }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('VOTER_ID', e.target.value, 'COAPPLICANT', 'caVoterIdNo', kycData.votersIdNo)}
                                            className={cn((validationErrors.caVoterIdNo || identityConflicts.caVoterIdNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.caVoterIdNo || identityConflicts.caVoterIdNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.caVoterIdNo || identityConflicts.caVoterIdNo}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="caOtherIdNo" className="text-sm font-semibold">Co-Applicant Aadhaar Number {renderRequiredIndicator('caOtherIdNo')}</Label>
                                        <Input id="caOtherIdNo" value={kycData.caOtherIdNo} maxLength={12} placeholder="12-digit Aadhaar number"
                                            onChange={(e) => {
                                                setKycData({ ...kycData, caOtherIdNo: e.target.value });
                                                if (e.target.value) {
                                                    const v = validateAadhaar(e.target.value, false);
                                                    if (!v.isValid && v.error) setValidationError('caOtherIdNo', v.error);
                                                    else clearValidationError('caOtherIdNo');
                                                } else {
                                                    clearValidationError('caOtherIdNo');
                                                }
                                                clearIdentityConflict('caOtherIdNo');
                                            }}
                                            onBlur={(e) => checkIdentityFieldUniqueness('AADHAAR', e.target.value, 'COAPPLICANT', 'caOtherIdNo', kycData.otherIdNo)}
                                            className={cn((validationErrors.caOtherIdNo || identityConflicts.caOtherIdNo) && 'border-red-500 focus-visible:ring-red-500')} />
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !(validationErrors.caOtherIdNo || identityConflicts.caOtherIdNo) && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.caOtherIdNo || identityConflicts.caOtherIdNo}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* ══ TAB: Loan Details ══ */}
                    {activeTab === 'loan-details' && (() => {
                        const selectedLoanProduct = allLoanProducts.find(p => p.id === nomineeData.requestedLoanProductId);
                        const tenureMonths = selectedLoanProduct?.numberOfDues != null
                            ? computeTenureMonths(selectedLoanProduct.numberOfDues, selectedLoanProduct.frequency)
                            : null;
                        return (
                        <>
                        {/* Member Group Status is only for a brand-new member — a
                            renewal member already has their center/group. */}
                        <Card className={cn('border-primary/20 shadow-md dark:border-sidebar-accent', renewalMode && 'hidden')}>
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Users className="h-5 w-5 text-primary" />Member Group Status
                                </CardTitle>
                                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                                    The FDO&apos;s preferred center and group for this member. This is only a request — the Branch Manager makes the final assignment in Client Operations → Assign Center &amp; Group.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="memberGroupStatus" className="text-sm font-semibold">Group Status <span className="text-red-500">*</span></Label>
                                        <Select value={clientData.memberGroupStatus} onValueChange={(v) => {
                                            setClientData({ ...clientData, memberGroupStatus: v, requestedCenterId: '', requestedGroupId: '' });
                                            setRequestedGroups([]);
                                            clearValidationError('memberGroupStatus');
                                        }}>
                                            <SelectTrigger id="memberGroupStatus" className={cn(validationErrors.memberGroupStatus && 'border-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="NEW_CENTER_NEW_MEMBER">New Center New Member</SelectItem>
                                                <SelectItem value="EXISTING_CENTER_NEW_MEMBER">Existing Center New Member</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.memberGroupStatus && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.memberGroupStatus}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedCenterId" className="text-sm font-semibold">Center <span className="text-red-500">*</span></Label>
                                        <Select value={clientData.requestedCenterId} onValueChange={(v) => {
                                            setClientData({ ...clientData, requestedCenterId: v, requestedGroupId: '' });
                                            setRequestedGroups([]);
                                            fetchRequestedGroups(v);
                                            clearValidationError('requestedCenterId');
                                        }} disabled={isLoadingFdoCenters || (needsBranchSelection && !enrollmentBranchId)}>
                                            <SelectTrigger id="requestedCenterId" className={cn(validationErrors.requestedCenterId && 'border-red-500')}>
                                                <SelectValue placeholder={
                                                    isLoadingFdoCenters
                                                        ? 'Loading...'
                                                        : (needsBranchSelection && !enrollmentBranchId)
                                                            ? 'Select a branch above first'
                                                            : '-- SELECT --'
                                                } />
                                            </SelectTrigger>
                                            <SelectContent>{fdoCenters
                                                .filter((c) => clientData.memberGroupStatus !== 'NEW_CENTER_NEW_MEMBER' || c.clientCount === 0)
                                                .map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.code})</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedCenterId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedCenterId}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedGroupId" className="text-sm font-semibold">Requested Group <span className="text-red-500">*</span></Label>
                                        <Select value={clientData.requestedGroupId} onValueChange={(v) => {
                                            setClientData({ ...clientData, requestedGroupId: v });
                                            clearValidationError('requestedGroupId');
                                        }} disabled={!clientData.requestedCenterId || isLoadingRequestedGroups}>
                                            <SelectTrigger id="requestedGroupId" className={cn(validationErrors.requestedGroupId && 'border-red-500')}>
                                                <SelectValue placeholder={
                                                    !clientData.requestedCenterId
                                                        ? 'Select center first'
                                                        : isLoadingRequestedGroups
                                                        ? 'Loading...'
                                                        : '-- SELECT --'
                                                } />
                                            </SelectTrigger>
                                            <SelectContent>{requestedGroups
                                                .filter((g) => clientData.memberGroupStatus !== 'NEW_CENTER_NEW_MEMBER' || g.memberCount === 0)
                                                .map((g) => <SelectItem key={g.id} value={g.id}>{g.name} ({g.memberCount}/{g.maxMembersPerGroup})</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedGroupId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedGroupId}</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="renewal-editable border-primary/20 shadow-md dark:border-sidebar-accent">
                            <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-green-50 to-green-50 dark:border-sidebar-accent dark:from-sidebar-accent dark:to-sidebar-accent">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <CreditCard className="h-5 w-5 text-primary" />Loan Details
                                </CardTitle>
                                <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
                                    Requested loan product, purpose, and amount for this member&apos;s first loan. Center and Co-Applicant are taken automatically from this enrollment.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3 pt-4">
                                {/* Product Type → Frequency → Product → Amount */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedLoanProductTypeId" className="text-sm font-semibold">Product Type {renderRequiredIndicator('requestedLoanProductTypeId')}</Label>
                                        <Select value={nomineeData.requestedLoanProductTypeId} onValueChange={(v) => {
                                            const byType = allLoanProducts.filter(p => p.loanProductTypeId === v);
                                            const byFreq = nomineeData.requestedLoanFrequency ? byType.filter(p => p.frequency === nomineeData.requestedLoanFrequency) : byType;
                                            setFilteredLoanProducts(byFreq);
                                            setNomineeData({ ...nomineeData, requestedLoanProductTypeId: v, requestedLoanProductId: '' });
                                            setSelectedLoanProductAmount('');
                                            clearValidationError('requestedLoanProductTypeId');
                                        }}>
                                            <SelectTrigger id="requestedLoanProductTypeId" className={cn(validationErrors.requestedLoanProductTypeId && 'border-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>{loanProductTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedLoanProductTypeId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedLoanProductTypeId}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedLoanFrequency" className="text-sm font-semibold">Frequency {renderRequiredIndicator('requestedLoanFrequency')}</Label>
                                        <Select value={nomineeData.requestedLoanFrequency} onValueChange={(v) => {
                                            const byType = nomineeData.requestedLoanProductTypeId ? allLoanProducts.filter(p => p.loanProductTypeId === nomineeData.requestedLoanProductTypeId) : allLoanProducts;
                                            setFilteredLoanProducts(byType.filter(p => p.frequency === v));
                                            setNomineeData({ ...nomineeData, requestedLoanFrequency: v, requestedLoanProductId: '' });
                                            setSelectedLoanProductAmount('');
                                        }} disabled={!nomineeData.requestedLoanProductTypeId}>
                                            <SelectTrigger id="requestedLoanFrequency"><SelectValue placeholder="-- SELECT --" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="weekly">Weekly</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedLoanProductId" className="text-sm font-semibold">Loan Product {renderRequiredIndicator('requestedLoanProductId')}</Label>
                                        <Select value={nomineeData.requestedLoanProductId} onValueChange={(v) => {
                                            const product = filteredLoanProducts.find(p => p.id === v);
                                            setSelectedLoanProductAmount(product ? String(product.loanAmount) : '');
                                            setNomineeData({ ...nomineeData, requestedLoanProductId: v });
                                            clearValidationError('requestedLoanProductId');
                                        }} disabled={!nomineeData.requestedLoanProductTypeId}>
                                            <SelectTrigger id="requestedLoanProductId" className={cn(validationErrors.requestedLoanProductId && 'border-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>{filteredLoanProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedLoanProductId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedLoanProductId}</p>
                                    </div>
                                </div>

                                {/* Loan Amount + Purpose Type + Loan Purpose */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="space-y-2">
                                        <Label htmlFor="loanProductAmount" className="text-sm font-semibold">Loan Amount</Label>
                                        <Input id="loanProductAmount" value={selectedLoanProductAmount ? `₹ ${Number(selectedLoanProductAmount).toLocaleString('en-IN')}` : ''} placeholder="Auto-filled from product" disabled />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedLoanPurposeTypeId" className="text-sm font-semibold">Purpose Type {renderRequiredIndicator('requestedLoanPurposeTypeId')}</Label>
                                        <Select value={nomineeData.requestedLoanPurposeTypeId} onValueChange={(v) => {
                                            setNomineeData({ ...nomineeData, requestedLoanPurposeTypeId: v, requestedLoanPurposeId: '' });
                                            setLoanPurposes([]);
                                            fetchLoanPurposes(v);
                                            clearValidationError('requestedLoanPurposeTypeId');
                                        }}>
                                            <SelectTrigger id="requestedLoanPurposeTypeId" className={cn(validationErrors.requestedLoanPurposeTypeId && 'border-red-500')}>
                                                <SelectValue placeholder="-- SELECT --" />
                                            </SelectTrigger>
                                            <SelectContent>{loanPurposeTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedLoanPurposeTypeId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedLoanPurposeTypeId}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="requestedLoanPurposeId" className="text-sm font-semibold">Loan Purpose {renderRequiredIndicator('requestedLoanPurposeId')}</Label>
                                        <Select value={nomineeData.requestedLoanPurposeId} onValueChange={(v) => {
                                            setNomineeData({ ...nomineeData, requestedLoanPurposeId: v });
                                            clearValidationError('requestedLoanPurposeId');
                                        }} disabled={!nomineeData.requestedLoanPurposeTypeId || isLoadingLoanPurposes}>
                                            <SelectTrigger id="requestedLoanPurposeId" className={cn(validationErrors.requestedLoanPurposeId && 'border-red-500')}>
                                                <SelectValue placeholder={isLoadingLoanPurposes ? 'Loading...' : '-- SELECT --'} />
                                            </SelectTrigger>
                                            <SelectContent>{loanPurposes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <p className={cn("flex items-center gap-1 text-xs text-red-500", !validationErrors.requestedLoanPurposeId && "invisible")}><AlertCircle className="h-3 w-3" />{validationErrors.requestedLoanPurposeId}</p>
                                    </div>
                                </div>

                                {/* Auto-fetched from selected Loan Product */}
                                <div className="space-y-2 pt-2">
                                    <Label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Auto-fetched from Loan Product</Label>
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="autoInsuranceRate" className="text-sm font-semibold">Insurance Rate</Label>
                                            <Input id="autoInsuranceRate" value={`${LOAN_FEES.INSURANCE_FEE_PERCENT}%`} disabled />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="autoInsuranceFee" className="text-sm font-semibold">Insurance Fee</Label>
                                            <Input id="autoInsuranceFee" value={selectedLoanProduct?.insuranceFees != null ? `₹ ${Number(selectedLoanProduct.insuranceFees).toLocaleString('en-IN')}` : '—'} placeholder="Auto-filled from product" disabled />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="autoTenure" className="text-sm font-semibold">Tenure</Label>
                                            <Input id="autoTenure" value={selectedLoanProduct?.numberOfDues != null ? `${selectedLoanProduct.numberOfDues} dues (${tenureMonths} mo)` : '—'} placeholder="Auto-filled from product" disabled />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="autoDocumentCharge" className="text-sm font-semibold">Document Charge</Label>
                                            <Input id="autoDocumentCharge" value={selectedLoanProduct?.documentCharges != null ? `₹ ${Number(selectedLoanProduct.documentCharges).toLocaleString('en-IN')}` : '—'} placeholder="Auto-filled from product" disabled />
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        </>
                        );
                    })()}

                    {/* ══ TAB 4: KYC Uploads ══ */}
                    {activeTab === 'kyc-uploads' && (
                        <div className="space-y-6">
                            {renewalMode && rnPrefilled && (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
                                    On a renewal, the member&apos;s existing KYC carries over. You <strong>must</strong> re-capture <strong>House Image 1</strong>, <strong>Latitude / Longitude</strong> and the <strong>Location QR</strong> below (the member may have relocated).
                                </div>
                            )}
                            {/* Member Identity Documents — shown on a renewal too,
                                but read-only (carried over from the approved record;
                                the tab wrapper's .renewal-locked freezes them). */}
                            <div className="rounded-2xl border border-primary/20 shadow-sm overflow-hidden dark:border-sidebar-accent/30">
                                <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-primary to-primary dark:from-sidebar-accent dark:to-sidebar-accent">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 shrink-0">
                                        <Shield className="h-4 w-4 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white tracking-wide">Member Documents</p>
                                        <p className="text-[11px] text-green-100">Identity proof uploads</p>
                                    </div>
                                </div>
                                <div className="bg-green-50/30 dark:bg-green-950/10 px-4 py-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                        <DocumentInputWithUpload
                                            label={`Member Photo${isFieldRequired('clientPhoto') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['client_photo']}
                                            documentType="client_photo"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('clientPhoto')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Aadhaar Front${isFieldRequired('aadhaarFrontFileUrl') || isFieldRequired('aadhaarFront') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['aadhaar_front']}
                                            value={kycData.otherIdNo}
                                            documentType="aadhaar_front"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('aadhaarFrontFileUrl') || isFieldRequired('aadhaarFront')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Aadhaar Back${isFieldRequired('aadhaarBackFileUrl') || isFieldRequired('aadhaarBack') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['aadhaar_back']}
                                            documentType="aadhaar_back"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('aadhaarBackFileUrl') || isFieldRequired('aadhaarBack')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`PAN Card Upload${isFieldRequired('pancardNo') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['pan_card']}
                                            value={kycData.pancardNo}
                                            documentType="pan_card"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('pancardNo')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Voter ID Front${isFieldRequired('voterIdImage') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['voter_id']}
                                            value={kycData.votersIdNo}
                                            documentType="voter_id"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('voterIdImage')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Voter ID Back${isFieldRequired('voterIdBackImage') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['voter_id_back']}
                                            documentType="voter_id_back"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('voterIdBackImage')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Bank Passbook${isFieldRequired('bankPassbook') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['bank_passbook']}
                                            documentType="bank_passbook"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('bankPassbook')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Smart Card Front Upload${isFieldRequired('smart_card_front') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['smart_card_front']}
                                            documentType="smart_card_front"
                                            owner="client"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('smart_card_front')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Smart Card Back${isFieldRequired('smart_card_back') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['smart_card_back']}
                                            documentType="smart_card_back"
                                            owner="client"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('smart_card_back')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Co-Applicant Documents — editable on a renewal only
                                when a brand-new co-applicant is being added. */}
                            <div className={cn(
                                'rounded-2xl border border-primary shadow-sm overflow-hidden dark:border-sidebar-accent/30',
                                renewalMode && rnCoMode === 'new' && 'renewal-editable'
                            )}>
                                <div className="flex items-center gap-3 px-5 py-3.5 bg-gradient-to-r from-primary to-violet-500 dark:from-primary dark:to-violet-800">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 shrink-0">
                                        <Users className="h-4 w-4 text-white" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-white tracking-wide">Co-Applicant Documents</p>
                                        <p className="text-[11px] text-violet-100">Co-applicant uploads</p>
                                    </div>
                                </div>
                                <div className="bg-green-50/30 dark:bg-brand-green-darker/10 px-4 py-4">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Photo${isFieldRequired('coApplicantPhoto') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_photo']}
                                            documentType="co_applicant_photo"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantPhoto')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Aadhaar Front${isFieldRequired('coApplicantAadhaarFront') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_other_id']}
                                            documentType="co_applicant_other_id"
                                            owner="coApplicant"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantAadhaarFront')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`CA Aadhaar Back${isFieldRequired('coApplicantAadhaarBack') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_aadhaar_back']}
                                            documentType="co_applicant_aadhaar_back"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantAadhaarBack')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant PAN Card Upload${isFieldRequired('coApplicantPancardUpload') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_pan_card']}
                                            documentType="co_applicant_pan_card"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantPancardUpload')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Voter ID Front${isFieldRequired('coApplicantVoterIdUpload') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_voter_id']}
                                            documentType="co_applicant_voter_id"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantVoterIdUpload')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Voter ID Back${isFieldRequired('coApplicantVoterIdBackUpload') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_voter_id_back']}
                                            documentType="co_applicant_voter_id_back"
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantVoterIdBackUpload')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Other ID Front${isFieldRequired('coApplicantOtherIdFront') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_other_id_front']}
                                            documentType="co_applicant_other_id_front"
                                            owner="coApplicant"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantOtherIdFront')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        <DocumentInputWithUpload
                                            label={`Co-Applicant Other ID Back${isFieldRequired('coApplicantOtherIdBack') ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs['co_applicant_other_id_back']}
                                            documentType="co_applicant_other_id_back"
                                            owner="coApplicant"
                                            accept="image/jpeg,image/jpg,image/png,application/pdf"
                                            clientIdentifier={clientIdentifier}
                                            required={isFieldRequired('coApplicantOtherIdBack')}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Residence Verification — house images, NOC (gas bill / NOC
                                images) and location QR are all re-uploaded on a renewal
                                (member may have relocated, or their NOC may have lapsed). */}
                            <div className="renewal-editable rounded-lg border border-primary/20 bg-white/60 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-semibold text-foreground dark:text-white">
                                        Residence Verification {renewalMode && rnPrefilled ? '— House Image 1, lat/long & QR required' : '(Optional)'}
                                    </p>
                                    <p className="text-xs text-slate-500">House photos, NOC and GPS location QR for field verification.</p>
                                </div>
                                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {(['house_image_1','house_image_2','house_image_3','gas_bill','noc_image_1','noc_image_2','noc_image_3'] as const).map((key) => {
                                        const rnRequired = renewalMode && key === 'house_image_1';
                                        const required = rnRequired || isFieldRequired(key);
                                        return (
                                        <DocumentInputWithUpload
                                            key={key}
                                            label={`${RESIDENCE_DOC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}${required ? '' : ' (Optional)'}`}
                                            initialOutput={inlineDocs[key]}
                                            documentType={key}
                                            accept="image/jpeg,image/jpg,image/png"
                                            clientIdentifier={clientIdentifier}
                                            required={required}
                                            onOutputChange={handleInlineDocChange}
                                        />
                                        );
                                    })}
                                    <DocumentInputWithUpload
                                        label={`Location QR${(renewalMode || isFieldRequired('location_qr')) ? '' : ' (Optional)'}`}
                                        initialOutput={inlineDocs['location_qr']}
                                        documentType="location_qr"
                                        accept="image/jpeg,image/jpg,image/png"
                                        clientIdentifier={clientIdentifier}
                                        required={renewalMode || isFieldRequired('location_qr')}
                                        onOutputChange={handleInlineDocChange}
                                    />
                                </div>
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="latitude" className="text-sm font-semibold">Latitude {renewalMode ? <span className="text-red-500">*</span> : renderRequiredIndicator('latitude')}</Label>
                                        <Input id="latitude" value={latitude} onChange={(e) => { setLatitude(e.target.value); setLocationAccuracy(null); }} placeholder="e.g. 11.016844" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="longitude" className="text-sm font-semibold">Longitude {renewalMode ? <span className="text-red-500">*</span> : renderRequiredIndicator('longitude')}</Label>
                                        <Input id="longitude" value={longitude} onChange={(e) => { setLongitude(e.target.value); setLocationAccuracy(null); }} placeholder="e.g. 76.955833" />
                                    </div>
                                    <div className="flex items-end gap-2">
                                        <Button type="button" variant="outline" onClick={handleGetCurrentLocation} disabled={isLocating} className="flex-1">
                                            {isLocating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{locatingLabel}</> : 'Use current location'}
                                        </Button>
                                        <Button type="button" variant="outline" onClick={() => setIsLocationMapOpen(true)} className="flex-1">
                                            <MapPin className="mr-2 h-4 w-4" />Select on Map
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <LocationSearchBox
                                        onSelect={(lat, lng) => handlePickedLocation(lat, lng)}
                                        biasLat={Number.isFinite(parseFloat(latitude)) ? parseFloat(latitude) : undefined}
                                        biasLng={Number.isFinite(parseFloat(longitude)) ? parseFloat(longitude) : undefined}
                                    />
                                </div>
                                {locationAccuracy != null && (
                                    <p className={cn('mt-2 text-xs', locationAccuracy > LOW_ACCURACY_WARN_METERS ? 'text-amber-600' : 'text-emerald-600')}>
                                        GPS accuracy ±{Math.round(locationAccuracy)} m
                                        {locationAccuracy > LOW_ACCURACY_WARN_METERS && ' — approximate (no GPS / indoors), drag the pin onto the exact spot if needed'}
                                    </p>
                                )}
                                {!isLocationMapOpen && (
                                    <LocationPreview
                                        className="mt-3"
                                        latitude={latitude}
                                        longitude={longitude}
                                        title="Member Residence"
                                    />
                                )}
                                <LocationPickerDialog
                                    open={isLocationMapOpen}
                                    onOpenChange={setIsLocationMapOpen}
                                    latitude={latitude}
                                    longitude={longitude}
                                    title="Select Residence Location"
                                    markerTitle="Member Residence"
                                    onLocationChange={handlePickedLocation}
                                />
                                {mapsUrl && <div className="mt-3 text-xs text-sidebar-accent dark:text-slate-300">Maps URL: <span className="font-mono">{mapsUrl}</span></div>}
                                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="flex items-center gap-2 text-xs">
                                        {(locationQrUpload.status === 'uploading' || locationQrUpload.status === 'validating') && (
                                            <span className="flex items-center gap-1 text-slate-500"><Loader2 className="h-3 w-3 animate-spin" />Uploading QR…</span>
                                        )}
                                        {locationQrUpload.status === 'success' && <span className="text-green-700 dark:text-green-400">QR uploaded</span>}
                                    </div>
                                    {locationError && <p className="flex items-center gap-1 text-xs text-red-500"><AlertCircle className="h-3 w-3" />{locationError}</p>}
                                </div>
                                <div ref={qrWrapRef} className={cn('mt-4', !mapsUrl && 'hidden')}>
                                    <button
                                        type="button"
                                        onClick={() => mapsUrl && window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
                                        title="Open this location in Google Maps"
                                        className="inline-flex items-center gap-4 rounded-md border border-primary/20 bg-green-50 px-4 py-3 text-left transition-colors hover:bg-[#e3f5ea] dark:border-sidebar-accent dark:bg-brand-green-darker/30 dark:hover:bg-brand-green-darker/60"
                                    >
                                        <QRCodeCanvas value={mapsUrl || ' '} size={96} includeMargin />
                                        <div className="text-xs text-sidebar-accent dark:text-slate-300">Click or scan to open location in Google Maps.</div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Footer ───────────────────────────────────────── */}
                <div className="border-t border-primary/20 bg-green-50 px-4 py-4 sm:px-8 sm:py-6 dark:border-sidebar-accent dark:bg-brand-green-darker/50">
                    <div className="flex items-center justify-between gap-2 flex-wrap gap-y-2">
                        <div className="flex items-center gap-3">
                            {tabIdx > 0 && (
                                <Button variant="outline" onClick={handleTabPrev} disabled={isSubmitting}
                                    className="border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300">
                                    <ChevronLeft className="mr-2 h-4 w-4" />Previous
                                </Button>
                            )}
                            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                {localDraft.isOnline ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                ) : (
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                )}
                                {localDraft.isOnline ? 'Online' : 'Offline — saving on this device'}
                                {localDraft.lastSavedAt && (
                                    <span className="text-slate-400 dark:text-slate-500">
                                        · autosaved {new Date(localDraft.lastSavedAt).toLocaleTimeString()}
                                    </span>
                                )}
                            </span>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <Button variant="outline" onClick={() => router.back()} disabled={isSubmitting || rnSubmitting}
                                className="border-primary/30 text-sidebar-accent hover:bg-brand-green-tint dark:border-sidebar-accent/60 dark:text-slate-300">
                                Cancel
                            </Button>
                            {!renewalMode && (
                                <Button variant="outline" onClick={handleSaveDraft} disabled={isSubmitting || isSavingDraft}
                                    className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20">
                                    {isSavingDraft
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                                        : <><Save className="mr-2 h-4 w-4" />Save Draft</>
                                    }
                                </Button>
                            )}
                            {tabIdx < TAB_ORDER.length - 1 && (
                                <Button onClick={handleTabNext} disabled={isSubmitting || rnSubmitting}
                                    className="bg-primary hover:bg-sidebar-accent text-white">
                                    Next<ChevronRight className="ml-2 h-4 w-4" />
                                </Button>
                            )}
                            {renewalMode ? (
                                <Button onClick={handleRenewalSubmit}
                                    disabled={!canCreateClient || rnSubmitting || !rnPrefilled}
                                    className="bg-emerald-700 hover:bg-emerald-800 text-white">
                                    {rnSubmitting
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Submitting…</>
                                        : <><Save className="mr-2 h-4 w-4" />Submit Renewal Loan for Approval</>}
                                </Button>
                            ) : tabIdx === TAB_ORDER.length - 1 ? (
                                <Button onClick={handleSubmit}
                                    disabled={!canCreateClient || isSubmitting || !allRequiredUploadsComplete}
                                    className="bg-green-600 hover:bg-green-700 text-white">
                                    {isSubmitting
                                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                                        : <><Save className="mr-2 h-4 w-4" />Save Enrollment</>}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

