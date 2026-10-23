'use client';

import { useState } from 'react';
import { CalendarDays, FileDown, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { DateInput } from '@/components/ui/date-input';

interface AdvanceCollectionFilterState {
  fromDate: string;
  toDate: string;
}

interface AdvanceCollectionFilterProps {
  onSearch?: (filters: AdvanceCollectionFilterState) => void;
}

export function AdvanceCollectionFilter({
  onSearch,
}: AdvanceCollectionFilterProps) {
  const [filters, setFilters] = useState<AdvanceCollectionFilterState>({
    fromDate: '',
    toDate: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleChange = (field: keyof AdvanceCollectionFilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!filters.fromDate || !filters.toDate) {
      toast({
        title: 'Date range required',
        description: 'Please choose both From Date and Till Date before running the report.',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setIsLoading(false);

    if (onSearch) {
      onSearch(filters);
    }

    toast({
      title: 'Report generated',
      description:
        'Advance collection data loaded. Connect the API to show real results in the table below.',
    });
  };

  const handleReset = () => {
    setFilters({
      fromDate: '',
      toDate: '',
    });
  };

  const handleExport = () => {
    toast({
      title: 'Export started',
      description: 'This will trigger an export once backend integration is ready.',
    });
  };

  const isDisabled = isLoading;

  return (
    <div className="relative w-full max-w-6xl">
      {/* Background Accent */}
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 blur-2xl" />

      {/* Main Card */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95">
        {/* Top Gradient Bar */}
        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary bg-[length:200%_100%] animate-shimmer" />

        {/* Header */}
        <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                <Search className="h-6 w-6 text-white" />
              </div>
              <div className="flex flex-col gap-0.5">
                <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                  Advance Collection Report
                </h1>
                <p className="text-xs text-sidebar-accent dark:text-slate-400">
                  Track advance collection status for members across branches.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Form */}
        <div className="px-4 sm:px-8 py-6">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6"
            aria-label="Advance collection report filters"
          >
            <div className="grid gap-6 md:grid-cols-2">
              {/* From Date */}
              <div className="space-y-2">
                <Label
                  htmlFor="ac-fromDate"
                  className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                  From Date
                </Label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <DateInput
                    id="ac-fromDate"
                    value={filters.fromDate}
                    onChange={(event) =>
                      handleChange('fromDate', event.target.value)
                    }
                    className={cn(
                      'h-11 w-full border border-primary/30 pl-9 text-sm font-medium',
                      'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                      'dark:bg-brand-green-darker dark:border-sidebar-accent'
                    )}
                    disabled={isDisabled}
                  />
                </div>
              </div>

              {/* Till Date */}
              <div className="space-y-2">
                <Label
                  htmlFor="ac-toDate"
                  className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                >
                  Till Date
                </Label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <DateInput
                    id="ac-toDate"
                    value={filters.toDate}
                    onChange={(event) => handleChange('toDate', event.target.value)}
                    className={cn(
                      'h-11 w-full border border-primary/30 pl-9 text-sm font-medium',
                      'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                      'dark:bg-brand-green-darker dark:border-sidebar-accent'
                    )}
                    disabled={isDisabled}
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={isDisabled}
                className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Show
                  </span>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={isDisabled}
                className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30"
              >
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Reset
                </span>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleExport}
                disabled={isDisabled}
                className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-primary hover:text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-primary dark:hover:text-green-300 dark:hover:bg-brand-green-darker/60"
              >
                <span className="flex items-center gap-2">
                  <FileDown className="h-4 w-4" />
                  Export
                </span>
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}


