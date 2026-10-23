'use client';

import { useState } from 'react';
import { Building2, Star, StarOff, AlertCircle, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

const AM_MAX_BRANCHES = 4;

interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string | null;
}

interface AmBranchMultiSelectProps {
  branches: Branch[];
  selectedIds: string[];
  primaryId: string | null;
  onChange: (selectedIds: string[], primaryId: string | null) => void;
  isLoading?: boolean;
  disabled?: boolean;
}

/**
 * Multi-select checkbox group for assigning branches to an Area Manager.
 *
 * FIX: Uses <div role="checkbox"> rows (not <button>) so the "Set Primary"
 * <button> inside each row does not violate the HTML rule of
 * button-inside-button, which causes a React hydration error.
 */
export function AmBranchMultiSelect({
  branches,
  selectedIds,
  primaryId,
  onChange,
  isLoading = false,
  disabled = false,
}: AmBranchMultiSelectProps) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visibleBranches = term
    ? branches.filter((b) => b.name.toLowerCase().includes(term) || b.code.toLowerCase().includes(term))
    : branches;

  const toggleBranch = (branchId: string) => {
    if (disabled) return;

    const isSelected = selectedIds.includes(branchId);

    if (isSelected) {
      const newSelection = selectedIds.filter((id) => id !== branchId);
      const newPrimary =
        primaryId === branchId ? (newSelection[0] ?? null) : primaryId;
      onChange(newSelection, newPrimary);
    } else {
      if (selectedIds.length >= AM_MAX_BRANCHES) return;
      const newSelection = [...selectedIds, branchId];
      const newPrimary = primaryId ?? branchId;
      onChange(newSelection, newPrimary);
    }
  };

  const setPrimary = (branchId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || !selectedIds.includes(branchId)) return;
    onChange(selectedIds, branchId);
  };

  const count = selectedIds.length;
  const isAtMax = count >= AM_MAX_BRANCHES;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-green-50 px-4 py-3 dark:border-sidebar-accent dark:bg-brand-green-darker">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-slate-500">Loading branches...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-green-50 px-4 py-3 dark:border-sidebar-accent dark:bg-brand-green-darker">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <span className="text-sm text-slate-500">No branches available</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Usage counter */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">
          Select up to {AM_MAX_BRANCHES} branches
        </span>
        <Badge
          variant={isAtMax ? 'destructive' : 'secondary'}
          className="text-xs font-bold"
        >
          {count}/{AM_MAX_BRANCHES} selected
        </Badge>
      </div>

      {/* Search by branch name or code */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search branch by name or code..."
          className="h-9 pl-9 text-sm"
          disabled={disabled}
        />
      </div>

      {/* Branch list
          IMPORTANT: Each row must be a <div> (not <button>) because the
          "Set Primary" button lives inside it. Nesting <button>→<button>
          is invalid HTML and causes React hydration errors. */}
      <div className="max-h-[280px] overflow-y-auto rounded-xl border border-primary/20 bg-white shadow-inner dark:border-sidebar-accent dark:bg-brand-green-darker/50">
        {visibleBranches.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-slate-500">No branches match &ldquo;{search}&rdquo;</div>
        )}
        {visibleBranches.map((branch, idx) => {
          const isSelected = selectedIds.includes(branch.id);
          const isPrimary = primaryId === branch.id;
          const isRowDisabled = disabled || (!isSelected && isAtMax);

          return (
            <div
              key={branch.id}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={`${isSelected ? 'Deselect' : 'Select'} branch ${branch.name}`}
              aria-disabled={isRowDisabled}
              tabIndex={isRowDisabled ? -1 : 0}
              onClick={() => !isRowDisabled && toggleBranch(branch.id)}
              onKeyDown={(e) => {
                if ((e.key === ' ' || e.key === 'Enter') && !isRowDisabled) {
                  e.preventDefault();
                  toggleBranch(branch.id);
                }
              }}
              className={cn(
                'group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-all duration-150 select-none',
                idx !== 0 && 'border-t border-slate-100 dark:border-sidebar-accent',
                isSelected
                  ? 'bg-green-50/70 dark:bg-green-950/20'
                  : 'hover:bg-green-50 dark:hover:bg-sidebar-accent/50',
                isRowDisabled && 'cursor-not-allowed opacity-50'
              )}
            >
              {/* Custom checkbox indicator */}
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-white'
                    : 'border-primary/30 dark:border-sidebar-accent/60'
                )}
              >
                {isSelected && (
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              {/* Branch icon */}
              <Building2
                className={cn(
                  'h-4 w-4 shrink-0',
                  isSelected ? 'text-primary' : 'text-slate-400'
                )}
              />

              {/* Branch info */}
              <div className="flex flex-1 flex-col">
                <span
                  className={cn(
                    'text-sm font-semibold',
                    isSelected
                      ? 'text-foreground dark:text-green-200'
                      : 'text-sidebar-accent dark:text-slate-200'
                  )}
                >
                  {branch.name}
                </span>
                <span className="mt-0.5 font-mono text-xs text-slate-500">
                  {branch.code}
                </span>
              </div>

              {/* Primary badge / toggle button
                  This is a real <button> — valid here because the row is a <div>, not a <button> */}
              {isSelected && (
                <button
                  type="button"
                  onClick={(e) => setPrimary(branch.id, e)}
                  title={
                    isPrimary
                      ? 'Primary (default login) branch'
                      : 'Set as primary (default login) branch'
                  }
                  className={cn(
                    'ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition-all',
                    isPrimary
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-brand-green-tint text-slate-400 hover:bg-amber-50 hover:text-amber-600 dark:bg-sidebar-accent dark:hover:bg-amber-900/20'
                  )}
                >
                  {isPrimary ? (
                    <>
                      <Star className="h-3 w-3 fill-current" />
                      Primary
                    </>
                  ) : (
                    <>
                      <StarOff className="h-3 w-3" />
                      Set Primary
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isAtMax && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5" />
          Maximum of {AM_MAX_BRANCHES} branches reached. Deselect one to add another.
        </p>
      )}
      {count > 0 && primaryId && (
        <p className="text-xs text-slate-500">
          <span className="font-semibold text-amber-600">★ Primary</span> branch is the
          default context loaded on login. Click the ★ icon on any selected branch to change it.
        </p>
      )}
    </div>
  );
}
