'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { StorageImage } from '@/components/storage/StorageMedia';
import { ImageViewerDialog, type ImageViewerTarget } from '@/components/ui/ImageViewerDialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { HOUSEHOLD_VISIT_CENTER_RADIUS_METERS, LOCATION_MATCH_RADIUS_METERS } from '@/app/lib/location-utils';
import {
    CheckCircle2, Circle, MapPin, Wallet, ClipboardCheck, Home,
    MessageSquareText, ExternalLink,
} from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { cn } from '@/lib/utils';

interface MemberVerificationDialogProps {
    loanId: string | null;
    onClose: () => void;
}

type HouseholdPhoto = {
    id: string; photoUrl: string; isMandatory: boolean;
    distanceMeters: number | null; distanceFromClientMeters: number | null; distanceFromBranchMeters: number | null;
    notes: string | null; createdAt: string; uploadedByName: string;
};

type GrtPhoto = { id: string; photoUrl: string; notes: string | null; createdAt: string; uploadedByName: string };

type GrtQuestion = {
    id: string; question: string; questionType: string;
    choices: Array<{ id: string; choice: string }>;
    answerText: string | null; answerBool: boolean | null; answerChoiceIds: string[];
    photos: GrtPhoto[];
};

type MemberVerificationData = {
    loan: { loanNumber: string; clientName: string; clientDisplayId: string };
    client: { latitude: number | null; longitude: number | null };
    cashFlow: { completedAt: string | null };
    loanAppraisal: { reviewedAt: string | null };
    houseHoldVisit: {
        completedAt: string | null;
        fdoHouseImage: { photoUrl: string | null; uploadedByName: string; createdAt: string } | null;
        photos: HouseholdPhoto[];
    };
    grt: {
        completedSessionId: string | null; completedAt: string | null;
        questionnaireTitle: string | null; questions: GrtQuestion[];
        sessionPhotos: GrtPhoto[];
    };
    isComplete: boolean;
};

function TabBadge({ icon: Icon, label, done }: { icon: typeof Wallet; label: string; done: boolean }) {
    return (
        <div className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
            done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        )}>
            <Icon className="h-3.5 w-3.5" />
            {label}
            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
        </div>
    );
}

function formatDistanceKm(distance: number): string {
    return distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(2)}km`;
}

/** `radius` is omitted for informational-only distances (e.g. Branch) that don't gate approval. */
function DistanceChip({ label, distance, radius }: { label: string; distance: number | null; radius?: number }) {
    if (distance == null) {
        return <div className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[11px] text-slate-500">{label}: not available</div>;
    }
    if (radius == null) {
        return (
            <div className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
                {label}: {formatDistanceKm(distance)}
            </div>
        );
    }
    const ok = distance <= radius;
    return (
        <div className={cn(
            'rounded-full px-3 py-1 text-[11px] font-medium',
            ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        )}>
            {label}: {formatDistanceKm(distance)} {ok ? '✓' : '✗'} (within {radius}m)
        </div>
    );
}

function mapsLink(lat: number, lng: number) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
}

function renderAnswer(q: GrtQuestion, onImageClick: (p: GrtPhoto, title: string) => void) {
    if (q.questionType === 'TEXT') return <p className="text-sm">{q.answerText || '—'}</p>;
    if (q.questionType === 'YES_OR_NO') return <p className="text-sm font-medium">{q.answerBool == null ? '—' : q.answerBool ? 'Yes' : 'No'}</p>;
    if (q.questionType === 'SINGLE_CHOICE' || q.questionType === 'MULTIPLE_CHOICE') {
        const labels = q.choices.filter((c) => q.answerChoiceIds.includes(c.id)).map((c) => c.choice);
        return <p className="text-sm">{labels.length > 0 ? labels.join(', ') : '—'}</p>;
    }
    if (q.questionType === 'IMAGE') {
        return q.photos.length > 0 ? (
            <div className="flex flex-wrap gap-2">
                {q.photos.map((p) => (
                    <StorageImage
                        key={p.id}
                        src={p.photoUrl}
                        alt="Answer"
                        className="h-16 w-20 object-cover rounded border cursor-pointer hover:opacity-90"
                        onClick={() => onImageClick(p, q.question)}
                    />
                ))}
            </div>
        ) : <p className="text-xs text-slate-400">No photo</p>;
    }
    return null;
}

export function MemberVerificationDialog({ loanId, onClose }: MemberVerificationDialogProps) {
    const { toast } = useToast();
    const [data, setData] = useState<MemberVerificationData | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [viewerTarget, setViewerTarget] = useState<ImageViewerTarget | null>(null);

    const fetchData = useCallback(async () => {
        if (!loanId) return;
        setIsLoading(true);
        try {
            const r = await apiClient.get<MemberVerificationData>(`/member-individual/${loanId}`);
            if (r.success && r.data) setData(r.data);
            else toast({ title: 'Error', description: r.error || 'Failed to load verification details.', variant: 'destructive' });
        } finally {
            setIsLoading(false);
        }
    }, [loanId, toast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const mandatoryPhoto = data?.houseHoldVisit.photos.find((p) => p.isMandatory);
    const optionalPhotos = data?.houseHoldVisit.photos.filter((p) => !p.isMandatory) ?? [];

    return (
        <>
        <Dialog open={!!loanId} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="w-[95vw] max-w-3xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        {data ? `${data.loan.clientDisplayId} — ${data.loan.clientName} (${data.loan.loanNumber})` : 'Member Verification'}
                    </DialogTitle>
                </DialogHeader>

                {isLoading || !data ? (
                    <PageLoader label="Loading verification details..." fullScreen={false} />
                ) : (
                    <div className="space-y-5">
                        <div className="flex flex-wrap gap-2">
                            <TabBadge icon={Wallet} label="Cash Flow" done={!!data.cashFlow.completedAt} />
                            <TabBadge icon={ClipboardCheck} label="Loan Appraisal" done={!!data.loanAppraisal.reviewedAt} />
                            <TabBadge icon={Home} label="House Hold Assessment" done={!!data.houseHoldVisit.completedAt} />
                            <TabBadge icon={MessageSquareText} label="GRT" done={!!data.grt.completedAt} />
                        </div>

                        {!data.isComplete && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                                Member Individual / GRT not yet complete for this client — cannot approve for disbursement until every tab above is done.
                            </div>
                        )}

                        <Separator />

                        {/* FDO's house image from enrollment */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Home className="h-4 w-4" />FDO Uploaded House Image (Enrollment)</h3>
                            {data.houseHoldVisit.fdoHouseImage ? (
                                <StorageImage
                                    src={data.houseHoldVisit.fdoHouseImage.photoUrl}
                                    alt="FDO House Image"
                                    className="h-28 w-36 object-cover rounded-lg border shrink-0 cursor-pointer hover:opacity-90"
                                    onClick={() => setViewerTarget({
                                        src: data.houseHoldVisit.fdoHouseImage!.photoUrl,
                                        alt: 'FDO House Image',
                                        title: 'FDO Uploaded House Image',
                                        uploadedByName: data.houseHoldVisit.fdoHouseImage!.uploadedByName,
                                        uploadedAt: data.houseHoldVisit.fdoHouseImage!.createdAt,
                                    })}
                                />
                            ) : (
                                <p className="text-xs text-slate-400">FDO did not upload a house image at enrollment.</p>
                            )}
                        </div>

                        <Separator />

                        {/* House Hold Assessment */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold flex items-center gap-1.5"><Home className="h-4 w-4" />BM Verification Photo — House Hold Assessment</h3>
                            {mandatoryPhoto ? (
                                <div className="flex flex-wrap items-start gap-4">
                                    <StorageImage
                                        src={mandatoryPhoto.photoUrl}
                                        alt="House"
                                        className="h-28 w-36 object-cover rounded-lg border shrink-0 cursor-pointer hover:opacity-90"
                                        onClick={() => setViewerTarget({
                                            src: mandatoryPhoto.photoUrl,
                                            alt: 'BM Verification Photo',
                                            title: 'BM Verification Photo',
                                            uploadedByName: mandatoryPhoto.uploadedByName,
                                            uploadedAt: mandatoryPhoto.createdAt,
                                        })}
                                    />
                                    <div className="space-y-2 text-xs">
                                        <DistanceChip label="Distance from Branch" distance={mandatoryPhoto.distanceFromBranchMeters} />
                                        <DistanceChip label="Distance from Center" distance={mandatoryPhoto.distanceMeters} radius={HOUSEHOLD_VISIT_CENTER_RADIUS_METERS} />
                                        <DistanceChip label="Distance from FDO location" distance={mandatoryPhoto.distanceFromClientMeters} radius={LOCATION_MATCH_RADIUS_METERS} />
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400">No house photo captured yet.</p>
                            )}
                            {optionalPhotos.length > 0 && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                    {optionalPhotos.map((p) => (
                                        <StorageImage
                                            key={p.id}
                                            src={p.photoUrl}
                                            alt="House"
                                            className="h-16 w-20 object-cover rounded border cursor-pointer hover:opacity-90"
                                            onClick={() => setViewerTarget({
                                                src: p.photoUrl,
                                                alt: 'Additional House Photo',
                                                title: 'Additional House Photo',
                                                uploadedByName: p.uploadedByName,
                                                uploadedAt: p.createdAt,
                                            })}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* FDO enrollment location */}
                        <div className="space-y-1.5">
                            <h3 className="text-sm font-semibold flex items-center gap-1.5"><MapPin className="h-4 w-4" />Location Captured by FDO (Enrollment)</h3>
                            {data.client.latitude != null && data.client.longitude != null ? (
                                <a
                                    href={mapsLink(data.client.latitude, data.client.longitude)}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                                >
                                    {data.client.latitude.toFixed(6)}, {data.client.longitude.toFixed(6)} <ExternalLink className="h-3 w-3" />
                                </a>
                            ) : (
                                <p className="text-xs text-slate-400">No location recorded by FDO at enrollment.</p>
                            )}
                        </div>

                        <Separator />

                        {/* GRT */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold flex items-center gap-1.5"><MessageSquareText className="h-4 w-4" />GRT{data.grt.questionnaireTitle ? ` — ${data.grt.questionnaireTitle}` : ''}</h3>
                            {data.grt.completedSessionId ? (
                                <>
                                    <p className="text-xs text-slate-500">Session {data.grt.completedSessionId}</p>
                                    <div className="space-y-2">
                                        {data.grt.questions.map((q) => (
                                            <div key={q.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                                                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{q.question}</p>
                                                {renderAnswer(q, (p, title) => setViewerTarget({
                                                    src: p.photoUrl,
                                                    alt: title,
                                                    title,
                                                    uploadedByName: p.uploadedByName,
                                                    uploadedAt: p.createdAt,
                                                }))}
                                            </div>
                                        ))}
                                    </div>
                                    {data.grt.sessionPhotos.length > 0 && (
                                        <div className="flex flex-wrap gap-2 pt-1">
                                            {data.grt.sessionPhotos.map((p) => (
                                                <StorageImage
                                                    key={p.id}
                                                    src={p.photoUrl}
                                                    alt="GRT Center Photo"
                                                    className="h-16 w-20 object-cover rounded border cursor-pointer hover:opacity-90"
                                                    onClick={() => setViewerTarget({
                                                        src: p.photoUrl,
                                                        alt: 'GRT Center Photo',
                                                        title: 'GRT Center-wise Photo',
                                                        uploadedByName: p.uploadedByName,
                                                        uploadedAt: p.createdAt,
                                                    })}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <p className="text-xs text-slate-400">Not covered by a completed GRT session yet.</p>
                            )}
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
        <ImageViewerDialog target={viewerTarget} onClose={() => setViewerTarget(null)} />
        </>
    );
}
