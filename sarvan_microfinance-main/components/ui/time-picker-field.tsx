'use client';

import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type TimePickerFieldProps = {
    /** 'HH:mm' 24-hour string (or '' when unset) — the wire/storage format everywhere else in the app still uses. */
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    id?: string;
    /** Minute increments shown in the list. Default 5. */
    minuteStep?: number;
    placeholder?: string;
    className?: string;
};

type Period = 'AM' | 'PM';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 24h "HH:mm" -> { hour12 (1-12), minute ("00"-"59"), period }. */
function from24h(value: string): { hour12: number; minute: string; period: Period } | null {
    if (!TIME_RE.test(value)) return null;
    const [hStr, minute] = value.split(':');
    const h24 = Number(hStr);
    const period: Period = h24 >= 12 ? 'PM' : 'AM';
    const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { hour12, minute, period };
}

/** (hour12, minute, period) -> 24h "HH:mm" for onChange/storage. */
function to24h(hour12: number, minute: string, period: Period): string {
    const h24 = period === 'AM' ? (hour12 % 12) : (hour12 % 12) + 12;
    return `${String(h24).padStart(2, '0')}:${minute}`;
}

function nearestStepMinute(step: number): string {
    const now = new Date();
    const rounded = Math.round(now.getMinutes() / step) * step;
    return String(rounded % 60).padStart(2, '0');
}

/** One scrollable column of pill options, sharing the same look across Hr/Min/Period. */
function TimeColumn<T extends string | number>({
    label, options, selected, onSelect, scrollRef, format,
}: {
    label: string;
    options: T[];
    selected: T | null;
    onSelect: (v: T) => void;
    scrollRef?: (el: HTMLDivElement | null) => void;
    format?: (v: T) => string;
}) {
    return (
        <div className="flex flex-col">
            <div className="px-1 pb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            <div ref={scrollRef} className="scrollbar-thin max-h-48 w-16 overflow-y-auto px-1.5 pb-1.5 scroll-smooth">
                <div className="flex flex-col gap-0.5">
                    {options.map((opt) => {
                        const isSelected = opt === selected;
                        return (
                            <button
                                key={String(opt)}
                                type="button"
                                data-selected={isSelected || undefined}
                                onClick={() => onSelect(opt)}
                                className={cn(
                                    'rounded-md px-2 py-1.5 text-center text-sm font-medium tabular-nums transition-colors',
                                    isSelected
                                        ? 'bg-primary text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-primary/10 dark:text-slate-300 dark:hover:bg-primary/20',
                                )}
                            >
                                {format ? format(opt) : opt}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function TimePickerField({
    value,
    onChange,
    disabled,
    id,
    minuteStep = 5,
    placeholder = 'Select time',
    className,
}: TimePickerFieldProps) {
    const [open, setOpen] = React.useState(false);
    const parsed = from24h(value);
    const hour12 = parsed?.hour12 ?? null;
    const minute = parsed?.minute ?? null;
    const period = parsed?.period ?? null;

    const hourColRef = React.useRef<HTMLDivElement | null>(null);
    const minuteColRef = React.useRef<HTMLDivElement | null>(null);

    const hours = React.useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
    const minutes = React.useMemo(
        () => Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => String(i * minuteStep).padStart(2, '0')),
        [minuteStep],
    );

    const setPart = (nextHour12: number, nextMinute: string, nextPeriod: Period) =>
        onChange(to24h(nextHour12, nextMinute, nextPeriod));

    const setNow = () => {
        const now = new Date();
        const p = from24h(`${String(now.getHours()).padStart(2, '0')}:${nearestStepMinute(minuteStep)}`)!;
        setPart(p.hour12, p.minute, p.period);
    };

    // Scroll the selected hour/minute into view each time the popover opens.
    React.useEffect(() => {
        if (!open) return;
        const scroll = () => {
            hourColRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'center' });
            minuteColRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'center' });
        };
        const t = setTimeout(scroll, 0);
        return () => clearTimeout(t);
    }, [open]);

    const displayLabel = hour12 != null && minute != null && period
        ? `${hour12}:${minute} ${period}`
        : placeholder;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    id={id}
                    variant="outline"
                    disabled={disabled}
                    className={cn('h-11 w-full justify-between font-normal tabular-nums', !parsed && 'text-muted-foreground', className)}
                >
                    {displayLabel}
                    <Clock className="h-4 w-4 text-primary" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 overflow-hidden" align="start">
                {/* Live preview + quick "Now" action */}
                <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-primary via-primary to-purple-600 px-4 py-3">
                    <span className="text-lg font-semibold tabular-nums text-white">{displayLabel === placeholder ? '—:— --' : displayLabel}</span>
                    <button
                        type="button"
                        onClick={setNow}
                        className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-white/25"
                    >
                        Now
                    </button>
                </div>

                <div className="flex divide-x divide-slate-100 dark:divide-sidebar-accent pt-2">
                    <TimeColumn
                        label="Hour"
                        options={hours}
                        selected={hour12}
                        onSelect={(hh) => setPart(hh, minute ?? '00', period ?? 'AM')}
                        scrollRef={(el) => { hourColRef.current = el; }}
                    />
                    <TimeColumn
                        label="Min"
                        options={minutes}
                        selected={minute}
                        onSelect={(mm) => setPart(hour12 ?? 12, mm, period ?? 'AM')}
                        scrollRef={(el) => { minuteColRef.current = el; }}
                    />
                    <div className="flex flex-col">
                        <div className="px-1 pb-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            &nbsp;
                        </div>
                        <div className="flex flex-col gap-1 px-1.5 pb-1.5">
                            {(['AM', 'PM'] as Period[]).map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setPart(hour12 ?? 12, minute ?? '00', p)}
                                    className={cn(
                                        'w-12 rounded-md px-2 py-1.5 text-center text-sm font-semibold transition-colors',
                                        p === period
                                            ? 'bg-primary text-white shadow-sm'
                                            : 'text-slate-600 hover:bg-primary/10 dark:text-slate-300 dark:hover:bg-primary/20',
                                    )}
                                >
                                    {p}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
