'use client';

import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { ImageViewerDialog, type ImageViewerTarget } from '@/components/ui/ImageViewerDialog';

export interface BelongingProof {
    id: string;
    fileKey: string;
    fileName: string;
    mimeType: string;
}

// The bucket is private — every view goes through a short-lived signed URL.
async function signedUrl(fileKey: string): Promise<string | null> {
    const res = await apiClient.get<{ url: string }>(`/storage/signed-url?key=${encodeURIComponent(fileKey)}`);
    return res.success && res.data?.url ? res.data.url : null;
}

function PhotoThumb({ proof, index, onOpen }: { proof: BelongingProof; index: number; onOpen: (url: string) => void }) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        signedUrl(proof.fileKey).then((u) => { if (!cancelled) setUrl(u); }).catch(() => {});
        return () => { cancelled = true; };
    }, [proof.fileKey]);

    return (
        <button
            type="button"
            onClick={() => url && onOpen(url)}
            title={`Return photo ${index + 1}`}
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border bg-white transition hover:border-primary dark:bg-slate-900"
        >
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, expiring GCS URL; next/image can't optimise it
                <img src={url} alt={`Return photo ${index + 1}`} className="h-full w-full object-cover" />
            ) : (
                <ImageIcon className="h-5 w-5 text-slate-300" />
            )}
        </button>
    );
}

export function BelongingProofList({ proofs, emptyText = 'No photos' }: { proofs: BelongingProof[]; emptyText?: string }) {
    const [viewer, setViewer] = useState<ImageViewerTarget | null>(null);

    if (proofs.length === 0) return <p className="text-xs italic text-slate-400">{emptyText}</p>;

    return (
        <>
            <div className="flex flex-wrap gap-2">
                {proofs.map((p, i) => (
                    <PhotoThumb
                        key={p.id}
                        proof={p}
                        index={i}
                        onOpen={(src) => setViewer({ src, alt: `Return photo ${i + 1}`, title: `Return photo ${i + 1}` })}
                    />
                ))}
            </div>
            <ImageViewerDialog target={viewer} onClose={() => setViewer(null)} />
        </>
    );
}
