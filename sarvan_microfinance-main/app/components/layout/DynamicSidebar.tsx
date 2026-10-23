// ============================================================
// DYNAMIC SIDEBAR — Built from DB-driven menu items
// app/components/layout/DynamicSidebar.tsx
// ============================================================

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/app/store/authStore';
import { usePermission } from '@/app/hooks/usePermission';
import { Shield, Users, LayoutGrid } from 'lucide-react';

interface MenuItemData {
  id: string;
  label: string;
  path?: string | null;
  icon?: string | null;
  badge?: string | null;
  children?: MenuItemData[];
}

const ADMIN_STATIC_ITEMS = [
  { label: 'Role Management', path: '/dashboard/admin/roles', icon: Shield },
  { label: 'User Management', path: '/dashboard/admin/users', icon: Users },
] as const;

export function DynamicSidebar() {
  const menuItems = useAuthStore((s) => s.menuItems) as MenuItemData[];
  const user = useAuthStore((s) => s.user);
  const activeBranch = useAuthStore((s) => s.activeBranch);
  const roles = useAuthStore((s) => s.roles);
  const pathname = usePathname();
  const { hasRole } = usePermission();

  const isAdmin = hasRole('admin');

  const hasAdminMenuFromDB = menuItems.some(
    (item) =>
      item.path === '/dashboard/admin/roles' ||
      item.children?.some((c) => c.path === '/dashboard/admin/roles')
  );

  return (
    <aside className="w-64 h-screen bg-gradient-to-b from-sidebar-accent to-brand-green-darker text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-primary/50">
        <h1 className="font-bold text-lg tracking-wide">Sarvan MFI</h1>
        {activeBranch && (
          <p className="text-xs text-green-300/70 mt-1">{activeBranch.name}</p>
        )}
      </div>

      {/* Yellow accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-secondary via-brand-yellow-light to-secondary" />

      {/* User info */}
      <div className="p-3 border-b border-primary/30">
        <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
        <div className="flex flex-wrap gap-1 mt-1">
          {roles.slice(0, 2).map((role) => (
            <span
              key={role.roleId}
              className="text-xs bg-secondary text-foreground font-semibold rounded px-1.5 py-0.5"
            >
              {role.roleName}
            </span>
          ))}
          {roles.length > 2 && (
            <span className="text-xs text-green-300/70">+{roles.length - 2}</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2">
        {menuItems.length === 0 ? (
          <div className="px-4 py-8 text-center text-green-400/60 text-sm">
            No menu items available
          </div>
        ) : (
          menuItems.map((item) => (
            <MenuItem key={item.id} item={item} pathname={pathname} />
          ))
        )}

        {isAdmin && !hasAdminMenuFromDB && (
          <div className="mt-3">
            <div className="flex items-center gap-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-secondary/80">
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Administration</span>
            </div>

            {ADMIN_STATIC_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`flex items-center gap-2 pl-8 pr-4 py-2 text-sm transition-colors ${
                    isActive
                      ? 'bg-secondary text-foreground font-semibold'
                      : 'text-green-100 hover:bg-primary/50 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0 opacity-80" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
}

function MenuItem({
  item,
  pathname,
  depth = 0,
}: {
  item: MenuItemData;
  pathname: string;
  depth?: number;
}) {
  const isActive = item.path ? pathname.startsWith(item.path) : false;
  const hasChildren = item.children && item.children.length > 0;

  if (hasChildren) {
    return (
      <div>
        <div
          className={`flex items-center justify-between px-4 py-2 text-xs font-semibold uppercase tracking-wider mt-3 mb-1 ${
            isActive ? 'text-secondary' : 'text-green-300/70'
          }`}
        >
          <span>{item.label}</span>
          {item.badge && (
            <span className="bg-secondary text-foreground text-xs rounded-full px-1.5 py-0.5 font-bold">
              {item.badge}
            </span>
          )}
        </div>
        {item.children!.map((child) => (
          <MenuItem key={child.id} item={child} pathname={pathname} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <Link
      href={item.path ?? '#'}
      className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
        isActive
          ? 'bg-secondary text-foreground font-semibold'
          : 'text-green-100 hover:bg-primary/50 hover:text-white'
      } ${depth > 0 ? 'pl-8' : ''}`}
    >
      {item.icon && <span className="w-4 h-4 opacity-80">{item.icon}</span>}
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className="bg-secondary text-foreground text-xs rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center font-bold">
          {item.badge}
        </span>
      )}
    </Link>
  );
}
