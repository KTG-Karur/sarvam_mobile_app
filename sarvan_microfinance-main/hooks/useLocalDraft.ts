'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'sarvam:local-draft:';

type StoredDraft<T> = { data: T; savedAt: number };

/**
 * Best-effort localStorage backup for in-progress form data, independent of
 * network/server state. Debounces writes, survives tab close/reload/offline,
 * and is meant to be cleared once the data is safely persisted server-side.
 */
export function useLocalDraft<T>(key: string, debounceMs = 600) {
    const storageKey = `${PREFIX}${key}`;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

    useEffect(() => {
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    const save = useCallback((data: T) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            try {
                const savedAt = Date.now();
                localStorage.setItem(storageKey, JSON.stringify({ data, savedAt } satisfies StoredDraft<T>));
                setLastSavedAt(savedAt);
            } catch {
                // Storage full/unavailable (private browsing etc.) — autosave is best-effort only.
            }
        }, debounceMs);
    }, [storageKey, debounceMs]);

    const load = useCallback((): StoredDraft<T> | null => {
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? (JSON.parse(raw) as StoredDraft<T>) : null;
        } catch {
            return null;
        }
    }, [storageKey]);

    const clear = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
        setLastSavedAt(null);
    }, [storageKey]);

    return { save, load, clear, isOnline, lastSavedAt };
}
