'use client';

import * as React from 'react';
import {
    addMonths,
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    format,
    isSameDay,
    isSameMonth,
    isToday,
    isValid,
    parse,
    startOfMonth,
    startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toDisplayDate, parseDisplayDate } from '@/app/lib/date-format';

/**
 * Drop-in replacement for `<input type="date">` that always shows DD/MM/YYYY.
 *
 * A native date input is drawn by the browser in the computer's language setting
 * (often MM/DD/YYYY), which code can't change. This keeps the native API so call
 * sites don't change: `value` is 'yyyy-MM-dd' ('' when empty) and `onChange`
 * receives an event-like object whose `target.value` is 'yyyy-MM-dd' (or '').
 * Users can type DD/MM/YYYY (slashes are inserted automatically) or pick a day
 * from the calendar; `min` / `max` limit the calendar and typed dates.
 */
type DateInputProps = Omit<React.ComponentProps<'input'>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max'> & {
    value?: string | null;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    min?: string;
    max?: string;
};

const ISO = 'yyyy-MM-dd';
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Layout classes belong on the wrapper (so the calendar button stays inside the
// box); everything else (height, colours, text) styles the text field itself.
const WRAPPER_CLASS = /^([a-z0-9-]+:)*(w-|min-w-|max-w-|flex-|basis-|grow|shrink|col-|row-|self-|justify-self-|order-|m[trblxy]?-|-m[trblxy]?-|hidden$|block$|inline)/;

function parseIso(v: string | null | undefined): Date | undefined {
    if (!v) return undefined;
    const d = parse(v, ISO, new Date());
    return isValid(d) ? d : undefined;
}

/** Auto-inserts slashes while typing: "01102026" → "01/10/2026". */
function maskTyped(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
    { value, onChange, min, max, className, disabled, readOnly, name, id, placeholder = 'DD/MM/YYYY', onBlur, ...rest },
    ref,
) {
    const iso = value ?? '';
    const [text, setText] = React.useState(() => toDisplayDate(iso));
    const [open, setOpen] = React.useState(false);
    const selected = parseIso(iso);
    const [viewMonth, setViewMonth] = React.useState<Date>(selected ?? parseIso(max) ?? new Date());

    // Follow outside changes to `value` (form reset, "clear filters", …).
    React.useEffect(() => {
        setText(toDisplayDate(iso));
        const d = parseIso(iso);
        if (d) setViewMonth(d);
    }, [iso]);

    const emit = React.useCallback((next: string) => {
        if (!onChange) return;
        const target = { value: next, name: name ?? '', id: id ?? '', type: 'date' } as unknown as HTMLInputElement;
        onChange({ target, currentTarget: target } as React.ChangeEvent<HTMLInputElement>);
    }, [onChange, name, id]);

    const minDate = parseIso(min);
    const maxDate = parseIso(max);
    const outOfRange = (d: Date) => (!!minDate && d < minDate) || (!!maxDate && d > maxDate);

    const days = React.useMemo(() => {
        const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
        const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end });
    }, [viewMonth]);

    const thisYear = new Date().getFullYear();
    const fromYear = minDate?.getFullYear() ?? thisYear - 100;
    const toYear = maxDate?.getFullYear() ?? thisYear + 10;
    const years: number[] = [];
    for (let y = toYear; y >= fromYear; y--) years.push(y);

    const tokens = (className ?? '').split(/\s+/).filter(Boolean);
    const wrapperClass = tokens.filter(t => WRAPPER_CLASS.test(t)).join(' ');
    const inputClass = tokens.filter(t => !WRAPPER_CLASS.test(t)).join(' ');
    const locked = disabled || readOnly;

    return (
        <div className={cn('relative w-full', wrapperClass)}>
            <Input
                {...rest}
                ref={ref}
                id={id}
                name={name}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={placeholder}
                disabled={disabled}
                readOnly={readOnly}
                value={text}
                className={cn('pr-9', inputClass)}
                onChange={(e) => {
                    const masked = maskTyped(e.target.value);
                    setText(masked);
                    if (masked === '') { emit(''); return; }
                    const parsed = parseDisplayDate(masked);
                    if (parsed) {
                        emit(parsed);
                        setViewMonth(parseIso(parsed)!);
                    }
                }}
                onBlur={(e) => {
                    // Incomplete/invalid typing reverts to the current value.
                    if (text !== '' && !parseDisplayDate(text)) setText(toDisplayDate(iso));
                    onBlur?.(e);
                }}
            />
            <Popover open={open && !locked} onOpenChange={(v) => setOpen(v && !locked)}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        tabIndex={-1}
                        disabled={locked}
                        aria-label="Open calendar"
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1.5 text-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    >
                        <CalendarDays className="h-4 w-4" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3" align="end">
                    <div className="flex items-center justify-between gap-1 pb-2">
                        <button type="button" className="rounded p-1 hover:bg-accent" aria-label="Previous month" onClick={() => setViewMonth(m => addMonths(m, -1))}>
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <div className="flex items-center gap-1">
                            <select
                                aria-label="Month"
                                className="rounded border border-input bg-background px-1 py-0.5 text-sm"
                                value={viewMonth.getMonth()}
                                onChange={(e) => setViewMonth(m => new Date(m.getFullYear(), Number(e.target.value), 1))}
                            >
                                {MONTHS.map((label, i) => <option key={label} value={i}>{label}</option>)}
                            </select>
                            <select
                                aria-label="Year"
                                className="rounded border border-input bg-background px-1 py-0.5 text-sm"
                                value={viewMonth.getFullYear()}
                                onChange={(e) => setViewMonth(m => new Date(Number(e.target.value), m.getMonth(), 1))}
                            >
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <button type="button" className="rounded p-1 hover:bg-accent" aria-label="Next month" onClick={() => setViewMonth(m => addMonths(m, 1))}>
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                        {WEEKDAYS.map(d => <div key={d} className="py-1">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                        {days.map((day) => {
                            const isSel = !!selected && isSameDay(day, selected);
                            const blocked = outOfRange(day);
                            return (
                                <button
                                    key={day.toISOString()}
                                    type="button"
                                    disabled={blocked}
                                    onClick={() => {
                                        const next = format(day, ISO);
                                        setText(toDisplayDate(next));
                                        emit(next);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        'h-8 w-8 rounded-md text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                                        !isSameMonth(day, viewMonth) && 'text-muted-foreground/40',
                                        isToday(day) && !isSel && 'border border-primary/40',
                                        isSel ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-accent',
                                    )}
                                >
                                    {format(day, 'd')}
                                </button>
                            );
                        })}
                    </div>
                    {!locked && (
                        <div className="mt-2 flex justify-between border-t pt-2 text-xs">
                            <button type="button" className="text-muted-foreground hover:underline" onClick={() => { setText(''); emit(''); setOpen(false); }}>
                                Clear
                            </button>
                            {!outOfRange(new Date(new Date().setHours(0, 0, 0, 0))) && (
                                <button
                                    type="button"
                                    className="font-medium text-primary hover:underline"
                                    onClick={() => {
                                        const next = format(new Date(), ISO);
                                        setText(toDisplayDate(next));
                                        emit(next);
                                        setOpen(false);
                                    }}
                                >
                                    Today
                                </button>
                            )}
                        </div>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
});
