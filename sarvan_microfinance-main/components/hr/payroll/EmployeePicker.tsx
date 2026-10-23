'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { EMPLOYEE_PICKER_MAX_ROWS, filterEmployeeOptions, type EmployeeOption } from '@/app/lib/payroll/employee-picker-filter';

/**
 * Searchable employee dropdown for payroll pages. A plain <Select> draws one menu item per employee, which
 * gets slow when "All Branches" returns hundreds of people; this draws at most EMPLOYEE_PICKER_MAX_ROWS
 * matches and narrows as you type.
 */
export function EmployeePicker({
    employees,
    value,
    onChange,
    isLoading = false,
    id,
}: {
    employees: EmployeeOption[];
    /** Selected employee id, or 'all' for "nothing selected". */
    value: string;
    onChange: (id: string) => void;
    isLoading?: boolean;
    id?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const selected = employees.find((e) => e.id === value);
    const matches = useMemo(() => filterEmployeeOptions(employees, query), [employees, query]);
    const shown = matches.slice(0, EMPLOYEE_PICKER_MAX_ROWS);

    const choose = (next: string) => {
        onChange(next);
        setOpen(false);
        setQuery('');
    };

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
            <PopoverTrigger asChild>
                <Button
                    id={id}
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={isLoading}
                    className="w-full justify-between bg-white font-normal dark:bg-sidebar-accent"
                >
                    <span className={cn('truncate', !selected && 'text-muted-foreground')}>
                        {isLoading ? 'Loading employees...' : selected ? selected.name : '-- SELECT --'}
                    </span>
                    {isLoading ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" /> : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-2" align="start">
                <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={`Search ${employees.length} employees...`}
                    className="mb-2 h-9"
                />
                <div className="max-h-64 overflow-y-auto" role="listbox">
                    <button
                        type="button"
                        onClick={() => choose('all')}
                        className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent"
                    >
                        -- SELECT --
                    </button>
                    {shown.map((e) => (
                        <button
                            key={e.id}
                            type="button"
                            role="option"
                            aria-selected={e.id === value}
                            onClick={() => choose(e.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                            <Check className={cn('h-4 w-4 shrink-0', e.id === value ? 'opacity-100' : 'opacity-0')} />
                            <span className="truncate">{e.name}</span>
                        </button>
                    ))}
                    {matches.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No employee matches “{query}”.</p>}
                    {matches.length > shown.length && (
                        <p className="px-2 py-2 text-xs text-muted-foreground">
                            Showing {shown.length} of {matches.length}. Type to narrow the list.
                        </p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
