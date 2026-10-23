'use client';

import { Bell, UserCircle, Users, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UserMenu } from './UserMenu';

interface AppHeaderProps {
    onMobileMenuToggle?: () => void;
    /** The sidebar already shows its own X close button while open — this hamburger
     * would otherwise sit right next to it, doing the same job twice. */
    isMobileSidebarOpen?: boolean;
}

export function AppHeader({ onMobileMenuToggle, isMobileSidebarOpen }: AppHeaderProps) {
    return (
        <header className="flex h-14 sm:h-16 items-center justify-between border-b border-sidebar-accent bg-gradient-to-r from-primary to-sidebar-accent px-3 sm:px-6 shadow-md">
            {/* Left Section */}
            <div className="flex items-center gap-2">
                {/* Hamburger — mobile only, hidden while the sidebar is open (its own X closes it) */}
                {!isMobileSidebarOpen && (
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onMobileMenuToggle}
                        className="text-white hover:text-white hover:bg-white/15 active:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70 lg:hidden"
                        aria-label="Open navigation menu"
                    >
                        <Menu className="h-6 w-6 text-white drop-shadow-sm" strokeWidth={2.5} />
                    </Button>
                )}
            </div>

            {/* Right Section - Actions & User */}
            <div className="flex items-center gap-1 sm:gap-3">
                {/* User Friend Button — hidden on very small screens */}
                {/* <Button
                    variant="ghost"
                    size="icon"
                    className="hidden sm:flex text-white hover:bg-sidebar-accent/70"
                    title="User Friend"
                >
                    <Users className="h-5 w-5" />
                </Button> */}

                {/* Notifications */}
                {/* <Button
                    variant="ghost"
                    size="icon"
                    className="relative text-white hover:bg-sidebar-accent/70"
                    title="Notifications"
                >
                    <Bell className="h-5 w-5" />
                    <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-secondary ring-2 ring-primary" />
                </Button> */}

                {/* User Menu */}
                <UserMenu />

                {/* Logout Icon — hidden on very small screens */}
                {/* <Button
                    variant="ghost"
                    size="icon"
                    className="hidden sm:flex text-white hover:bg-sidebar-accent/70"
                    title="Logout"
                >
                    <UserCircle className="h-5 w-5" />
                </Button> */}
            </div>
        </header>
    );
}
