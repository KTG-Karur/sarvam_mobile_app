'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, Pencil, Trash2, Loader2 } from 'lucide-react';

export interface ThemePresetSummary {
  id: string;
  name: string;
  isActive: boolean;
  primaryColor: string;
  secondaryColor: string;
  sidebarBg: string;
  pageBg: string;
  navBg: string;
}

interface ThemePresetCardProps {
  preset: ThemePresetSummary;
  onDeleted: () => void;
  /** True while ANY card in the grid has an apply/delete in flight — disables
   *  this card's actions too, so a second click can't race the first one and
   *  land a different theme than the one that reloads the page. */
  gridBusy: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function ThemePresetCard({ preset, onDeleted, gridBusy, onBusyChange }: ThemePresetCardProps) {
  const { toast } = useToast();
  const [isApplying, setIsApplying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const disabled = gridBusy || isApplying || isDeleting;

  async function handleApply() {
    setIsApplying(true);
    onBusyChange(true);
    try {
      const result = await apiClient.post(`/settings/brand/presets/${preset.id}/activate`);
      if (result.success) {
        window.location.reload();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to apply theme', variant: 'destructive' });
        setIsApplying(false);
        onBusyChange(false);
      }
    } catch {
      setIsApplying(false);
      onBusyChange(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    onBusyChange(true);
    try {
      const result = await apiClient.delete(`/settings/brand/presets/${preset.id}`);
      if (result.success) {
        toast({ title: 'Theme deleted' });
        onDeleted();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to delete theme', variant: 'destructive' });
      }
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
      onBusyChange(false);
    }
  }

  return (
    <>
      <Card className={preset.isActive ? 'border-primary shadow-md' : 'border-primary/20 dark:border-sidebar-accent'}>
        <CardContent className="p-5 space-y-4">
          <div className="flex gap-1.5 h-10 rounded-lg overflow-hidden border border-border">
            <div className="flex-1" style={{ backgroundColor: preset.primaryColor }} />
            <div className="flex-1" style={{ backgroundColor: preset.secondaryColor }} />
            <div className="flex-1" style={{ backgroundColor: preset.sidebarBg }} />
            <div className="flex-1 border-l border-border" style={{ backgroundColor: preset.pageBg }} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-foreground truncate">{preset.name}</p>
            {preset.isActive && (
              <Badge className="gap-1 shrink-0">
                <CheckCircle2 className="h-3 w-3" />
                Active
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/settings/brand/${preset.id}`}
              className={`flex-1 ${disabled ? 'pointer-events-none' : ''}`}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : undefined}
            >
              <Button variant="outline" size="sm" className="w-full gap-2" disabled={disabled}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            </Link>
            {!preset.isActive && (
              <Button size="sm" className="flex-1 gap-2" onClick={handleApply} disabled={disabled}>
                {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Apply
              </Button>
            )}
            {!preset.isActive && (
              <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(true)} title="Delete" disabled={disabled}>
                <Trash2 className="h-4 w-4 text-red-600" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmationDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={handleDelete}
        title="Delete theme preset?"
        description={`"${preset.name}" and its logo, favicon, and login slides will be permanently removed.`}
        confirmText="Delete"
        type="delete"
        isLoading={isDeleting}
      />
    </>
  );
}
