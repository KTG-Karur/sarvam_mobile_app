'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { ThemePresetCard, type ThemePresetSummary } from '@/components/settings/ThemePresetCard';
import { Plus } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

export function BrandSettingsClient() {
  const router = useRouter();
  const [user, setUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
  const [presets, setPresets] = useState<ThemePresetSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [gridBusy, setGridBusy] = useState(false);

  useEffect(() => {
    setUser(tokenStorage.getUser());
  }, []);

  function loadPresets() {
    setIsLoading(true);
    apiClient.get<ThemePresetSummary[]>('/settings/brand/presets').then((res) => {
      if (res.success && res.data) setPresets(res.data);
    }).finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadPresets();
  }, []);

  if (!user) {
    return <PageLoader fullScreen={false} />;
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        This page is only accessible to Admins.
      </div>
    );
  }

  function handleCreate() {
    if (!newName.trim()) return;
    router.push(`/dashboard/settings/brand/new?name=${encodeURIComponent(newName.trim())}`);
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title="Brand Themes"
        description="Create and switch between named theme presets for the entire application"
        badge="Admin Only"
        actions={[
          { label: 'Add Theme', onClick: () => setAddDialogOpen(true), icon: Plus },
        ]}
      />

      {isLoading ? (
        <PageLoader fullScreen={false} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {presets.map((preset) => (
            <ThemePresetCard
              key={preset.id}
              preset={preset}
              onDeleted={loadPresets}
              gridBusy={gridBusy}
              onBusyChange={setGridBusy}
            />
          ))}
        </div>
      )}

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Theme</DialogTitle>
            <DialogDescription>
              Give the new theme a name — you&apos;ll configure its colors, logo, and login slides next.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Theme Green"
            maxLength={80}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim()}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
