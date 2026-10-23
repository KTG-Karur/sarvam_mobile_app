'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavigationItem } from '@/app/config/navigation.config';
import { SidebarMenuItem } from './SidebarMenuItem';

function isItemOrDescendantActive(node: NavigationItem, currentPath: string): boolean {
    if (node.children && node.children.length > 0) {
        return node.children.some((child) => isItemOrDescendantActive(child, currentPath));
    }
    if (!node.href) return false;
    if (node.href === '/dashboard' || node.href === '/dashboard/hr') {
        return currentPath === node.href;
    }
    return currentPath === node.href || currentPath.startsWith(node.href + '/');
}

/**
 * Open-state for one level of dropdowns. The dropdown holding the current page stays open
 * (and highlighted) even while the user opens one other dropdown to browse — opening
 * "Center Operations" from a Client page no longer collapses Client. The active dropdown can
 * still be closed by clicking it; navigating resets both back to "only the active one open".
 */
export function useSidebarOpenState(entries: { key: string; item: NavigationItem }[]) {
    const pathname = usePathname();
    // Tagged with the path it was set on, so a navigation resets it without an effect.
    const [state, setState] = useState({ path: pathname, browsedKey: null as string | null, activeClosed: false });
    const current = state.path === pathname ? state : { path: pathname, browsedKey: null, activeClosed: false };

    const activeKey =
        entries.find(({ item }) => item.children?.length && isItemOrDescendantActive(item, pathname))?.key ?? null;

    const isOpen = (key: string) => key === current.browsedKey || (key === activeKey && !current.activeClosed);
    const toggle = (key: string) =>
        setState(
            key === activeKey
                ? { ...current, activeClosed: !current.activeClosed }
                : { ...current, browsedKey: current.browsedKey === key ? null : key }
        );

    return { isOpen, toggle };
}

interface SidebarSectionProps {
    item: NavigationItem;
    isCollapsed: boolean;
    level?: number;
    isOpen: boolean;
    onToggle: () => void;
    /** While the sidebar search is active, every matching branch is shown expanded. */
    forceOpen?: boolean;
}

export function SidebarSection({ item, isCollapsed, level = 0, isOpen: isOpenProp, onToggle, forceOpen = false }: SidebarSectionProps) {
    const isOpen = forceOpen || isOpenProp;
    const pathname = usePathname();
    const childOpenState = useSidebarOpenState(
        (item.children ?? []).map((child, index) => ({ key: `${child.href}-${index}`, item: child }))
    );
    const Icon = item.icon;

    const isSectionActive = level === 0 && isItemOrDescendantActive(item, pathname);

    if (!item.children || item.children.length === 0) {
        return (
            <SidebarMenuItem
                name={item.name}
                href={item.href}
                icon={item.icon}
                isCollapsed={isCollapsed}
                isChild={level > 0}
                level={level}
            />
        );
    }

    const getButtonColors = () => {
        if (level === 0) {
            if (isSectionActive) {
                return 'bg-secondary text-secondary-foreground font-semibold shadow-md shadow-secondary/30';
            }
            return 'text-green-100 hover:bg-primary/60 hover:text-white';
        }
        return 'text-green-200 hover:bg-primary/50 hover:text-white bg-sidebar-accent/40 border-l-2 border-primary/40';
    };

    return (
        <div>
            <button
                onClick={(e) => {
                    // Expanding/collapsing a dropdown shouldn't bubble up and trigger anything
                    // above it (the mobile sidebar no longer auto-closes on nav clicks at all —
                    // see AppSidebar.tsx — but stopPropagation is kept as a general safeguard).
                    e.stopPropagation();
                    onToggle();
                }}
                className={cn(
                    'group flex w-full items-center gap-3 rounded-lg py-2.5 text-sm font-medium transition-all duration-200',
                    level === 0 ? 'px-3' : 'pl-11 pr-3',
                    getButtonColors(),
                    isCollapsed && 'justify-center px-2'
                )}
                title={isCollapsed ? item.name : undefined}
            >
                <Icon
                    className={cn(
                        'h-5 w-5 flex-shrink-0 transition-colors',
                        isSectionActive ? 'text-secondary-foreground' : 'text-green-300 group-hover:text-white'
                    )}
                />
                {/* Always mounted and faded/collapsed via CSS (not `{!isCollapsed && ...}`) so the
                    label doesn't vanish at t=0 while the sidebar's own width transition is still
                    running — see SidebarMenuItem.tsx for the same fix and its reasoning. */}
                <span
                    className={cn(
                        'overflow-hidden text-left leading-tight transition-all duration-300 ease-in-out',
                        isCollapsed ? 'w-0 whitespace-nowrap opacity-0' : 'min-w-0 flex-1 opacity-100'
                    )}
                >
                    {item.name}
                </span>
                <ChevronDown
                    className={cn(
                        'h-4 w-4 shrink-0 transition-all duration-200',
                        isSectionActive && 'text-secondary-foreground',
                        isOpen && 'rotate-180',
                        isCollapsed ? 'w-0 opacity-0' : 'opacity-100'
                    )}
                />
            </button>

            {!isCollapsed && isOpen && (
                <div className="mt-1 space-y-1 ml-2">
                    {item.children.map((child, index) => {
                        const childKey = `${child.href}-${index}`;
                        return (
                            <SidebarSection
                                key={childKey}
                                item={child}
                                isCollapsed={isCollapsed}
                                level={level + 1}
                                forceOpen={forceOpen}
                                isOpen={childOpenState.isOpen(childKey)}
                                onToggle={() => childOpenState.toggle(childKey)}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
}
