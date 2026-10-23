'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { LoginSlidesManager } from '@/components/settings/LoginSlidesManager';
import { BrandAssetsManager } from '@/components/settings/BrandAssetsManager';
import { ThemeLoginAnimationUpload } from '@/components/settings/ThemeLoginAnimationUpload';
import { Palette, ArrowLeft, Save, Loader2 } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';

interface ThemePresetConfig {
  name: string;
  primaryColor: string;
  primaryDark: string;
  primaryDarker: string;
  primaryLight: string;
  primaryTint: string;
  secondaryColor: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarFontSize: number;
  sidebarBrandFontSize: number;
  sidebarFullNameFontSize: number;
  navBg: string;
  pageBg: string;
  foregroundColor: string;
  fontSizeBase: number;
  companyNameShort: string;
  companyNameFull: string;
  loginAnimationKey: string | null;
  paymentUpiNumber: string | null;
}

const DEFAULTS: ThemePresetConfig = {
  name: '',
  primaryColor:    '#037f35',
  primaryDark:     '#025c27',
  primaryDarker:   '#013318',
  primaryLight:    '#04a845',
  primaryTint:     '#e6f5ec',
  secondaryColor:  '#feb902',
  sidebarBg:       '#013318',
  sidebarText:     '#e6f5ec',
  sidebarFontSize: 13,
  sidebarBrandFontSize: 18,
  sidebarFullNameFontSize: 10,
  navBg:           '#ffffff',
  pageBg:          '#f4faf6',
  foregroundColor: '#0f1f12',
  fontSizeBase:    14,
  companyNameShort: 'KTGT',
  companyNameFull:  'Knock The Globe Technologies',
  loginAnimationKey: null,
  paymentUpiNumber: null,
};

type ColorFields = keyof Omit<ThemePresetConfig, 'name' | 'fontSizeBase' | 'sidebarFontSize' | 'sidebarBrandFontSize' | 'sidebarFullNameFontSize' | 'companyNameShort' | 'companyNameFull' | 'loginAnimationKey' | 'paymentUpiNumber'>;

interface ColorRowProps {
  label: string;
  description: string;
  field: ColorFields;
  value: string;
  onChange: (field: ColorFields, value: string) => void;
}

function ColorRow({ label, description, field, value, onChange }: ColorRowProps) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground dark:text-slate-200">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="relative w-10 h-10 rounded-lg overflow-hidden border-2 border-slate-200 dark:border-sidebar-accent shadow-sm">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(field, e.target.value)}
            className="absolute inset-0 w-[200%] h-[200%] -top-2 -left-2 cursor-pointer border-none bg-transparent"
          />
        </div>
        <Input
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(field, v);
          }}
          className="w-28 font-mono text-xs h-9"
          maxLength={7}
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

// Free-typed px entry — no slider, no advertised range: the admin types
// whatever size they want, decimals included (7.5, 12.25 → kept to 2
// decimal places). The only guard is a wide sanity bound (1–100, mirrored by
// the API) so a stray "0" or "9999" can't render the whole app unreadable;
// an empty/invalid entry reverts to the current value on blur/Enter, and an
// over-limit one snaps to the bound visibly in the box.
const FONT_SIZE_SANITY_MIN = 1;
const FONT_SIZE_SANITY_MAX = 100;
const roundSize = (n: number) => Math.round(n * 100) / 100;

function FontSizeInput({ value, onChange }: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [seenValue, setSeenValue] = useState(value);
  // Re-sync the text only when the value changed from outside what's typed —
  // a plain String(value) would turn an in-progress "7." back into "7" on
  // every keystroke, making decimals impossible to type. (Adjusting state
  // during render on a prop change, rather than in an effect.)
  if (value !== seenValue) {
    setSeenValue(value);
    if (Number(draft) !== value) setDraft(String(value));
  }

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const bounded = roundSize(Math.min(FONT_SIZE_SANITY_MAX, Math.max(FONT_SIZE_SANITY_MIN, n)));
    onChange(bounded);
    setDraft(String(bounded));
  };

  return (
    <div className="flex items-center gap-1 shrink-0">
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          // Push up as they type whenever it's already a usable size, so
          // Save works without needing a blur first.
          if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= FONT_SIZE_SANITY_MIN && n <= FONT_SIZE_SANITY_MAX) onChange(roundSize(n));
        }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        className="w-20 h-9 text-center text-sm font-bold"
        aria-label="Font size in px"
      />
      <span className="text-sm font-bold text-foreground dark:text-slate-100">px</span>
    </div>
  );
}

interface ThemePresetEditorClientProps {
  /** null = creating a brand-new preset; a preset id = editing an existing one. */
  presetId: string | null;
  /** Pre-fills the name field for the create flow (from the "Add Theme" dialog). */
  initialName?: string;
}

export function ThemePresetEditorClient({ presetId, initialName }: ThemePresetEditorClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<ReturnType<typeof tokenStorage.getUser>>(null);
  const [config, setConfig] = useState<ThemePresetConfig>({
    ...DEFAULTS,
    name: initialName ?? '',
  });
  const [isLoading, setIsLoading] = useState(!!presetId);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setUser(tokenStorage.getUser());
  }, []);

  useEffect(() => {
    if (!presetId) return;
    apiClient.get<ThemePresetConfig>(`/settings/brand/presets/${presetId}`).then((res) => {
      if (res.success && res.data) {
        setConfig({
          ...DEFAULTS,
          ...res.data,
          loginAnimationKey: res.data.loginAnimationKey ?? null,
          paymentUpiNumber: res.data.paymentUpiNumber ?? null,
        });
      }
    }).finally(() => setIsLoading(false));
  }, [presetId]);

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

  function setColor(field: ColorFields, value: string) {
    setConfig((prev) => ({ ...prev, [field]: value }));
  }

  function goBack() {
    router.push('/dashboard/settings/brand');
  }

  async function handleSave() {
    if (!config.name.trim()) {
      toast({ title: 'Name required', description: 'Give this theme a name before saving', variant: 'destructive' });
      return;
    }
    setIsSaving(true);
    try {
      const result = presetId
        ? await apiClient.put<ThemePresetConfig>(`/settings/brand/presets/${presetId}`, config)
        : await apiClient.post<ThemePresetConfig>('/settings/brand/presets', config);

      if (result.success) {
        // Hard navigation (not router.push) — if the preset being edited is the
        // active one, this guarantees the refreshed colors/logo actually show up
        // on the next page instead of depending on router-cache invalidation timing.
        window.location.href = '/dashboard/settings/brand';
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={presetId ? `Edit "${config.name || 'Theme'}"` : 'New Theme'}
        description="Customise colors and typography for this theme preset"
        badge="Admin Only"
        actions={[
          { label: 'Back to Themes', onClick: goBack, icon: ArrowLeft, variant: 'outline' },
          { label: isSaving ? 'Saving…' : 'Save Theme', onClick: handleSave, icon: isSaving ? Loader2 : Save },
        ]}
      />

      {/* Theme Name + Company Name */}
      <Card className="border-primary/20 dark:border-sidebar-accent">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Theme Identity</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">Theme Name</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">Internal label shown on the theme card — not visible to end users</p>
              <Input
                value={config.name}
                onChange={(e) => setConfig((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={80}
                placeholder="e.g. Theme Green"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Short Name</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">Sidebar brand text, page titles</p>
              <Input
                value={config.companyNameShort}
                onChange={(e) => setConfig((prev) => ({ ...prev, companyNameShort: e.target.value }))}
                maxLength={60}
                placeholder="KTGT"
              />
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">Short Name size in the sidebar header</p>
                <FontSizeInput value={config.sidebarBrandFontSize} onChange={(n) => setConfig((prev) => ({ ...prev, sidebarBrandFontSize: n }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Full Name</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">Login page tag, report/PDF headers</p>
              <Input
                value={config.companyNameFull}
                onChange={(e) => setConfig((prev) => ({ ...prev, companyNameFull: e.target.value }))}
                maxLength={120}
                placeholder="Knock The Globe Technologies"
              />
              <div className="flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">Full Name size in the sidebar header</p>
                <FontSizeInput value={config.sidebarFullNameFontSize} onChange={(n) => setConfig((prev) => ({ ...prev, sidebarFullNameFontSize: n }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">G-Pay / PhonePe Number</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Printed on the Loan Card / Loan Passbook with the Payment QR — leave blank to omit
              </p>
              <Input
                value={config.paymentUpiNumber ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^[0-9+\-\s,/]*$/.test(v)) setConfig((prev) => ({ ...prev, paymentUpiNumber: v }));
                }}
                maxLength={40}
                inputMode="tel"
                placeholder="e.g. 8925540843"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-sm font-medium text-foreground">Login Animation</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Custom intro animation played after successful login for this theme
              </p>
              <ThemeLoginAnimationUpload
                presetId={presetId}
                loginAnimationKey={config.loginAnimationKey}
                onKeyChange={(key) =>
                  setConfig((prev) => ({ ...prev, loginAnimationKey: key }))
                }
                isSarvamTheme={
                  /sarvam/i.test(config.companyNameShort) || /sarvam/i.test(config.companyNameFull)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {presetId ? (
        <BrandAssetsManager presetId={presetId} />
      ) : (
        <Card className="border-dashed border-primary/30 dark:border-sidebar-accent">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Save this theme first to add a logo, favicon, or login carousel slides.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Primary Colors */}
        <Card className="border-primary/20 dark:border-sidebar-accent">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="h-4 w-4 text-primary" />
              <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Primary Colors</p>
            </div>
            <ColorRow label="Primary" description="Buttons, links, active states" field="primaryColor" value={config.primaryColor} onChange={setColor} />
            <ColorRow label="Primary Dark" description="Hover states, borders" field="primaryDark" value={config.primaryDark} onChange={setColor} />
            <ColorRow label="Primary Darker" description="Deep accents, sidebar default" field="primaryDarker" value={config.primaryDarker} onChange={setColor} />
            <ColorRow label="Primary Light" description="Hover highlights" field="primaryLight" value={config.primaryLight} onChange={setColor} />
            <ColorRow label="Primary Tint" description="Card tints, light backgrounds" field="primaryTint" value={config.primaryTint} onChange={setColor} />
          </CardContent>
        </Card>

        {/* Accent + Sidebar */}
        <div className="space-y-6">
          <Card className="border-primary/20 dark:border-sidebar-accent">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Palette className="h-4 w-4 text-amber-500" />
                <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Accent / Secondary</p>
              </div>
              <ColorRow label="Secondary" description="Badges, highlights, sidebar accent" field="secondaryColor" value={config.secondaryColor} onChange={setColor} />
            </CardContent>
          </Card>

          <Card className="border-primary/20 dark:border-sidebar-accent">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Palette className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Sidebar</p>
              </div>
              <ColorRow label="Sidebar Background" description="Left navigation panel background" field="sidebarBg" value={config.sidebarBg} onChange={setColor} />
              <ColorRow label="Sidebar Text" description="Navigation text and icon color" field="sidebarText" value={config.sidebarText} onChange={setColor} />
              <div className="flex items-center gap-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground dark:text-slate-200">Sidebar Menu Font Size</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Navigation menu item text size — type any size in px</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <FontSizeInput value={config.sidebarFontSize} onChange={(n) => setConfig((prev) => ({ ...prev, sidebarFontSize: n }))} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 dark:border-sidebar-accent">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Palette className="h-4 w-4 text-sky-500" />
                <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Page &amp; Cards</p>
              </div>
              <ColorRow label="Page Background" description="Main page background color" field="pageBg" value={config.pageBg} onChange={setColor} />
              <ColorRow label="Card / Nav Background" description="Cards, modals, top navbar" field="navBg" value={config.navBg} onChange={setColor} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Text Colors */}
      <Card className="border-primary/20 dark:border-sidebar-accent">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Palette className="h-4 w-4 text-slate-700 dark:text-slate-300" />
            <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">Text Colors</p>
          </div>
          <ColorRow label="Page Text Color" description="Main body text, headings, table content" field="foregroundColor" value={config.foregroundColor} onChange={setColor} />
        </CardContent>
      </Card>

      {/* Typography */}
      <Card className="border-primary/20 dark:border-sidebar-accent">
        <CardContent className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary mb-4">Typography</p>
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground dark:text-slate-200 mb-1">Page Base Font Size</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">All page text scales relative to this value — type any size in px</p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <FontSizeInput value={config.fontSizeBase} onChange={(n) => setConfig((prev) => ({ ...prev, fontSizeBase: n }))} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Preview strip */}
      <Card className="border-primary/20 dark:border-sidebar-accent">
        <CardContent className="p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary mb-4">Live Preview</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="h-8 px-4 rounded-lg flex items-center text-sm font-medium text-white" style={{ backgroundColor: config.primaryColor }}>
              Primary Button
            </div>
            <div className="h-8 px-4 rounded-lg flex items-center text-sm font-medium" style={{ backgroundColor: config.secondaryColor, color: '#2a1f00' }}>
              Secondary Badge
            </div>
            <div className="h-8 px-4 rounded-lg flex items-center text-sm font-medium text-white" style={{ backgroundColor: config.sidebarBg }}>
              Sidebar BG
            </div>
            <div className="h-8 px-4 rounded-lg flex items-center text-sm font-medium border-2" style={{ borderColor: config.primaryDark, color: config.primaryColor }}>
              Outline
            </div>
            <div className="h-8 px-4 rounded-lg flex items-center text-sm font-medium" style={{ backgroundColor: config.primaryTint, color: config.primaryDarker }}>
              Tint Card
            </div>
          </div>
        </CardContent>
      </Card>

      {presetId && <LoginSlidesManager presetId={presetId} />}

      <div className="flex justify-end gap-3 pb-8">
        <Button variant="outline" onClick={goBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Themes
        </Button>
        <Button onClick={handleSave} disabled={isSaving} className="gap-2">
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? 'Saving…' : 'Save Theme'}
        </Button>
      </div>
    </div>
  );
}
