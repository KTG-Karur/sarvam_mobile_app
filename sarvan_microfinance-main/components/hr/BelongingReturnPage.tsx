'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    AlertCircle, AlertTriangle, ArrowLeft, Backpack, Building2, CalendarDays, Camera, CheckCircle2,
    IdCard, ImagePlus, IndianRupee, Loader2, PackageCheck, PackageX, User, UserCheck, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { PageLoader } from '@/components/ui/page-loader';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import {
    BELONGING_CONDITIONS, BELONGING_PROOF_MAX_BYTES, BELONGING_PROOF_MAX_PHOTOS,
    OUTCOME_FIELDS, OUTCOME_LABELS, validateBelongingReturn,
    type BelongingReturnOutcome,
} from '@/app/lib/hr/belonging-return-rules';
import { toDisplayDate } from '@/app/lib/date-format';

interface IssuedBelongingDetail {
    id: string;
    status: 'ISSUED' | 'RETURNED' | 'LOST' | 'DAMAGED';
    issuedDate: string;
    returnedDate: string | null;
    belongingItem: { itemName: string; description: string | null };
    issuedBy: { firstName: string; lastName: string } | null;
    employee: {
        id: string;
        firstName: string;
        lastName: string;
        employeeId: string | null;
        branch: { name: string } | null;
        designation: { name: string } | null;
    };
}

interface UploadedPhoto {
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType: 'image/jpeg' | 'image/png';
    previewUrl: string; // local object URL
}

const OUTCOME_OPTIONS: { value: BelongingReturnOutcome; icon: LucideIcon; description: string; tone: 'ok' | 'warn' | 'bad' }[] = [
    { value: 'RETURNED', icon: CheckCircle2, description: 'Handed back in working order.', tone: 'ok' },
    { value: 'DAMAGED', icon: AlertTriangle, description: 'Handed back, but damaged.', tone: 'warn' },
    { value: 'LOST', icon: PackageX, description: 'Not handed back — record the recovery.', tone: 'bad' },
];

const TONE_SELECTED: Record<'ok' | 'warn' | 'bad', string> = {
    ok: 'border-primary bg-primary/5 ring-1 ring-primary',
    warn: 'border-amber-500 bg-amber-50 ring-1 ring-amber-500 dark:bg-amber-950/30',
    bad: 'border-red-500 bg-red-50 ring-1 ring-red-500 dark:bg-red-950/30',
};
const TONE_ICON: Record<'ok' | 'warn' | 'bad', string> = {
    ok: 'text-primary',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
};

/** Only same-app dashboard paths — never an external or protocol-relative URL. */
function safeReturnTo(value: string | null, fallback: string): string {
    if (!value || !value.startsWith('/dashboard/') || value.startsWith('//')) return fallback;
    return value;
}

function Section({ title, hint, required, children }: {
    title: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
    return (
        <section className="space-y-3 px-5 py-6 sm:px-6">
            <div>
                <h2 className="text-sm font-semibold text-foreground dark:text-slate-100">
                    {title}{required && <span className="ml-0.5 text-red-500">*</span>}
                </h2>
                {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

function DetailItem({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
    return (
        <div className="flex min-w-0 items-start gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
                <p className="truncate text-sm font-medium text-foreground dark:text-slate-100">{value}</p>
            </div>
        </div>
    );
}

export function BelongingReturnPage({ issuedBelongingId }: { issuedBelongingId: string }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();

    const [record, setRecord] = useState<IssuedBelongingDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [status, setStatus] = useState<BelongingReturnOutcome>('RETURNED');
    const [condition, setCondition] = useState<string>('Good');
    const [remarks, setRemarks] = useState('');
    const [recoveryAmount, setRecoveryAmount] = useState('');
    const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
    const [uploading, setUploading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);

    const fallbackBack = record ? `/dashboard/hr/belongings?employeeId=${record.employee.id}` : '/dashboard/hr/belongings';
    const backHref = safeReturnTo(searchParams.get('returnTo'), fallbackBack);
    const goBack = useCallback(() => router.push(backHref), [router, backHref]);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const res = await apiClient.get<IssuedBelongingDetail>(`/hr/belongings/issued/${issuedBelongingId}`);
                if (res.success && res.data) setRecord(res.data);
                else setLoadError(res.error || 'Could not load this belonging.');
            } catch {
                setLoadError('Could not load this belonging.');
            } finally {
                setLoading(false);
            }
        })();
    }, [issuedBelongingId]);

    // Release preview object URLs when leaving the page.
    const photosRef = useRef(photos);
    photosRef.current = photos;
    useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

    const fields = OUTCOME_FIELDS[status];
    const busy = uploading || submitting;

    const addPhotos = async (files: File[]) => {
        const room = BELONGING_PROOF_MAX_PHOTOS - photos.length;
        if (room <= 0) {
            toast({ title: `Up to ${BELONGING_PROOF_MAX_PHOTOS} photos only`, variant: 'destructive' });
            return;
        }
        setUploading(true);
        setError(null);
        try {
            for (const file of files.slice(0, room)) {
                if (file.size > BELONGING_PROOF_MAX_BYTES) {
                    toast({ title: 'Photo too large', description: `${file.name} is over 5 MB.`, variant: 'destructive' });
                    continue;
                }
                const form = new FormData();
                form.append('file', file);
                const res = await apiClient.post<Omit<UploadedPhoto, 'previewUrl'>>(`/hr/belongings/issued/${issuedBelongingId}/proof`, form);
                if (!res.success || !res.data) {
                    toast({ title: 'Upload failed', description: res.error || file.name, variant: 'destructive' });
                    continue;
                }
                const uploaded = { ...res.data, previewUrl: URL.createObjectURL(file) };
                setPhotos((prev) => [...prev, uploaded]);
            }
        } finally {
            setUploading(false);
        }
    };

    const removePhoto = (fileKey: string) => {
        setPhotos((prev) => {
            const target = prev.find((p) => p.fileKey === fileKey);
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((p) => p.fileKey !== fileKey);
        });
    };

    const handleSubmit = async () => {
        if (!record) return;
        const amount = fields.recoveryAmount === 'hidden' || recoveryAmount.trim() === '' ? null : Number(recoveryAmount);
        // Photos picked before switching to "Lost" stay on screen in case the
        // user switches back, but are never sent with a lost item.
        const sentPhotos = fields.photos ? photos : [];
        const problem = validateBelongingReturn({ status, photoCount: sentPhotos.length, recoveryAmount: amount });
        if (problem) {
            setError(problem);
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const res = await apiClient.post(`/hr/belongings/issued/${issuedBelongingId}/return`, {
                status,
                condition: fields.condition ? condition : null,
                remarks: remarks.trim() || null,
                recoveryAmount: amount,
                photos: sentPhotos.map(({ fileKey, fileName, fileSize, mimeType }) => ({ fileKey, fileName, fileSize, mimeType })),
            });
            if (!res.success) {
                setError(res.error || 'Failed to record the return');
                return;
            }
            toast({ title: 'Return recorded', description: `${record.belongingItem.itemName} — ${OUTCOME_LABELS[status]}.` });
            goBack();
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <PageLoader label="Loading belonging..." fullScreen={false} />;

    const employeeName = record ? `${record.employee.firstName} ${record.employee.lastName}` : '';

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            {/* ── Page header ── */}
            <div className="space-y-4">
                <Button variant="ghost" size="sm" onClick={goBack} disabled={busy} className="-ml-2 gap-1.5 text-slate-600 dark:text-slate-300">
                    <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <PackageCheck className="h-7 w-7 text-white" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl dark:text-white">Return Belonging</h1>
                        <p className="mt-1 text-sm text-sidebar-accent dark:text-slate-400">
                            Record how the item came back. Exit clearance stays blocked until every belonging is closed.
                        </p>
                    </div>
                </div>
            </div>

            {loadError || !record ? (
                <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                    <CardContent className="flex flex-col items-center gap-3 px-4 py-14 text-center text-slate-500">
                        <AlertCircle className="h-8 w-8 opacity-40" />
                        {loadError ?? 'Belonging not found.'}
                        <Button variant="outline" onClick={goBack}>Go back</Button>
                    </CardContent>
                </Card>
            ) : (
                <>
                    {/* ── Item details ── */}
                    <Card className="overflow-hidden border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                        <div className="flex items-start justify-between gap-3 border-b border-primary/10 bg-primary/5 px-5 py-4 sm:px-6 dark:bg-brand-green-darker/60">
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                                    <Backpack className="h-5 w-5 text-primary" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Item</p>
                                    <p className="truncate text-lg font-bold text-foreground dark:text-white">{record.belongingItem.itemName}</p>
                                    {record.belongingItem.description && (
                                        <p className="truncate text-xs text-slate-500">{record.belongingItem.description}</p>
                                    )}
                                </div>
                            </div>
                            <Badge variant={record.status === 'ISSUED' ? 'default' : 'outline'} className="shrink-0">
                                {record.status === 'ISSUED' ? 'Issued' : OUTCOME_LABELS[record.status]}
                            </Badge>
                        </div>
                        <CardContent className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
                            <DetailItem icon={User} label="Employee" value={employeeName} />
                            <DetailItem icon={IdCard} label="Employee ID" value={record.employee.employeeId ?? '—'} />
                            <DetailItem icon={Building2} label="Branch" value={record.employee.branch?.name ?? '—'} />
                            <DetailItem
                                icon={CalendarDays}
                                label="Issued on"
                                value={toDisplayDate(new Date(record.issuedDate))}
                            />
                            <DetailItem
                                icon={UserCheck}
                                label="Issued by"
                                value={record.issuedBy ? `${record.issuedBy.firstName} ${record.issuedBy.lastName}` : '—'}
                            />
                            {record.employee.designation && (
                                <DetailItem icon={IdCard} label="Designation" value={record.employee.designation.name} />
                            )}
                        </CardContent>
                    </Card>

                    {record.status !== 'ISSUED' ? (
                        <Card className="border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <CardContent className="flex flex-col items-center gap-3 px-4 py-12 text-center">
                                <CheckCircle2 className="h-8 w-8 text-primary" />
                                <p className="text-sm text-slate-600 dark:text-slate-300">
                                    This item was already closed as <strong>{OUTCOME_LABELS[record.status]}</strong>
                                    {record.returnedDate ? ` on ${toDisplayDate(new Date(record.returnedDate))}` : ''}.
                                </p>
                                <Button variant="outline" onClick={goBack}>Go back</Button>
                            </CardContent>
                        </Card>
                    ) : (
                        /* ── Return form ── */
                        <Card className="overflow-hidden border-primary/20 bg-white/80 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <div className="divide-y divide-slate-100 dark:divide-sidebar-accent">
                                <Section title="Outcome" hint="What happened to the item?" required>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        {OUTCOME_OPTIONS.map((o) => {
                                            const selected = status === o.value;
                                            const Icon = o.icon;
                                            return (
                                                <button
                                                    key={o.value}
                                                    type="button"
                                                    onClick={() => { setStatus(o.value); setError(null); }}
                                                    disabled={busy}
                                                    aria-pressed={selected}
                                                    className={cn(
                                                        'flex items-start gap-3 rounded-lg border bg-white p-4 text-left transition-colors sm:flex-col sm:gap-2 dark:bg-transparent',
                                                        selected ? TONE_SELECTED[o.tone] : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                                                    )}
                                                >
                                                    <Icon className={cn('h-5 w-5 shrink-0', selected ? TONE_ICON[o.tone] : 'text-slate-400')} />
                                                    <span className="min-w-0">
                                                        <span className="block text-sm font-semibold text-foreground dark:text-slate-100">{OUTCOME_LABELS[o.value]}</span>
                                                        <span className="block text-xs text-slate-500 dark:text-slate-400">{o.description}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {fields.condition && (
                                        <div className="flex flex-wrap items-center gap-3 pt-2">
                                            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Condition</span>
                                            <div className="inline-flex rounded-md border bg-white p-0.5 dark:border-slate-700 dark:bg-transparent" role="radiogroup" aria-label="Condition">
                                                {BELONGING_CONDITIONS.map((c) => (
                                                    <button
                                                        key={c}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={condition === c}
                                                        onClick={() => setCondition(c)}
                                                        disabled={busy}
                                                        className={cn(
                                                            'rounded px-4 py-1.5 text-xs font-medium transition-colors',
                                                            condition === c ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                                                        )}
                                                    >
                                                        {c}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </Section>

                                {fields.photos && (
                                    <Section
                                        title={status === 'DAMAGED' ? 'Evidence — photo of the damage' : 'Evidence — photo of the item'}
                                        hint={`Take or upload up to ${BELONGING_PROOF_MAX_PHOTOS} photos (JPG or PNG, 5 MB each).`}
                                        required
                                    >
                                        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
                                            {photos.map((p, i) => (
                                                <div key={p.fileKey} className="relative aspect-square overflow-hidden rounded-lg border bg-slate-50 dark:bg-slate-900">
                                                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                                                    <img src={p.previewUrl} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                                                    <button
                                                        type="button"
                                                        onClick={() => removePhoto(p.fileKey)}
                                                        disabled={busy}
                                                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                                                        aria-label={`Remove photo ${i + 1}`}
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                            {photos.length < BELONGING_PROOF_MAX_PHOTOS && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => setCameraOpen(true)}
                                                        disabled={busy}
                                                        className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-primary/30 text-xs font-medium text-primary transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-50"
                                                    >
                                                        <Camera className="h-5 w-5" /> Camera
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => photoInputRef.current?.click()}
                                                        disabled={busy}
                                                        className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 text-xs font-medium text-slate-500 transition-colors hover:border-primary hover:text-primary disabled:opacity-50 dark:border-slate-600"
                                                    >
                                                        {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                                                        {uploading ? 'Uploading' : 'Upload'}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        <input
                                            ref={photoInputRef}
                                            type="file"
                                            accept="image/jpeg,image/png"
                                            multiple
                                            hidden
                                            onChange={(e) => {
                                                const files = Array.from(e.target.files ?? []);
                                                e.target.value = '';
                                                if (files.length) addPhotos(files);
                                            }}
                                        />
                                    </Section>
                                )}

                                {fields.recoveryAmount !== 'hidden' && (
                                    <Section
                                        title="Recovery Amount (₹)"
                                        hint="Amount to be recovered from the employee. Enter ₹0 if the company will not charge the employee."
                                        required={fields.recoveryAmount === 'required'}
                                    >
                                        <div className="relative max-w-xs">
                                            <IndianRupee className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                            <Input
                                                type="number"
                                                inputMode="decimal"
                                                min={0}
                                                step="0.01"
                                                placeholder="0.00"
                                                value={recoveryAmount}
                                                onChange={(e) => { setRecoveryAmount(e.target.value); setError(null); }}
                                                disabled={busy}
                                                className="pl-9"
                                            />
                                        </div>
                                    </Section>
                                )}

                                <Section title="Remarks" hint="Optional — anything the approver should know.">
                                    <Textarea
                                        rows={4}
                                        value={remarks}
                                        onChange={(e) => setRemarks(e.target.value)}
                                        disabled={busy}
                                        maxLength={1000}
                                        placeholder={status === 'LOST' ? 'e.g. Reported lost during field visit on …' : 'e.g. Minor scratches on the cover'}
                                    />
                                </Section>
                            </div>

                            {/* ── Confirm ── */}
                            <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-6 dark:border-sidebar-accent dark:bg-slate-900/40">
                                {error && (
                                    <p className="mb-3 flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400" role="alert">
                                        <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                                    </p>
                                )}
                                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        You&apos;ll be recorded as the person receiving this return.
                                    </p>
                                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                                        <Button variant="outline" onClick={goBack} disabled={busy}>Cancel</Button>
                                        <Button onClick={handleSubmit} disabled={busy} className="gap-2">
                                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                                            {submitting ? 'Saving…' : 'Confirm Return'}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )}
                </>
            )}

            <CameraCapture
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(file) => { setCameraOpen(false); addPhotos([file]); }}
                label="Photo of returned item"
            />
        </div>
    );
}
