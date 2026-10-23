'use client';

import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Camera,
  Clipboard,
  ImageDown,
  ZapOff,
  FileText,
  Image as ImagePlaceholderIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useFileUpload, type UploadedFile, type UploadStatus } from '@/hooks/useFileUpload';
import { resolveKycUploadCategory, resolveKycUploadOwner } from '@/app/lib/kyc-document-types';
import { CameraCapture } from '@/components/ui/CameraCapture';
import { useImageCompression } from '@/hooks/useImageCompression';
import { StorageImage } from '@/components/storage/StorageMedia';
import { ImageViewerDialog, type ImageViewerTarget } from '@/components/ui/ImageViewerDialog';

export type DocumentFieldOutput = {
  documentType: string;
  documentNumber: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  status: 'pending' | 'uploaded';
};

type Props = {
  label: string;
  documentType: string;
  owner?: 'client' | 'nominee' | 'coApplicant';
  accept: string;
  clientIdentifier: string;
  /**
   * Previously uploaded value for this documentType.
   * Used to re-hydrate UI when step components remount.
   */
  initialOutput?: DocumentFieldOutput;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  uploadEndpoint?: string;
  onOutputChange?: (output: DocumentFieldOutput) => void;
  inputError?: string;
};

function acceptToAllowedTypes(accept: string): string[] {
  return accept
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Short uppercase extension (e.g. "PDF") shown on the tile for non-image uploads. */
function fileExtensionLabel(fileName: string): string {
  const ext = fileName.split('.').pop();
  return ext && ext !== fileName ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

/**
 * Best-effort mimeType guess from a file name/URL extension — used only as a
 * fallback for restored/prefilled documents whose real mimeType wasn't
 * plumbed through (e.g. an older KYC row, or an API route that forgot to
 * select it). Without this, `initialFile.mimeType` falls back to
 * 'application/octet-stream' and the preview tile renders a generic
 * FileText+extension icon instead of the actual photo, even for a plain JPG.
 */
function guessMimeTypeFromName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS[ext] ?? null : null;
}

function buildOutput(args: {
  documentType: string;
  documentNumber: string | null;
  file: UploadedFile | null;
}): DocumentFieldOutput {
  return {
    documentType: args.documentType,
    documentNumber: args.documentNumber,
    fileUrl: args.file?.fileUrl ?? null,
    fileName: args.file?.fileName ?? null,
    fileSize: args.file?.fileSize ?? null,
    mimeType: args.file?.mimeType ?? null,
    status: args.file?.fileUrl ? 'uploaded' : 'pending',
  };
}

/** Small circular action button used for the Upload / Camera / Paste row under each tile. */
function TileActionButton({
  icon,
  title,
  onClick,
  disabled,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
        'border-primary/30 bg-brand-green-tint/60 text-sidebar-accent hover:bg-brand-green-tint',
        'dark:border-sidebar-accent/40 dark:bg-brand-green-darker/30 dark:text-emerald-300 dark:hover:bg-brand-green-darker/50',
        active && 'border-green-400 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {icon}
    </button>
  );
}

export function DocumentInputWithUpload({
  label,
  documentType,
  owner,
  accept,
  clientIdentifier,
  initialOutput,
  value,
  onChange,
  placeholder,
  maxLength,
  required = false,
  disabled = false,
  readOnly = false,
  uploadEndpoint = '/api/kyc/aadhaar/upload',
  onOutputChange,
  inputError,
}: Props) {
  const { toast } = useToast();
  const reactId = useId();
  const inputId = `${reactId}-${documentType}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewerTarget, setViewerTarget] = useState<ImageViewerTarget | null>(null);

  const allowedTypes = useMemo(() => acceptToAllowedTypes(accept), [accept]);

  // Show camera/paste actions only when this field accepts image files
  const isImageAccept = useMemo(
    () => allowedTypes.some((t) => t.startsWith('image/')),
    [allowedTypes],
  );

  const derivedOwner = useMemo(
    () => resolveKycUploadOwner({ documentType, explicitOwner: owner }),
    [documentType, owner],
  );

  const category = useMemo(
    () => resolveKycUploadCategory({ documentType, owner: derivedOwner }),
    [derivedOwner, documentType],
  );

  const initialFile = useMemo((): UploadedFile | null => {
    if (!initialOutput?.fileUrl) return null;
    const fileName = initialOutput.fileName ?? 'Uploaded file';
    return {
      documentType,
      fileUrl: initialOutput.fileUrl,
      fileName,
      fileSize: initialOutput.fileSize ?? 0,
      mimeType: initialOutput.mimeType
        ?? guessMimeTypeFromName(fileName)
        ?? guessMimeTypeFromName(initialOutput.fileUrl)
        ?? 'application/octet-stream',
    };
  }, [documentType, initialOutput?.fileName, initialOutput?.fileSize, initialOutput?.fileUrl, initialOutput?.mimeType]);

  // ── Image compression hook ────────────────────────────────────────────────
  const imageCompression = useImageCompression(documentType);

  // ── File upload hook ──────────────────────────────────────────────────────
  const upload = useFileUpload({
    uploadEndpoint,
    allowedTypes,
    clientIdentifier,
    isEnrollment: true,
    initialFile,
    extraFormFields: {
      owner: derivedOwner,
      category,
    },
    onSuccess: (file) => {
      onOutputChange?.(
        buildOutput({
          documentType,
          documentNumber: value?.trim() ? value.trim() : null,
          file,
        }),
      );
    },
    onError: () => {
      onOutputChange?.(
        buildOutput({
          documentType,
          documentNumber: value?.trim() ? value.trim() : null,
          file: null,
        }),
      );
    },
  });

  const isCompressing = imageCompression.compressing;
  const isUploading = upload.status === 'uploading' || upload.status === 'validating';
  const isBusy = isCompressing || isUploading;
  const isSuccess = upload.status === 'success' && Boolean(upload.file?.fileUrl);
  const isError = upload.status === 'error' || Boolean(inputError);
  const isImageFile = isSuccess && !!upload.file?.mimeType.startsWith('image/');

  const canPickFile = !disabled && !isBusy;

  const triggerPicker = useCallback(() => {
    if (!canPickFile) return;
    fileInputRef.current?.click();
  }, [canPickFile]);

  // ── Core upload flow ──────────────────────────────────────────────────────
  const doUpload = useCallback(
    async (raw: File) => {
      // 1. Compress (always — even for images within size limit so we get stats)
      const compressed = raw.type.startsWith('image/')
        ? await imageCompression.compress(raw)
        : raw;

      if (!compressed) return; // compression failed; error already set in hook

      // 2. Upload the compressed file
      if (isSuccess) {
        void upload.replace(compressed, documentType);
      } else {
        void upload.upload(compressed, documentType);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documentType, isSuccess, upload, imageCompression.compress],
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.files?.[0];
      if (!raw) return;
      void doUpload(raw);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [doUpload],
  );

  const onCameraCapture = useCallback(
    (file: File) => {
      void doUpload(file);
    },
    [doUpload],
  );

  const onRemove = useCallback(
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      upload.remove();
      imageCompression.reset();
      onOutputChange?.(
        buildOutput({
          documentType,
          documentNumber: value?.trim() ? value.trim() : null,
          file: null,
        }),
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [documentType, imageCompression, onOutputChange, upload, value],
  );

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const file = new File([blob], `pasted_photo_${Date.now()}.png`, { type: imageType });
          void doUpload(file);
          return;
        }
      }
      toast({
        title: 'No image found',
        description: 'Clipboard does not contain an image. Copy an image first.',
        variant: 'destructive',
      });
    } catch {
      toast({
        title: 'Paste failed',
        description: 'Could not access clipboard. Please allow clipboard permission or use Ctrl+V.',
        variant: 'destructive',
      });
    }
  }, [doUpload, toast]);

  const onNumberChange = useCallback(
    (next: string) => {
      onChange?.(next);
      onOutputChange?.(
        buildOutput({
          documentType,
          documentNumber: next.trim() ? next.trim() : null,
          file: upload.file,
        }),
      );
    },
    [documentType, onChange, onOutputChange, upload.file],
  );

  const showNumberInput = typeof value === 'string' && typeof onChange === 'function';

  // ── Compression stats panel ───────────────────────────────────────────────
  const compressionStats = imageCompression.result;
  const showStats =
    !isCompressing &&
    compressionStats !== null &&
    compressionStats.wasCompressed;

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-brand-green-darker/10',
        isError ? 'border-red-300 dark:border-red-800' : 'border-primary/20 dark:border-sidebar-accent/30',
      )}
      id={documentType}
    >
      {/* ── Preview tile ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          'relative flex aspect-[4/3] items-center justify-center bg-brand-green-tint/50 dark:bg-brand-green-darker/30',
          isImageFile && upload.file && 'cursor-pointer',
        )}
        onClick={() => {
          if (!isImageFile || !upload.file) return;
          setViewerTarget({ src: upload.file.fileUrl, alt: label, title: label });
        }}
      >
        {isSuccess && upload.file ? (
          isImageFile ? (
            <StorageImage src={upload.file.fileUrl} alt={label} className="h-full w-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1.5 text-sidebar-accent dark:text-emerald-300">
              <FileText className="h-10 w-10" />
              <span className="text-[10px] font-semibold tracking-wide">{fileExtensionLabel(upload.file.fileName)}</span>
            </div>
          )
        ) : (
          <ImagePlaceholderIcon className="h-12 w-12 text-primary/30 dark:text-emerald-400/30" />
        )}

        {isSuccess && (
          <button
            type="button"
            title="Remove"
            aria-label="Remove document"
            onClick={onRemove}
            disabled={disabled || isBusy}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white shadow-lg ring-2 ring-white hover:bg-red-700 disabled:opacity-50 dark:ring-brand-green-darker"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}

        {isSuccess && (
          <div className="absolute left-1.5 top-1.5 rounded-full bg-emerald-500 p-0.5 text-white shadow">
            <CheckCircle2 className="h-3 w-3" />
          </div>
        )}

        {isBusy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-[10px]">
              {isCompressing ? 'Optimising…' : upload.status === 'validating' ? 'Validating…' : `Uploading… ${upload.progress}%`}
            </span>
          </div>
        )}
      </div>

      {/* ── Label + actions ───────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Label
          htmlFor={showNumberInput ? inputId : undefined}
          className="text-xs font-semibold leading-snug text-foreground dark:text-slate-200"
        >
          {label} {required && <span className="text-red-500">*</span>}
        </Label>

        {showNumberInput && (
          <Input
            id={inputId}
            value={value}
            onChange={(e) => onNumberChange(e.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            disabled={disabled}
            readOnly={readOnly}
            className={cn('h-8 text-xs', inputError && 'border-red-500 focus-visible:ring-red-500')}
          />
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          <TileActionButton
            icon={<Upload className="h-4 w-4" />}
            title={isSuccess ? `Replace ${label} — Upload` : `Upload ${label}`}
            onClick={triggerPicker}
            disabled={!canPickFile}
          />
          {isImageAccept && (
            <TileActionButton
              icon={<Camera className="h-4 w-4" />}
              title={isSuccess ? `Replace ${label} — Camera` : `Take photo for ${label}`}
              onClick={() => setCameraOpen(true)}
              disabled={!canPickFile}
            />
          )}
          {isImageAccept && (
            <TileActionButton
              icon={<Clipboard className="h-4 w-4" />}
              title={isSuccess ? `Replace ${label} — Paste` : `Paste image for ${label}`}
              onClick={handlePasteFromClipboard}
              disabled={!canPickFile}
            />
          )}
        </div>

        <Input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          disabled={!canPickFile}
          onChange={onFileChange}
          aria-label={`Upload ${label}`}
        />

        {/* ── Compression stats badge ───────────────────────────────────── */}
        {showStats && compressionStats && (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] text-blue-800">
            <div className="mb-0.5 flex items-center gap-1 font-semibold">
              <ImageDown className="h-3 w-3 shrink-0" />
              Optimised — saved {compressionStats.reductionPercent}%
            </div>
          </div>
        )}

        {/* ── Compression error ─────────────────────────────────────────── */}
        {imageCompression.error && !isCompressing && (
          <p className="flex items-center gap-1 text-[10px] text-amber-600">
            <ZapOff className="h-3 w-3 shrink-0" />
            {imageCompression.error} — using original.
          </p>
        )}

        {/* ── Upload / validation error ─────────────────────────────────── */}
        {(upload.status === 'error' || inputError) && (
          <p className="flex items-center gap-1 text-[10px] text-red-500">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {inputError || upload.error || 'Upload failed'}
          </p>
        )}
      </div>

      {/* Camera dialog */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={onCameraCapture}
        label={label}
      />

      <ImageViewerDialog target={viewerTarget} onClose={() => setViewerTarget(null)} />
    </div>
  );
}
