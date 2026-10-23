'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Building, ChevronDown, ChevronRight, Loader2, MapPinned, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Level = 'REGION' | 'DIVISION' | 'AREA' | 'BRANCH';
type ScopeItem = { level: 'HEAD_OFFICE' } | { level: Level; id: string };
type Node = { id: string; name: string; code: string };
type AreaNode = Node & { branches: Node[] };
type DivisionNode = Node & { areas: AreaNode[] };
type RegionNode = Node & { divisions: DivisionNode[] };

type ScopeResponse = {
  regions: RegionNode[];
  branches: Node[];
  scopes: ScopeItem[];
  headOffice: boolean;
  coveredBranchCount: number | null;
};

interface OrgScopeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  userRole: string;
  /** Called after a save. Single branches / Head Office are written to Manage Branches too. */
  onChanged?: () => void;
}

const LEVEL_LABEL: Record<Level, string> = {
  REGION: 'Region',
  DIVISION: 'Division',
  AREA: 'Area',
  BRANCH: 'Branch',
};

const key = (level: Level, id: string) => `${level}:${id}`;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Assigns a user (e.g. a Quality Checker) Head Office / Region / Division /
 * Area / Branch coverage. Works like branch assignment, so it drives their
 * listings, branch switcher and all actions (see app/lib/permissions/org-scope.ts).
 * Ticking a Region covers every Division, Area and Branch under it (shown as
 * "covered" and locked), and likewise down the tree; Head Office covers all.
 */
export function OrgScopeModal({ open, onOpenChange, userId, userName, userRole, onChanged }: OrgScopeModalProps) {
  const { toast } = useToast();
  const [data, setData] = useState<ScopeResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [headOffice, setHeadOffice] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await apiClient.get<ScopeResponse>(`/users/${userId}/org-scope`);
        if (res.success && res.data) {
          setData(res.data);
          setHeadOffice(res.data.headOffice);
          setSelected(
            new Set(res.data.scopes.flatMap((s) => (s.level === 'HEAD_OFFICE' ? [] : [key(s.level, s.id)])))
          );
          // Open the regions that already hold a selection.
          setExpanded(new Set(res.data.regions.map((r) => r.id)));
        } else {
          toast({ title: 'Error', description: res.error || 'Failed to load coverage', variant: 'destructive' });
        }
      } catch {
        toast({ title: 'Error', description: 'Failed to load coverage', variant: 'destructive' });
      } finally {
        setIsLoading(false);
      }
    };
    load();
    setSearch('');
  }, [open, userId, toast]);

  // Lookups for labels / unassigned branches.
  const { labelOf, unlinkedBranches } = useMemo(() => {
    const labels = new Map<string, string>();
    const linked = new Set<string>();
    for (const r of data?.regions ?? []) {
      labels.set(key('REGION', r.id), `${r.name} (${r.code})`);
      for (const d of r.divisions) {
        labels.set(key('DIVISION', d.id), `${d.name} (${d.code})`);
        for (const a of d.areas) {
          labels.set(key('AREA', a.id), `${a.name} (${a.code})`);
          for (const b of a.branches) linked.add(b.id);
        }
      }
    }
    for (const b of data?.branches ?? []) labels.set(key('BRANCH', b.id), `${b.code} - ${b.name}`);
    return {
      labelOf: labels,
      unlinkedBranches: (data?.branches ?? []).filter((b) => !linked.has(b.id)),
    };
  }, [data]);

  const toggle = (level: Level, id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = key(level, id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const q = search.trim().toLowerCase();
  const matches = (n: Node) => !q || n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const scopes: ScopeItem[] = headOffice
        ? [{ level: 'HEAD_OFFICE' }]
        : [...selected].map((k) => {
            const [level, id] = k.split(':') as [Level, string];
            return { level, id };
          });
      const res = await apiClient.put<{ scopes: ScopeItem[]; headOffice: boolean; coveredBranchCount: number | null }>(
        `/users/${userId}/org-scope`,
        { scopes }
      );
      if (res.success) {
        toast({
          title: scopes.length > 0 ? 'Coverage saved' : 'Coverage cleared',
          description: headOffice
            ? `${userName} now covers Head Office (all branches). Takes full effect on their next login.`
            : scopes.length > 0
              ? `${userName} now covers ${res.data?.coveredBranchCount ?? 0} branch(es). Takes full effect on their next login.`
              : `${userName} is back to their normal branch assignment.`,
        });
        onChanged?.();
        onOpenChange(false);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to save coverage', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to save coverage', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Row renderer ──
  const Row = ({
    level,
    node,
    depth,
    coveredBy,
    hasChildren,
    isOpen,
  }: {
    level: Level;
    node: Node;
    depth: number;
    coveredBy: string | null;
    hasChildren: boolean;
    isOpen: boolean;
  }) => {
    const checked = selected.has(key(level, node.id));
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-green-50 dark:hover:bg-sidebar-accent/40',
          coveredBy && 'opacity-70'
        )}
        style={{ paddingLeft: depth * 20 + 4 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleExpand(node.id)}
            className="h-5 w-5 flex items-center justify-center text-slate-500"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <Checkbox
          id={key(level, node.id)}
          checked={checked || !!coveredBy}
          disabled={!!coveredBy || isSaving}
          onCheckedChange={() => toggle(level, node.id)}
        />
        <label htmlFor={key(level, node.id)} className="flex-1 min-w-0 cursor-pointer text-sm">
          <span className="font-medium text-foreground">{node.name}</span>{' '}
          <span className="font-mono text-xs text-slate-500">({node.code})</span>
        </label>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{LEVEL_LABEL[level]}</span>
        {coveredBy && (
          <Badge variant="outline" className="text-[10px] font-normal">
            via {coveredBy}
          </Badge>
        )}
      </div>
    );
  };

  const selectedList = [...selected];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <MapPinned className="h-5 w-5 text-primary" />
            Assign Region / Division / Area
          </DialogTitle>
          <DialogDescription>
            Choose what{' '}
            <span className="font-semibold text-sidebar-accent dark:text-slate-200">{userName}</span> ({userRole}) covers.
            Works like branch assignment: their member lists, branch switcher and all actions follow it. They see
            only what is ticked here — being based at Head Office does not give every branch; tick Head Office (all
            branches) for that. A Region covers all its Divisions, Areas and Branches. Single Branches are shared
            with Manage Branches.
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Selected summary */}
            <div className="rounded-lg bg-green-50 px-3 py-2 dark:bg-sidebar-accent">
              <div className="flex items-center justify-between">
                <span className="text-sm text-sidebar-accent dark:text-slate-300">Assigned</span>
                <Badge variant="secondary" className="font-bold">{headOffice ? 'All' : selectedList.length}</Badge>
              </div>
              {headOffice ? (
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Head Office: every Region, Division, Area and Branch.
                </p>
              ) : selectedList.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedList.map((k) => {
                    const [level, id] = k.split(':') as [Level, string];
                    return (
                      <Badge key={k} variant="outline" className="gap-1 bg-white dark:bg-brand-green-darker">
                        <span className="text-[10px] uppercase text-slate-500">{LEVEL_LABEL[level]}</span>
                        {labelOf.get(k) ?? id}
                        <button
                          type="button"
                          onClick={() => toggle(level, id)}
                          className="ml-0.5 text-slate-400 hover:text-red-600"
                          aria-label="Remove"
                          disabled={isSaving}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">Nothing assigned — they will not see any branch's members.</p>
              )}
            </div>

            {/* Head Office: everything */}
            <label
              htmlFor="org-scope-head-office"
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 hover:bg-green-50 dark:border-sidebar-accent dark:hover:bg-sidebar-accent/40"
            >
              <Checkbox
                id="org-scope-head-office"
                checked={headOffice}
                disabled={isSaving}
                onCheckedChange={(v) => setHeadOffice(v === true)}
              />
              <Building className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm font-semibold">Head Office (all branches)</span>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Covers everything</span>
            </label>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search region, division, area or branch..."
                className="pl-8 h-9"
              />
            </div>

            {/* Tree */}
            <div className="flex-1 min-h-[240px] overflow-y-auto rounded-lg border border-primary/20 p-2 dark:border-sidebar-accent">
              {data.regions.length === 0 && unlinkedBranches.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">No regions or branches configured.</p>
              )}

              {data.regions.map((r) => {
                const rSel = selected.has(key('REGION', r.id));
                const rLabel = `${r.name}`;
                const divisions = r.divisions.filter(
                  (d) =>
                    matches(r) || matches(d) ||
                    d.areas.some((a) => matches(a) || a.branches.some(matches))
                );
                if (q && divisions.length === 0 && !matches(r)) return null;
                const rOpen = expanded.has(r.id) || !!q;
                return (
                  <React.Fragment key={r.id}>
                    <Row level="REGION" node={r} depth={0} coveredBy={headOffice ? 'Head Office' : null} hasChildren={r.divisions.length > 0} isOpen={rOpen} />
                    {rOpen &&
                      divisions.map((d) => {
                        const dCovered = headOffice ? 'Head Office' : rSel ? rLabel : null;
                        const dSel = selected.has(key('DIVISION', d.id));
                        const areas = d.areas.filter(
                          (a) => matches(r) || matches(d) || matches(a) || a.branches.some(matches)
                        );
                        const dOpen = expanded.has(d.id) || !!q;
                        return (
                          <React.Fragment key={d.id}>
                            <Row level="DIVISION" node={d} depth={1} coveredBy={dCovered} hasChildren={d.areas.length > 0} isOpen={dOpen} />
                            {dOpen &&
                              areas.map((a) => {
                                const aCovered = dCovered ?? (dSel ? d.name : null);
                                const aSel = selected.has(key('AREA', a.id));
                                const branches = a.branches.filter(
                                  (b) => matches(r) || matches(d) || matches(a) || matches(b)
                                );
                                const aOpen = expanded.has(a.id) || !!q;
                                return (
                                  <React.Fragment key={a.id}>
                                    <Row level="AREA" node={a} depth={2} coveredBy={aCovered} hasChildren={a.branches.length > 0} isOpen={aOpen} />
                                    {aOpen &&
                                      branches.map((b) => (
                                        <Row
                                          key={`${a.id}-${b.id}`}
                                          level="BRANCH"
                                          node={b}
                                          depth={3}
                                          coveredBy={aCovered ?? (aSel ? a.name : null)}
                                          hasChildren={false}
                                          isOpen={false}
                                        />
                                      ))}
                                  </React.Fragment>
                                );
                              })}
                          </React.Fragment>
                        );
                      })}
                  </React.Fragment>
                );
              })}

              {unlinkedBranches.filter(matches).length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Branches not linked to an Area
                  </p>
                  {unlinkedBranches.filter(matches).map((b) => (
                    <Row key={b.id} level="BRANCH" node={b} depth={0} coveredBy={headOffice ? 'Head Office' : null} hasChildren={false} isOpen={false} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="bg-primary hover:bg-primary text-white"
            onClick={handleSave}
            disabled={isSaving || isLoading || !data}
          >
            {isSaving ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Saving...</> : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
