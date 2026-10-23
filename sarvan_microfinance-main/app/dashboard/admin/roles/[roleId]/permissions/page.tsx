'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Save, Loader2, Lock, AlertTriangle, RotateCcw, Eye, EyeOff,
  CheckSquare, Square, ChevronDown, ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { toast } from '@/app/hooks/use-toast';
import { tokenStorage } from '@/app/lib/token-storage';
import {
  getApplicableActions,
  emptyActions,
  asNode,
  collectSubtree,
  allPageEntries,
  SECTIONS,
  type ActionKey,
  type PageActions,
  type PermNode,
  type PermSection,
} from '@/app/lib/permissions/page-permission-tree';

// ─── Types ────────────────────────────────────────────────────
type PagePermissions = Record<string, PageActions>;

// Actions shown per page (View always shown, others depend on page type)
const ALL_ACTIONS: { key: ActionKey; label: string; color: string }[] = [
  { key: 'view',    label: 'View',    color: 'bg-primary'  },
  { key: 'add',     label: 'Add',     color: 'bg-green-600' },
  { key: 'edit',    label: 'Edit',    color: 'bg-amber-500' },
  { key: 'delete',  label: 'Delete',  color: 'bg-red-500'   },
  { key: 'approve', label: 'Approve', color: 'bg-purple-600' },
];

// Mirrors AppSidebar's isPageVisible() parent-prefix fallback: a page with no
// explicit entry inherits view access from the nearest configured ancestor.
function resolveInheritedView(href: string, perms: PagePermissions): boolean {
  if (href in perms) return perms[href].view;
  const segments = href.split('/');
  for (let len = segments.length - 1; len > 2; len--) {
    const parentHref = segments.slice(0, len).join('/');
    if (parentHref in perms) return perms[parentHref].view;
  }
  return false;
}

// ─── Page Component ───────────────────────────────────────────
export default function RolePermissionsPage() {
  const params = useParams();
  const router = useRouter();
  const roleId = params.roleId as string;

  const [role, setRole] = useState<{ name: string; slug: string; color: string | null } | null>(null);
  const [permissions, setPermissions] = useState<PagePermissions>({});
  const [originalPermissions, setOriginalPermissions] = useState<PagePermissions>({});
  const [isConfigured, setIsConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(SECTIONS.map((s) => s.name))
  );

  // ── Auth guard ─────────────────────────────────────────────
  const [userRole, setUserRole] = useState<string | null>(null);
  useEffect(() => {
    const user = tokenStorage.getUser();
    setUserRole(user?.role ?? null);
  }, []);
  const isNonAdmin = userRole !== null && userRole !== 'ADMIN';
  useEffect(() => {
    if (isNonAdmin) router.replace('/dashboard?error=insufficient_permissions');
  }, [isNonAdmin, router]);

  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [roleRes, permsRes] = await Promise.all([
        fetch(`/api/admin/roles/${roleId}`),
        fetch(`/api/admin/roles/${roleId}/page-permissions`),
      ]);
      const [roleData, permsData] = await Promise.all([roleRes.json(), permsRes.json()]);

      if (roleData.success) setRole(roleData.role);

      if (permsData.success) {
        if (permsData.pagePermissions === null) {
          setIsConfigured(false);
          setPermissions({});
          setOriginalPermissions({});
        } else {
          setIsConfigured(true);
          // Ensure all pages have all action keys (migrate old format if needed)
          const normalized: PagePermissions = {};
          for (const [href, val] of Object.entries(permsData.pagePermissions as Record<string, unknown>)) {
            if (typeof val === 'boolean') {
              // Old format { href: boolean } → migrate
              normalized[href] = { ...emptyActions(), view: val };
            } else {
              normalized[href] = { ...emptyActions(), ...(val as Partial<PageActions>) };
            }
          }
          // Newly-exposed nested pages (e.g. sub-reports under Portfolio) may not
          // have an explicit saved entry yet even though they're currently
          // reachable via the parent-prefix fallback in AppSidebar. Seed them as
          // checked so the screen reflects real current access — otherwise
          // hitting Save would silently revoke pages the role can access today.
          for (const entry of allPageEntries()) {
            if (!(entry.href in normalized) && resolveInheritedView(entry.href, normalized)) {
              normalized[entry.href] = { ...emptyActions(), view: true };
            }
          }
          setPermissions(normalized);
          setOriginalPermissions({ ...normalized });
        }
      }
    } catch {
      toast({ title: 'Failed to load data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [roleId]);

  useEffect(() => {
    if (userRole === 'ADMIN') loadData();
  }, [userRole, loadData]);

  if (isNonAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-gray-500">
        <Lock className="h-12 w-12 text-red-300" />
        <p className="text-lg font-medium">Access Restricted</p>
        <p className="text-sm">Only Administrators can manage role permissions.</p>
      </div>
    );
  }

  // ── Tree-aware helpers ─────────────────────────────────────
  // A node with children is "fully checked" for an action only when itself
  // AND every descendant that supports that action has it checked — so a
  // heading's box reflects its whole group, not just its own href.
  const isFullyChecked = (node: PermNode, action: ActionKey): boolean =>
    collectSubtree(node).every(
      (n) => !n.applicableActions.includes(action) || (permissions[n.href]?.[action] ?? false)
    );

  const isAllActionsChecked = (node: PermNode): boolean =>
    collectSubtree(node).every((n) =>
      n.applicableActions.every((a) => permissions[n.href]?.[a] ?? false)
    );

  const isNodeVisible = (node: PermNode): boolean =>
    collectSubtree(node).some((n) => permissions[n.href]?.view ?? false);

  // Toggle one action across a node's whole subtree: checking a heading grants
  // it (and every child under it); unchecking it revokes the whole group.
  const toggleNodeAction = (node: PermNode, action: ActionKey) => {
    const nextValue = !isFullyChecked(node, action);
    setIsConfigured(true);
    setPermissions((p) => {
      const next = { ...p };
      for (const n of collectSubtree(node)) {
        if (!n.applicableActions.includes(action)) continue;
        const current = next[n.href] ?? emptyActions();
        const updated = { ...current, [action]: nextValue };
        if (action === 'view' && !nextValue) Object.assign(updated, emptyActions());
        if (action !== 'view' && nextValue) updated.view = true;
        next[n.href] = updated;
      }
      return next;
    });
  };

  // Toggle every applicable action across a node's whole subtree (full access or none)
  const toggleAllActionsForNode = (node: PermNode) => {
    const nextValue = !isAllActionsChecked(node);
    setIsConfigured(true);
    setPermissions((p) => {
      const next = { ...p };
      for (const n of collectSubtree(node)) {
        const updated = emptyActions();
        if (nextValue) n.applicableActions.forEach((a) => { updated[a] = true; });
        next[n.href] = updated;
      }
      return next;
    });
  };

  // Flat view of everything under a section (used for header stats/quick-toggles)
  const sectionFlatNodes = (section: PermSection): PermNode[] =>
    section.isLeaf ? [asNode(section.sectionHref, section.name)] : section.nodes.flatMap(collectSubtree);

  // Toggle all pages in a section for a specific action
  const toggleSectionAction = (section: PermSection, action: ActionKey) => {
    const flatNodes = sectionFlatNodes(section).filter((n) => n.applicableActions.includes(action));
    const allChecked = flatNodes.every((n) => permissions[n.href]?.[action]);
    setIsConfigured(true);
    setPermissions((p) => {
      const next = { ...p };
      flatNodes.forEach((n) => {
        const current = next[n.href] ?? emptyActions();
        const updated = { ...current, [action]: !allChecked };
        if (action !== 'view' && !allChecked) updated.view = true;
        if (action === 'view' && allChecked) Object.assign(updated, emptyActions());
        next[n.href] = updated;
      });
      return next;
    });
  };

  // Toggle expand/collapse section
  const toggleExpand = (name: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // ── Save ───────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      // Build full permissions map: all pages with all action keys
      const fullPerms: PagePermissions = {};
      for (const entry of allPageEntries()) {
        const current = permissions[entry.href] ?? emptyActions();
        const actions: PageActions = { ...emptyActions() };
        // Only store actions that are applicable to this page
        entry.applicableActions.forEach((a) => { actions[a] = current[a] ?? false; });
        fullPerms[entry.href] = actions;
      }

      const res = await fetch(`/api/admin/roles/${roleId}/page-permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagePermissions: fullPerms }),
      });

      const data = await res.json();
      if (data.success) {
        setPermissions(fullPerms);
        setOriginalPermissions({ ...fullPerms });
        setIsConfigured(true);
        const viewCount = Object.values(fullPerms).filter((a) => a.view).length;
        toast({ title: `Saved — ${viewCount} pages accessible in sidebar` });
      } else {
        toast({ title: data.error ?? 'Failed to save', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Reset to default ───────────────────────────────────────
  const handleReset = async () => {
    setShowResetConfirm(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}/page-permissions`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setPermissions({});
        setOriginalPermissions({});
        setIsConfigured(false);
        toast({ title: 'Reset to default role configuration.' });
      } else {
        toast({ title: data.error ?? 'Failed to reset', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Computed stats ─────────────────────────────────────────
  const hasChanges = (() => {
    const all = allPageEntries();
    return all.some((e) => {
      const cur = permissions[e.href] ?? emptyActions();
      const orig = originalPermissions[e.href] ?? emptyActions();
      return ALL_ACTIONS.some((a) => cur[a.key] !== orig[a.key]);
    });
  })();

  const totalVisible = Object.values(permissions).filter((a) => a.view).length;

  const sectionVisible = (section: PermSection) =>
    section.isLeaf
      ? (permissions[section.sectionHref]?.view ?? false)
      : section.nodes.some((n) => isNodeVisible(n));

  // Recursively render a node and its children as indented table rows.
  const renderNodeRows = (nodes: PermNode[], depth: number, sectionName: string): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    nodes.forEach((node, idx) => {
      const hasChildren = node.children.length > 0;
      const nodeVisible = isNodeVisible(node);
      const allApplicableChecked = isAllActionsChecked(node);
      const rowIdx = rows.length;

      rows.push(
        <tr
          key={`${sectionName}-${node.href}-${depth}-${idx}`}
          className={`border-b border-gray-50 transition-colors ${
            rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
          } ${nodeVisible ? 'hover:bg-green-50/30' : 'hover:bg-gray-50'}`}
        >
          {/* Page / group name */}
          <td className="px-4 py-2.5" style={{ paddingLeft: `${16 + depth * 20}px` }}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleAllActionsForNode(node)}
                title={hasChildren ? 'Toggle all actions for this group and its sub-pages' : 'Toggle all actions for this page'}
                className="flex-shrink-0"
              >
                {allApplicableChecked ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-gray-300 hover:text-primary" />
                )}
              </button>
              <span className={`text-sm ${hasChildren ? 'font-semibold' : 'font-medium'} ${nodeVisible ? 'text-gray-800' : 'text-gray-400'}`}>
                {node.label}
              </span>
              {nodeVisible ? (
                <Eye className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
              ) : (
                <EyeOff className="h-3.5 w-3.5 text-gray-300 flex-shrink-0" />
              )}
            </div>
          </td>

          {/* Action cells */}
          {ALL_ACTIONS.map((action) => {
            const subtree = collectSubtree(node);
            const applicableInSubtree = subtree.some((n) => n.applicableActions.includes(action.key));
            if (!applicableInSubtree) {
              return (
                <td key={action.key} className="px-2 py-2.5 text-center">
                  <span className="text-gray-200 text-lg">—</span>
                </td>
              );
            }
            const checked = isFullyChecked(node, action.key);
            return (
              <td key={action.key} className="px-2 py-2.5 text-center">
                <button
                  onClick={() => toggleNodeAction(node, action.key)}
                  title={`${checked ? 'Revoke' : 'Grant'} ${action.label} for ${node.label}${hasChildren ? ' (and its sub-pages)' : ''}`}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center mx-auto transition-all hover:scale-110 ${
                    checked
                      ? `${action.color} border-transparent`
                      : 'bg-white border-gray-300 hover:border-gray-500'
                  }`}
                >
                  {checked && (
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </td>
            );
          })}
        </tr>
      );

      if (hasChildren) {
        rows.push(...renderNodeRows(node.children, depth + 1, sectionName));
      }
    });
    return rows;
  };

  if (loading) {
    return <PageLoader fullScreen={false} />;
  }

  return (
    <div className="space-y-5 pb-24">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              {role?.color && (
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
              )}
              <h1 className="text-2xl font-bold">{role?.name ?? '…'} — Page Permissions</h1>
            </div>
            <p className="text-sm text-gray-500">
              Set View/Add/Edit/Delete/Approve access per page. <strong>View</strong> controls sidebar visibility.
              Group headings control every page underneath them.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isConfigured && (
            <Button variant="outline" size="sm" onClick={() => setShowResetConfirm(true)} disabled={saving} className="gap-1.5 text-gray-600">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
          {hasChanges && (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200">Unsaved</Badge>
          )}
          <Button onClick={handleSave} disabled={saving || !hasChanges} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </div>

      {/* ── Not configured banner ── */}
      {!isConfigured && (
        <div className="flex items-start gap-3 bg-green-50 border border-primary/30 rounded-lg px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-sidebar-accent">
            <p className="font-medium">Using default role-based access</p>
            <p>No custom page permissions set. Configure below to enable page-level control.</p>
          </div>
        </div>
      )}

      {/* ── Legend & global stats ── */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-4 flex-wrap">
          {ALL_ACTIONS.map((a) => (
            <div key={a.key} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${a.color}`} />
              <span className="text-gray-600">{a.label}</span>
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1 text-green-700 font-medium">
            <Eye className="h-4 w-4 text-green-500" /> {totalVisible} visible
          </span>
          <Button variant="ghost" size="sm" className="text-xs text-primary h-7 px-2"
            onClick={() => {
              setIsConfigured(true);
              const all: PagePermissions = {};
              for (const e of allPageEntries()) {
                const a = emptyActions();
                e.applicableActions.forEach((k) => { a[k] = true; });
                all[e.href] = a;
              }
              setPermissions(all);
            }}>
            Grant All
          </Button>
          <Button variant="ghost" size="sm" className="text-xs text-gray-500 h-7 px-2"
            onClick={() => {
              setIsConfigured(true);
              const all: PagePermissions = {};
              for (const e of allPageEntries()) all[e.href] = emptyActions();
              setPermissions(all);
            }}>
            Revoke All
          </Button>
        </div>
      </div>

      {/* ── Sections ── */}
      <div className="space-y-3">
        {SECTIONS.map((section) => {
          const visible = sectionVisible(section);
          const isExpanded = expandedSections.has(section.name);
          const flatNodes = sectionFlatNodes(section);

          return (
            <Card
              key={section.name}
              className={`overflow-hidden border transition-colors ${
                visible ? 'border-primary/30' : 'border-gray-200'
              }`}
            >
              {/* Section header */}
              <CardHeader className="p-0">
                <div className="flex items-center">
                  {/* Section label / expand */}
                  <button
                    className="flex items-center gap-2 flex-1 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    onClick={() => !section.isLeaf && toggleExpand(section.name)}
                  >
                    <CardTitle className={`text-sm font-semibold ${visible ? 'text-sidebar-accent' : 'text-gray-700'}`}>
                      {section.name}
                    </CardTitle>
                    {/* Visibility badge */}
                    {visible ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                        <Eye className="h-3.5 w-3.5" /> Visible
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <EyeOff className="h-3.5 w-3.5" /> Hidden
                      </span>
                    )}
                    {!section.isLeaf && (
                      <span className="text-xs text-gray-400 ml-auto">
                        {flatNodes.filter((n) => permissions[n.href]?.view).length}/{flatNodes.length} pages visible
                      </span>
                    )}
                    {!section.isLeaf && (
                      <div className="text-gray-400 flex-shrink-0 ml-1">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                      </div>
                    )}
                  </button>

                  {/* Section-level action quick toggles (column headers for section) */}
                  {!section.isLeaf && (
                    <div className="flex items-center gap-1 px-3 border-l border-gray-100">
                      {ALL_ACTIONS.map((action) => {
                        const applicable = flatNodes.some((n) => n.applicableActions.includes(action.key));
                        if (!applicable) return null;
                        const allChecked = flatNodes
                          .filter((n) => n.applicableActions.includes(action.key))
                          .every((n) => permissions[n.href]?.[action.key]);
                        return (
                          <button
                            key={action.key}
                            onClick={() => toggleSectionAction(section, action.key)}
                            title={`Toggle ${action.label} for all pages in ${section.name}`}
                            className={`w-7 h-7 rounded text-xs font-bold transition-all border ${
                              allChecked
                                ? `${action.color} text-white border-transparent`
                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
                            }`}
                          >
                            {action.label.charAt(0)}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Leaf page inline actions */}
                  {section.isLeaf && (
                    <div className="flex items-center gap-1 px-3 border-l border-gray-100">
                      {ALL_ACTIONS.map((action) => {
                        const applicable = getApplicableActions(section.sectionHref).includes(action.key);
                        if (!applicable) return null;
                        const checked = permissions[section.sectionHref]?.[action.key] ?? false;
                        return (
                          <button
                            key={action.key}
                            onClick={() => toggleNodeAction(asNode(section.sectionHref, section.name), action.key)}
                            title={`${checked ? 'Revoke' : 'Grant'} ${action.label}`}
                            className={`w-7 h-7 rounded text-xs font-bold transition-all border ${
                              checked
                                ? `${action.color} text-white border-transparent`
                                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400'
                            }`}
                          >
                            {action.label.charAt(0)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardHeader>

              {/* Sub-pages table */}
              {!section.isLeaf && isExpanded && (
                <CardContent className="p-0 border-t border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-full">Page</th>
                        {ALL_ACTIONS.map((a) => (
                          <th key={a.key} className="px-2 py-2 text-xs font-semibold text-gray-500 text-center w-16">
                            {a.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {renderNodeRows(section.nodes, 0, section.name)}
                    </tbody>
                  </table>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Floating save bar ── */}
      {hasChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-xl px-6 py-3 shadow-2xl flex items-center gap-4 z-50">
          <span className="text-sm">Unsaved changes</span>
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary gap-2">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            Save Now
          </Button>
          <Button size="sm" variant="ghost" onClick={loadData} disabled={saving}
            className="text-gray-300 hover:text-white hover:bg-gray-800">
            Discard
          </Button>
        </div>
      )}

      <ConfirmationDialog
        open={showResetConfirm}
        onOpenChange={setShowResetConfirm}
        onConfirm={handleReset}
        title="Reset to default?"
        description="This removes all custom page permissions."
        confirmText="Reset"
        type="warning"
      />
    </div>
  );
}
