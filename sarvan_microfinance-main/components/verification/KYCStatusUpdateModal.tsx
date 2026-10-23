'use client';

import { useState, useEffect } from 'react';
import { StorageImage, StorageLink, StorageIframe } from '@/components/storage/StorageMedia';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PageLoader } from '@/components/ui/page-loader';
import { Loader2, FileCheck, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import { toDisplayDate } from '@/app/lib/date-format';

const kycStatusUpdateSchema = z.object({
    verifyStatus: z.enum(['verified', 'pending', 'rejected', 'under_review'], {
        required_error: 'Verification status is required',
    }),
    rejectionReason: z.string().optional(),
});

type KYCStatusUpdateFormValues = z.infer<typeof kycStatusUpdateSchema>;

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    dateOfJoining?: string | null;
    verificationStatus?: string | null;
    center?: {
        name: string;
        code: string;
    } | null;
};

type ClientVerificationDetails = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    email?: string | null;
    dateOfBirth?: string | null;
    age?: number | null;
    gender?: string | null;
    fatherName?: string | null;
    motherName?: string | null;
    address?: string | null;
    pincode?: string | null;
    postOffice?: string | null;
    district?: string | null;
    state?: string | null;
    country?: string | null;
    mobileNumber?: string | null;
    bankName?: string | null;
    bankBranch?: string | null;
    ifscCode?: string | null;
    bankAcNo?: string | null;
    otherIdNo?: string | null;
    smartCardNo?: string | null;
    votersIdNo?: string | null;
    pancardNo?: string | null;
    requestedAmount?: string | number | null;
    verificationStatus?: string | null;
    createdAt?: string | null;
    coApplicant?: {
        id: string;
        name: string;
        gender?: string | null;
        dateOfBirth?: string | null;
        age?: number | null;
        occupation?: string | null;
        relationWithClient?: string | null;
        mobileNumber?: string | null;
        voterIdNo?: string | null;
        otherIdNo?: string | null;
        pancardNo?: string | null;
        economicActivityTypeId?: string | null;
        economicActivityId?: string | null;
        economicActivityType?: { id: string; name: string } | null;
        economicActivity?: { id: string; name: string } | null;
        createdAt?: string | null;
        updatedAt?: string | null;
    } | null;
    center?: {
        id: string;
        name: string;
        code: string;
        branch?: {
            id: string;
            name: string;
        } | null;
    } | null;
};

type VerificationDocument = {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    mimeType: string | null;
    uploadedAt: string | Date;
};

type KYCStatusUpdateModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    client: Client | null;
    onSuccess: () => void;
};

export function KYCStatusUpdateModal({
    open,
    onOpenChange,
    client,
    onSuccess,
}: KYCStatusUpdateModalProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [clientDetails, setClientDetails] = useState<ClientVerificationDetails | null>(null);
    const [kycDocuments, setKycDocuments] = useState<VerificationDocument[]>([]);
    const currentUser = tokenStorage.getUser();
    const currentUserRole = currentUser?.role;

    const form = useForm<KYCStatusUpdateFormValues>({
        resolver: zodResolver(kycStatusUpdateSchema),
        defaultValues: {
            verifyStatus: undefined,
            rejectionReason: '',
        },
    });

    // Update form when client changes or modal opens
    useEffect(() => {
        if (client && open) {
            const currentVerifyStatus = client.verificationStatus || 'PENDING_VERIFICATION';
            const statusLower = currentVerifyStatus.toLowerCase().replace(/_/g, '');
            
            let mappedStatus: 'verified' | 'pending' | 'rejected' | 'under_review' = 'pending';
            if (statusLower.includes('verified') && !statusLower.includes('pending')) {
                mappedStatus = 'verified';
            } else if (statusLower.includes('rejected')) {
                mappedStatus = 'rejected';
            } else if (statusLower.includes('review')) {
                mappedStatus = 'under_review';
            } else {
                mappedStatus = 'pending';
            }

            form.reset({
                verifyStatus: mappedStatus,
                rejectionReason: '',
            });
            void fetchVerificationContext(client.clientId);
        } else if (!open) {
            form.reset({
                verifyStatus: undefined,
                rejectionReason: '',
            });
            setClientDetails(null);
            setKycDocuments([]);
        }
    }, [client, open, form]);

    const fetchVerificationContext = async (clientAccountId: string) => {
        setIsLoadingDetails(true);
        try {
            const [clientResult, documentsResult] = await Promise.all([
                apiClient.get<ClientVerificationDetails>(`/clients/${clientAccountId}`),
                apiClient.get<{
                    clientId: string;
                    documents: VerificationDocument[];
                }>(`/clients/${clientAccountId}/kyc-documents?scope=all`),
            ]);

            if (!clientResult.success || !clientResult.data) {
                throw new Error(clientResult.error || 'Failed to load client details');
            }

            setClientDetails(clientResult.data);
            setKycDocuments(documentsResult.success && documentsResult.data ? documentsResult.data.documents || [] : []);
        } catch (error) {
            console.error('Error loading verification context:', error);
            setClientDetails(null);
            setKycDocuments([]);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to load client review details',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingDetails(false);
        }
    };

    const handleSubmit = async (values: KYCStatusUpdateFormValues) => {
        if (!client) return;

        setIsSubmitting(true);
        try {
            const result = await apiClient.patch<{
                client: {
                    id: string;
                    clientId: string;
                    firstName: string;
                    lastName: string;
                    verificationStatus: string;
                    verifiedAt: string;
                };
                message: string;
            }>(`/clients/${client.id}/kyc-verification`, {
                verifyStatus: values.verifyStatus,
                rejectionReason: values.verifyStatus === 'rejected' ? values.rejectionReason : undefined,
            });

            if (result.success && result.data) {
                toast({
                    title: 'Success',
                    description: result.data.message || `KYC verification status updated successfully for ${client.firstName} ${client.lastName}.`,
                });
                form.reset();
                onSuccess();
                onOpenChange(false);
            } else {
                throw new Error(result.error || 'Failed to update KYC verification status');
            }
        } catch (error) {
            const errorMessage = error instanceof Error 
                ? error.message 
                : 'Failed to update KYC verification. Please try again.';
            
            toast({
                title: 'Error',
                description: errorMessage,
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleClose = () => {
        if (!isSubmitting) {
            form.reset();
            onOpenChange(false);
        }
    };

    const selectedStatus = form.watch('verifyStatus');
    const showRejectionReason = selectedStatus === 'rejected';
    const verifyStatusOptions =
        currentUserRole === 'AREA_MANAGER'
            ? [
                { value: 'verified', label: 'Approve as AM' },
                { value: 'rejected', label: 'Reject as AM' },
                { value: 'under_review', label: 'Keep Under Review' },
            ]
            : [
                { value: 'verified', label: 'Approve as BM' },
                { value: 'rejected', label: 'Reject as BM' },
                { value: 'under_review', label: 'Keep Under Review' },
                { value: 'pending', label: 'Reset to Pending' },
            ];

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-[92vw] lg:max-w-7xl border-primary/20 bg-white shadow-2xl dark:border-sidebar-accent dark:bg-brand-green-darker">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <ShieldCheck className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl">Update KYC Verification Status</DialogTitle>
                            <DialogDescription>
                                Update verification status for the selected client
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {client && (
                    <div className="space-y-4">
                        <ScrollArea className="max-h-[72vh] pr-4">
                            {isLoadingDetails ? (
                                <PageLoader label="Loading client details and documents..." fullScreen={false} />
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-slate-50 to-white p-5 dark:border-sidebar-accent dark:from-sidebar-accent/50 dark:to-brand-green-darker">
                                        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2 xl:grid-cols-5">
                                            <DetailItem label="Member Name" value={`${client.firstName} ${client.lastName}`} />
                                            <DetailItem label="Member ID" value={client.clientId} />
                                            <DetailItem label="Workflow Status" value={client.verificationStatus || 'PENDING_VERIFICATION'} />
                                            <DetailItem
                                                label="Center"
                                                value={client.center ? `${client.center.name} (${client.center.code})` : '—'}
                                            />
                                            <DetailItem
                                                label="Date of Joining"
                                                value={client.dateOfJoining ? toDisplayDate(new Date(client.dateOfJoining)) : '—'}
                                            />
                                        </div>
                                    </div>

                                    {clientDetails && (
                                        <>
                                            <div className="grid gap-4 xl:grid-cols-2">
                                                <DetailSection
                                                    title="Personal Details"
                                                    items={[
                                                        ['First Name', clientDetails.firstName],
                                                        ['Last Name', clientDetails.lastName],
                                                        ['Gender', clientDetails.gender],
                                                        ['Date of Birth', formatDate(clientDetails.dateOfBirth)],
                                                        ['Age', formatValue(clientDetails.age)],
                                                        ['Father Name', clientDetails.fatherName],
                                                        ['Mother Name', clientDetails.motherName],
                                                        ['Mobile Number', clientDetails.mobileNumber || clientDetails.phone],
                                                        ['Email', clientDetails.email],
                                                    ]}
                                                />
                                                <DetailSection
                                                    title="Address"
                                                    items={[
                                                        ['Address', clientDetails.address],
                                                        ['Pincode', clientDetails.pincode],
                                                        ['Post Office', clientDetails.postOffice],
                                                        ['District', clientDetails.district],
                                                        ['State', clientDetails.state],
                                                        ['Country', clientDetails.country],
                                                    ]}
                                                />
                                                <DetailSection
                                                    title="Bank Details"
                                                    items={[
                                                        ['Bank Name', clientDetails.bankName],
                                                        ['Branch', clientDetails.bankBranch],
                                                        ['IFSC', clientDetails.ifscCode],
                                                        ['Account Number', clientDetails.bankAcNo],
                                                        ['Requested Amount', formatValue(clientDetails.requestedAmount)],
                                                    ]}
                                                />
                                                <DetailSection
                                                    title="Identity Details"
                                                    items={[
                                                        ['Aadhaar', clientDetails.otherIdNo],
                                                        ['Voter ID', clientDetails.votersIdNo],
                                                        ['PAN', clientDetails.pancardNo],
                                                        ['Smart Card', clientDetails.smartCardNo],
                                                    ]}
                                                />
                                                <DetailSection
                                                    title="Co-Applicant Details"
                                                    items={[
                                                        ['Name', clientDetails.coApplicant?.name],
                                                        ['Relation With Member', clientDetails.coApplicant?.relationWithClient],
                                                        ['Gender', clientDetails.coApplicant?.gender],
                                                        ['Economic Activity Type', clientDetails.coApplicant?.economicActivityType?.name || clientDetails.coApplicant?.economicActivityTypeId],
                                                        ['Economic Activity', clientDetails.coApplicant?.economicActivity?.name || clientDetails.coApplicant?.economicActivityId],
                                                        ['Date of Birth', formatDate(clientDetails.coApplicant?.dateOfBirth)],
                                                        ['Age', formatValue(clientDetails.coApplicant?.age)],
                                                        ['Mobile Number', clientDetails.coApplicant?.mobileNumber],
                                                        ['Voter ID', clientDetails.coApplicant?.voterIdNo],
                                                        ['Aadhaar / Other ID', clientDetails.coApplicant?.otherIdNo],
                                                        ['PAN', clientDetails.coApplicant?.pancardNo],
                                                    ]}
                                                />
                                            </div>

                                            <div className="rounded-xl border border-primary/20 bg-white p-5 dark:border-sidebar-accent dark:bg-green-950/40">
                                                <div className="mb-4">
                                                    <h3 className="text-base font-semibold text-foreground dark:text-slate-100">
                                                        KYC Documents
                                                    </h3>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                                        Review the uploaded documents before approving or rejecting.
                                                    </p>
                                                </div>

                                                {kycDocuments.length === 0 ? (
                                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                                        No KYC documents available for this client.
                                                    </p>
                                                ) : (
                                                    <div className="grid gap-4 xl:grid-cols-2">
                                                        {kycDocuments.map((document) => (
                                                            <div
                                                                key={document.id}
                                                                className="rounded-xl border border-primary/20 bg-green-50 p-4 dark:border-sidebar-accent dark:bg-brand-green-darker/60"
                                                            >
                                                                <div className="mb-4 flex items-start justify-between gap-3">
                                                                    <div>
                                                                        <p className="text-sm font-semibold text-foreground dark:text-slate-100">
                                                                            {getKycDocumentTypeLabel(document.documentType)}
                                                                        </p>
                                                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                                                            {document.fileName || 'Unnamed file'}
                                                                        </p>
                                                                    </div>
                                                                    {document.fileUrl && (
                                                                        <StorageLink
                                                                            href={document.fileUrl}
                                                                            className="rounded-md border border-primary/30 px-2.5 py-1 text-xs font-medium text-primary hover:bg-green-50 hover:text-sidebar-accent dark:border-sidebar-accent dark:text-primary dark:hover:bg-green-950/40"
                                                                        >
                                                                            Open
                                                                        </StorageLink>
                                                                    )}
                                                                </div>

                                                                {document.fileUrl ? (
                                                                    document.mimeType?.startsWith('image/') ? (
                                                                        <StorageImage
                                                                            src={document.fileUrl}
                                                                            alt={document.fileName || document.documentType}
                                                                            className="h-56 w-full rounded-lg border border-primary/20 bg-white object-contain dark:border-sidebar-accent dark:bg-green-950"
                                                                        />
                                                                    ) : (
                                                                        <StorageIframe
                                                                            src={document.fileUrl}
                                                                            title={document.fileName || document.documentType}
                                                                            className="h-56 w-full rounded-lg border border-primary/20 bg-white dark:border-sidebar-accent"
                                                                        />
                                                                    )
                                                                ) : (
                                                                    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-primary/30 text-sm text-slate-500 dark:border-sidebar-accent dark:text-slate-400">
                                                                        Preview unavailable
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </ScrollArea>

                        {currentUserRole === 'AREA_MANAGER' && client.verificationStatus !== 'UNDER_REVIEW' && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                                Branch Manager verification must be completed before Area Manager approval.
                            </div>
                        )}

                        {/* Form */}
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="verifyStatus"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-sm font-medium">
                                                Verification Status <span className="text-red-500">*</span>
                                            </FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value}
                                                disabled={isSubmitting}
                                            >
                                                <FormControl>
                                                    <SelectTrigger className="h-11 w-full">
                                                        <SelectValue placeholder="Select review decision" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {verifyStatusOptions.map((status) => (
                                                        <SelectItem key={status.value} value={status.value}>
                                                            {status.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {showRejectionReason && (
                                    <FormField
                                        control={form.control}
                                        name="rejectionReason"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-sm font-medium">
                                                    Rejection Reason
                                                </FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        {...field}
                                                        placeholder="Enter reason for rejection (optional)"
                                                        className="min-h-[100px] resize-none"
                                                        disabled={isSubmitting}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                <DialogFooter className="gap-2 sm:gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleClose}
                                        disabled={isSubmitting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={
                                            isSubmitting ||
                                            !form.formState.isValid ||
                                            (currentUserRole === 'AREA_MANAGER' && client.verificationStatus !== 'UNDER_REVIEW')
                                        }
                                        className="bg-primary hover:bg-primary text-white"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Updating...
                                            </>
                                        ) : (
                                            <>
                                                <FileCheck className="mr-2 h-4 w-4" />
                                                Update Status
                                            </>
                                        )}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

function DetailSection({
    title,
    items,
}: {
    title: string;
    items: Array<[string, unknown]>;
}) {
    return (
        <div className="rounded-xl border border-primary/20 bg-white p-5 shadow-sm dark:border-sidebar-accent dark:bg-green-950/40">
            <h3 className="mb-4 text-sm font-semibold tracking-wide text-foreground dark:text-slate-100">{title}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
                {items.map(([label, value]) => (
                    <DetailItem key={label} label={label} value={formatValue(value)} />
                ))}
            </div>
        </div>
    );
}

function DetailItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg bg-green-50 px-3 py-2.5 dark:bg-brand-green-darker/60">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {label}
            </span>
            <p className="mt-1 text-sm font-medium text-foreground dark:text-slate-100 break-words">{value}</p>
        </div>
    );
}

function formatDate(value: string | null | undefined) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : toDisplayDate(date);
}

function formatValue(value: unknown) {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    return String(value);
}

