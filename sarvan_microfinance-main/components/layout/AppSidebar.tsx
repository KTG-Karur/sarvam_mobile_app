'use client';

import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { navigationConfig, type NavigationItem } from '@/app/config/navigation.config';
import { SidebarBrand } from '@/components/sidebar/SidebarBrand';
import { SidebarSection, useSidebarOpenState } from '@/components/sidebar/SidebarSection';
import { LogOut, AlertCircle, X, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { tokenStorage } from '@/app/lib/token-storage';
import type { UserRole } from '@/app/types';
import { useAuthStore } from '@/app/store/authStore';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';

// ─── Combined role + page-permission filter ────────────────────────────────
// A leaf item is visible if EITHER the legacy static allowedRoles check
// passes OR the RBAC page-permission grant explicitly turns it on for this
// href — the same OR semantics as resolvePageAuthorization() in
// app/lib/permissions/route-authorization.ts (pagePermissions only ever ADDS
// access on top of allowedRoles, it never revokes it).
//
// Treating a saved pagePermissions snapshot as a full REPLACEMENT (the old
// behavior) silently hid every nav item added to navigationConfig after that
// snapshot was last saved from the Role Permissions admin screen — the
// PageActionsSchema on save defaults every unlisted page to `view: false`,
// so a role's sidebar could go stale the moment a new page was shipped,
// without anyone touching that role's permissions at all.
function filterNavigation(
    items: NavigationItem[],
    effectiveRoles: UserRole[],
    pagePerms: Record<string, unknown> | null
): NavigationItem[] {
    function legacyAllows(item: NavigationItem): boolean {
        if (!item.allowedRoles || item.allowedRoles.length === 0) return true;
        return item.allowedRoles.some((r) => effectiveRoles.includes(r));
    }

    function permGrantsView(val: unknown): boolean {
        if (val === null || val === undefined) return false;
        if (typeof val === 'object' && !Array.isArray(val)) {
            return (val as Record<string, boolean>).view === true;
        }
        return val === true;
    }

    function pagePermGrantsView(href: string): boolean {
        if (!pagePerms) return false;
        if (href in pagePerms) return permGrantsView(pagePerms[href]);
        const segments = href.split('/');
        for (let len = segments.length - 1; len > 2; len--) {
            const parentHref = segments.slice(0, len).join('/');
            if (parentHref in pagePerms) return permGrantsView(pagePerms[parentHref]);
        }
        return false;
    }

    return items
        .map((item) => {
            if (item.children && item.children.length > 0) {
                const visibleChildren = filterNavigation(item.children, effectiveRoles, pagePerms);
                if (visibleChildren.length === 0) return null;
                return { ...item, children: visibleChildren };
            }
            const visible = legacyAllows(item) || pagePermGrantsView(item.href);
            return visible ? item : null;
        })
        .filter((item): item is NavigationItem => item !== null);
}

// ─── Loan Advance feature-flag filter ──────────────────────────────────────────
// Strips any item flagged requiresLoanAdvance (and its children) when the
// project-wide Loan Advance switch is off — applied AFTER the role filter so
// it also strips items for ADMIN, who otherwise bypasses filterNavigation entirely.
function filterLoanAdvanceItems(items: NavigationItem[], loanAdvanceEnabled: boolean): NavigationItem[] {
    if (loanAdvanceEnabled) return items;
    return items
        .map((item) => {
            if (item.requiresLoanAdvance) return null;
            if (item.children && item.children.length > 0) {
                const children = filterLoanAdvanceItems(item.children, loanAdvanceEnabled);
                if (children.length === 0) return null;
                return { ...item, children };
            }
            return item;
        })
        .filter((item): item is NavigationItem => item !== null);
}

// ─── Search filter ─────────────────────────────────────────────────────────────
function searchNavigation(items: NavigationItem[], query: string): NavigationItem[] {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.reduce<NavigationItem[]>((acc, item) => {
        const nameMatch = item.name.toLowerCase().includes(q);
        if (item.children && item.children.length > 0) {
            const matchedChildren = searchNavigation(item.children, query);
            if (nameMatch) {
                acc.push(item);
            } else if (matchedChildren.length > 0) {
                acc.push({ ...item, children: matchedChildren });
            }
        } else {
            if (nameMatch) acc.push(item);
        }
        return acc;
    }, []);
}

// ─── Component ────────────────────────────────────────────────────────────────
interface AppSidebarProps {
    isMobileOpen?: boolean;
    onMobileClose?: () => void;
}

export function AppSidebar({ isMobileOpen = false, onMobileClose }: AppSidebarProps) {
    const [mounted, setMounted] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const router = useRouter();

    const storePagePermissions = useAuthStore((s) => s.pagePermissions);
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();

    useEffect(() => {
        setMounted(true);

        const storedUser = tokenStorage.getUser();
        if (storedUser?.role) {
            setUserRole(storedUser.role as UserRole);
        }
    }, []);

    // Admin always gets the full, unfiltered nav — no branch-based downgrade,
    // and no allowedRoles/page-permission filtering. Matches the unconditional
    // Admin bypass in app/lib/permissions/route-authorization.ts and the backend guards.
    const isAdmin = userRole === 'ADMIN';

    const effectiveRoles = useMemo<UserRole[]>(() => {
        if (!userRole) return [];
        return [userRole];
    }, [userRole]);

    const filteredNavigation = useMemo(() => {
        const roleFiltered = isAdmin
            ? navigationConfig
            : filterNavigation(
                navigationConfig,
                effectiveRoles,
                storePagePermissions as unknown as Record<string, unknown> | null
            );
        return filterLoanAdvanceItems(roleFiltered, loanAdvanceEnabled);
    }, [effectiveRoles, isAdmin, storePagePermissions, loanAdvanceEnabled]);

    const displayNavigation = useMemo(
        () => searchNavigation(filteredNavigation, searchQuery),
        [filteredNavigation, searchQuery]
    );

    const topOpenState = useSidebarOpenState(
        displayNavigation.map((item) => ({ key: item.href, item }))
    );

    const handleLogout = () => {
        try {
            localStorage.removeItem('sarvan-page-permissions');
            localStorage.removeItem('sarvan-rbac-permissions');
        } catch { /* ignore */ }
        router.push('/login');
    };

    return (
        <>
            {/* Sidebar — fixed overlay on mobile (slides via transform so open/close animates), static on desktop */}
            <aside
                className={cn(
                    // Theme-aware background — tracks BrandConfig.sidebarBg
                    // transition-all (not a scoped transition-[width,transform] arbitrary
                    // list) so both the mobile slide (transform) and the desktop
                    // collapse/expand (width) reliably animate — Tailwind v4's comma-list
                    // arbitrary-property syntax isn't dependable here. overflow-hidden stops
                    // inner content from visibly spilling/reflowing while the width tweens.
                    'flex h-screen w-72 flex-col overflow-hidden border-r border-sidebar-accent bg-sidebar shadow-xl transition-all duration-300 ease-in-out',
                    // Mobile: always fixed + full height overlay, slide on/off screen instead of
                    // display:none <-> flex (which can't animate) — only a transform can.
                    'fixed inset-y-0 left-0 z-30',
                    isMobileOpen ? 'translate-x-0' : '-translate-x-full',
                    // Desktop: static in normal flow, ignore the mobile transform, collapsible width
                    'lg:relative lg:z-auto lg:flex lg:translate-x-0',
                    isCollapsed ? 'lg:w-16' : 'lg:w-72'
                )}
            >
                {/* Mobile close button */}
                {isMobileOpen && (
                    <button
                        onClick={onMobileClose}
                        className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-primary/70 text-white hover:bg-primary/90 lg:hidden"
                        aria-label="Close menu"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}

                {/* Brand Section */}
                <SidebarBrand
                    isCollapsed={isCollapsed}
                    onToggle={() => setIsCollapsed(!isCollapsed)}
                />

                {/* Yellow Accent Bar */}
                <div className="h-1 bg-gradient-to-r from-secondary via-secondary/50 to-secondary bg-[length:200%_100%] animate-shimmer" />

                {/* Search bar - only show when not collapsed */}
                {!isCollapsed && (
                    <div className="px-3 pt-3 pb-1">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-green-300 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search menu..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-md bg-primary/40 pl-8 pr-3 py-2 text-sm text-white placeholder-green-300/70 border border-primary focus:outline-none focus:border-secondary focus:ring-1 focus:ring-secondary"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-2.5 text-green-300 hover:text-white"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Navigation Menu — clicking a page link no longer auto-closes the mobile
                    sidebar; it now only closes via the X button or tapping the backdrop
                    overlay (see app/dashboard/layout.tsx's mobile overlay onClick). */}
                <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin scrollbar-track-green-dark scrollbar-thumb-green">
                    {mounted && (
                        searchQuery && displayNavigation.length === 0
                            ? (
                                <div className="px-3 py-4 text-center text-sm text-green-300/70">
                                    No menu found for &ldquo;{searchQuery}&rdquo;
                                </div>
                            )
                            : displayNavigation.length === 0 && !effectiveRoles.includes('ADMIN')
                                ? (
                                    isCollapsed
                                        ? (
                                            <div
                                                className="flex justify-center pt-4"
                                                title="No pages assigned. Contact your Administrator."
                                            >
                                                <AlertCircle className="h-5 w-5 text-secondary" />
                                            </div>
                                        )
                                        : (
                                            <div className="mx-1 mt-4 rounded-lg border border-secondary/40 bg-secondary/10 p-4 text-center">
                                                <AlertCircle className="mx-auto mb-2 h-8 w-8 text-secondary" />
                                                <p className="text-sm font-semibold text-secondary">
                                                    No Pages Assigned
                                                </p>
                                                <p className="mt-1.5 text-xs leading-relaxed text-secondary/80">
                                                    Please contact your Administrator to get access to pages.
                                                </p>
                                            </div>
                                        )
                                )
                                : displayNavigation.map((item) => (
                                    <SidebarSection
                                        key={item.href}
                                        item={item}
                                        isCollapsed={isCollapsed}
                                        forceOpen={!!searchQuery.trim()}
                                        isOpen={topOpenState.isOpen(item.href)}
                                        onToggle={() => topOpenState.toggle(item.href)}
                                    />
                                ))
                    )}
                </nav>

                {/* Logout Button */}
                <div className="border-t border-sidebar-accent p-3">
                    <Button
                        variant="ghost"
                        onClick={handleLogout}
                        className={cn(
                            'w-full justify-start text-green-100 hover:bg-primary/60 hover:text-white',
                            isCollapsed && 'justify-center px-2'
                        )}
                        title={isCollapsed ? 'Logout' : undefined}
                    >
                        <LogOut className="h-5 w-5 flex-shrink-0" />
                        {!isCollapsed && <span className="ml-3">Logout</span>}
                    </Button>
                </div>
            </aside>
        </>
    );
}
