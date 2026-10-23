'use client';

import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface TableSearchInputProps {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
}

/** Search box for client-side "find anything in this table" filtering — pair with useTableSearch. */
export function TableSearchInput({ value, onChange, placeholder = 'Search...', className }: TableSearchInputProps) {
    return (
        <div className={cn('relative', className)}>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="pl-8 pr-8 w-full sm:w-64"
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label="Clear search"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}
