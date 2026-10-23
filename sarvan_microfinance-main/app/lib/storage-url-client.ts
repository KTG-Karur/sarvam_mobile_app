'use client';

import { tokenStorage } from '@/app/lib/token-storage';

/**
 * Client-side resolution of a stored document reference into something the
 * browser can actually load. The GCS bucket is private, so every `fileUrl` /
 * `documentUrl` / `photoUrl` / etc. column now holds a bare GCS object key —
 * this exchanges that key for a short-lived (1 hour) signed URL via
 * GET /api/storage/signed-url. Legacy pre-migration Supabase records still
 * hold a full https:// URL and are returned unchanged.
 *
 * Results are cached in-memory (per browser tab) for slightly under the
 * server's 1-hour signed URL lifetime, so re-rendering the same document in
 * a list/table doesn't re-request a URL for every row on every render.
 */

const CACHE_TTL_MS = 50 * 60 * 1000; // stay safely under the 1hr signed URL expiry
const cache = new Map<string, { url: string; expiresAt: number }>();
const inFlight = new Map<string, Promise<string>>();

export function isViewableUrl(value: string | null | undefined): value is string {
    return !!value && /^https?:\/\//i.test(value);
}

export async function resolveStorageUrl(rawValue: string | null | undefined): Promise<string> {
    if (!rawValue) return '';
    if (isViewableUrl(rawValue)) return rawValue; // legacy Supabase URL, already viewable

    const cached = cache.get(rawValue);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const existing = inFlight.get(rawValue);
    if (existing) return existing;

    const promise = (async () => {
        try {
            const token = tokenStorage.getAccessToken();
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const response = await fetch(`/api/storage/signed-url?key=${encodeURIComponent(rawValue)}`, { headers });
            if (!response.ok) return '';

            const result = await response.json();
            const url = result?.data?.url || '';
            if (url) cache.set(rawValue, { url, expiresAt: Date.now() + CACHE_TTL_MS });
            return url;
        } catch {
            return '';
        } finally {
            inFlight.delete(rawValue);
        }
    })();

    inFlight.set(rawValue, promise);
    return promise;
}

/** Resolves several stored references at once (e.g. before building a print template). */
export async function resolveStorageUrls(rawValues: Array<string | null | undefined>): Promise<Map<string, string>> {
    const unique = Array.from(new Set(rawValues.filter((v): v is string => !!v)));
    const resolved = await Promise.all(unique.map((v) => resolveStorageUrl(v)));
    const map = new Map<string, string>();
    unique.forEach((key, i) => map.set(key, resolved[i]));
    return map;
}

/** Resolves a stored reference and triggers a browser download/save-as. */
export async function downloadStorageFile(rawValue: string | null | undefined, filename: string): Promise<boolean> {
    const url = await resolveStorageUrl(rawValue);
    if (!url) return false;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    return true;
}
