'use client';

import { useEffect, useState } from 'react';
import { resolveStorageUrl } from '@/app/lib/storage-url-client';

/**
 * Reactively resolves a stored document reference (GCS key or legacy Supabase
 * URL) into a viewable URL. Returns null until resolved. Safe to call inside
 * a list-item component (one hook instance per rendered item) — do not call
 * this directly inside a `.map()` callback that isn't itself a component.
 */
export function useSignedUrl(rawValue: string | null | undefined): string | null {
    // Reset synchronously during render when the input changes (React's
    // recommended "adjusting state on prop change" pattern) rather than
    // inside the effect below, which avoids a same-tick cascading setState.
    const [trackedValue, setTrackedValue] = useState(rawValue);
    const [url, setUrl] = useState<string | null>(null);

    if (rawValue !== trackedValue) {
        setTrackedValue(rawValue);
        setUrl(null);
    }

    useEffect(() => {
        if (!rawValue) return;

        let cancelled = false;
        resolveStorageUrl(rawValue).then((resolved) => {
            if (!cancelled) setUrl(resolved || null);
        });

        return () => {
            cancelled = true;
        };
    }, [rawValue]);

    return rawValue ? url : null;
}
