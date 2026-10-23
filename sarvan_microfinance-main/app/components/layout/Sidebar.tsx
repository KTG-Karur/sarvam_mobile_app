'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Building2,
  FileText,
  CreditCard,
  Settings,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { companyNameShort } from '@/hooks/use-toast';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Centers', href: '/dashboard/centers', icon: Building2 },
  { name: 'Clients', href: '/dashboard/clients', icon: Users },
  { name: 'Loans', href: '/dashboard/loans', icon: CreditCard },
  { name: 'Collections', href: '/dashboard/collections', icon: FileText },
  { name: 'Reports', href: '/dashboard/reports', icon: FileText },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <div className="flex h-full w-64 flex-col border-r border-sidebar-accent bg-gradient-to-b from-sidebar-accent to-brand-green-darker">
      <div className="flex h-16 items-center border-b border-sidebar-accent/50 px-6">
        <div className="flex flex-col leading-tight">
          <h2 className="text-lg font-extrabold text-white tracking-wide">
            {companyNameShort}
          </h2>
          <span className="text-[10px] font-semibold tracking-widest text-secondary uppercase">
            Microfinance
          </span>
        </div>
      </div>

      {/* Yellow accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-secondary via-brand-yellow-light to-secondary" />

      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-secondary text-foreground font-semibold shadow-md'
                  : 'text-green-100 hover:bg-primary/60 hover:text-white'
              )}
            >
              <item.icon
                className={cn(
                  'h-5 w-5',
                  isActive ? 'text-foreground' : 'text-green-300'
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-accent/50 p-4">
        <Button
          variant="ghost"
          className="w-full justify-start text-green-100 hover:bg-primary/60 hover:text-white"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4 text-green-300" />
          Logout
        </Button>
      </div>
    </div>
  );
}
