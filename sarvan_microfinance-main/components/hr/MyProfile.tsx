'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import {
    UserCircle, User, IdCard, Building2, MapPin, Landmark, Users, Phone, Mail, FileCheck, Download,
    Briefcase, CalendarDays, Layers,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import { FieldPermission, MaskedValue } from '@/app/components/rbac/FieldPermission';
import { DocumentRow, DocumentThumbnail, categoryLabel, statusVariant } from '@/components/hr/DocumentThumbnail';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { toDisplayDate } from '@/app/lib/date-format';

type ProfileLookup = { id: string; firstName: string; lastName: string } | null;

type Profile = {
    id: string;
    employeeId: string | null;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    profilePhotoUrl: string | null;
    dateOfJoining: string | null;
    mobileNumber: string | null;
    email: string | null;
    branch: { id: string; name: string; code: string } | null;
    department: { id: string; name: string } | null;
    designation: { id: string; name: string; grade: number | null } | null;
    gender: string | null;
    dob: string | null;
    maritalStatus: string | null;
    bloodGroup: string | null;
    education: string | null;
    aadhaarNumber: string | null;
    panNumber: string | null;
    uanNumber: string | null;
    esiNumber: string | null;
    pfNumber: string | null;
    address: string | null;
    permanentAddress: string | null;
    sameAsCurrentAddress: boolean;
    emergencyContactName: string | null;
    emergencyContactRelation: string | null;
    emergencyContactMobile: string | null;
    bankName: string | null;
    bankBranchName: string | null;
    bankAccountNumber: string | null;
    bankIfscCode: string | null;
    fatherName: string | null;
    motherName: string | null;
    wifeName: string | null;
    wifeAge: number | null;
    husbandName: string | null;
    husbandAge: number | null;
    weddingDate: string | null;
    reportingManagerL1: ProfileLookup;
    reportingManagerL2: ProfileLookup;
    reportingManagerL3: ProfileLookup;
    /** False while the onboarding approval chain is a single stage — see hasReportingHierarchy. */
    showReportingManagers: boolean;
};

const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500';
const VALUE_CLASS = 'mt-0.5 break-words text-sm font-medium text-foreground dark:text-slate-100';

function Field({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
    return (
        <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
            <div className={LABEL_CLASS}>{label}</div>
            <div className={VALUE_CLASS}>{value || '—'}</div>
        </div>
    );
}

function SensitiveField({ label, value, fieldName }: { label: string; value: string | null; fieldName: string }) {
    return (
        <FieldPermission module="hr-employee" field={fieldName}>
            {({ access }) => (
                <div className="min-w-0">
                    <div className={LABEL_CLASS}>{label}</div>
                    <div className={VALUE_CLASS}>
                        {access === 'MASKED' && value ? <MaskedValue value={value} /> : (value || '—')}
                    </div>
                </div>
            )}
        </FieldPermission>
    );
}

// Every section card fills its grid cell (h-full + flex column), so the two
// cards in a row always share one height; the header is a fixed h-12 strip so
// every card's heading lines up too.
function SectionCard({ icon: Icon, title, children, className, bodyClassName }: {
    icon: LucideIcon;
    title: string;
    children: React.ReactNode;
    className?: string;
    bodyClassName?: string;
}) {
    return (
        <Card
            className={cn(
                'flex h-full flex-col gap-0 overflow-hidden rounded-xl border-primary/15 bg-white/90 py-0 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40',
                className
            )}
        >
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-primary/10 bg-primary/[0.04] px-4 dark:border-sidebar-accent dark:bg-brand-green-darker/60">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                </span>
                <h2 className="text-sm font-semibold text-foreground dark:text-slate-100">{title}</h2>
            </div>
            <CardContent className={cn('grid flex-1 grid-cols-1 content-start gap-x-6 gap-y-4 p-4 sm:grid-cols-2', bodyClassName)}>
                {children}
            </CardContent>
        </Card>
    );
}

function SummaryStat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | null | undefined }) {
    return (
        <div className="flex h-full min-w-0 items-center gap-3 rounded-lg border border-primary/15 bg-white/90 px-3 py-2.5 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
                <div className={LABEL_CLASS}>{label}</div>
                <div className="truncate text-sm font-semibold text-foreground dark:text-slate-100" title={value ?? undefined}>{value || '—'}</div>
            </div>
        </div>
    );
}

function managerName(m: ProfileLookup): string | null {
    return m ? `${m.firstName} ${m.lastName}` : null;
}

export function MyProfile() {
    const { toast } = useToast();
    const [profile, setProfile] = useState<Profile | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [documents, setDocuments] = useState<DocumentRow[]>([]);
    const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);

    const fetchProfile = useCallback(async () => {
        try {
            const res = await apiClient.get<Profile>('/hr/employees/me');
            if (res.success && res.data) {
                setProfile(res.data);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to load profile.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load profile.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    // The round avatar shows the same photo as the employee ID card
    // (app/api/hr/employees/me/id-card): the latest KYC "Photo" document —
    // already loaded below for the Documents section — then the profile photo.
    const idCardPhoto = documents
        .filter((d) => d.category === 'KYC' && d.subtype === 'Photo')
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    const avatarSrc = useSignedUrl(idCardPhoto?.fileUrl || profile?.profilePhotoUrl || null);

    // Own documents only — GET with no employeeId defaults to the caller,
    // same convention the admin Employee Documents page relies on. Kept
    // read-only here (no upload/verify/reject), just a view of what HR has
    // on file.
    const fetchDocuments = useCallback(async () => {
        try {
            const res = await apiClient.get<DocumentRow[]>('/hr/employee-documents');
            if (res.success && res.data) setDocuments(res.data);
        } catch {
            // Documents are supplementary — don't block the rest of the profile with an error toast
        } finally {
            setIsLoadingDocuments(false);
        }
    }, []);

    const handleDownloadDocument = async (doc: DocumentRow) => {
        try {
            const res = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(doc.fileUrl)}`);
            if (res.success && res.data?.url) {
                window.open(res.data.url, '_blank', 'noopener,noreferrer');
            } else {
                toast({ title: 'Error', description: 'Could not resolve document URL.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Could not resolve document URL.', variant: 'destructive' });
        }
    };

    useEffect(() => {
        fetchProfile();
        fetchDocuments();
    }, [fetchProfile, fetchDocuments]);

    if (isLoading) {
        return <PageLoader label="Loading Profile..." fullScreen={false} />;
    }

    if (!profile) {
        return <div className="mx-auto max-w-3xl py-12 text-center text-slate-500">Profile not available.</div>;
    }

    const permanentAddress = profile.sameAsCurrentAddress ? profile.address : profile.permanentAddress;
    const normalizedMaritalStatus = (profile.maritalStatus || '').trim().toUpperCase();
    const normalizedGender = (profile.gender || '').trim().toUpperCase();
    // Only a currently married employee shows spouse fields and Wedding Date —
    // Single, Divorced, Widowed and unset all hide them, same as the edit form.
    const isMarried = normalizedMaritalStatus === 'MARRIED';
    const showWife = isMarried && normalizedGender === 'MALE';
    const showHusband = isMarried && normalizedGender === 'FEMALE';

    return (
        <div className="mx-auto w-full max-w-7xl space-y-4">
            {/* ── Profile header ── */}
            <Card className="gap-0 overflow-hidden rounded-xl border-primary/15 bg-white/90 py-0 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <div className="h-1.5 bg-gradient-to-r from-primary to-primary/60" />
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
                    <Avatar className="h-16 w-16 shrink-0 shadow-md shadow-primary/20 ring-2 ring-white sm:h-20 sm:w-20 dark:ring-brand-green-darker">
                        {avatarSrc && <AvatarImage src={avatarSrc} alt={`${profile.firstName} ${profile.lastName}`} className="object-cover" />}
                        <AvatarFallback className="bg-gradient-to-br from-primary to-primary text-white">
                            <UserCircle className="h-9 w-9" />
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl dark:text-white">
                                {profile.firstName} {profile.lastName}
                            </h1>
                            <Badge variant={profile.isActive ? 'default' : 'outline'}>
                                {profile.isActive ? 'Active' : 'Inactive'}
                            </Badge>
                            {profile.bloodGroup && (
                                <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
                                    {profile.bloodGroup}
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                            <span className="font-medium text-foreground dark:text-slate-200">{profile.employeeId || '—'}</span>
                            {' · '}{profile.designation?.name || profile.role}
                            {' · '}{profile.branch?.name || '—'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                            {profile.mobileNumber && (
                                <span className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-primary" />
                                    {profile.mobileNumber}
                                </span>
                            )}
                            {profile.email && (
                                <span className="flex min-w-0 items-center gap-1.5">
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    <span className="truncate">{profile.email}</span>
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </Card>

            {/* ── Employee summary ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <SummaryStat icon={IdCard} label="Employee ID" value={profile.employeeId} />
                <SummaryStat icon={Briefcase} label="Designation" value={profile.designation?.name} />
                <SummaryStat icon={Layers} label="Department" value={profile.department?.name} />
                <SummaryStat icon={Building2} label="Branch" value={profile.branch?.name} />
                <SummaryStat icon={CalendarDays} label="Date of Joining" value={profile.dateOfJoining?.substring(0, 10)} />
            </div>

            {/* Same sections and fields as before, in the onboarding form's tab
                order. Two columns from lg up; grid rows stretch, so both cards
                in a row are the same height. */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SectionCard icon={User} title="Personal Details">
                    <Field label="Date of Birth" value={profile.dob?.substring(0, 10)} />
                    <Field label="Gender" value={profile.gender} />
                    <Field label="Marital Status" value={profile.maritalStatus} />
                    <Field label="Blood Group" value={profile.bloodGroup} />
                    <Field label="Education Qualification" value={profile.education} wide />
                </SectionCard>

                <SectionCard icon={MapPin} title="Address & Emergency Contact">
                    <Field label="Current Address" value={profile.address} wide />
                    <Field label="Permanent Address" value={permanentAddress} wide />
                    <div className="border-t border-slate-100 pt-3 sm:col-span-2 dark:border-sidebar-accent">
                        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-primary">Emergency Contact</div>
                        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                            <Field label="Emergency Contact Name" value={profile.emergencyContactName} />
                            <Field label="Emergency Contact Relationship" value={profile.emergencyContactRelation} />
                            <Field label="Emergency Contact Number" value={profile.emergencyContactMobile} />
                        </div>
                    </div>
                </SectionCard>

                <SectionCard icon={IdCard} title="Identity & Statutory">
                    <SensitiveField label="Aadhaar Number" fieldName="aadhaarNumber" value={profile.aadhaarNumber} />
                    <SensitiveField label="PAN Number" fieldName="panNumber" value={profile.panNumber} />
                    <SensitiveField label="UAN Number" fieldName="uanNumber" value={profile.uanNumber} />
                    <SensitiveField label="ESI Number" fieldName="esiNumber" value={profile.esiNumber} />
                    <SensitiveField label="PF Number" fieldName="pfNumber" value={profile.pfNumber} />
                </SectionCard>

                <SectionCard icon={Landmark} title="Bank Details">
                    <Field label="Bank Name" value={profile.bankName} />
                    <Field label="Bank Branch Name" value={profile.bankBranchName} />
                    <SensitiveField label="Account Number" fieldName="bankAccountNumber" value={profile.bankAccountNumber} />
                    <Field label="IFSC Code" value={profile.bankIfscCode} />
                </SectionCard>

                <SectionCard icon={Users} title="Family Details">
                    <Field label="Father Name" value={profile.fatherName} />
                    <Field label="Mother Name" value={profile.motherName} />
                    {showWife && <Field label="Spouse Name" value={profile.wifeName} />}
                    {showWife && <Field label="Spouse Age" value={profile.wifeAge != null ? String(profile.wifeAge) : null} />}
                    {showHusband && <Field label="Spouse Name" value={profile.husbandName} />}
                    {showHusband && <Field label="Spouse Age" value={profile.husbandAge != null ? String(profile.husbandAge) : null} />}
                    {isMarried && <Field label="Wedding Date" value={profile.weddingDate?.substring(0, 10)} />}
                </SectionCard>

                <SectionCard icon={Building2} title="Organization">
                    <Field label="Branch" value={profile.branch?.name} />
                    <Field label="Department" value={profile.department?.name} />
                    <Field label="Designation" value={profile.designation?.name} />
                    {profile.showReportingManagers && (
                        <>
                            <Field label="L1 Manager" value={managerName(profile.reportingManagerL1)} />
                            <Field label="L2 Manager" value={managerName(profile.reportingManagerL2)} />
                            <Field label="L3 Manager" value={managerName(profile.reportingManagerL3)} />
                        </>
                    )}
                    <Field label="Date of Joining" value={profile.dateOfJoining?.substring(0, 10)} />
                </SectionCard>

                <SectionCard icon={FileCheck} title="Documents" className="lg:col-span-2" bodyClassName="sm:grid-cols-1 md:grid-cols-2">
                    {isLoadingDocuments ? (
                        <div className="py-4 text-center text-sm text-slate-500 md:col-span-2">Loading documents...</div>
                    ) : documents.length === 0 ? (
                        <div className="py-4 text-center text-sm text-slate-500 md:col-span-2">No documents on file yet.</div>
                    ) : (
                        documents.map((doc) => (
                            <div
                                key={doc.id}
                                className="flex h-16 items-center gap-3 rounded-lg border border-slate-200/70 bg-white px-3 transition-colors hover:border-primary/30 hover:bg-green-50/30 dark:border-sidebar-accent dark:bg-transparent dark:hover:bg-brand-green-darker/20"
                            >
                                <DocumentThumbnail doc={doc} />
                                <div className="min-w-0 flex-1">
                                    {/* Same two lines for every document (name, then category · date) so all items match in height. */}
                                    <div className="truncate text-sm font-medium text-foreground dark:text-slate-200" title={doc.subtype ?? categoryLabel(doc.category)}>
                                        {doc.subtype ?? categoryLabel(doc.category)}
                                    </div>
                                    <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                        {doc.subtype ? `${categoryLabel(doc.category)} · ` : ''}Uploaded {toDisplayDate(new Date(doc.uploadedAt))}
                                    </div>
                                </div>
                                <Badge variant={statusVariant(doc.status)} className="shrink-0">{doc.status}</Badge>
                                <Button size="sm" variant="ghost" className="shrink-0" onClick={() => handleDownloadDocument(doc)} title="Download">
                                    <Download className="h-4 w-4" />
                                </Button>
                            </div>
                        ))
                    )}
                </SectionCard>
            </div>
        </div>
    );
}
