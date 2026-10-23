'use client';

import { useState, useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    IdCard,
    Users,
    CheckCircle2,
    RotateCcw,
    Trash2,
    Loader2,
    AlertCircle,
    ShieldCheck,
    Send,
    Info,
    CheckCircle,
    XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

// Mock data - replace with actual API calls
const MOCK_CENTERS = [
    { id: '1', name: '003 - PADANTHORAI', code: '003' },
    { id: '2', name: '041 - KAMBADI', code: '041' },
    { id: '3', name: '052 - THIRUMALAI', code: '052' },
];

const MOCK_POST_OFFICES = [
    { value: 'padanthorai', label: 'Padanthorai' },
    { value: 'kambadi', label: 'Kambadi' },
    { value: 'thirumalai', label: 'Thirumalai' },
];

const GENDER_OPTIONS = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
];

const CASTE_OPTIONS = [
    { value: 'general', label: 'General' },
    { value: 'obc', label: 'OBC' },
    { value: 'sc', label: 'SC' },
    { value: 'st', label: 'ST' },
];

const COMMUNITY_OPTIONS = [
    { value: 'hindu', label: 'Hindu' },
    { value: 'muslim', label: 'Muslim' },
    { value: 'christian', label: 'Christian' },
    { value: 'sikh', label: 'Sikh' },
    { value: 'other', label: 'Other' },
];

const RELIGION_OPTIONS = [
    { value: 'hinduism', label: 'Hinduism' },
    { value: 'islam', label: 'Islam' },
    { value: 'christianity', label: 'Christianity' },
    { value: 'sikhism', label: 'Sikhism' },
    { value: 'buddhism', label: 'Buddhism' },
    { value: 'other', label: 'Other' },
];

const MARITAL_STATUS_OPTIONS = [
    { value: 'single', label: 'Single' },
    { value: 'married', label: 'Married' },
    { value: 'divorced', label: 'Divorced' },
    { value: 'widowed', label: 'Widowed' },
];

const QUALIFICATION_OPTIONS = [
    { value: 'illiterate', label: 'Illiterate' },
    { value: 'primary', label: 'Primary' },
    { value: 'secondary', label: 'Secondary' },
    { value: 'higher_secondary', label: 'Higher Secondary' },
    { value: 'graduate', label: 'Graduate' },
    { value: 'post_graduate', label: 'Post Graduate' },
];

const HOUSE_STATUS_OPTIONS = [
    { value: 'owned', label: 'Owned' },
    { value: 'rented', label: 'Rented' },
    { value: 'parental', label: 'Parental' },
    { value: 'other', label: 'Other' },
];

const RELATION_OPTIONS = [
    { value: 'spouse', label: 'Spouse' },
    { value: 'father', label: 'Father' },
    { value: 'mother', label: 'Mother' },
    { value: 'son', label: 'Son' },
    { value: 'daughter', label: 'Daughter' },
    { value: 'brother', label: 'Brother' },
    { value: 'sister', label: 'Sister' },
    { value: 'other', label: 'Other' },
];

const REQUESTED_AMOUNT_OPTIONS = [
    { value: '10000', label: '₹10,000' },
    { value: '20000', label: '₹20,000' },
    { value: '25000', label: '₹25,000' },
    { value: '30000', label: '₹30,000' },
    { value: '50000', label: '₹50,000' },
];

const CLIENT_STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
];

// Validation schema
const enrollmentSchema = z.object({
    // KYC Verification
    mobileNumber: z.string().regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits').optional(),
    voterIdNo: z.string().optional(),
    otherIdNo: z.string().optional(),
    pancardNo: z.string().optional(),
    smartCardNo: z.string().optional(),
    aadhaarNumber: z.string().regex(/^[0-9]{12}$/, 'Aadhaar must be 12 digits').optional(),
    otp: z.string().optional(),
    caMobileNumber: z.string().regex(/^[0-9]{10}$/, 'Mobile number must be 10 digits').optional(),
    caVoterIdNo: z.string().optional(),
    caOtherIdNo: z.string().optional(),
    caPancardNo: z.string().optional(),

    // Member Details
    centerName: z.string().min(1, 'Center name is required'),
    clientName: z.string().min(1, 'Member name is required'),
    address: z.string().min(1, 'Address is required'),
    pincode: z.string().regex(/^[0-9]{6}$/, 'Pincode must be 6 digits'),
    postOffice: z.string().min(1, 'Post office is required'),
    country: z.string().min(1, 'Country is required'),
    district: z.string().min(1, 'District is required'),
    state: z.string().min(1, 'State is required'),
    gender: z.string().min(1, 'Gender is required'),
    caste: z.string().min(1, 'Caste is required'),
    community: z.string().min(1, 'Community is required'),
    religion: z.string().min(1, 'Religion is required'),
    maritalStatus: z.string().min(1, 'Marital status is required'),
    dateOfBirth: z.string().min(1, 'Date of birth is required'),
    age: z.string(),
    spouseName: z.string().optional(),
    noOfChildren: z.string().optional(),
    spouseEconomicActivityTypeId: z.string().optional(),
    spouseEconomicActivityId: z.string().optional(),
    monthlyFamilyIncome: z.string().optional(),
    monthlyFamilyExpense: z.string().optional(),
    economicActivityTypeId: z.string().min(1, 'Economic Activity Type is required'),
    economicActivityId: z.string().min(1, 'Economic Activity is required'),
    qualification: z.string().min(1, 'Qualification is required'),
    houseStatus: z.string().min(1, 'House status is required'),
    fatherName: z.string().optional(),
    groupId: z.string().optional(),
    clientId: z.string().optional(),
    ifscCode: z.string().min(1, 'IFSC code is required'),
    bankAccountNo: z.string().min(1, 'Bank account number is required'),
    retypeBankAccountNo: z.string().min(1, 'Please retype bank account number'),
    bankName: z.string().optional(),
    bankBranch: z.string().optional(),

    // Nominee Details
    nomineeName: z.string().optional(),
    nomineeGender: z.string().optional(),
    nomineeDateOfBirth: z.string().optional(),
    nomineeAge: z.string().optional(),
    relationWithClient: z.string().optional(),
    requestedAmount: z.string().optional(),
    admissionFees: z.string().default('100'),

    // Status
    clientStatus: z.string().optional(),
}).refine((data) => data.bankAccountNo === data.retypeBankAccountNo, {
    message: 'Bank account numbers do not match',
    path: ['retypeBankAccountNo'],
});

type EnrollmentFormValues = z.infer<typeof enrollmentSchema>;

export function EnrollmentForm() {
    const { toast } = useToast();
    const [centers, setCenters] = useState<typeof MOCK_CENTERS>([]);
    const [postOffices, setPostOffices] = useState<Array<{ value: string; label: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isPincodeVerifying, setIsPincodeVerifying] = useState(false);
    const [isIFSCVerifying, setIsIFSCVerifying] = useState(false);
    const [isKYCVerifying, setIsKYCVerifying] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

    // KYC Verification States
    const [kycVerificationStatus, setKycVerificationStatus] = useState<string>('');
    const [showOtpInput, setShowOtpInput] = useState(false);
    const [maskedMobile, setMaskedMobile] = useState('');
    const [kycTransactionId, setKycTransactionId] = useState('');
    const [kycVerifiedAt, setKycVerifiedAt] = useState('');
    const [kycVerificationMessage, setKycVerificationMessage] = useState('');
    const [isOtpSending, setIsOtpSending] = useState(false);
    const [isOtpVerifying, setIsOtpVerifying] = useState(false);
    const [resendTimer, setResendTimer] = useState(0);

    // Economic activity states
    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [spouseEconomicActivities, setSpouseEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);
    const [isLoadingSpouseActivities, setIsLoadingSpouseActivities] = useState(false);

    const form = useForm<EnrollmentFormValues>({
        resolver: zodResolver(enrollmentSchema),
        defaultValues: {
            centerName: '',
            clientName: '',
            address: '',
            pincode: '',
            postOffice: '',
            country: 'India',
            district: '',
            state: '',
            gender: '',
            caste: '',
            community: '',
            religion: '',
            maritalStatus: '',
            dateOfBirth: '',
            age: '',
            economicActivityTypeId: '',
            economicActivityId: '',
            spouseEconomicActivityTypeId: '',
            spouseEconomicActivityId: '',
            qualification: '',
            houseStatus: '',
            ifscCode: '',
            bankAccountNo: '',
            retypeBankAccountNo: '',
            admissionFees: '100',
            clientStatus: '',
        },
    });

    useEffect(() => {
        fetchCenters();
    }, []);

    const fetchCenters = async () => {
        setIsLoading(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            const storedUser = tokenStorage.getUser();
            const branchId = activeBranch?.id || storedUser?.branchId;

            if (!branchId) {
                toast({
                    title: 'Error',
                    description: 'No branch found. Please select a branch first.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            const result = await apiClient.get<typeof MOCK_CENTERS>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setCenters(result.data);
            } else {
                // Fallback to mock data during development
                setCenters(MOCK_CENTERS);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            // Fallback to mock data during development
            setCenters(MOCK_CENTERS);
        } finally {
            setIsLoading(false);
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

    // Watch nominee DOB changes to update nominee age
    const watchNomineeDOB = form.watch('nomineeDateOfBirth');
    useEffect(() => {
        if (watchNomineeDOB) {
            const age = calculateAge(watchNomineeDOB);
            form.setValue('nomineeAge', age);
        }
    }, [watchNomineeDOB, form]);

    // Auto-generate Client ID when center is selected
    const watchCenter = form.watch('centerName');
    useEffect(() => {
        if (watchCenter) {
            // TODO: Generate client ID based on center and sequence
            // For now, using mock format
            const center = centers.find((c) => c.id === watchCenter);
            if (center) {
                // Mock client ID generation
                const mockClientId = `${center.code}${Date.now().toString().slice(-6)}`;
                form.setValue('clientId', mockClientId);
            }
        }
    }, [watchCenter, centers, form]);

    const handlePincodeVerify = async () => {
        const pincode = form.getValues('pincode');

        console.log('=== PINCODE VERIFY START (EnrollmentForm) ===');
        console.log('Pincode value:', pincode);

        if (!pincode || pincode.length !== 6) {
            toast({
                title: 'Invalid Pincode',
                description: 'Please enter a valid 6-digit pincode',
                variant: 'destructive',
            });
            return;
        }

        setIsPincodeVerifying(true);

        try {
            console.log('Calling pincode API for:', pincode);

            toast({
                title: 'Verifying Pincode',
                description: 'Fetching location details...',
            });

            // Call the actual API
            const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
                cache: 'no-store',
            });

            console.log('API Response status:', response.status);
            const data = await response.json();
            console.log('API Response data:', JSON.stringify(data, null, 2));

            if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
                const postOfficeList = data[0].PostOffice;

                if (postOfficeList && postOfficeList.length > 0) {
                    const details = postOfficeList[0];

                    console.log('Setting location details from API:', {
                        postOffice: details.Name,
                        district: details.District,
                        state: details.State,
                        country: details.Country,
                    });

                    // Create dropdown options from all post offices
                    const postOfficeOptions = postOfficeList.map((po: any) => ({
                        value: po.Name,
                        label: po.Name,
                    }));

                    console.log('Post office options:', postOfficeOptions);
                    setPostOffices(postOfficeOptions);

                    // Populate form with actual API data (first post office)
                    form.setValue('postOffice', details.Name || '');
                    form.setValue('district', details.District || '');
                    form.setValue('state', details.State || '');
                    form.setValue('country', details.Country || 'India');

                    toast({
                        title: 'Pincode Verified',
                        description: `Location: ${details.Name}, ${details.District}, ${details.State}`,
                    });
                } else {
                    console.log('No post office data found');
                    setPostOffices([]);
                    toast({
                        title: 'Invalid Pincode',
                        description: 'No location details found for this pincode',
                        variant: 'destructive',
                    });
                }
            } else if (data[0]?.Status === 'Error') {
                console.log('API returned error:', data[0].Message);
                setPostOffices([]);
                toast({
                    title: 'Invalid Pincode',
                    description: data[0].Message || 'No location details found for this pincode',
                    variant: 'destructive',
                });
            } else {
                console.log('Unexpected API response format');
                setPostOffices([]);
                toast({
                    title: 'Invalid Pincode',
                    description: 'No location details found for this pincode',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error verifying pincode:', error);
            setPostOffices([]);
            toast({
                title: 'Error',
                description: 'Failed to verify pincode. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsPincodeVerifying(false);
            console.log('=== PINCODE VERIFY END ===');
        }
    };

    const handleIFSCVerify = async () => {
        const ifsc = form.getValues('ifscCode');
        if (!ifsc) {
            toast({
                title: 'Invalid IFSC',
                description: 'Please enter a valid IFSC code',
                variant: 'destructive',
            });
            return;
        }

        setIsIFSCVerifying(true);
        try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Mock data population
            form.setValue('bankName', 'State Bank of India');
            form.setValue('bankBranch', 'Padanthorai Branch');

            toast({
                title: 'IFSC Verified',
                description: 'Bank details populated successfully',
            });
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to verify IFSC. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsIFSCVerifying(false);
        }
    };

    const handleKYCVerify = async () => {
        setIsKYCVerifying(true);
        try {
            // TODO: Replace with actual KYC verification API call
            await new Promise((resolve) => setTimeout(resolve, 1500));

            toast({
                title: 'KYC Verified',
                description: 'KYC verification completed successfully',
            });
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to verify KYC. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsKYCVerifying(false);
        }
    };

    // KYC Aadhaar OTP Handlers
    const handleSendOtp = async () => {
        const aadhaarNumber = form.getValues('aadhaarNumber');

        if (!aadhaarNumber || aadhaarNumber.length !== 12) {
            toast({
                title: 'Invalid Aadhaar',
                description: 'Please enter a valid 12-digit Aadhaar number',
                variant: 'destructive',
            });
            return;
        }

        setIsOtpSending(true);

        try {
            const response = await fetch('/api/kyc/aadhaar/send-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aadhaarNumber,
                    clientId: form.getValues('clientId'),
                }),
            });

            const data = await response.json();

            if (data.success) {
                setKycTransactionId(data.transactionId);
                setMaskedMobile(data.maskedMobile);
                setShowOtpInput(true);
                setResendTimer(60);

                toast({
                    title: 'OTP Sent',
                    description: `OTP sent to ${data.maskedMobile}`,
                });
            } else {
                toast({
                    title: 'Error',
                    description: data.message || 'Failed to send OTP',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error sending OTP:', error);
            toast({
                title: 'Error',
                description: 'Failed to send OTP. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsOtpSending(false);
        }
    };

    const handleVerifyOtp = async () => {
        const otp = form.getValues('otp');

        if (!otp || otp.length !== 6) {
            toast({
                title: 'Invalid OTP',
                description: 'Please enter a valid 6-digit OTP',
                variant: 'destructive',
            });
            return;
        }

        setIsOtpVerifying(true);

        try {
            const response = await fetch('/api/kyc/aadhaar/verify-otp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transactionId: kycTransactionId,
                    otp,
                    clientId: form.getValues('clientId'),
                }),
            });

            const data = await response.json();

            if (data.success && data.kycStatus === 'API_VERIFIED') {
                setKycVerificationStatus('API_VERIFIED');
                setKycVerifiedAt(toDisplayDateTime(new Date()));
                setShowOtpInput(false);

                toast({
                    title: 'KYC Verified!',
                    description: 'Aadhaar verification successful',
                });
            } else {
                setKycVerificationStatus('API_FAILED');
                setKycVerificationMessage(data.message || 'Verification failed');

                toast({
                    title: 'Verification Failed',
                    description: data.message || 'Invalid OTP or verification failed',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error verifying OTP:', error);
            setKycVerificationStatus('API_FAILED');

            toast({
                title: 'Error',
                description: 'Failed to verify OTP. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsOtpVerifying(false);
        }
    };

    const handleResendOtp = async () => {
        await handleSendOtp();
    };

    // Resend Timer Effect
    useEffect(() => {
        if (resendTimer > 0) {
            const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendTimer]);


    const onSubmit = async (values: EnrollmentFormValues) => {
        setIsSubmitting(true);

        // Validate KYC verification before submission
        if (kycVerificationStatus !== 'API_VERIFIED') {
            toast({
                title: 'KYC Not Verified',
                description: 'Please complete Aadhaar OTP verification before submitting',
                variant: 'destructive',
            });
            setIsSubmitting(false);
            return;
        }

        try {
            // Include KYC data in submission
            const submissionData = {
                ...values,
                kycVerificationStatus,
                kycTransactionId,
                kycVerifiedAt,
                overallStatus: 'PENDING_BM_APPROVAL',
            };

            // TODO: Replace with actual API call
            console.log('Submitting enrollment with KYC data:', submissionData);
            await new Promise((resolve) => setTimeout(resolve, 1500));

            toast({
                title: 'Success',
                description: 'Member enrollment submitted successfully',
            });

            // Reset form after successful submission
            form.reset();
            // Reset KYC states
            setKycVerificationStatus('');
            setShowOtpInput(false);
            setMaskedMobile('');
            setKycTransactionId('');
            setKycVerifiedAt('');
            setKycVerificationMessage('');
        } catch (error) {
            console.error('Error submitting enrollment:', error);
            toast({
                title: 'Error',
                description: 'Failed to submit enrollment. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApprove = async () => {
        const status = form.getValues('clientStatus');
        if (!status) {
            toast({
                title: 'Validation Error',
                description: 'Please select client status first',
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 1500));

            toast({
                title: 'Success',
                description: 'Member enrollment approved successfully',
            });
        } catch (error) {
            console.error('Error approving enrollment:', error);
            toast({
                title: 'Error',
                description: 'Failed to approve enrollment. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            // TODO: Replace with actual API call
            await new Promise((resolve) => setTimeout(resolve, 1000));

            toast({
                title: 'Success',
                description: 'Member enrollment deleted successfully',
            });

            form.reset();
            setDeleteDialogOpen(false);
        } catch (error) {
            console.error('Error deleting enrollment:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete enrollment. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsDeleting(false);
        }
    };

    const handleReset = () => {
        form.reset();
        toast({
            title: 'Reset',
            description: 'Form has been reset',
        });
    };

    if (isLoading) {
        return <PageLoader label="Loading..." fullScreen={false} />;
    }

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Client Enrollment
                </h1>
                <p className="text-muted-foreground">
                    Enroll new clients with KYC verification and complete details
                </p>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* KYC Verification Section */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <IdCard className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">KYC Verification</CardTitle>
                                    <CardDescription>
                                        Verify client and co-applicant identification details
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {/* Member KYC Fields */}
                                <div className="space-y-4 md:col-span-2 lg:col-span-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground">Member Details</h3>
                                </div>

                                <FormField
                                    control={form.control}
                                    name="mobileNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Mobile Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter mobile number" />
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
                                            <FormLabel>Voters ID No</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter voter ID" />
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
                                            <FormLabel>Other ID No</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter other ID" />
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
                                            <FormLabel>Pancard No</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter PAN card" />
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
                                            <FormLabel>Smart Card No</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter smart card" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Co-Applicant KYC Fields */}
                                <div className="space-y-4 md:col-span-2 lg:col-span-3 mt-4 pt-4 border-t">
                                    <h3 className="text-sm font-semibold text-muted-foreground">Co-Applicant (C.A) Details</h3>
                                </div>

                                <FormField
                                    control={form.control}
                                    name="caMobileNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>C.A Mobile Number</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter mobile number" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="caVoterIdNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>C.A Voter ID No.</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter voter ID" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="caOtherIdNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>C.A Other ID No.</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter other ID" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="caPancardNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>C.A Pancard No.</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter PAN card" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="md:col-span-2 lg:col-span-3 flex justify-end pt-2">
                                    <Button
                                        type="button"
                                        onClick={handleKYCVerify}
                                        disabled={isKYCVerifying}
                                        className="bg-primary hover:bg-primary text-white"
                                    >
                                        {isKYCVerifying ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Verifying...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Verify
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Client / Applicant Details Section */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-emerald-50/60 to-teal-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                                    <User className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Member / Applicant Details</CardTitle>
                                    <CardDescription>
                                        Complete personal, address, and financial information
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {/* Center Name */}
                                <FormField
                                    control={form.control}
                                    name="centerName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Center Name <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {centers.map((center) => (
                                                        <SelectItem key={center.id} value={center.id}>
                                                            {center.name} ({center.code})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Client Name */}
                                <FormField
                                    control={form.control}
                                    name="clientName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Member Name <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter member name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Address */}
                                <FormField
                                    control={form.control}
                                    name="address"
                                    render={({ field }) => (
                                        <FormItem className="md:col-span-2 lg:col-span-3">
                                            <FormLabel>Address <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter full address" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Pincode with Verify */}
                                <FormField
                                    control={form.control}
                                    name="pincode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Pincode <span className="text-red-500">*</span></FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input {...field} className="h-11" placeholder="Enter pincode" maxLength={6} />
                                                </FormControl>
                                                <Button
                                                    type="button"
                                                    onClick={handlePincodeVerify}
                                                    disabled={isPincodeVerifying}
                                                    variant="outline"
                                                    className="shrink-0"
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

                                {/* Post Office */}
                                <FormField
                                    control={form.control}
                                    name="postOffice"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Post Office <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {postOffices.length > 0 ? (
                                                        postOffices.map((po) => (
                                                            <SelectItem key={po.value} value={po.value}>
                                                                {po.label}
                                                            </SelectItem>
                                                        ))
                                                    ) : (
                                                        <SelectItem value="none" disabled>
                                                            Verify pincode first
                                                        </SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Country */}
                                <FormField
                                    control={form.control}
                                    name="country"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Country <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter country" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* District */}
                                <FormField
                                    control={form.control}
                                    name="district"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>District <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter district" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* State */}
                                <FormField
                                    control={form.control}
                                    name="state"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>State <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter state" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Gender */}
                                <FormField
                                    control={form.control}
                                    name="gender"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Gender <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
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

                                {/* Caste */}
                                <FormField
                                    control={form.control}
                                    name="caste"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Caste <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {CASTE_OPTIONS.map((option) => (
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

                                {/* Community */}
                                <FormField
                                    control={form.control}
                                    name="community"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Community <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {COMMUNITY_OPTIONS.map((option) => (
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

                                {/* Religion */}
                                <FormField
                                    control={form.control}
                                    name="religion"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Religion <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {RELIGION_OPTIONS.map((option) => (
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

                                {/* Marital Status */}
                                <FormField
                                    control={form.control}
                                    name="maritalStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Marital Status <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {MARITAL_STATUS_OPTIONS.map((option) => (
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

                                {/* Date of Birth */}
                                <FormField
                                    control={form.control}
                                    name="dateOfBirth"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Date of Birth <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <DateInput {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Age (Auto-calculated) */}
                                <FormField
                                    control={form.control}
                                    name="age"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Age</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted cursor-not-allowed" readOnly disabled />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Spouse Name */}
                                <FormField
                                    control={form.control}
                                    name="spouseName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spouse Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter spouse name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* No. of Children */}
                                <FormField
                                    control={form.control}
                                    name="noOfChildren"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>No. of Children</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" type="number" placeholder="0" min="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Spouse Economic Activity Type */}
                                <FormField
                                    control={form.control}
                                    name="spouseEconomicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spouse Economic Activity Type</FormLabel>
                                            <Select
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('spouseEconomicActivityId', '');
                                                    if (value) {
                                                        fetchSpouseEconomicActivities(value);
                                                    }
                                                }}
                                                value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
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

                                {/* Spouse Economic Activity */}
                                <FormField
                                    control={form.control}
                                    name="spouseEconomicActivityId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spouse Economic Activity</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value}
                                                disabled={!form.watch('spouseEconomicActivityTypeId') || isLoadingSpouseActivities}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue
                                                            placeholder={isLoadingSpouseActivities ? 'Loading...' : '-- SELECT --'}
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

                                {/* Monthly Family Income */}
                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyIncome"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly Family Income</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" type="number" placeholder="0" min="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Monthly Family Expense */}
                                <FormField
                                    control={form.control}
                                    name="monthlyFamilyExpense"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Monthly Family Expense</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" type="number" placeholder="0" min="0" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Economic Activity Type */}
                                <FormField
                                    control={form.control}
                                    name="economicActivityTypeId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Economic Activity Type <span className="text-red-500">*</span></FormLabel>
                                            <Select
                                                onValueChange={(value) => {
                                                    field.onChange(value);
                                                    form.setValue('economicActivityId', '');
                                                    if (value) {
                                                        fetchEconomicActivities(value);
                                                    }
                                                }}
                                                value={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
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

                                {/* Economic Activity */}
                                <FormField
                                    control={form.control}
                                    name="economicActivityId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Economic Activity <span className="text-red-500">*</span></FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value}
                                                disabled={!form.watch('economicActivityTypeId') || isLoadingActivities}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue
                                                            placeholder={isLoadingActivities ? 'Loading...' : '-- SELECT --'}
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

                                {/* Qualification */}
                                <FormField
                                    control={form.control}
                                    name="qualification"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Qualification <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {QUALIFICATION_OPTIONS.map((option) => (
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

                                {/* House Status */}
                                <FormField
                                    control={form.control}
                                    name="houseStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>House Status <span className="text-red-500">*</span></FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {HOUSE_STATUS_OPTIONS.map((option) => (
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

                                {/* Father Name */}
                                <FormField
                                    control={form.control}
                                    name="fatherName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Father Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter father name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Group ID */}
                                <FormField
                                    control={form.control}
                                    name="groupId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Group Id</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted" placeholder="Auto-generated" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Client ID */}
                                <FormField
                                    control={form.control}
                                    name="clientId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Member Id</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted cursor-not-allowed" readOnly disabled />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* IFSC Code with Verify */}
                                <FormField
                                    control={form.control}
                                    name="ifscCode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>IFSC Code <span className="text-red-500">*</span></FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input {...field} className="h-11" placeholder="Enter IFSC code" />
                                                </FormControl>
                                                <Button
                                                    type="button"
                                                    onClick={handleIFSCVerify}
                                                    disabled={isIFSCVerifying}
                                                    variant="outline"
                                                    className="shrink-0"
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

                                {/* Bank Account No */}
                                <FormField
                                    control={form.control}
                                    name="bankAccountNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank A/c No <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter account number" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Retype Bank Account No */}
                                <FormField
                                    control={form.control}
                                    name="retypeBankAccountNo"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Retype Bank A/c No <span className="text-red-500">*</span></FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Retype account number" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Bank Name */}
                                <FormField
                                    control={form.control}
                                    name="bankName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted" placeholder="Auto-filled" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* Bank Branch */}
                                <FormField
                                    control={form.control}
                                    name="bankBranch"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Bank Branch</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted" placeholder="Auto-filled" readOnly />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* KYC VERIFICATION SECTION */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-green-600 via-emerald-600 to-teal-600" />

                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-emerald-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                                    <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">KYC Verification (Aadhaar OTP)</CardTitle>
                                    <CardDescription>
                                        Verify client identity using Aadhaar OTP authentication
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="pt-6">
                            <div className="space-y-6">

                                {/* Aadhaar Number Input */}
                                <FormField
                                    control={form.control}
                                    name="aadhaarNumber"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Aadhaar Number <span className="text-red-500">*</span></FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        className="h-11"
                                                        placeholder="Enter 12-digit Aadhaar number"
                                                        maxLength={12}
                                                        disabled={kycVerificationStatus === 'API_VERIFIED'}
                                                    />
                                                </FormControl>
                                                <Button
                                                    type="button"
                                                    onClick={handleSendOtp}
                                                    disabled={
                                                        !field.value ||
                                                        field.value.length !== 12 ||
                                                        isOtpSending ||
                                                        kycVerificationStatus === 'API_VERIFIED'
                                                    }
                                                    className="whitespace-nowrap"
                                                >
                                                    {isOtpSending ? (
                                                        <>
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            Sending...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Send className="mr-2 h-4 w-4" />
                                                            Send OTP
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {/* OTP Input Section (Conditional) */}
                                {showOtpInput && kycVerificationStatus !== 'API_VERIFIED' && (
                                    <div className="rounded-lg border-2 border-primary/30 bg-green-50/50 dark:bg-green-950/20 dark:border-sidebar-accent p-4">
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-sm text-sidebar-accent dark:text-primary">
                                                <Info className="h-4 w-4" />
                                                <span>OTP sent to: {maskedMobile}</span>
                                            </div>

                                            <FormField
                                                control={form.control}
                                                name="otp"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Enter OTP</FormLabel>
                                                        <div className="flex gap-2">
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                    className="h-11"
                                                                    placeholder="Enter 6-digit OTP"
                                                                    maxLength={6}
                                                                />
                                                            </FormControl>
                                                            <Button
                                                                type="button"
                                                                onClick={handleVerifyOtp}
                                                                disabled={!field.value || field.value.length !== 6 || isOtpVerifying}
                                                            >
                                                                {isOtpVerifying ? (
                                                                    <>
                                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                        Verifying...
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <CheckCircle className="mr-2 h-4 w-4" />
                                                                        Verify OTP
                                                                    </>
                                                                )}
                                                            </Button>
                                                        </div>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleResendOtp}
                                                disabled={resendTimer > 0}
                                            >
                                                {resendTimer > 0 ? (
                                                    `Resend OTP in ${resendTimer}s`
                                                ) : (
                                                    'Resend OTP'
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Verification Status Display */}
                                {kycVerificationStatus && (
                                    <Alert variant={kycVerificationStatus === 'API_VERIFIED' ? 'default' : 'destructive'}>
                                        {kycVerificationStatus === 'API_VERIFIED' ? (
                                            <>
                                                <CheckCircle className="h-4 w-4" />
                                                <AlertTitle>KYC Verified Successfully!</AlertTitle>
                                                <AlertDescription>
                                                    Aadhaar verification completed at {kycVerifiedAt}
                                                    <br />
                                                    Transaction ID: {kycTransactionId}
                                                </AlertDescription>
                                            </>
                                        ) : (
                                            <>
                                                <XCircle className="h-4 w-4" />
                                                <AlertTitle>KYC Verification Failed</AlertTitle>
                                                <AlertDescription>
                                                    {kycVerificationMessage || 'Please try again or contact support.'}
                                                </AlertDescription>
                                            </>
                                        )}
                                    </Alert>
                                )}

                            </div>
                        </CardContent>
                    </Card>

                    {/* Nominee / Co Applicant Details Section */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                        <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-purple-50/60 to-pink-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                                    <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Nominee / Co Applicant Details</CardTitle>
                                    <CardDescription>
                                        Information about the nominee or co-applicant
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                <FormField
                                    control={form.control}
                                    name="nomineeName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Nominee Name</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11" placeholder="Enter nominee name" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="nomineeGender"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Gender</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
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
                                    name="relationWithClient"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Relation With Client</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
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
                                    name="nomineeDateOfBirth"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Date of Birth</FormLabel>
                                            <FormControl>
                                                <DateInput {...field} className="h-11" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="nomineeAge"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Age</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted cursor-not-allowed" readOnly disabled />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="requestedAmount"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Requested Amount</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-11">
                                                        <SelectValue placeholder="-- SELECT --" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {REQUESTED_AMOUNT_OPTIONS.map((option) => (
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
                                    name="admissionFees"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Admission Fees</FormLabel>
                                            <FormControl>
                                                <Input {...field} className="h-11 bg-muted cursor-not-allowed" readOnly disabled />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </CardContent>
                    </Card>

                    {/* Action Buttons Section */}
                    <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-lg">
                        <CardContent className="pt-6">
                            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                                <div className="flex flex-wrap gap-4 flex-1">
                                    <FormField
                                        control={form.control}
                                        name="clientStatus"
                                        render={({ field }) => (
                                            <FormItem className="min-w-[200px]">
                                                <FormLabel>Member Status</FormLabel>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-11">
                                                            <SelectValue placeholder="-- SELECT --" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {CLIENT_STATUS_OPTIONS.map((option) => (
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
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <Button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className="bg-primary hover:bg-primary text-white"
                                        size="lg"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Submit
                                            </>
                                        )}
                                    </Button>

                                    <Button
                                        type="button"
                                        onClick={handleApprove}
                                        disabled={isSubmitting || !form.watch('clientStatus')}
                                        className="bg-green-600 hover:bg-green-700 text-white"
                                        size="lg"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Approving...
                                            </>
                                        ) : (
                                            'Approve'
                                        )}
                                    </Button>

                                    <Button
                                        type="button"
                                        onClick={() => setDeleteDialogOpen(true)}
                                        disabled={isDeleting}
                                        variant="destructive"
                                        size="lg"
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Delete
                                    </Button>

                                    <Button
                                        type="button"
                                        onClick={handleReset}
                                        variant="outline"
                                        size="lg"
                                    >
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reset
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </form>
            </Form>

            {/* Delete Confirmation Dialog */}
            <ConfirmationDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                onConfirm={handleDelete}
                title="Delete Enrollment"
                description="Are you sure you want to delete this client enrollment? This action cannot be undone."
                confirmText="Delete"
                cancelText="Cancel"
                type="delete"
                isLoading={isDeleting}
            />
        </div>
    );
}

