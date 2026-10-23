'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, RotateCcw, Loader2, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

// ─── Config type metadata ────────────────────────────────────────────────────

type ConfigType =
    | 'CATEGORY_RULE'
    | 'GOLD_TARGET'
    | 'GOLD_ACHIEVEMENT_EXISTING'
    | 'GOLD_ACHIEVEMENT_NEW'
    | 'GOLD_WEIGHT_SLAB'
    | 'JLG_INCENTIVE'
    | 'COLLECTION_INCENTIVE'
    | 'OD_COLLECTION_RATE';

type FieldFlags = { label: boolean; category: boolean; minValue: boolean; maxValue: boolean };

const CONFIG_TABS: { type: ConfigType; title: string; description: string; fields: FieldFlags; rateLabel: string }[] = [
    { type: 'CATEGORY_RULE', title: 'Field Officer Category', description: 'Active Clients band → Category (A / B / C)', fields: { label: true, category: true, minValue: true, maxValue: true }, rateLabel: 'Rate (unused)' },
    { type: 'GOLD_TARGET', title: 'Gold Loan Target', description: 'Branch type (NEW / EXISTING) → target member count', fields: { label: true, category: true, minValue: false, maxValue: false }, rateLabel: 'Target Members' },
    { type: 'GOLD_ACHIEVEMENT_EXISTING', title: 'Gold Achievement — Existing Branch', description: 'Achieved-members band → Eligible Incentive (₹)', fields: { label: true, category: false, minValue: true, maxValue: true }, rateLabel: 'Eligible Incentive (₹)' },
    { type: 'GOLD_ACHIEVEMENT_NEW', title: 'Gold Achievement — New Branch', description: 'Achieved-members band → Eligible Incentive (₹)', fields: { label: true, category: false, minValue: true, maxValue: true }, rateLabel: 'Eligible Incentive (₹)' },
    { type: 'GOLD_WEIGHT_SLAB', title: 'Gold Weight Slabs', description: 'Gram-weight band → Incentive per member (₹)', fields: { label: true, category: false, minValue: true, maxValue: true }, rateLabel: 'Incentive per Member (₹)' },
    { type: 'JLG_INCENTIVE', title: 'JLG Incentive', description: 'Flat rate per JLG loan member (₹)', fields: { label: true, category: false, minValue: false, maxValue: false }, rateLabel: 'Rate per Member (₹)' },
    { type: 'COLLECTION_INCENTIVE', title: 'Collection Incentive', description: 'Category + Recovery % band → Incentive amount (₹)', fields: { label: true, category: true, minValue: true, maxValue: true }, rateLabel: 'Incentive (₹)' },
    { type: 'OD_COLLECTION_RATE', title: 'OD Collection Rate', description: 'DPD band → Incentive rate (%)', fields: { label: true, category: false, minValue: true, maxValue: true }, rateLabel: 'Rate (%)' },
];

interface SlabForm {
    key: string; // local-only React key
    slabOrder: number;
    label: string;
    category: string;
    minValue: string;
    maxValue: string;
    rate: string;
}

interface SlabApi {
    slabOrder: number;
    label: string | null;
    category: string | null;
    minValue: string | number | null;
    maxValue: string | number | null;
    rate: string | number;
}

let localKeyCounter = 0;
const newKey = () => `slab-${++localKeyCounter}-${Date.now()}`;

function slabToForm(s: SlabApi): SlabForm {
    return {
        key: newKey(),
        slabOrder: s.slabOrder,
        label: s.label ?? '',
        category: s.category ?? '',
        minValue: s.minValue == null ? '' : String(s.minValue),
        maxValue: s.maxValue == null ? '' : String(s.maxValue),
        rate: String(s.rate),
    };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function IncentiveConfigPage() {
    const { toast } = useToast();
    const [activeTab, setActiveTab] = useState<ConfigType>('CATEGORY_RULE');
    const [slabsByType, setSlabsByType] = useState<Partial<Record<ConfigType, SlabForm[]>>>({});
    const [loading, setLoading] = useState<Partial<Record<ConfigType, boolean>>>({});
    const [saving, setSaving] = useState(false);
    const [resetOpen, setResetOpen] = useState(false);
    const [resetting, setResetting] = useState(false);

    const activeMeta = CONFIG_TABS.find((t) => t.type === activeTab)!;
    const activeSlabs = slabsByType[activeTab] ?? [];

    const loadTab = useCallback(async (type: ConfigType) => {
        setLoading((p) => ({ ...p, [type]: true }));
        try {
            const res = await apiClient.get<{ config: { slabs: SlabApi[] } | null }>(`/admin/incentive-config?configType=${type}`);
            if (res.success && res.data) {
                const slabs = res.data.config?.slabs ?? [];
                setSlabsByType((p) => ({ ...p, [type]: slabs.map(slabToForm) }));
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load config.', variant: 'destructive' });
        } finally {
            setLoading((p) => ({ ...p, [type]: false }));
        }
    }, [toast]);

    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the default tab once on mount only
    useEffect(() => { loadTab('CATEGORY_RULE'); }, []);

    const handleTabChange = (value: string) => {
        const type = value as ConfigType;
        setActiveTab(type);
        if (!slabsByType[type]) loadTab(type);
    };

    const updateSlab = (key: string, field: keyof SlabForm, value: string) => {
        setSlabsByType((p) => ({
            ...p,
            [activeTab]: (p[activeTab] ?? []).map((s) => (s.key === key ? { ...s, [field]: value } : s)),
        }));
    };

    const addSlab = () => {
        const list = slabsByType[activeTab] ?? [];
        const next: SlabForm = { key: newKey(), slabOrder: list.length + 1, label: '', category: '', minValue: '', maxValue: '', rate: '0' };
        setSlabsByType((p) => ({ ...p, [activeTab]: [...list, next] }));
    };

    const removeSlab = (key: string) => {
        const list = (slabsByType[activeTab] ?? []).filter((s) => s.key !== key).map((s, i) => ({ ...s, slabOrder: i + 1 }));
        setSlabsByType((p) => ({ ...p, [activeTab]: list }));
    };

    const moveSlab = (index: number, direction: -1 | 1) => {
        const list = [...(slabsByType[activeTab] ?? [])];
        const target = index + direction;
        if (target < 0 || target >= list.length) return;
        [list[index], list[target]] = [list[target], list[index]];
        const renumbered = list.map((s, i) => ({ ...s, slabOrder: i + 1 }));
        setSlabsByType((p) => ({ ...p, [activeTab]: renumbered }));
    };

    const handleSave = async () => {
        if (activeSlabs.length === 0) {
            toast({ title: 'Nothing to save', description: 'Add at least one slab.', variant: 'destructive' });
            return;
        }
        setSaving(true);
        try {
            const payload = {
                configType: activeTab,
                slabs: activeSlabs.map((s) => ({
                    slabOrder: s.slabOrder,
                    label: s.label || null,
                    category: activeMeta.fields.category ? (s.category || null) : null,
                    minValue: activeMeta.fields.minValue && s.minValue !== '' ? Number(s.minValue) : null,
                    maxValue: activeMeta.fields.maxValue && s.maxValue !== '' ? Number(s.maxValue) : null,
                    rate: Number(s.rate || 0),
                })),
            };
            const res = await apiClient.put<{ config: { slabs: SlabApi[] } }>('/admin/incentive-config', payload);
            if (res.success && res.data) {
                setSlabsByType((p) => ({ ...p, [activeTab]: res.data!.config.slabs.map(slabToForm) }));
                toast({ title: 'Saved', description: `${activeMeta.title} updated successfully.` });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to save.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to save config.', variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        setResetting(true);
        try {
            const res = await apiClient.delete<{ config: { slabs: SlabApi[] } }>(`/admin/incentive-config?configType=${activeTab}`);
            if (res.success && res.data) {
                setSlabsByType((p) => ({ ...p, [activeTab]: res.data!.config.slabs.map(slabToForm) }));
                toast({ title: 'Reset', description: `${activeMeta.title} reset to defaults.` });
            } else {
                toast({ title: 'Error', description: res.error || 'Failed to reset.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to reset config.', variant: 'destructive' });
        } finally {
            setResetting(false);
            setResetOpen(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/20">
                    <Settings2 className="h-6 w-6 text-primary dark:text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-foreground dark:text-primary">Incentive Configuration</h1>
                    <p className="text-sm text-muted-foreground">
                        Admin-managed slabs and rates that drive the monthly Incentive Report — no code changes needed to adjust them.
                    </p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0">
                    {CONFIG_TABS.map((t) => (
                        <TabsTrigger
                            key={t.type}
                            value={t.type}
                            className="text-xs data-[state=active]:bg-primary data-[state=active]:text-white border border-primary/20"
                        >
                            {t.title}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {CONFIG_TABS.map((t) => (
                    <TabsContent key={t.type} value={t.type} className="mt-4">
                        <Card className="border-primary/20">
                            <CardHeader>
                                <CardTitle className="text-base text-foreground dark:text-primary">{t.title}</CardTitle>
                                <CardDescription>{t.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {loading[t.type] ? (
                                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                                        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
                                    </div>
                                ) : (
                                    <>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm border-collapse">
                                                <thead>
                                                    <tr className="text-left text-xs text-muted-foreground border-b border-primary/20">
                                                        <th className="py-2 pr-2 w-10">#</th>
                                                        {t.fields.label && <th className="py-2 pr-2">Label</th>}
                                                        {t.fields.category && <th className="py-2 pr-2">Category</th>}
                                                        {t.fields.minValue && <th className="py-2 pr-2">Min</th>}
                                                        {t.fields.maxValue && <th className="py-2 pr-2">Max</th>}
                                                        <th className="py-2 pr-2">{t.rateLabel}</th>
                                                        <th className="py-2 w-24 text-right">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {activeSlabs.map((s, i) => (
                                                        <tr key={s.key} className="border-b border-primary/10">
                                                            <td className="py-1.5 pr-2 text-muted-foreground">{s.slabOrder}</td>
                                                            {t.fields.label && (
                                                                <td className="py-1.5 pr-2">
                                                                    <Input value={s.label} onChange={(e) => updateSlab(s.key, 'label', e.target.value)} className="h-8 w-40" placeholder="Label" />
                                                                </td>
                                                            )}
                                                            {t.fields.category && (
                                                                <td className="py-1.5 pr-2">
                                                                    <Input value={s.category} onChange={(e) => updateSlab(s.key, 'category', e.target.value)} className="h-8 w-24" placeholder="A / B / C" />
                                                                </td>
                                                            )}
                                                            {t.fields.minValue && (
                                                                <td className="py-1.5 pr-2">
                                                                    <Input type="number" value={s.minValue} onChange={(e) => updateSlab(s.key, 'minValue', e.target.value)} className="h-8 w-24" placeholder="Min" />
                                                                </td>
                                                            )}
                                                            {t.fields.maxValue && (
                                                                <td className="py-1.5 pr-2">
                                                                    <Input type="number" value={s.maxValue} onChange={(e) => updateSlab(s.key, 'maxValue', e.target.value)} className="h-8 w-24" placeholder="Open-ended" />
                                                                </td>
                                                            )}
                                                            <td className="py-1.5 pr-2">
                                                                <Input type="number" value={s.rate} onChange={(e) => updateSlab(s.key, 'rate', e.target.value)} className="h-8 w-28" />
                                                            </td>
                                                            <td className="py-1.5 text-right space-x-1">
                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={i === 0} onClick={() => moveSlab(i, -1)}>↑</Button>
                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={i === activeSlabs.length - 1} onClick={() => moveSlab(i, 1)}>↓</Button>
                                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-600" onClick={() => removeSlab(s.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {activeSlabs.length === 0 && (
                                                <div className="py-8 text-center text-sm text-muted-foreground">No slabs configured. Add one below.</div>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-3">
                                            <Button variant="outline" size="sm" onClick={addSlab} className="border-primary/30 text-sidebar-accent">
                                                <Plus className="h-4 w-4 mr-1" /> Add Slab
                                            </Button>
                                            <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary hover:bg-sidebar-accent text-white">
                                                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
                                            </Button>
                                            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} className="border-red-300 text-red-600">
                                                <RotateCcw className="h-4 w-4 mr-1" /> Reset to Defaults
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                ))}
            </Tabs>

            <ConfirmationDialog
                open={resetOpen}
                onOpenChange={setResetOpen}
                onConfirm={handleReset}
                title="Reset to Defaults?"
                description={`This replaces all current "${activeMeta.title}" slabs with the seeded defaults. This cannot be undone.`}
                confirmText="Reset"
                type="warning"
                isLoading={resetting}
            />
        </div>
    );
}
