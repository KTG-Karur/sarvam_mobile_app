'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
    Loader2, UserPlus, Users, Search, Eye, Trash2, Upload, FileText,
    ShieldCheck, Clock, XCircle, CheckCircle2, Star, Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { PageLoader } from '@/components/ui/page-loader';
import {
    CO_APPLICANT_KYC_DOCUMENT_TYPES,
    type SupportedKycDocumentType,
} from '@/app/lib/kyc-document-types';
import { compressImage, type CompressionResult } from '@/app/lib/image-compress';
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

// The documents this page manages — CO_APPLICANT_KYC_DOCUMENT_TYPES now has no
// unused/duplicate entries left to exclude.
const MANAGED_DOC_TYPES = CO_APPLICANT_KYC_DOCUMENT_TYPES;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    PENDING_APPROVAL: { label: 'Pending Approval', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: <Clock className="h-3 w-3" /> },
    APPROVED: { label: 'Approved', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: <CheckCircle2 className="h-3 w-3" /> },
    REJECTED: { label: 'Rejected', color: 'bg-red-100 text-red-700 border-red-200', icon: <XCircle className="h-3 w-3" /> },
    ACTIVE: { label: 'Active', color: 'bg-green-100 text-green-700 border-green-200', icon: <ShieldCheck className="h-3 w-3" /> },
    INACTIVE: { label: 'Inactive', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: <XCircle className="h-3 w-3" /> },
};

function calculateAge(dob: string): number {
    if (!dob) return 0;
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return Math.max(0, age);
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface ClientOption { id: string; clientId: string; firstName: string; lastName: string; }

interface CoApplicant {
    id: string;
    isPrimary: boolean;
    status: keyof typeof STATUS_CONFIG;
    currentStage: 'BM' | 'AM' | 'QC' | 'ADMIN' | null;
    name: string;
    gender: string;
    dateOfBirth: string;
    age: number;
    relationWithClient: string;
    mobileNumber: string;
    voterIdNo: string | null;
    otherIdNo: string | null;
    pancardNo: string | null;
    economicActivityTypeId: string | null;
    economicActivityId: string | null;
    economicActivityType?: { id: string; name: string } | null;
    economicActivity?: { id: string; name: string } | null;
    createdAt: string;
}

interface CoApplicantDocument {
    id: string;
    documentType: string;
    fileUrl: string | null;
    fileName: string | null;
    uploadedAt: string;
}

interface FormState {
    name: string; gender: string; dateOfBirth: string; age: string;
    relationWithClient: string; mobileNumber: string;
    voterIdNo: string; otherIdNo: string; pancardNo: string;
    economicActivityTypeId: string; economicActivityId: string;
}

const EMPTY_FORM: FormState = {
    name: '', gender: '', dateOfBirth: '', age: '',
    relationWithClient: '', mobileNumber: '',
    voterIdNo: '', otherIdNo: '', pancardNo: '',
    economicActivityTypeId: '', economicActivityId: '',
};

export function CoApplicantManagementClient() {
    const { toast } = useToast();
    const searchParams = useSearchParams();
    // Deep-link param is the business clientId (e.g. K3BRI0001), matching how
    // /api/clients/[clientId] resolves clients — not the internal cuid.
    const preselectedClientCode = searchParams.get('clientId');

    // ── Client selection ──
    const [selectedClientId, setSelectedClientId] = useState(''); // internal cuid, used by /api/co-applicants
    const [selectedClient, setSelectedClient] = useState<ClientOption | null>(null);
    const [isResolvingPreselected, setIsResolvingPreselected] = useState(!!preselectedClientCode);
    const [clientSearch, setClientSearch] = useState('');
    const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
    const [isLoadingClients, setIsLoadingClients] = useState(false);

    // ── Co-applicant list ──
    const [coApplicants, setCoApplicants] = useState<CoApplicant[]>([]);
    const [isLoadingList, setIsLoadingList] = useState(false);

    // ── Economic activity master data ──
    const [economicActivityTypes, setEconomicActivityTypes] = useState<Array<{ id: string; name: string }>>([]);
    const [economicActivities, setEconomicActivities] = useState<Array<{ id: string; name: string }>>([]);
    const [isLoadingActivities, setIsLoadingActivities] = useState(false);

    // ── Add/Edit dialog ──
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(EMPTY_FORM);
    const [isSaving, setIsSaving] = useState(false);

    // ── Documents dialog ──
    const [docsCoApplicant, setDocsCoApplicant] = useState<CoApplicant | null>(null);
    const [documents, setDocuments] = useState<CoApplicantDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);
    const [uploadingType, setUploadingType] = useState<string | null>(null);
    const [compressionStats, setCompressionStats] = useState<Record<string, CompressionResult>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingUploadType = useRef<SupportedKycDocumentType | null>(null);

    const [activatingId, setActivatingId] = useState<string | null>(null);

    // ── Fetch client search results ──
    useEffect(() => {
        if (preselectedClientCode) return; // don't override an explicit deep link
        const handle = setTimeout(async () => {
            if (!clientSearch.trim()) { setClientOptions([]); return; }
            setIsLoadingClients(true);
            try {
                const res = await apiClient.get<{ clients: ClientOption[] } | ClientOption[]>(
                    `/clients?search=${encodeURIComponent(clientSearch.trim())}&pageSize=20`
                );
                const list = Array.isArray(res.data) ? res.data : (res.data?.clients ?? []);
                setClientOptions(list);
            } catch { setClientOptions([]); }
            finally { setIsLoadingClients(false); }
        }, 350);
        return () => clearTimeout(handle);
    }, [clientSearch, preselectedClientCode]);

    // ── Resolve the deep-linked client (business clientId -> internal id) ──
    useEffect(() => {
        if (!preselectedClientCode) return;
        setIsResolvingPreselected(true);
        apiClient.get<ClientOption>(`/clients/${preselectedClientCode}`).then((res) => {
            if (res.success && res.data) {
                setSelectedClient(res.data);
                setSelectedClientId(res.data.id);
            } else {
                toast({ title: 'Record not found', description: 'Could not resolve the linked member/client.', variant: 'destructive' });
            }
        }).catch(() => {
            toast({ title: 'Error', description: 'Failed to load record.', variant: 'destructive' });
        }).finally(() => setIsResolvingPreselected(false));
    }, [preselectedClientCode, toast]);

    // ── Fetch co-applicants list ──
    const fetchCoApplicants = useCallback(async () => {
        if (!selectedClientId) { setCoApplicants([]); return; }
        setIsLoadingList(true);
        try {
            const res = await apiClient.get<CoApplicant[]>(`/co-applicants?clientId=${selectedClientId}&all=true`);
            setCoApplicants(res.success && Array.isArray(res.data) ? res.data : []);
        } catch {
            setCoApplicants([]);
        } finally {
            setIsLoadingList(false);
        }
    }, [selectedClientId]);

    useEffect(() => { void fetchCoApplicants(); }, [fetchCoApplicants]);

    // ── Economic activity types on mount ──
    useEffect(() => {
        apiClient.get<Array<{ id: string; name: string }>>('/economic-activity-types').then((res) => {
            if (res.success && res.data) setEconomicActivityTypes(res.data);
        }).catch(() => { /* non-critical */ });
    }, []);

    const fetchEconomicActivities = useCallback(async (typeId: string) => {
        if (!typeId) { setEconomicActivities([]); return; }
        setIsLoadingActivities(true);
        try {
            const res = await apiClient.get<Array<{ id: string; name: string }>>(`/economic-activities?activityTypeId=${typeId}`);
            setEconomicActivities(res.success && res.data ? res.data : []);
        } catch { setEconomicActivities([]); }
        finally { setIsLoadingActivities(false); }
    }, []);

    // ── Client select handlers ──
    const handleSelectClient = (client: ClientOption) => {
        setSelectedClientId(client.id);
        setSelectedClient(client);
        setClientSearch('');
        setClientOptions([]);
    };

    // ── Add/Edit form ──
    const openAddForm = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setEconomicActivities([]);
        setFormOpen(true);
    };

    const openEditForm = (co: CoApplicant) => {
        setEditingId(co.id);
        setForm({
            name: co.name,
            gender: co.gender?.toUpperCase() || '',
            dateOfBirth: new Date(co.dateOfBirth).toISOString().split('T')[0],
            age: String(co.age),
            relationWithClient: co.relationWithClient?.toUpperCase() || '',
            mobileNumber: co.mobileNumber,
            voterIdNo: co.voterIdNo || '',
            otherIdNo: co.otherIdNo || '',
            pancardNo: co.pancardNo || '',
            economicActivityTypeId: co.economicActivityTypeId || '',
            economicActivityId: co.economicActivityId || '',
        });
        if (co.economicActivityTypeId) void fetchEconomicActivities(co.economicActivityTypeId);
        setFormOpen(true);
    };

    const updateForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

    const handleDobChange = (dob: string) => {
        updateForm({ dateOfBirth: dob, age: dob ? String(calculateAge(dob)) : '' });
    };

    const handleSubmitForm = async () => {
        if (!selectedClientId) return;
        if (!form.name.trim() || !form.gender || !form.dateOfBirth || !form.relationWithClient || !/^[0-9]{10}$/.test(form.mobileNumber)) {
            toast({ title: 'Missing details', description: 'Name, gender, date of birth, relation and a valid 10-digit mobile number are required.', variant: 'destructive' });
            return;
        }

        setIsSaving(true);
        try {
            const payload = {
                clientId: selectedClientId,
                name: form.name.trim(),
                gender: form.gender,
                dateOfBirth: form.dateOfBirth,
                age: parseInt(form.age, 10) || calculateAge(form.dateOfBirth),
                relationWithClient: form.relationWithClient,
                mobileNumber: form.mobileNumber,
                voterIdNo: form.voterIdNo || null,
                otherIdNo: form.otherIdNo || null,
                pancardNo: form.pancardNo || null,
                economicActivityTypeId: form.economicActivityTypeId || null,
                economicActivityId: form.economicActivityId || null,
            };

            const res = editingId
                ? await apiClient.put(`/co-applicants/${editingId}`, payload)
                : await apiClient.post('/co-applicants', payload);

            if (res.success) {
                toast({ title: editingId ? 'Co-applicant updated' : 'Co-applicant created', description: res.message || 'Saved successfully.' });
                setFormOpen(false);
                void fetchCoApplicants();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save co-applicant', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    // ── Documents dialog ──
    const openDocuments = async (co: CoApplicant) => {
        setDocsCoApplicant(co);
        setIsLoadingDocs(true);
        try {
            const res = await apiClient.get<{ documents: CoApplicantDocument[] }>(
                `/clients/${selectedClient?.clientId}/kyc-documents?scope=co_applicant&coApplicantId=${co.id}`
            );
            setDocuments(res.success && res.data ? res.data.documents : []);
        } catch {
            setDocuments([]);
        } finally {
            setIsLoadingDocs(false);
        }
    };

    const triggerUpload = (documentType: SupportedKycDocumentType) => {
        pendingUploadType.current = documentType;
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const documentType = pendingUploadType.current;
        e.target.value = '';
        if (!file || !documentType || !docsCoApplicant || !selectedClient) return;

        setUploadingType(documentType);
        try {
            const compressionResult = await compressImage(file, documentType);
            const { compressedFile, previewUrl } = compressionResult;
            URL.revokeObjectURL(previewUrl);
            if (compressionResult.wasCompressed) {
                setCompressionStats((prev) => ({ ...prev, [documentType]: compressionResult }));
            }

            const body = new FormData();
            body.append('clientId', selectedClient.clientId);
            body.append('documentType', documentType);
            body.append('file', compressedFile);
            body.append('owner', 'coApplicant');
            body.append('coApplicantId', docsCoApplicant.id);

            const response = await fetch('/api/kyc/aadhaar/upload', { method: 'POST', body });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Upload failed');

            toast({
                title: 'Uploaded',
                description: compressionResult.wasCompressed
                    ? `Document uploaded — ${compressionResult.originalSizeLabel} → ${compressionResult.compressedSizeLabel} (saved ${compressionResult.reductionPercent}%).`
                    : 'Document uploaded successfully.',
            });
            await openDocuments(docsCoApplicant);
        } catch (error) {
            toast({ title: 'Upload failed', description: error instanceof Error ? error.message : 'Failed to upload document', variant: 'destructive' });
        } finally {
            setUploadingType(null);
        }
    };

    const handleDeleteDocument = async (doc: CoApplicantDocument) => {
        if (!selectedClient || !docsCoApplicant) return;
        try {
            const res = await apiClient.delete(`/clients/${selectedClient.clientId}/kyc-documents?documentId=${doc.id}`);
            if (res.success) {
                toast({ title: 'Deleted', description: 'Document removed.' });
                await openDocuments(docsCoApplicant);
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to delete', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        }
    };

    // ── Activate ──
    const handleActivate = async (co: CoApplicant) => {
        setActivatingId(co.id);
        try {
            const res = await apiClient.post(`/co-applicants/${co.id}/activate`);
            if (res.success) {
                toast({ title: 'Activated', description: `${co.name} is now the active co-applicant.` });
                void fetchCoApplicants();
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to activate', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        } finally {
            setActivatingId(null);
        }
    };

    const docsByType = useMemo(() => {
        const map = new Map<string, CoApplicantDocument>();
        documents.forEach((d) => map.set(d.documentType, d));
        return map;
    }, [documents]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-lg">
                    <Users className="h-5 w-5 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-white">Co-Applicant Management</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Add, review and activate co-applicants — each goes through Branch Manager → Area Manager → Quality Check → Admin approval.
                    </p>
                </div>
            </div>

            {/* Client selector (only when not deep-linked with a clientId) */}
            {isResolvingPreselected && (
                <PageLoader label="Loading…" fullScreen={false} />
            )}

            {!preselectedClientCode && (
                <Card>
                    <CardContent className="pt-6 space-y-3">
                        <Label className="flex items-center gap-2 text-sm font-semibold">
                            <Search className="h-3.5 w-3.5" /> Search Member / Client
                        </Label>
                        <Input
                            value={selectedClient ? `${selectedClient.clientId} — ${selectedClient.firstName} ${selectedClient.lastName}` : clientSearch}
                            onChange={(e) => { setClientSearch(e.target.value); setSelectedClient(null); setSelectedClientId(''); }}
                            placeholder="Search by name, ID or phone…"
                        />
                        {isLoadingClients && <p className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Searching…</p>}
                        {clientOptions.length > 0 && (
                            <div className="rounded-lg border divide-y max-h-56 overflow-y-auto">
                                {clientOptions.map((c) => (
                                    <button
                                        key={c.id}
                                        onClick={() => handleSelectClient(c)}
                                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                    >
                                        <span className="font-mono text-xs text-slate-500 mr-2">{c.clientId}</span>
                                        {c.firstName} {c.lastName}
                                    </button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {selectedClientId && (
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-sidebar-accent dark:text-slate-200">
                                    {selectedClient ? `${selectedClient.firstName} ${selectedClient.lastName} (${selectedClient.clientId})` : 'Co-Applicants'}
                                </h3>
                                <p className="text-xs text-slate-500">{coApplicants.length} co-applicant{coApplicants.length !== 1 ? 's' : ''}</p>
                            </div>
                            <Button onClick={openAddForm} className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                                <UserPlus className="h-4 w-4 mr-2" /> Add Co-Applicant
                            </Button>
                        </div>

                        {isLoadingList ? (
                            <PageLoader fullScreen={false} />
                        ) : coApplicants.length === 0 ? (
                            <p className="text-center text-sm text-slate-400 italic py-8">No co-applicants yet for this client.</p>
                        ) : (
                            <div className="rounded-lg border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Relation</TableHead>
                                            <TableHead>Mobile</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Created</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {coApplicants.map((co) => {
                                            const cfg = STATUS_CONFIG[co.status];
                                            return (
                                                <TableRow key={co.id}>
                                                    <TableCell className="font-medium">
                                                        <span className="flex items-center gap-1.5">
                                                            {co.name}
                                                            {co.isPrimary && (
                                                                <Badge variant="outline" className="text-[10px] gap-1 border-amber-300 text-amber-700">
                                                                    <Star className="h-2.5 w-2.5" /> Primary
                                                                </Badge>
                                                            )}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-sm">{co.relationWithClient}</TableCell>
                                                    <TableCell className="text-sm font-mono">{co.mobileNumber}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className={cn('text-xs gap-1', cfg.color)}>
                                                            {cfg.icon} {cfg.label}
                                                            {co.status === 'PENDING_APPROVAL' && co.currentStage && ` (${co.currentStage})`}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-slate-500">{toDisplayDate(new Date(co.createdAt))}</TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex justify-end gap-1">
                                                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Documents" onClick={() => openDocuments(co)}>
                                                                <FileText className="h-3.5 w-3.5" />
                                                            </Button>
                                                            {(co.status === 'PENDING_APPROVAL' || co.status === 'REJECTED') && (
                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Edit" onClick={() => openEditForm(co)}>
                                                                    <Pencil className="h-3.5 w-3.5" />
                                                                </Button>
                                                            )}
                                                            {co.status === 'APPROVED' && (
                                                                <Button
                                                                    size="sm"
                                                                    className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                                                                    disabled={activatingId === co.id}
                                                                    onClick={() => handleActivate(co)}
                                                                >
                                                                    {activatingId === co.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
                                                                    Activate
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* ── Add/Edit Dialog ── */}
            <Dialog open={formOpen} onOpenChange={setFormOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Edit Co-Applicant' : 'Add Co-Applicant'}</DialogTitle>
                        <DialogDescription>
                            {editingId ? 'Editing details resets this co-applicant back to Pending Approval for re-review.' : 'This co-applicant must be approved (Branch Manager → Area Manager → Quality Check → Admin) before it can be activated.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Name <span className="text-red-500">*</span></Label>
                            <Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Gender <span className="text-red-500">*</span></Label>
                            <Select value={form.gender} onValueChange={(v) => updateForm({ gender: v })}>
                                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                                <SelectContent>
                                    {GENDER_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Relationship with Client <span className="text-red-500">*</span></Label>
                            <Select value={form.relationWithClient} onValueChange={(v) => updateForm({ relationWithClient: v })}>
                                <SelectTrigger><SelectValue placeholder="Select relation" /></SelectTrigger>
                                <SelectContent>
                                    {RELATION_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Date of Birth <span className="text-red-500">*</span></Label>
                            <DateInput value={form.dateOfBirth} onChange={(e) => handleDobChange(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Age</Label>
                            <Input value={form.age} disabled />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Mobile Number <span className="text-red-500">*</span></Label>
                            <Input value={form.mobileNumber} onChange={(e) => updateForm({ mobileNumber: e.target.value })} placeholder="10-digit mobile number" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>PAN Number</Label>
                            <Input value={form.pancardNo} onChange={(e) => updateForm({ pancardNo: e.target.value.toUpperCase() })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Voter ID Number</Label>
                            <Input value={form.voterIdNo} onChange={(e) => updateForm({ voterIdNo: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Aadhaar / Other ID Number</Label>
                            <Input value={form.otherIdNo} onChange={(e) => updateForm({ otherIdNo: e.target.value })} />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Economic Activity Type</Label>
                            <Select
                                value={form.economicActivityTypeId}
                                onValueChange={(v) => { updateForm({ economicActivityTypeId: v, economicActivityId: '' }); void fetchEconomicActivities(v); }}
                            >
                                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                                <SelectContent>
                                    {economicActivityTypes.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Economic Activity</Label>
                            <Select
                                value={form.economicActivityId}
                                onValueChange={(v) => updateForm({ economicActivityId: v })}
                                disabled={!form.economicActivityTypeId || isLoadingActivities}
                            >
                                <SelectTrigger><SelectValue placeholder={isLoadingActivities ? 'Loading…' : 'Select activity'} /></SelectTrigger>
                                <SelectContent>
                                    {economicActivities.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isSaving}>Cancel</Button>
                        <Button onClick={handleSubmitForm} disabled={isSaving} className="bg-gradient-to-r from-purple-600 to-pink-600 text-white">
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingId ? 'Save Changes' : 'Create Co-Applicant'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Documents Dialog ── */}
            <Dialog open={!!docsCoApplicant} onOpenChange={(o) => { if (!o) setDocsCoApplicant(null); }}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Documents — {docsCoApplicant?.name}</DialogTitle>
                        <DialogDescription>Upload the required identity documents for this co-applicant.</DialogDescription>
                    </DialogHeader>

                    <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelected} />

                    {isLoadingDocs ? (
                        <PageLoader fullScreen={false} />
                    ) : (
                        <div className="space-y-2">
                            {MANAGED_DOC_TYPES.map((docType) => {
                                const uploaded = docsByType.get(docType.value);
                                const isUploading = uploadingType === docType.value;
                                return (
                                    <div key={docType.value} className="flex items-center justify-between rounded-lg border px-3 py-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText className={cn('h-4 w-4 shrink-0', uploaded ? 'text-green-600' : 'text-slate-400')} />
                                            <div className="min-w-0">
                                                <span className="text-sm truncate">{docType.label}</span>
                                                {compressionStats[docType.value] && (
                                                    <div className="text-[10px] text-blue-600 dark:text-blue-400 truncate">
                                                        {compressionStats[docType.value].originalSizeLabel} → {compressionStats[docType.value].compressedSizeLabel} (saved {compressionStats[docType.value].reductionPercent}%)
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {uploaded && (
                                                <>
                                                    <a href={uploaded.fileUrl ?? '#'} target="_blank" rel="noreferrer">
                                                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Eye className="h-3.5 w-3.5 text-primary" /></Button>
                                                    </a>
                                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleDeleteDocument(uploaded)}>
                                                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                    </Button>
                                                </>
                                            )}
                                            <Button
                                                variant="outline" size="sm" className="h-7 text-xs"
                                                disabled={isUploading}
                                                onClick={() => triggerUpload(docType.value)}
                                            >
                                                {isUploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
                                                {uploaded ? 'Replace' : 'Upload'}
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDocsCoApplicant(null)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
