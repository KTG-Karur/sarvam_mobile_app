'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { tokenStorage } from '@/app/lib/token-storage';
import { resolveStorageUrl } from '@/app/lib/storage-url-client';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface UploadedFile {
    /** Display file name */
    fileName: string;
    /**
     * Storable value returned from the upload endpoint. The storage bucket is
     * private, so for GCS-backed uploads this is a bare object key, not a
     * viewable URL — never render this directly, use `previewUrl` instead.
     * (Legacy pre-migration records may still hold a real https:// URL here.)
     */
    fileUrl: string;
    /** File size in bytes */
    fileSize: number;
    /** MIME type */
    mimeType: string;
    /** The document type key, e.g. "client_photo" */
    documentType: string;
    /** Short-lived signed URL safe to render in <img>/<Image>. Resolved client-side from fileUrl. */
    previewUrl?: string;
}


export type UploadStatus = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

export interface FileUploadState {
    /** Current upload status */
    status: UploadStatus;
    /** Upload progress percentage (0-100).  */
    progress: number;
    /** Error message if status === 'error' */
    error: string | null;
    /** The uploaded file info once successful */
    file: UploadedFile | null;
}

export interface UseFileUploadOptions {
    /** API endpoint to POST the file to. Defaults to '/api/kyc/aadhaar/upload'. */
    uploadEndpoint?: string;
    /** Maximum file size in bytes. Defaults to 5 MB */
    maxSizeBytes?: number;
    /** Allowed MIME types. If empty, all types are accepted. */
    allowedTypes?: string[];
    /** A unique client identifier used for storage path construction */
    clientIdentifier?: string;
    /** Whether this upload happens during enrollment (pre-client creation) */
    isEnrollment?: boolean;
    /** Additional form fields to append to the upload request */
    extraFormFields?: Record<string, string>;
    /** Called after a successful upload */
    onSuccess?: (file: UploadedFile) => void;
    /** Called on upload error */
    onError?: (error: string) => void;
    /**
     * Hydrates the hook with an already-uploaded file (e.g. when a step remounts).
     * When set, the hook will expose `status: "success"` and show the file in UI.
     */
    initialFile?: UploadedFile | null;
}

// ────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────

/**
 * Reusable file-upload hook.
 *
 * Encapsulates: client-side validation → upload → replace → delete
 * and exposes granular upload state so UI components can show
 * progress, errors, and success in a consistent way.
 */
export function useFileUpload(options: UseFileUploadOptions = {}) {
    const {
        uploadEndpoint = '/api/kyc/aadhaar/upload',
        maxSizeBytes = 5 * 1024 * 1024, // 5 MB
        allowedTypes = [],
        clientIdentifier = 'pending-client',
        isEnrollment = true,
        extraFormFields = {},
        onSuccess,
        onError,
        initialFile = null,
    } = options;

    const [state, setState] = useState<FileUploadState>({
        status: initialFile?.fileUrl ? 'success' : 'idle',
        progress: initialFile?.fileUrl ? 100 : 0,
        error: null,
        file: initialFile?.fileUrl ? initialFile : null,
    });

    // Abort controller so we can cancel in-flight requests
    const abortRef = useRef<AbortController | null>(null);

    // Keep internal state in sync with parent-provided initial file.
    // This is critical for multi-step forms where step components unmount/remount.
    useEffect(() => {
        setState((s) => {
            const isBusy = s.status === 'uploading' || s.status === 'validating';
            if (isBusy) return s;

            const nextHasFile = Boolean(initialFile?.fileUrl);
            const currentUrl = s.file?.fileUrl ?? null;
            const nextUrl = initialFile?.fileUrl ?? null;

            if (nextHasFile && nextUrl && nextUrl !== currentUrl) {
                return { status: 'success', progress: 100, error: null, file: initialFile };
            }

            if (!nextHasFile && s.file) {
                return { status: 'idle', progress: 0, error: null, file: null };
            }

            return s;
        });
    }, [initialFile]);

    // Resolve a viewable preview URL whenever the current file lacks one
    // (fresh upload, or hydrated from an `initialFile` that only carries the raw key).
    useEffect(() => {
        const currentFile = state.file;
        if (!currentFile || currentFile.previewUrl || !currentFile.fileUrl) return;

        let cancelled = false;
        resolveStorageUrl(currentFile.fileUrl).then((previewUrl) => {
            if (cancelled || !previewUrl) return;
            setState((s) => {
                if (!s.file || s.file.fileUrl !== currentFile.fileUrl || s.file.previewUrl) return s;
                return { ...s, file: { ...s.file, previewUrl } };
            });
        });

        return () => {
            cancelled = true;
        };
    }, [state.file]);

    // ── Client-side validation ──────────────────────────────────
    const validateFile = useCallback(
        (file: File): string | null => {
            // Size check
            if (file.size > maxSizeBytes) {
                const maxMB = (maxSizeBytes / (1024 * 1024)).toFixed(1);
                return `File too large. Maximum size is ${maxMB} MB.`;
            }

            // Type check
            if (allowedTypes.length > 0) {
                const isAllowed = allowedTypes.some((type) => {
                    if (type.endsWith('/*')) {
                        // e.g. "image/*"
                        return file.type.startsWith(type.replace('/*', '/'));
                    }
                    return file.type === type;
                });

                if (!isAllowed) {
                    return `Invalid file type "${file.type}". Allowed: ${allowedTypes.join(', ')}`;
                }
            }

            // Empty file check
            if (file.size === 0) {
                return 'File is empty. Please select a valid file.';
            }

            return null; // valid
        },
        [maxSizeBytes, allowedTypes],
    );

    // ── Upload ──────────────────────────────────────────────────
    const upload = useCallback(
        async (file: File, documentType: string): Promise<UploadedFile | null> => {
            // 1. Validate
            setState((s) => ({ ...s, status: 'validating', error: null, progress: 0 }));

            const validationError = validateFile(file);
            if (validationError) {
                setState((s) => ({ ...s, status: 'error', error: validationError }));
                onError?.(validationError);
                return null;
            }

            // 2. Upload
            setState((s) => ({ ...s, status: 'uploading', progress: 10 }));

            const controller = new AbortController();
            abortRef.current = controller;

            try {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('documentType', documentType);
                formData.append('clientId', clientIdentifier);
                if (isEnrollment) {
                    formData.append('isEnrollment', 'true');
                }
                for (const [key, value] of Object.entries(extraFormFields)) {
                    if (typeof value === 'string' && value.trim()) {
                        formData.append(key, value);
                    }
                }

                // Set progress to simulate mid-upload (real progress requires XHR)
                setState((s) => ({ ...s, progress: 40 }));

                const token = tokenStorage.getAccessToken();
                const headers: Record<string, string> = {};
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }

                const response = await fetch(uploadEndpoint, {
                    method: 'POST',
                    headers,
                    body: formData,
                    signal: controller.signal,
                });

                setState((s) => ({ ...s, progress: 80 }));

                if (!response.ok) {
                    const errorBody = await response.json().catch(() => null);
                    const message =
                        errorBody?.message ||
                        errorBody?.error ||
                        `Upload failed (HTTP ${response.status})`;
                    throw new Error(message);
                }

                const result = await response.json();
                if (!result?.success) {
                    throw new Error(result?.message || result?.error || 'Upload failed');
                }

                const data = result.data as {
                    fileUrl: string;
                    fileName: string;
                    fileSize?: number;
                    mimeType?: string;
                    documentType?: string;
                };

                const uploadedFile: UploadedFile = {
                    fileName: data.fileName || file.name,
                    fileUrl: data.fileUrl || '',
                    fileSize: data.fileSize || file.size,
                    mimeType: data.mimeType || file.type,
                    documentType: data.documentType || documentType,
                };

                setState({
                    status: 'success',
                    progress: 100,
                    error: null,
                    file: uploadedFile,
                });

                onSuccess?.(uploadedFile);
                return uploadedFile;
            } catch (err: unknown) {
                if ((err as Error).name === 'AbortError') {
                    setState((s) => ({ ...s, status: 'idle', progress: 0, error: null }));
                    return null;
                }

                const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
                setState((s) => ({ ...s, status: 'error', error: message, progress: 0 }));
                onError?.(message);
                return null;
            } finally {
                abortRef.current = null;
            }
        },
        [uploadEndpoint, clientIdentifier, isEnrollment, extraFormFields, validateFile, onSuccess, onError],
    );

    // ── Replace (delete old + upload new) ───────────────────────
    const replace = useCallback(
        async (file: File, documentType: string): Promise<UploadedFile | null> => {
            // If there's an existing file, we could delete it first,
            // but the server-side handles orphaned files & the new upload
            // replaces the reference. This keeps it simple.
            setState({ status: 'idle', progress: 0, error: null, file: null });
            return upload(file, documentType);
        },
        [upload],
    );

    // ── Remove (client-side only — clears state) ────────────────
    const remove = useCallback(() => {
        setState({ status: 'idle', progress: 0, error: null, file: null });
    }, []);

    // ── Cancel in-flight upload ─────────────────────────────────
    const cancel = useCallback(() => {
        abortRef.current?.abort();
        setState({ status: 'idle', progress: 0, error: null, file: null });
    }, []);

    // ── Reset to pristine state ─────────────────────────────────
    const reset = useCallback(() => {
        abortRef.current?.abort();
        setState({ status: 'idle', progress: 0, error: null, file: null });
    }, []);

    return {
        /** Current upload state */
        ...state,
        /** Upload a file */
        upload,
        /** Replace the current file */
        replace,
        /** Remove the current file reference (client-side) */
        remove,
        /** Cancel an in-flight upload */
        cancel,
        /** Reset to pristine state */
        reset,
        /** Client-side validate without uploading */
        validateFile,
    };
}
