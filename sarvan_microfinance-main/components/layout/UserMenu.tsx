'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, LogOut } from 'lucide-react';
import { ProfileModal } from '@/components/layout/ProfileModal';
import { useRouter } from 'next/navigation';
import { branchStorage, StoredBranch } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { apiClient } from '@/app/lib/api-client';
import { getRoleDisplayName } from '@/app/lib/role-display';

interface UserMenuProps {
    userName?: string;
    userRole?: string;
    userId?: string;
}

export function UserMenu({
    userName: propUserName,
    userRole: propUserRole,
    userId: propUserId,
}: UserMenuProps) {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [activeBranch, setActiveBranch] = useState<StoredBranch | null>(null);
    const [userName, setUserName] = useState<string>(propUserName || 'Administrator');
    const [userRole, setUserRole] = useState<string>(propUserRole || 'ADMINISTRATOR');
    const [userId, setUserId] = useState<string>(propUserId || 'K-MS-1001-014');
    const [profileOpen, setProfileOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
        // Load user data from storage
        const storedUser = tokenStorage.getUser();
        if (storedUser) {
            setUserName(`${storedUser.firstName} ${storedUser.lastName}`);
            setUserId(storedUser.id);
            // Use RBAC role name if available so custom roles like "Background Verification Team"
            // are shown correctly instead of the legacy enum fallback "Field Development Officer".
            setUserRole(getRoleDisplayName(storedUser));
        } else if (propUserName) {
            // Use props if provided and no stored user
            setUserName(propUserName);
            setUserRole(propUserRole || 'ADMINISTRATOR');
            setUserId(propUserId || 'K-MS-1001-014');
        }

        // Load active branch on mount
        const branch = branchStorage.getActiveBranch();
        setActiveBranch(branch);

        // If no active branch but user has a branchId, fetch and set it
        if (!branch && storedUser?.branchId) {
            apiClient.get<{
                id: string;
                name: string;
                code: string;
                address?: string | null;
            }>(`/branches/${storedUser.branchId}`)
                .then((result) => {
                    if (result.success && result.data) {
                        const branchData: StoredBranch = {
                            id: result.data.id,
                            name: result.data.name,
                            code: result.data.code,
                            address: result.data.address || null,
                        };
                        branchStorage.setActiveBranch(branchData);
                        setActiveBranch(branchData);
                    }
                })
                .catch((error) => {
                    console.error('Error fetching branch:', error);
                });
        }

        // Listen for branch change events
        const handleBranchChange = (event: CustomEvent<StoredBranch>) => {
            setActiveBranch(event.detail);
        };

        window.addEventListener('branchChanged', handleBranchChange as EventListener);

        return () => {
            window.removeEventListener('branchChanged', handleBranchChange as EventListener);
        };
    }, [propUserName, propUserRole, propUserId]);

    const handleLogout = () => {
        // Clear all storage
        tokenStorage.clear();
        branchStorage.clearActiveBranch();
        router.push('/login');
    };

    if (!mounted) {
        return (
            <div className="flex items-center gap-3 px-3 py-2 text-white/50">
                <div className="flex flex-col items-end">
                    <div className="h-4 w-20 animate-pulse rounded bg-primary/50" />
                </div>
                <div className="h-9 w-9 animate-pulse rounded-full bg-primary/50 border-2 border-secondary/30" />
            </div>
        );
    }

    return (
        <>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="flex items-center gap-2 text-white hover:text-white focus:text-white focus-visible:text-white active:text-white data-[state=open]:text-white hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent/70 max-w-[180px] sm:max-w-none px-2 sm:px-3 focus-visible:ring-0"
                >
                    <div className="hidden sm:flex flex-col items-end min-w-0">
                        <span className="text-sm font-semibold text-white truncate max-w-[120px]">{userRole}</span>
                        {activeBranch && (
                            <span className="text-xs text-secondary/80 truncate max-w-[120px]">
                                {activeBranch.name} ({activeBranch.code})
                            </span>
                        )}
                    </div>
                    <Avatar className="h-9 w-9 border-2 border-secondary">
                        <AvatarFallback className="bg-secondary text-secondary-foreground font-bold">
                            {userRole.charAt(0)}
                        </AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{userName}</p>
                        <p className="text-xs leading-none text-muted-foreground">
                            {userRole}
                        </p>
                        {activeBranch && (
                            <p className="text-xs leading-none text-muted-foreground">
                                {activeBranch.name} ({activeBranch.code})
                            </p>
                        )}
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                    <User className="mr-2 h-4 w-4" />
                    Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Logout
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>

        <ProfileModal
            open={profileOpen}
            onOpenChange={setProfileOpen}
            userId={userId}
        />
        </>
    );
}
