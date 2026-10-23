'use client';

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
import { Bell, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function Header() {
  const user = {
    name: 'User',
    email: 'user@example.com',
    initials: 'U',
  };

  return (
    <header className="flex h-16 items-center justify-between border-b border-sidebar-accent bg-gradient-to-r from-primary to-sidebar-accent px-6 shadow-md">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-300" />
          <Input
            type="search"
            placeholder="Search..."
            className="pl-10 bg-sidebar-accent/60 border-primary/50 text-white placeholder:text-green-300/60 focus:border-secondary/60 focus:ring-secondary/20"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="relative text-white hover:bg-sidebar-accent/70">
          <Bell className="h-5 w-5" />
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-secondary ring-1 ring-primary" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-10 w-10 rounded-full hover:bg-sidebar-accent/70">
              <Avatar>
                <AvatarFallback className="bg-secondary text-foreground font-bold">
                  {user.initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 border-primary/30">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
