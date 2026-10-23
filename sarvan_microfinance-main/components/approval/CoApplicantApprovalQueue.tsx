'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
    Loader2, RefreshCw, ChevronRight, ArrowLeft, User, Phone, Calendar,
    Briefcase, CheckCircle2, XCircle, Shield, FileText, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import { PageLoader } from '@/components/ui/page-loader';
import { StorageLink } from '@/components/storage/StorageMedia';
import { toDisplayDate } from '@/app/lib/date-format';

interface QueueCoApplicant {
    id: string;
    name: string;
    gender: string;
    dateOfBirth: string;
    age: number;
    relationWithClient: string;
    mobileNumber: string;
    voterIdNo: string | null;
    otherIdNo: string | null;
    pancardNo: string | null;
    currentStage: 'BM' | 'AM' | 'QC' | 'ADMIN' | null;
    createdAt: string;
    economicActivityType?: { name: string } | null;
    economicActivity?: { name: string } | null;
    client: { id: string; clientId: string; firstName: string; lastName: string; center?: { name: string; code: string } | null };
    kycDocuments: Array<{ id: string; documentType: string; fileUrl: string | null; documentNumber: string | null }>;
}

const STAGE_LABEL: Record<string, string> = { BM: 'Branch Manager', AM: 'Area Manager', QC: 'Quality Check', ADMIN: 'Admin' };

export function CoApplicantApprovalQueue() {
    const { toast } = useToast();
    const [items, setItems] = useState<QueueCoApplicant[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selected, setSelected] = useState<QueueCoApplicant | null>(null);
    const [remarks, setRemarks] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchQueue = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<QueueCoApplicant[]>('/co-applicants/approval-queue');
            setItems(res.success && Array.isArray(res.data) ? res.data : []);
        } catch {
            toast({ title: 'Error', description: 'Failed to load co-applicant approval queue', variant: 'destructive' });
            setItems([]);
        } finally {
            setIsLoading(false);
        }
    }, [toast]);

    useEffect(() => { void fetchQueue(); }, [fetchQueue]);

    const handleAction = async (action: 'approve' | 'reject') => {
        if (!selected) return;
        if (action === 'reject' && !remarks.trim()) {
            toast({ title: 'Remarks required', description: 'Please provide a reason for rejection.', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        try {
            const res = await apiClient.post(`/co-applicants/${selected.id}/action`, { action, remarks: remarks.trim() || undefined });
            if (res.success) {
                toast({ title: action === 'approve' ? 'Approved' : 'Rejected', description: res.message || 'Action completed.' });
                setSelected(null);
                setRemarks('');
                void fetchQueue();
            } else {
                toast({ title: 'Error', description: res.error || 'Action failed', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Detail view ──
    if (selected) {
        return (
            <div className="space-y-4">
                <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setRemarks(''); }} className="gap-1.5">
                    <ArrowLeft className="h-4 w-4" /> Back to queue
                </Button>

                <Card className="border-2 border-purple-200 dark:border-purple-800">
                    <CardContent className="pt-6 space-y-5">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-foreground dark:text-white">{selected.name}</h2>
                            <Badge variant="outline" className="gap-1.5 border-purple-300 text-purple-700 bg-purple-50">
                                <Shield className="h-3 w-3" /> Pending {STAGE_LABEL[selected.currentStage ?? ''] ?? ''} review
                            </Badge>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div className="flex items-center gap-2"><User className="h-4 w-4 text-slate-400" /> Relation: <strong>{selected.relationWithClient}</strong></div>
                            <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-slate-400" /> Mobile: <strong>{selected.mobileNumber}</strong></div>
                            <div className="flex items-center gap-2"><Calendar className="h-4 w-4 text-slate-400" /> DOB: <strong>{toDisplayDate(new Date(selected.dateOfBirth))}</strong> ({selected.age} yrs)</div>
                            {selected.economicActivityType && (
                                <div className="flex items-center gap-2"><Briefcase className="h-4 w-4 text-slate-400" /> Activity: <strong>{selected.economicActivityType.name}{selected.economicActivity ? ` — ${selected.economicActivity.name}` : ''}</strong></div>
                            )}
                            {selected.pancardNo && <div>PAN: <span className="font-mono">{selected.pancardNo}</span></div>}
                            {selected.voterIdNo && <div>Voter ID: <span className="font-mono">{selected.voterIdNo}</span></div>}
                            {selected.otherIdNo && <div>Aadhaar: <span className="font-mono">{selected.otherIdNo}</span></div>}
                        </div>

                        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                            <p className="font-semibold text-sidebar-accent dark:text-slate-300 mb-1">For client</p>
                            <p>{selected.client.clientId} — {selected.client.firstName} {selected.client.lastName}</p>
                            {selected.client.center && <p className="text-xs text-slate-500">{selected.client.center.code} — {selected.client.center.name}</p>}
                        </div>

                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5" /> Documents ({selected.kycDocuments.length})
                            </p>
                            {selected.kycDocuments.length === 0 ? (
                                <p className="text-xs text-slate-400 italic">No documents uploaded yet</p>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {selected.kycDocuments.map((doc) => (
                                        <StorageLink
                                            key={doc.id}
                                            href={doc.fileUrl}
                                            className="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                                        >
                                            <Eye className="h-3 w-3 text-primary shrink-0" />
                                            <span className="truncate">{getKycDocumentTypeLabel(doc.documentType)}</span>
                                        </StorageLink>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold">Remarks</label>
                            <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required to reject…" rows={3} />
                        </div>

                        <div className="flex gap-3">
                            <Button
                                className="flex-1 bg-gradient-to-r from-emerald-500 to-green-600 text-white"
                                disabled={isSubmitting}
                                onClick={() => handleAction('approve')}
                            >
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                                Approve
                            </Button>
                            <Button
                                variant="destructive"
                                className="flex-1"
                                disabled={isSubmitting}
                                onClick={() => handleAction('reject')}
                            >
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <XCircle className="h-4 w-4 mr-1.5" />}
                                Reject
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // ── Queue list ──
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground dark:text-slate-200">{items.length}</span> co-applicant{items.length !== 1 ? 's' : ''} awaiting your review
                </p>
                <Button variant="outline" size="sm" onClick={() => void fetchQueue()} disabled={isLoading} className="h-9 gap-1.5">
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} /> Refresh
                </Button>
            </div>

            {isLoading && items.length === 0 ? (
                <Card><CardContent className="py-12">
                    <PageLoader label="Loading…" fullScreen={false} />
                </CardContent></Card>
            ) : items.length === 0 ? (
                <Card className="border-dashed"><CardContent className="flex flex-col items-center justify-center py-16 gap-2">
                    <Shield className="h-8 w-8 text-slate-300" />
                    <p className="text-sm text-muted-foreground">No co-applicants pending your review.</p>
                </CardContent></Card>
            ) : (
                <div className="space-y-2.5">
                    {items.map((co) => (
                        <button
                            key={co.id}
                            onClick={() => setSelected(co)}
                            className="w-full flex items-center gap-3 rounded-xl border-2 border-purple-200/60 bg-white px-4 py-3.5 text-left shadow-sm hover:border-purple-400 hover:shadow-md transition-all dark:border-purple-900/40 dark:bg-brand-green-darker/50"
                        >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-base font-bold text-white">
                                {co.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-foreground dark:text-white">{co.name}</span>
                                    <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700">{STAGE_LABEL[co.currentStage ?? ''] ?? ''}</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {co.relationWithClient} of {co.client.firstName} {co.client.lastName} ({co.client.clientId})
                                </p>
                            </div>
                            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
