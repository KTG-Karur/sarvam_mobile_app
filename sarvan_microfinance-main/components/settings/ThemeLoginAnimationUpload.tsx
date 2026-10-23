'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { validateAnimationManifest } from '@/components/auth/login-animations/validateManifest';
import { DeclarativeAnimationRunner } from '@/components/auth/login-animations/DeclarativeAnimationRunner';
import { SarvamLoginTransition } from '@/components/SarvamLoginTransition';
import type { AnimationManifest } from '@/components/auth/login-animations/types';
import {
  Upload,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  X,
  FileJson,
} from 'lucide-react';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

interface CustomAnimationDetailsResponse {
  id: string;
  key: string;
  name: string;
  version: string;
  themePresetId: string;
  durationMs: number;
  reducedMotionDurationMs: number;
  canvas: {
    width: number;
    height: number;
    background?: string;
  };
  layerCount: number;
  manifest: AnimationManifest;
}

interface ThemeLoginAnimationUploadProps {
  presetId: string | null;
  loginAnimationKey: string | null;
  onKeyChange: (key: string | null) => void;
  /** Only the Sarvam theme ships the built-in Sarvam animation — other themes (e.g. K3) must upload their own. */
  isSarvamTheme?: boolean;
}

export function ThemeLoginAnimationUpload({
  presetId,
  loginAnimationKey,
  onKeyChange,
  isSarvamTheme = false,
}: ThemeLoginAnimationUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(Boolean(presetId));
  const [animation, setAnimation] = useState<CustomAnimationDetailsResponse | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // File staging & validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [stagedManifest, setStagedManifest] = useState<AnimationManifest | null>(null);

  // Preview state
  const [previewManifest, setPreviewManifest] = useState<AnimationManifest | null>(null);
  const [previewSarvam, setPreviewSarvam] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    if (!presetId) {
      setIsLoading(false);
      setAnimation(null);
      return;
    }

    setIsLoading(true);
    apiClient
      .get<CustomAnimationDetailsResponse>(
        `/settings/brand/presets/${encodeURIComponent(presetId)}/login-animation`
      )
      .then((res) => {
        if (res.success && res.data) {
          setAnimation(res.data);
        } else {
          setAnimation(null);
        }
      })
      .catch((err) => {
        console.error('Failed to load theme animation:', err);
        setAnimation(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [presetId]);

  function triggerFileSelect() {
    setValidationErrors([]);
    setStagedManifest(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.json')) {
      setValidationErrors([
        'Invalid file type. Only declarative JSON animation files (.json) are permitted.',
      ]);
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setValidationErrors([
        `File size (${(file.size / 1024 / 1024).toFixed(2)} MB) exceeds the allowable limit of 2 MB.`,
      ]);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const raw = event.target?.result;
        if (typeof raw !== 'string' || !raw.trim()) {
          setValidationErrors(['The selected file is empty.']);
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (jsonErr: any) {
          setValidationErrors([`Invalid JSON syntax: ${jsonErr.message || 'Parse error'}`]);
          return;
        }

        const validation = validateAnimationManifest(parsed);
        if (!validation.success || !validation.data) {
          setValidationErrors(validation.issues || [validation.error || 'Validation failed']);
          return;
        }

        setValidationErrors([]);
        setStagedManifest(validation.data);
        await performUpload(validation.data);
      } catch (err: any) {
        setValidationErrors([`File read error: ${err.message || 'Unknown error'}`]);
      }
    };

    reader.onerror = () => {
      setValidationErrors(['Failed to read file from disk.']);
    };

    reader.readAsText(file);
  }

  async function performUpload(manifest: AnimationManifest) {
    if (!presetId) {
      toast({
        title: 'Theme not saved',
        description: 'Please save this theme before uploading an animation.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    try {
      const res = await apiClient.post<CustomAnimationDetailsResponse>(
        `/settings/brand/presets/${encodeURIComponent(presetId)}/login-animation`,
        manifest
      );

      if (res.success && res.data) {
        setAnimation(res.data);
        onKeyChange(res.data.key);
        toast({
          title: 'Login Animation Uploaded',
          description: `Animation '${manifest.name}' is now linked exclusively to this theme.`,
        });
      } else {
        toast({
          title: 'Upload Failed',
          description: res.error || 'Failed to save animation',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Upload Error',
        description: err.message || 'An error occurred during upload',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      setStagedManifest(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleDeleteConfirm() {
    if (!presetId) return;

    setIsDeleting(true);
    try {
      const res = await apiClient.delete(
        `/settings/brand/presets/${encodeURIComponent(presetId)}/login-animation`
      );

      if (res.success) {
        setAnimation(null);
        onKeyChange(null);
        toast({
          title: 'Animation Removed',
          description: 'Custom login animation has been removed from this theme.',
        });
      } else {
        toast({
          title: 'Removal Failed',
          description: res.error || 'Failed to remove animation',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete animation',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }

  function handleEnableSarvam() {
    onKeyChange('sarvam');
    toast({
      title: 'Sarvam Animation Selected',
      description: 'Built-in Sarvam animation set for this theme. Click "Save Theme" to persist.',
    });
  }

  function handleDisableSarvam() {
    onKeyChange(null);
    toast({
      title: 'No Animation Selected',
      description: 'Login transition disabled for this theme. Click "Save Theme" to persist.',
    });
  }

  function handleOpenPreview() {
    if (animation?.manifest) {
      setPreviewManifest(animation.manifest);
      setPreviewSarvam(false);
      setPreviewKey((k) => k + 1);
    }
  }

  function handlePreviewSarvam() {
    setPreviewSarvam(true);
    setPreviewManifest(null);
    setPreviewKey((k) => k + 1);
  }

  // State A: Brand new preset not yet saved
  if (!presetId) {
    return (
      <div className="rounded-xl border border-dashed border-primary/30 dark:border-sidebar-accent p-4 text-xs text-muted-foreground bg-muted/20">
        Save this theme first to upload and manage its login animation.
      </div>
    );
  }

  // State B: Loading
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        Loading theme animation settings...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Validation alert if staged file was rejected */}
      {validationErrors.length > 0 && (
        <Alert variant="destructive" className="py-2.5">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-xs font-semibold">Invalid Animation File</AlertTitle>
          <AlertDescription className="text-xs mt-1 space-y-0.5">
            {validationErrors.map((err, idx) => (
              <p key={idx}>{err}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* State 1: Uploaded Custom Animation Exists */}
      {animation ? (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-foreground">
                Login animation uploaded
              </span>
            </div>
            <Badge variant="secondary" className="text-[11px] font-mono">
              {animation.key}
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border/50">
            <div>
              <span className="text-foreground font-medium">Animation:</span>{' '}
              {animation.name}
            </div>
            <div>
              <span className="text-foreground font-medium">Version:</span>{' '}
              {animation.version}
            </div>
            <div>
              <span className="text-foreground font-medium">Duration:</span>{' '}
              {animation.durationMs}ms
            </div>
            <div>
              <span className="text-foreground font-medium">Layers:</span>{' '}
              {animation.layerCount}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleOpenPreview}
              className="gap-1.5 text-xs h-8"
            >
              <Play className="h-3.5 w-3.5" />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={triggerFileSelect}
              disabled={isUploading}
              className="gap-1.5 text-xs h-8"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {isUploading ? 'Uploading…' : 'Replace Animation'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              disabled={isDeleting}
              className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </div>
        </div>
      ) : loginAnimationKey === 'sarvam' ? (
        /* State 2: Built-in Sarvam Animation Active */
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-sm font-semibold text-foreground">
                Built-in Sarvam animation active
              </span>
            </div>
            <Badge variant="secondary" className="text-[11px]">
              Built-in
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            Sarvam Charitable Trust corporate logo assembly and animated reveal lockup.
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePreviewSarvam}
              className="gap-1.5 text-xs h-8"
            >
              <Play className="h-3.5 w-3.5" />
              Preview
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={triggerFileSelect}
              disabled={isUploading}
              className="gap-1.5 text-xs h-8"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {isUploading ? 'Uploading…' : 'Upload Custom Animation'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDisableSarvam}
              className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Use No Animation
            </Button>
          </div>
        </div>
      ) : (
        /* State 3: No Animation Uploaded */
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-4 space-y-3">
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-foreground">Login Animation</p>
            <p className="text-xs text-muted-foreground">
              No animation uploaded for this theme.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              onClick={triggerFileSelect}
              disabled={isUploading}
              className="gap-1.5 text-xs h-8"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {isUploading ? 'Uploading…' : 'Upload Animation JSON'}
            </Button>
            {isSarvamTheme && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleEnableSarvam}
                className="gap-1.5 text-xs h-8 text-muted-foreground hover:text-foreground"
              >
                Use Built-in Sarvam Animation
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Preview Modal Dialog ── */}
      <Dialog
        open={Boolean(previewManifest || previewSarvam)}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewManifest(null);
            setPreviewSarvam(false);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-[95vw] xl:max-w-[1400px] max-h-[90vh] p-0 overflow-hidden bg-black/95 border-border flex flex-col"
        >
          <DialogHeader className="shrink-0 p-4 bg-card/80 border-b border-border flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-base font-semibold">
                Preview:{' '}
                {previewSarvam
                  ? 'Sarvam Charitable Trust'
                  : previewManifest?.name || 'Custom Animation'}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground font-mono">
                {previewSarvam
                  ? 'Built-in static animation • Duration: 1720ms'
                  : `Key: ${previewManifest?.id} • Duration: ${previewManifest?.durationMs}ms • Canvas: ${previewManifest?.canvas.width}×${previewManifest?.canvas.height}`}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPreviewKey((k) => k + 1)}
                className="h-7 text-xs gap-1"
              >
                <RotateCcw className="h-3 w-3" />
                Replay
              </Button>
              <DialogClose asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7 bg-slate-900 text-white border-slate-700 hover:bg-slate-800 hover:text-white"
                  aria-label="Close preview"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </DialogClose>
            </div>
          </DialogHeader>

          <div
            className="relative w-full flex-1 min-h-[450px] flex items-center justify-center bg-black/90 overflow-hidden"
            style={{ transform: 'translateZ(0)' }}
          >
            {previewManifest && (
              <DeclarativeAnimationRunner
                key={previewKey}
                manifest={previewManifest}
                onComplete={() => {
                  /* Preview only: never navigate to dashboard */
                }}
              />
            )}
            {previewSarvam && (
              <SarvamLoginTransition
                key={previewKey}
                onComplete={() => {
                  /* Preview only: never navigate to dashboard */
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Deletion Confirmation Dialog ── */}
      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={handleDeleteConfirm}
        title="Remove Login Animation"
        description={`Are you sure you want to remove the custom login animation '${animation?.name}' from this theme? This theme will fall back to direct dashboard navigation on login.`}
        type="delete"
        isLoading={isDeleting}
        confirmText="Remove"
        cancelText="Cancel"
      />
    </div>
  );
}
