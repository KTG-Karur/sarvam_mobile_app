'use client';

import { useEffect, useState } from 'react';
import {
    User,
    MapPin,
    Landmark,
    Users,
    Home,
    Phone,
    Mail,
    Calendar,
    Cake,
    ShieldCheck,
    Image as ImageIcon,
    X,
    Ban,
    Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { useToast } from '@/hooks/use-toast';
import { StorageImage } from '@/components/storage/StorageMedia';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

// ─── Types ───────────────────────────────────────────────────────────────────
interface NamedRef { name: string }
interface ReviewerRef { firstName: string; lastName: string; employeeId: string | null }
interface KycDoc { id: string; documentType: string; fileUrl: string | null; documentNumber: string | null }
interface CoApplicantRef {
    name: string; gender: string; dateOfBirth: string; age: number;
    relationWithClient: string; mobileNumber: string;
    pancardNo: string | null; voterIdNo: string | null;
    economicActivityType?: NamedRef | null; economicActivity?: NamedRef | null;
}

interface ClientProfileData {
    id: string; clientId: string; firstName: string; lastName: string;
    phone: string | null; email: string | null; mobileNumber: string | null;
    gender: string | null; dateOfBirth: string | null; age: number | null;
    fatherName: string | null; motherName: string | null; spouseName: string | null;
    maritalStatus: string | null; religion: string | null; caste: string | null;
    qualification: string | null; noOfChildren: number | null;
    economicActivityType: NamedRef | null; economicActivity: NamedRef | null;
    permanentAddress: string | null; pincode: string | null; postOffice: string | null;
    district: string | null; state: string | null; country: string | null;
    bankName: string | null; bankBranch: string | null; ifscCode: string | null; bankAcNo: string | null;
    pancardNo: string | null; votersIdNo: string | null;
    approvalStatus: string;
    latitude: number | null; longitude: number | null; locationApprovalStatus: string | null;
    center: { id: string; name: string; code: string; branch?: { name: string } | null } | null;
    groupMemberships: Array<{ group: { id: string; name: string } }>;
    coApplicant?: CoApplicantRef | null;
    kycDocuments: KycDoc[];
    createdAt: string;
    enrolledBy?: ReviewerRef | null;
    isDefaultMember: boolean;
    defaultMemberReason: string | null;
    defaultMemberSetAt: string | null;
    defaultMemberSetBy?: ReviewerRef | null;
}

interface Props {
    clientId: string;
}

// ─── Small presentational helpers ─────────────────────────────────────────────
function statusTone(status: string): { badge: string; label: string } {
    if (status === 'APPROVED') return { badge: 'border-transparent bg-emerald-500 text-white', label: 'Approved' };
    if (status === 'REJECTED') return { badge: 'border-transparent bg-red-500 text-white', label: 'Rejected' };
    return { badge: 'border-transparent bg-amber-500 text-white', label: status.replace(/_/g, ' ') };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    if (value === null || value === undefined || value === '') return null;
    return (
        <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="truncate text-sm font-medium text-foreground" title={typeof value === 'string' ? value : undefined}>{value}</p>
        </div>
    );
}

type Tone = 'indigo' | 'sky' | 'rose' | 'emerald' | 'amber' | 'teal';
const TONE_CLASSES: Record<Tone, { border: string; header: string; icon: string }> = {
    indigo: { border: 'border-indigo-200 dark:border-indigo-900', header: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300', icon: 'text-indigo-500' },
    sky:    { border: 'border-sky-200 dark:border-sky-900',       header: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',             icon: 'text-sky-500' },
    rose:   { border: 'border-rose-200 dark:border-rose-900',     header: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',         icon: 'text-rose-500' },
    emerald:{ border: 'border-emerald-200 dark:border-emerald-900', header: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', icon: 'text-emerald-500' },
    amber:  { border: 'border-amber-200 dark:border-amber-900',   header: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',     icon: 'text-amber-500' },
    teal:   { border: 'border-teal-200 dark:border-teal-900',     header: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',         icon: 'text-teal-500' },
};

function SectionCard({ tone, icon, title, children }: { tone: Tone; icon: React.ReactNode; title: string; children: React.ReactNode }) {
    const t = TONE_CLASSES[tone];
    return (
        <div className={cn('overflow-hidden rounded-xl border-2 bg-card shadow-sm', t.border)}>
            <div className={cn('flex items-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wide', t.header)}>
                <span className={t.icon}>{icon}</span>
                {title}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4">
                {children}
            </div>
        </div>
    );
}

// Documents grouped for a nicer visual order than raw array order.
const DOC_ORDER = [
    'client_photo', 'co_applicant_photo',
    'aadhaar_front', 'aadhaar_back',
    'voter_id', 'voter_id_back',
    'pan_card', 'co_applicant_pan_card',
    'smart_card_front', 'smart_card_back',
    'co_applicant_other_id', 'co_applicant_aadhaar_back',
    'bank_passbook',
    'house_image_1', 'house_image_2', 'house_image_3',
    'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3',
    'location_qr',
];

export function ClientProfileDetail({ clientId }: Props) {
    const { toast } = useToast();
    const [data, setData] = useState<ClientProfileData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [previewDoc, setPreviewDoc] = useState<KycDoc | null>(null);

    // Default Member (No Loan) toggle — Admin/Sub Admin only.
    const currentUser = tokenStorage.getUser();
    const canManageDefaultMember = currentUser?.role === 'ADMIN' || !!currentUser?.isSubAdmin;
    const [isDefaultLocal, setIsDefaultLocal] = useState(false);
    const [reasonInput, setReasonInput] = useState('');
    const [isSavingDefault, setIsSavingDefault] = useState(false);

    useEffect(() => {
        let cancelled = false;
        apiClient.get<{ client: ClientProfileData }>(`/approval/clients/${clientId}`)
            .then((res) => {
                if (!cancelled && res.success && res.data?.client) {
                    setData(res.data.client);
                    setIsDefaultLocal(res.data.client.isDefaultMember);
                    setReasonInput(res.data.client.defaultMemberReason ?? '');
                }
            })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [clientId]);

    const handleSaveDefaultMember = async () => {
        if (isDefaultLocal && !reasonInput.trim()) {
            toast({ title: 'Reason required', description: 'Enter a reason before marking this member as Default.', variant: 'destructive' });
            return;
        }
        setIsSavingDefault(true);
        try {
            const res = await apiClient.patch<{
                isDefaultMember: boolean; defaultMemberReason: string | null;
                defaultMemberSetAt: string | null; defaultMemberSetBy: ReviewerRef | null;
            }>(`/clients/${clientId}/default-member`, { isDefaultMember: isDefaultLocal, reason: reasonInput.trim() || undefined });
            if (res.success && res.data) {
                setData((prev) => prev ? { ...prev, ...res.data } : prev);
                toast({ title: 'Saved', description: isDefaultLocal ? 'Client marked as Default Member — new loans are now blocked.' : 'Default Member flag cleared.' });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save. Please try again.', variant: 'destructive' });
        } finally {
            setIsSavingDefault(false);
        }
    };

    if (isLoading || !data) {
        return <PageLoader label="Loading client profile…" fullScreen={false} />;
    }

    const c = data;
    const status = statusTone(c.approvalStatus);
    const photoDoc = c.kycDocuments.find(d => d.documentType === 'client_photo');
    const groups = c.groupMemberships.map(g => g.group.name).join(', ');
    const fmtDate = (d: string | null) => (d ? toDisplayDate(new Date(d)) : null);

    const orderedDocs = [...c.kycDocuments]
        .filter(d => d.fileUrl)
        .sort((a, b) => {
            const ia = DOC_ORDER.indexOf(a.documentType);
            const ib = DOC_ORDER.indexOf(b.documentType);
            return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        });

    return (
        <div className="space-y-5">
            {/* ── Hero ── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 via-cyan-600 to-teal-500 p-5 sm:p-6 text-white shadow-lg">
                <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
                <div className="absolute -bottom-14 right-24 h-32 w-32 rounded-full bg-white/10" />
                <div className="relative flex flex-wrap items-center gap-5">
                    <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-4 border-white/60 bg-white/20 shadow-md">
                        {photoDoc?.fileUrl ? (
                            <StorageImage src={photoDoc.fileUrl} alt={`${c.firstName} ${c.lastName}`} className="h-full w-full object-cover" />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center"><User className="h-9 w-9 text-white/80" /></div>
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-bold tracking-tight">{c.firstName} {c.lastName}</h2>
                            <Badge className={status.badge}>{status.label}</Badge>
                            {c.isDefaultMember && (
                                <Badge className="border-transparent bg-red-600 text-white gap-1">
                                    <Ban className="h-3 w-3" /> Default Member — No New Loans
                                </Badge>
                            )}
                        </div>
                        <p className="mt-0.5 text-sm text-white/85">
                            {c.clientId}
                            {c.center && <> · {c.center.code ? `${c.center.code} - ` : ''}{c.center.name}</>}
                            {groups && <> · Group: {groups}</>}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/90">
                            {c.mobileNumber && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {c.mobileNumber}</span>}
                            {c.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {c.email}</span>}
                            {c.dateOfBirth && <span className="flex items-center gap-1"><Cake className="h-3.5 w-3.5" /> {fmtDate(c.dateOfBirth)}{c.age ? ` (${c.age} yrs)` : ''}</span>}
                            <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Enrolled {fmtDate(c.createdAt)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Section grid ── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SectionCard tone="indigo" icon={<User className="h-4 w-4" />} title="Personal Details">
                    <Field label="Gender" value={c.gender} />
                    <Field label="Marital Status" value={c.maritalStatus} />
                    <Field label="Father's Name" value={c.fatherName} />
                    <Field label="Mother's Name" value={c.motherName} />
                    <Field label="Spouse Name" value={c.spouseName} />
                    <Field label="No. of Children" value={c.noOfChildren} />
                    <Field label="Religion" value={c.religion} />
                    <Field label="Caste" value={c.caste} />
                    <Field label="Qualification" value={c.qualification} />
                    <Field label="Economic Activity" value={c.economicActivity?.name ?? c.economicActivityType?.name} />
                </SectionCard>

                <SectionCard tone="sky" icon={<MapPin className="h-4 w-4" />} title="Address & Contact">
                    <div className="col-span-2"><Field label="Address" value={c.permanentAddress} /></div>
                    <Field label="Post Office" value={c.postOffice} />
                    <Field label="District" value={c.district} />
                    <Field label="State" value={c.state} />
                    <Field label="Pincode" value={c.pincode} />
                    <Field label="Country" value={c.country} />
                    <Field label="Phone" value={c.phone} />
                </SectionCard>

                <SectionCard tone="emerald" icon={<Landmark className="h-4 w-4" />} title="Bank & Identity">
                    <Field label="Bank Name" value={c.bankName} />
                    <Field label="Branch" value={c.bankBranch} />
                    <Field label="IFSC Code" value={c.ifscCode} />
                    <Field label="Account No." value={c.bankAcNo} />
                    <Field label="PAN Card No." value={c.pancardNo} />
                    <Field label="Voter ID No." value={c.votersIdNo} />
                </SectionCard>

                {c.coApplicant && (
                    <SectionCard tone="rose" icon={<Users className="h-4 w-4" />} title="Co-Applicant / Nominee">
                        <Field label="Name" value={c.coApplicant.name} />
                        <Field label="Relation" value={c.coApplicant.relationWithClient} />
                        <Field label="Gender" value={c.coApplicant.gender} />
                        <Field label="Age" value={c.coApplicant.age} />
                        <Field label="Date of Birth" value={fmtDate(c.coApplicant.dateOfBirth)} />
                        <Field label="Mobile" value={c.coApplicant.mobileNumber} />
                        <Field label="PAN" value={c.coApplicant.pancardNo} />
                        <Field label="Voter ID" value={c.coApplicant.voterIdNo} />
                        <Field label="Economic Activity" value={c.coApplicant.economicActivity?.name ?? c.coApplicant.economicActivityType?.name} />
                    </SectionCard>
                )}

                <SectionCard tone="amber" icon={<Home className="h-4 w-4" />} title="Location">
                    <Field label="Latitude" value={c.latitude != null ? c.latitude.toFixed(6) : null} />
                    <Field label="Longitude" value={c.longitude != null ? c.longitude.toFixed(6) : null} />
                    <div className="col-span-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Approval Status</p>
                        <Badge variant="outline" className="mt-0.5">
                            {(c.locationApprovalStatus ?? 'PENDING').replace(/_/g, ' ')}
                        </Badge>
                    </div>
                </SectionCard>
            </div>

            {/* ── KYC Documents ── */}
            <div className="overflow-hidden rounded-xl border-2 border-teal-200 bg-card shadow-sm dark:border-teal-900">
                <div className="flex items-center gap-2 bg-teal-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                    <ShieldCheck className="h-4 w-4 text-teal-500" />
                    KYC Documents ({orderedDocs.length})
                </div>
                {orderedDocs.length === 0 ? (
                    <p className="p-6 text-center text-sm text-muted-foreground">No documents uploaded.</p>
                ) : (
                    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                        {orderedDocs.map((doc) => (
                            <button
                                key={doc.id}
                                type="button"
                                onClick={() => setPreviewDoc(doc)}
                                className="group overflow-hidden rounded-lg border border-border bg-muted/30 text-left transition-shadow hover:shadow-md"
                            >
                                <div className="relative h-24 w-full bg-muted">
                                    <StorageImage src={doc.fileUrl} alt={getKycDocumentTypeLabel(doc.documentType)} fill className="object-cover" />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity group-hover:bg-black/20 group-hover:opacity-100">
                                        <ImageIcon className="h-5 w-5 text-white" />
                                    </div>
                                </div>
                                <p className="truncate px-2 py-1.5 text-[10px] font-semibold text-foreground">
                                    {getKycDocumentTypeLabel(doc.documentType)}
                                </p>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Default Member (No Loan) control — Admin/Sub Admin only ── */}
            {canManageDefaultMember && (
                <div className="overflow-hidden rounded-xl border-2 border-red-200 bg-card shadow-sm dark:border-red-900">
                    <div className="flex items-center gap-2 bg-red-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-red-700 dark:bg-red-950/40 dark:text-red-300">
                        <Ban className="h-4 w-4 text-red-500" />
                        Default Member Control (Admin Only)
                    </div>
                    <div className="space-y-3 p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-semibold text-foreground">Is Default Member (No Loan Provide)</p>
                                <p className="text-xs text-muted-foreground">
                                    Blocks new loan applications for this member. Any loan already in progress is not affected.
                                </p>
                            </div>
                            <Switch checked={isDefaultLocal} onCheckedChange={setIsDefaultLocal} disabled={isSavingDefault} />
                        </div>

                        {isDefaultLocal && (
                            <div>
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Enter the Reason</p>
                                <Textarea
                                    value={reasonInput}
                                    onChange={(e) => setReasonInput(e.target.value)}
                                    placeholder="Why is this member being marked as a Default Member?"
                                    className="min-h-20 resize-none text-sm"
                                    disabled={isSavingDefault}
                                />
                            </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                            <Button
                                type="button"
                                size="sm"
                                onClick={handleSaveDefaultMember}
                                disabled={isSavingDefault}
                                className="bg-red-600 hover:bg-red-700 text-white"
                            >
                                {isSavingDefault ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                Save
                            </Button>
                            {data.defaultMemberSetAt && (
                                <p className="text-xs text-muted-foreground">
                                    Last updated {toDisplayDateTime(new Date(data.defaultMemberSetAt))}
                                    {data.defaultMemberSetBy && <> by {data.defaultMemberSetBy.firstName} {data.defaultMemberSetBy.lastName}</>}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Document lightbox ── */}
            <Dialog open={!!previewDoc} onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}>
                <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
                    <DialogTitle className="sr-only">{previewDoc ? getKycDocumentTypeLabel(previewDoc.documentType) : 'Document preview'}</DialogTitle>
                    {previewDoc && (
                        <>
                            <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
                                <span className="text-sm font-semibold">{getKycDocumentTypeLabel(previewDoc.documentType)}</span>
                                <button type="button" onClick={() => setPreviewDoc(null)} className="rounded-md p-1 hover:bg-muted">
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="flex max-h-[75vh] items-center justify-center bg-black/5 p-4">
                                <StorageImage src={previewDoc.fileUrl} alt={getKycDocumentTypeLabel(previewDoc.documentType)} className="max-h-[70vh] w-auto object-contain" />
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
