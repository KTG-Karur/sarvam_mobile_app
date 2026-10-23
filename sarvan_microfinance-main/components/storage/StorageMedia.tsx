'use client';

import React from 'react';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { cn } from '@/lib/utils';

/**
 * Drop-in replacements for rendering a stored document reference (`fileUrl`,
 * `documentUrl`, `photoUrl`, etc.) that may be a bare GCS object key (private
 * bucket — needs a signed URL) or a legacy Supabase https:// URL (already
 * viewable). Each component resolves internally via `useSignedUrl`, so they
 * are safe to use inside `.map()` — each rendered item gets its own hook call.
 */

type StorageImageProps = {
    src: string | null | undefined;
    alt: string;
    className?: string;
    /** Position absolute + fill parent, like next/image's `fill` prop. Caller still controls object-fit via className. */
    fill?: boolean;
    onClick?: () => void;
};

export function StorageImage({ src, alt, className, fill = false, onClick }: StorageImageProps) {
    const resolvedUrl = useSignedUrl(src);

    if (!resolvedUrl) {
        return <div className={cn(fill && 'absolute inset-0 h-full w-full', 'animate-pulse bg-muted', className)} />;
    }

    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={resolvedUrl}
            alt={alt}
            className={cn(fill && 'absolute inset-0 h-full w-full', className)}
            onClick={onClick}
        />
    );
}

type StorageLinkProps = {
    href: string | null | undefined;
    children: React.ReactNode;
    className?: string;
    title?: string;
};

/** An `<a target="_blank">` that only becomes clickable once the signed URL is resolved. */
export function StorageLink({ href, children, className, title }: StorageLinkProps) {
    const resolvedUrl = useSignedUrl(href);

    return (
        <a
            href={resolvedUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(!resolvedUrl && 'pointer-events-none opacity-60', className)}
            aria-disabled={!resolvedUrl}
            title={title}
        >
            {children}
        </a>
    );
}

type StorageIframeProps = {
    src: string | null | undefined;
    title: string;
    className?: string;
};

export function StorageIframe({ src, title, className }: StorageIframeProps) {
    const resolvedUrl = useSignedUrl(src);

    if (!resolvedUrl) {
        return <div className={cn('flex items-center justify-center bg-muted text-xs text-muted-foreground', className)}>Loading…</div>;
    }

    return <iframe src={resolvedUrl} title={title} className={className} />;
}
