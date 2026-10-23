'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { ClientSearchResult } from '@/components/client/ClientSearchResultsTable';
import { cn } from '@/lib/utils';
import { IdCard, Phone, User, MapPin, ShieldCheck, Loader2, FileImage, AlertCircle, CheckCircle2, Circle } from 'lucide-react';
import { companyNameShort } from '@/hooks/use-toast';
import { PageLoader } from '@/components/ui/page-loader';
import { useSignedUrl } from '@/hooks/useSignedUrl';

export interface KycDocument {
    id: string;
    name: string;
    imageUrl: string;
    value: string;
}

// Approval cycle stage info shown inside the KYC dialog
export interface ApprovalStage {
    key:    'FDO' | 'BM' | 'AM' | 'QC' | 'FINAL';
    label:  string;
    done:   boolean;
    active: boolean;
    person: string | null;
    role:   string | null;
    date:   string | null;
}

interface KycPreviewDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    client: ClientSearchResult | null;
    documents: KycDocument[];
    isLoading?: boolean;
    approvalCycle?: ApprovalStage[];
    isLoadingApproval?: boolean;
}

export function KycPreviewDialog({
    isOpen,
    onOpenChange,
    client,
    documents,
    isLoading = false,
    approvalCycle = [],
    isLoadingApproval = false,
}: KycPreviewDialogProps) {
    if (!client) {
        return null;
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="w-full max-w-full md:max-w-[58rem] border-none bg-green-950/90 p-0 text-white shadow-2xl">
                <div className="grid gap-0 md:grid-cols-[1.55fr_1.9fr]">
                    {/* Left: Client Summary + Approval Cycle */}
                    <div className="relative flex flex-col gap-4 border-r border-sidebar-accent bg-gradient-to-b from-brand-green-darker/80 via-green-950 to-green-950 p-6">
                        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.4),_transparent_55%)]" />

                        <DialogHeader className="mb-1">
                            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-50">
                                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                                KYC Preview
                            </DialogTitle>
                        </DialogHeader>

                        <div className="flex items-center gap-4">
                            <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-sidebar-accent">
                                <div className="flex h-full w-full items-center justify-center text-xl font-bold">
                                    {client.clientName.charAt(0)}
                                </div>
                            </div>
                            <div className="space-y-1 text-sm">
                                <div className="flex items-center gap-2">
                                    <User className="h-4 w-4 text-slate-300" />
                                    <p className="font-semibold text-slate-50">{client.clientName}</p>
                                </div>
                                <p className="flex items-center gap-1 text-xs text-slate-400">
                                    <MapPin className="h-3 w-3" />
                                    {client.centerName || (
                                        <span className="text-amber-400">⚠ No center assigned</span>
                                    )}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                            <div className="space-y-1">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Account</p>
                                <p className="font-medium">ID: {client.accountId}</p>
                                <p className="font-medium">
                                    Branch: {client.branchName || client.branchId || (
                                        <span className="text-slate-500">—</span>
                                    )}
                                </p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">Contact</p>
                                {client.phone && (
                                    <p className="flex items-center gap-1">
                                        <Phone className="h-3 w-3" />
                                        {client.phone}
                                    </p>
                                )}
                                {client.otherId && (
                                    <p className="flex items-center gap-1">
                                        <IdCard className="h-3 w-3" />
                                        {client.otherId}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Badge className={cn(
                                'border-none px-2 py-0.5 text-[11px] font-semibold',
                                client.status === 'Active'
                                    ? 'bg-emerald-500/10 text-emerald-300'
                                    : 'bg-sidebar-accent/60 text-slate-300'
                            )}>
                                Status: {client.status}
                            </Badge>
                            <Badge className="border-none bg-sidebar-accent/60 px-2 py-0.5 text-[11px] text-slate-200">
                                Dedupe: {client.dedupeFlag}
                            </Badge>
                        </div>

                        {/* ── Approval Cycle Timeline ── */}
                        <div className="mt-1">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                                Approval Cycle
                            </p>

                            {isLoadingApproval ? (
                                <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading approval details…
                                </div>
                            ) : approvalCycle.length === 0 ? (
                                <p className="text-xs text-sidebar-accent italic">No approval data available.</p>
                            ) : (
                                <div className="relative space-y-0">
                                    {approvalCycle.map((stage, idx) => (
                                        <div key={stage.key} className="flex gap-3">
                                            {/* Timeline spine */}
                                            <div className="flex flex-col items-center">
                                                <div className={cn(
                                                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                                                    stage.done
                                                        ? 'border-emerald-500 bg-emerald-500/20'
                                                        : stage.active
                                                            ? 'border-primary bg-primary/20'
                                                            : 'border-sidebar-accent bg-sidebar-accent/50'
                                                )}>
                                                    {stage.done ? (
                                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                                    ) : stage.active ? (
                                                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                                    ) : (
                                                        <Circle className="h-3.5 w-3.5 text-sidebar-accent" />
                                                    )}
                                                </div>
                                                {idx < approvalCycle.length - 1 && (
                                                    <div className={cn(
                                                        'mt-0.5 w-px flex-1',
                                                        stage.done ? 'bg-emerald-700/60' : 'bg-sidebar-accent'
                                                    )} style={{ minHeight: '20px' }} />
                                                )}
                                            </div>

                                            {/* Stage info */}
                                            <div className="pb-4 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn(
                                                        'text-xs font-semibold',
                                                        stage.done   ? 'text-emerald-300'
                                                        : stage.active ? 'text-green-300'
                                                        : 'text-sidebar-accent'
                                                    )}>
                                                        {stage.label}
                                                    </span>
                                                    {stage.done && (
                                                        <span className="text-[10px] font-medium text-emerald-500">✓ Done</span>
                                                    )}
                                                    {stage.active && (
                                                        <span className="text-[10px] font-medium text-primary">● Active</span>
                                                    )}
                                                    {!stage.done && !stage.active && (
                                                        <span className="text-[10px] text-sidebar-accent">○ Pending</span>
                                                    )}
                                                </div>
                                                {(stage.person || stage.date) && (
                                                    <div className="mt-0.5 text-[11px] text-slate-400 space-y-0">
                                                        {stage.person && (
                                                            <p className="truncate">
                                                                {stage.person}
                                                                {stage.role && (
                                                                    <span className="ml-1 text-sidebar-accent">
                                                                        ({stage.role.replace(/_/g, ' ')})
                                                                    </span>
                                                                )}
                                                            </p>
                                                        )}
                                                        {stage.date && (
                                                            <p className="text-slate-500">{stage.date}</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Documents */}
                    <div className="flex flex-col bg-green-950/95">
                        <div className="border-b border-sidebar-accent px-6 py-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                            Documents
                        </div>

                        <ScrollArea className="max-h-[460px] px-6 py-4">
                            {isLoading ? (
                                <PageLoader label="Loading documents..." fullScreen={false} />
                            ) : documents.length === 0 ? (
                                <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-slate-400">
                                    <FileImage className="h-12 w-12 text-sidebar-accent" />
                                    <p className="text-sm font-medium text-slate-300">No documents found</p>
                                    <p className="text-xs text-slate-500">
                                        KYC documents will appear here once uploaded
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-4">
                                    {documents.map((doc) => (
                                        <AadhaarImageCard key={doc.id} doc={doc} />
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Component to display Aadhaar image with error handling
 */
function AadhaarImageCard({ doc }: { doc: KycDocument }) {
    const [imageError, setImageError] = useState(false);
    const [imageLoading, setImageLoading] = useState(true);

    // Use regular img tag for external S3 URLs to avoid Next.js Image optimization issues
    const isExternalUrl = doc.imageUrl.startsWith('http://') || doc.imageUrl.startsWith('https://');

    // Fix Supabase Storage URL format if needed
    // Convert from: https://{project}.storage.supabase.co/storage/v1/s3/{bucket}/{key}
    // To: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{key}
    const correctedImageUrl = (() => {
        if (!isExternalUrl) return doc.imageUrl;
        
        let url = doc.imageUrl;
        
        // Fix Supabase Storage URL format - handle multiple patterns
        // Pattern 1: storage.supabase.co with /s3/ path
        if (url.includes('.storage.supabase.co') && url.includes('/s3/')) {
            url = url
                .replace(/\.storage\.supabase\.co/, '.supabase.co')
                .replace('/storage/v1/s3/', '/storage/v1/object/public/');
        }
        // Pattern 2: storage.supabase.co without /s3/ (direct path style)
        else if (url.includes('.storage.supabase.co') && !url.includes('/object/public/')) {
            // Extract project ref and rebuild URL
            const match = url.match(/https?:\/\/([^.]+)\.storage\.supabase\.co/);
            if (match) {
                const projectRef = match[1];
                const protocol = url.startsWith('https') ? 'https' : 'http';
                // Extract bucket and key from path - handle various path formats
                const pathMatch = url.match(/\/storage\/v1\/(?:s3\/)?([^\/]+)\/(.+)$/);
                if (pathMatch) {
                    const bucket = pathMatch[1];
                    const key = pathMatch[2];
                    url = `${protocol}://${projectRef}.supabase.co/storage/v1/object/public/${bucket}/${key}`;
                } else {
                    // Fallback: try to extract key from end of URL
                    const keyMatch = url.match(/\/storage\/v1\/[^\/]+\/(.+)$/);
                    if (keyMatch) {
                        const key = keyMatch[1];
                        // Try to extract bucket from URL or use env var
                        const bucketMatch = url.match(/\/storage\/v1\/[^\/]+\/([^\/]+)\//);
                        const bucket = bucketMatch ? bucketMatch[1] : `${companyNameShort}-microfinance`;
                        url = `${protocol}://${projectRef}.supabase.co/storage/v1/object/public/${bucket}/${key}`;
                    }
                }
            }
        }
        // Pattern 3: Already correct format but might have wrong domain
        else if (url.includes('supabase.co') && url.includes('/object/public/')) {
            // Ensure it's using the correct domain (not storage.supabase.co)
            url = url.replace(/\.storage\.supabase\.co/, '.supabase.co');
        }
        
        // Log corrected URL in development for debugging
        if (process.env.NODE_ENV === 'development' && url !== doc.imageUrl) {
            console.log('[KYC] URL corrected:', { original: doc.imageUrl, corrected: url });
        }
        
        return url;
    })();

    // The GCS bucket is private, so a bare object key (non-Supabase, non-http
    // value) needs to be exchanged for a signed URL before it's viewable.
    const resolvedImageUrl = useSignedUrl(correctedImageUrl);

    // Wrap error handling to prevent crashes
    const handleImageError = () => {
        try {
            setImageError(true);
            setImageLoading(false);
        } catch {
            // Silently catch any state update errors to prevent crashes
        }
    };

    const handleImageLoad = () => {
        try {
            setImageLoading(false);
            setImageError(false);
        } catch {
            // Silently catch any state update errors to prevent crashes
        }
    };

    return (
        <div className="flex flex-col overflow-hidden rounded-xl border border-sidebar-accent bg-brand-green-darker/60">
            {/* Image */}
            <div className="relative flex min-h-[150px] items-center justify-center overflow-hidden bg-brand-green-darker">
                {imageError ? (
                    <div className="flex flex-col items-center gap-2 p-4 text-slate-500">
                        <AlertCircle className="h-8 w-8 text-sidebar-accent" />
                        <p className="text-xs text-slate-400">Failed to load</p>
                        {resolvedImageUrl && (
                            <a
                                href={resolvedImageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:text-green-300 underline"
                            >
                                Open in new tab
                            </a>
                        )}
                    </div>
                ) : (
                    <>
                        {(imageLoading || !resolvedImageUrl) && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                            </div>
                        )}
                        {resolvedImageUrl && (
                            <img
                                src={resolvedImageUrl}
                                alt={doc.name}
                                className={cn(
                                    'w-full h-auto object-contain',
                                    imageLoading && 'opacity-0'
                                )}
                                style={{ maxHeight: '180px' }}
                                onLoad={handleImageLoad}
                                onError={handleImageError}
                                crossOrigin="anonymous"
                            />
                        )}
                    </>
                )}
            </div>

            {/* Name label */}
            <div className="px-3 py-2 text-center border-t border-sidebar-accent">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                    {doc.name}
                </p>
            </div>
        </div>
    );
}


