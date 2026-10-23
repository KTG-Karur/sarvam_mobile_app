'use client';

/**
 * useImageCompression.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * React hook that wraps the `compressImage` utility with full state management.
 *
 * Usage:
 *   const { compress, compressing, result, error, reset } =
 *     useImageCompression('client_photo');
 *
 *   // Call compress() when a file is selected; await the returned file.
 *   const ready = await compress(rawFile);
 *   if (ready) uploadFile(ready);   // already compressed
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useCallback, useRef } from 'react';
import {
  compressImage,
  type CompressionResult,
} from '@/app/lib/image-compress';

// ─── Hook state ───────────────────────────────────────────────────────────────

export interface UseImageCompressionState {
  /** True while compression is running. */
  compressing: boolean;
  /** Last successful compression result (null until first run). */
  result: CompressionResult | null;
  /** Error message if compression threw. */
  error: string | null;
}

export interface UseImageCompressionReturn extends UseImageCompressionState {
  /**
   * Compress `file` for the given document type.
   * Returns the compressed `File` on success, or `null` on error.
   * Also updates `result` and `error` state.
   */
  compress: (file: File) => Promise<File | null>;
  /**
   * Clear all state (call on unmount or when the field is reset).
   * Automatically revokes the cached preview Object-URL.
   */
  reset: () => void;
}

// ─── Hook implementation ──────────────────────────────────────────────────────

/**
 * @param documentType  KYC document type key, e.g. "client_photo", "aadhaar_front".
 *                      Determines which compression preset is applied.
 */
export function useImageCompression(documentType: string): UseImageCompressionReturn {
  const [state, setState] = useState<UseImageCompressionState>({
    compressing: false,
    result: null,
    error: null,
  });

  // Keep a ref to the previous preview URL so we can revoke it before setting a new one.
  const prevPreviewUrlRef = useRef<string | null>(null);

  const compress = useCallback(
    async (file: File): Promise<File | null> => {
      // Revoke previous Object-URL to avoid memory leak.
      if (prevPreviewUrlRef.current) {
        URL.revokeObjectURL(prevPreviewUrlRef.current);
        prevPreviewUrlRef.current = null;
      }

      setState({ compressing: true, result: null, error: null });

      try {
        const result = await compressImage(file, documentType);
        prevPreviewUrlRef.current = result.previewUrl;
        setState({ compressing: false, result, error: null });
        return result.compressedFile;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Image compression failed.';
        setState({ compressing: false, result: null, error: message });
        return null;
      }
    },
    [documentType],
  );

  const reset = useCallback(() => {
    if (prevPreviewUrlRef.current) {
      URL.revokeObjectURL(prevPreviewUrlRef.current);
      prevPreviewUrlRef.current = null;
    }
    setState({ compressing: false, result: null, error: null });
  }, []);

  return { ...state, compress, reset };
}
