'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { DEFAULT_LOGIN_SLIDES } from '@/app/lib/constants/login-slides';
import { useToast } from '@/hooks/use-toast';
import { Images, Plus, Trash2, Loader2, Pencil, X, Upload, ArrowUp, ArrowDown } from 'lucide-react';

interface LoginSlide {
  id: string;
  imageKey: string;
  title: string;
  description: string;
  sortOrder: number;
  updatedAt: string;
}

const emptyForm: { title: string; description: string; sortOrder: number | '' } = {
  title: '',
  description: '',
  sortOrder: '',
};

function formatFilenameToTitle(filename: string): string {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  return nameWithoutExt
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function LoginSlidesManager({ presetId }: { presetId: string }) {
  const { toast } = useToast();
  const [slides, setSlides] = useState<LoginSlide[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<LoginSlide | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function loadSlides() {
    setIsLoading(true);
    apiClient
      .get<LoginSlide[]>(`/settings/brand/login-slides?themePresetId=${presetId}`)
      .then((res) => {
        if (res.success && res.data) setSlides(res.data);
      })
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadSlides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  function resetForm() {
    setForm(emptyForm);
    setFiles([]);
    setEditingId(null);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function startEdit(slide: LoginSlide) {
    setEditingId(slide.id);
    setForm({ title: slide.title, description: slide.description, sortOrder: slide.sortOrder });
    setFiles([]);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!editingId && files.length === 0) {
      toast({ title: 'Images required', description: 'Choose one or more photos for the slide(s)', variant: 'destructive' });
      return;
    }

    if (editingId) {
      if (!form.title.trim() || !form.description.trim()) {
        toast({ title: 'Missing fields', description: 'Title and description are required', variant: 'destructive' });
        return;
      }
      const resolvedOrder = form.sortOrder === '' ? 0 : form.sortOrder;
      if (resolvedOrder < 0) {
        toast({ title: 'Invalid sort order', description: 'Sort order cannot be negative.', variant: 'destructive' });
        return;
      }
      if (slides.some((s) => s.id !== editingId && s.sortOrder === resolvedOrder)) {
        toast({
          title: 'Sort order in use',
          description: `Another slide is already at position ${resolvedOrder}. Choose a different order.`,
          variant: 'destructive',
        });
        return;
      }
      setIsSaving(true);
      try {
        const fd = new FormData();
        if (files.length > 0) fd.append('image', files[0]);
        fd.append('title', form.title.trim());
        fd.append('description', form.description.trim());
        fd.append('sortOrder', String(form.sortOrder === '' ? 0 : form.sortOrder));

        const result = await apiClient.put<LoginSlide>(`/settings/brand/login-slides/${editingId}`, fd);
        if (result.success) {
          toast({ title: 'Slide updated' });
          resetForm();
          loadSlides();
        } else {
          toast({ title: 'Error', description: result.error ?? 'Failed to save slide', variant: 'destructive' });
        }
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // Creating new slide(s) - single or multiple
    if (files.length === 1 && form.sortOrder !== '' && form.sortOrder < 0) {
      toast({ title: 'Invalid sort order', description: 'Sort order cannot be negative.', variant: 'destructive' });
      return;
    }
    if (files.length === 1 && form.sortOrder !== '' && slides.some((s) => s.sortOrder === form.sortOrder)) {
      toast({
        title: 'Sort order in use',
        description: `Another slide is already at position ${form.sortOrder}. Choose a different order.`,
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    const maxExistingOrder = slides.length > 0 ? Math.max(...slides.map((s) => s.sortOrder)) : -1;
    let successCount = 0;
    let failCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (files.length > 1) {
          setUploadProgress(`Uploading image ${i + 1} of ${files.length}...`);
        }

        const title = files.length === 1
          ? (form.title.trim() || formatFilenameToTitle(file.name))
          : (form.title.trim() ? `${form.title.trim()} ${i + 1}` : formatFilenameToTitle(file.name));

        const description = form.description.trim() || 'Login page slide';
        const sortOrder = files.length === 1 && form.sortOrder !== ''
          ? form.sortOrder
          : maxExistingOrder + 1 + i;

        const fd = new FormData();
        fd.append('themePresetId', presetId);
        fd.append('image', file);
        fd.append('title', title);
        fd.append('description', description);
        fd.append('sortOrder', String(sortOrder));

        const result = await apiClient.post<LoginSlide>('/settings/brand/login-slides', fd);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      if (successCount > 0) {
        toast({
          title: files.length > 1 ? `${successCount} slides added` : 'Slide added',
          description: failCount > 0 ? `${failCount} failed to upload.` : undefined,
        });
        resetForm();
        loadSlides();
      } else {
        toast({ title: 'Error', description: 'Failed to upload slide(s)', variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
      setUploadProgress(null);
    }
  }

  // The login page falls back to the built-in default photos when no slides exist in the DB.
  // Copy them in as real slides so they can be edited, reordered or deleted like any other.
  async function handleImportDefaults() {
    setIsImporting(true);
    let imported = 0;
    try {
      for (let i = 0; i < DEFAULT_LOGIN_SLIDES.length; i++) {
        const def = DEFAULT_LOGIN_SLIDES[i];
        const imgRes = await fetch(def.src);
        if (!imgRes.ok) continue;
        const blob = await imgRes.blob();
        const fd = new FormData();
        fd.append('themePresetId', presetId);
        fd.append('image', new File([blob], def.src.split('/').pop() ?? `slide${i + 1}.png`, { type: blob.type || 'image/png' }));
        fd.append('title', def.title);
        fd.append('description', def.description);
        fd.append('sortOrder', String(i));
        const result = await apiClient.post<LoginSlide>('/settings/brand/login-slides', fd);
        if (result.success) imported++;
      }
      if (imported > 0) {
        toast({ title: `${imported} default slides imported`, description: 'You can now edit, reorder or delete them.' });
        loadSlides();
      } else {
        toast({ title: 'Error', description: 'Could not import the default slides', variant: 'destructive' });
      }
    } finally {
      setIsImporting(false);
    }
  }

  async function handleReorder(slide: LoginSlide, direction: 'up' | 'down') {
    setReorderingId(slide.id);
    try {
      const result = await apiClient.post(`/settings/brand/login-slides/${slide.id}/reorder`, { direction });
      if (result.success) {
        loadSlides();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to reorder slide', variant: 'destructive' });
      }
    } finally {
      setReorderingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const result = await apiClient.delete(`/settings/brand/login-slides/${deleteTarget.id}`);
      if (result.success) {
        toast({ title: 'Slide deleted' });
        if (editingId === deleteTarget.id) resetForm();
        loadSlides();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to delete slide', variant: 'destructive' });
      }
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <Card className="border-primary/20 dark:border-sidebar-accent">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Images className="h-4 w-4 text-primary" />
          <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">
            Login Page Carousel
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-2">
            {slides.length === 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No custom slides yet — the login page is currently showing these built-in photos.
                  </p>
                  <Button size="sm" onClick={handleImportDefaults} disabled={isImporting} className="gap-2">
                    {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    Import to edit
                  </Button>
                </div>
                {DEFAULT_LOGIN_SLIDES.map((def, i) => (
                  <div
                    key={def.src}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-sidebar-accent p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={def.src}
                      alt={def.title}
                      className="h-14 w-24 rounded object-cover shrink-0 bg-slate-100 dark:bg-brand-green-darker"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{def.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{def.description.split('\n').join(' ')}</p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">#{i} · default</span>
                  </div>
                ))}
              </div>
            )}
            {slides.map((slide, idx) => (
              <div
                key={slide.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-sidebar-accent p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/branding/asset/login-slide/${slide.id}?v=${new Date(slide.updatedAt).getTime()}`}
                  alt={slide.title}
                  className="h-14 w-24 rounded object-cover shrink-0 bg-slate-100 dark:bg-brand-green-darker"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{slide.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{slide.description}</p>
                </div>
                <span className="text-xs text-slate-400 shrink-0">#{slide.sortOrder}</span>
                <div className="flex flex-col shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-6"
                    disabled={idx === 0 || reorderingId === slide.id}
                    onClick={() => handleReorder(slide, 'up')}
                    title="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-6"
                    disabled={idx === slides.length - 1 || reorderingId === slide.id}
                    onClick={() => handleReorder(slide, 'down')}
                    title="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Button variant="ghost" size="icon" onClick={() => startEdit(slide)} title="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(slide)} title="Delete">
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-dashed border-primary/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-sidebar-accent dark:text-primary">
              {editingId ? 'Edit slide' : 'Add slide(s)'}
            </p>
            {files.length > 0 && (
              <span className="text-xs font-medium text-primary">
                {files.length} {files.length === 1 ? 'file' : 'files'} selected
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple={!editingId}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="h-3.5 w-3.5" />
            Choose Photos
          </Button>
          <Input
            placeholder={files.length > 1 ? "Base Title (optional - defaults to filenames)" : "Title"}
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
          />
          <Input
            placeholder={files.length > 1 ? "Common Description (optional)" : "Description"}
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
          <div className="w-32 space-y-1">
            <Label htmlFor="slideSortOrder" className="text-xs text-slate-500 dark:text-slate-400">
              Sort Order
            </Label>
            <Input
              id="slideSortOrder"
              type="number"
              min={0}
              placeholder="Auto (next)"
              value={form.sortOrder}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  sortOrder: e.target.value === '' ? '' : Number(e.target.value),
                }))
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="gap-2"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editingId
                ? 'Save changes'
                : uploadProgress
                ? uploadProgress
                : files.length > 1
                ? `Upload ${files.length} slides`
                : 'Add slide'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm} className="gap-2">
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </CardContent>

      <ConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete login slide?"
        description={`"${deleteTarget?.title ?? ''}" will be removed from the login page carousel.`}
        confirmText="Delete"
        type="delete"
        isLoading={isDeleting}
      />
    </Card>
  );
}
