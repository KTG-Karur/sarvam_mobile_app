'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface SidebarMenuItemProps {
    name: string;
    href: string;
    icon: LucideIcon;
    isCollapsed: boolean;
    isChild?: boolean;
    level?: number;
}

export function SidebarMenuItem({
    name,
    href,
    icon: Icon,
    isCollapsed,
    isChild = false,
    level = 0,
}: SidebarMenuItemProps) {
    const pathname = usePathname();
    const isExactMatchOnly = href === '/dashboard/hr' || href === '/dashboard';
    const isActive = isExactMatchOnly || level === 0
        ? pathname === href
        : pathname.startsWith(href) && (pathname === href || pathname.startsWith(href + '/'));

    const paddingClass = level === 0 ? 'px-3' : level === 1 ? 'pl-11 pr-3' : 'pl-16 pr-3';

    const getColors = () => {
        if (isActive) {
            // Yellow highlight for active item
            return 'bg-secondary text-secondary-foreground font-semibold shadow-md shadow-secondary/30';
        }
        if (level === 0) {
            return 'text-green-100 hover:bg-primary/60 hover:text-white';
        }
        // Sub-nav items
        return 'text-green-200 hover:bg-primary/50 hover:text-white bg-sidebar-accent/40 border-l-2 border-primary/40';
    };

    return (
        <Link
            href={href}
            className={cn(
                'group flex items-center gap-3 rounded-lg py-2.5 text-sm transition-all duration-200',
                paddingClass,
                getColors(),
                isCollapsed && 'justify-center px-2'
            )}
            title={isCollapsed ? name : undefined}
        >
            <Icon
                className={cn(
                    'h-5 w-5 flex-shrink-0',
                    isActive ? 'text-secondary-foreground' : 'text-green-300 group-hover:text-white'
                )}
            />
            {/* Always mounted (not `{!isCollapsed && ...}`) and faded/collapsed via CSS instead —
                an instant unmount made the label vanish at t=0 while the sidebar's own width
                transition kept running for another 300ms, which read as janky. whitespace-nowrap
                only applies while actually collapsed (desktop-only state) — normally expanded
                labels must stay free to WRAP (long labels on the narrow mobile overlay). */}
            <span
                className={cn(
                    'overflow-hidden leading-tight transition-all duration-300 ease-in-out',
                    isCollapsed ? 'w-0 whitespace-nowrap opacity-0' : 'min-w-0 flex-1 opacity-100'
                )}
            >
                {name}
            </span>
        </Link>
    );
}
