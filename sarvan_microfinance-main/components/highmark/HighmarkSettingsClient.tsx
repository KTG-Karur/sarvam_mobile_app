'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { ShieldCheck, Save } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

interface HighmarkConfig {
  pullLimitPerAadhaar: number;
  limitWindowDays: number;
  freshnessWindowDays: number;
  enforcementMode: 'BLOCK' | 'WARN';
  limitedRoles: string[];
}

const DEFAULTS: HighmarkConfig = {
  pullLimitPerAadhaar: 3,
  limitWindowDays: 180,
  freshnessWindowDays: 60,
  enforcementMode: 'BLOCK',
  limitedRoles: ['BRANCH_MANAGER', 'FDO'],
};

const ROLE_OPTIONS = [
  { value: 'FDO', label: 'FDO' },
  { value: 'BRANCH_MANAGER', label: 'Branch Manager' },
  { value: 'AREA_MANAGER', label: 'Area Manager' },
  { value: 'ADMIN', label: 'Admin' },
];

export function HighmarkSettingsClient() {
  const { toast } = useToast();
  const user = tokenStorage.getUser();
  const [config, setConfig] = useState<HighmarkConfig>(DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    apiClient.get<HighmarkConfig>('/highmark/config').then((res) => {
      if (res.success && res.data) setConfig(res.data);
    }).finally(() => setIsLoading(false));
  }, []);

  if (user?.role !== 'ADMIN') {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 dark:text-slate-400">
        This page is only accessible to Admins.
      </div>
    );
  }

  function toggleRole(role: string, checked: boolean) {
    setConfig((c) => ({
      ...c,
      limitedRoles: checked ? [...c.limitedRoles, role] : c.limitedRoles.filter((r) => r !== role),
    }));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const result = await apiClient.put<HighmarkConfig>('/highmark/config', config);
      if (result.success) {
        toast({ title: 'Policy saved', description: 'Highmark check-limit policy updated.' });
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to save', variant: 'destructive' });
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <PageLoader fullScreen={false} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Highmark Settings"
        description="Control how often Branch Managers and FDOs can pull a CRIF credit report for the same Aadhaar, and how long a report stays reusable before a new (paid) pull is needed."
        actions={[{ label: isSaving ? 'Saving…' : 'Save', onClick: handleSave, icon: Save, variant: 'default' }]}
      />

      <Card>
        <CardContent className="pt-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pullLimit">Pull limit per Aadhaar</Label>
              <Input
                id="pullLimit"
                type="number"
                min={1}
                value={config.pullLimitPerAadhaar}
                onChange={(e) => setConfig({ ...config, pullLimitPerAadhaar: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="limitWindow">Limit window (days)</Label>
              <Input
                id="limitWindow"
                type="number"
                min={1}
                value={config.limitWindowDays}
                onChange={(e) => setConfig({ ...config, limitWindowDays: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="freshnessWindow">Refresh credit report every (days)</Label>
              <Input
                id="freshnessWindow"
                type="number"
                min={1}
                value={config.freshnessWindowDays}
                onChange={(e) => setConfig({ ...config, freshnessWindowDays: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">
                A client&apos;s Highmark report is auto-shown (no new pull, no charge) in enrollment and search until it turns this many days old — e.g. 15 — after which a fresh pull is required.
              </p>
            </div>
          </div>

          <div className="space-y-1.5 max-w-xs">
            <Label>When the limit is hit</Label>
            <Select value={config.enforcementMode} onValueChange={(v) => setConfig({ ...config, enforcementMode: v as 'BLOCK' | 'WARN' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BLOCK">Block the check</SelectItem>
                <SelectItem value="WARN">Allow, just warn</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Roles the limit applies to</Label>
            <p className="text-xs text-muted-foreground">Roles left unchecked can run unlimited checks (e.g. Admin, Area Manager overrides).</p>
            <div className="flex flex-wrap gap-4 pt-1">
              {ROLE_OPTIONS.map((role) => (
                <div key={role.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`role-${role.value}`}
                    checked={config.limitedRoles.includes(role.value)}
                    onCheckedChange={(checked) => toggleRole(role.value, checked === true)}
                  />
                  <Label htmlFor={`role-${role.value}`} className="text-sm font-normal">{role.label}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-primary/20 bg-green-50 px-4 py-3 text-sm text-sidebar-accent dark:border-sidebar-accent dark:bg-brand-green-darker/30 dark:text-slate-300">
            <ShieldCheck className="inline h-4 w-4 mr-1.5 -mt-0.5" />
            With these settings: a limited-role user may run up to <b>{config.pullLimitPerAadhaar}</b> check(s) per Aadhaar
            every <b>{config.limitWindowDays}</b> days. A report already pulled within the last <b>{config.freshnessWindowDays}</b> days
            is reused for free instead of triggering a new paid pull.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
