'use client';

import * as React from 'react';
import {
    format,
    parse,
    isValid,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    addMonths,
    isSameDay,
    isSameMonth,
    isToday,
} from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type DatePickerFieldProps = {
    /** ISO date string 'yyyy-MM-dd' (or '' when unset). */
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    id?: string;
    placeholder?: string;
    className?: string;
};

const ISO = 'yyyy-MM-dd';

function parseIso(v: string): Date | undefined {
    if (!v) return undefined;
    const d = parse(v, ISO, new Date());
    return isValid(d) ? d : undefined;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export function DatePickerField({
    value,
    onChange,
    disabled,
    id,
    placeholder = 'Select date',
    className,
}: DatePickerFieldProps) {
    const selected = parseIso(value);
    const [open, setOpen] = React.useState(false);
    const [viewMonth, setViewMonth] = React.useState<Date>(selected ?? new Date());

    React.useEffect(() => {
        const d = parseIso(value);
        if (d) setViewMonth(d);
    }, [value]);

    const days = React.useMemo(() => {
        const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
        const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
        return eachDayOfInterval({ start, end });
    }, [viewMonth]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    id={id}
                    variant="outline"
                    disabled={disabled}
                    className={cn('h-11 w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
                >
                    {selected ? format(selected, 'dd/MM/yyyy') : placeholder}
                    <CalendarDays className="h-4 w-4 text-primary" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="start">
                <div className="flex items-center justify-between pb-2">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewMonth((m) => addMonths(m, -1))}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="text-sm font-semibold">{format(viewMonth, 'MMMM yyyy')}</div>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setViewMonth((m) => addMonths(m, 1))}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
                    {WEEKDAYS.map((d) => (
                        <div key={d} className="py-1">{d}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                    {days.map((day) => {
                        const isSel = selected && isSameDay(day, selected);
                        const outside = !isSameMonth(day, viewMonth);
                        return (
                            <button
                                key={day.toISOString()}
                                type="button"
                                onClick={() => {
                                    onChange(format(day, ISO));
                                    setOpen(false);
                                }}
                                className={cn(
                                    'h-8 w-8 rounded-md text-sm transition-colors',
                                    outside && 'text-muted-foreground/40',
                                    isToday(day) && !isSel && 'border border-primary/40',
                                    isSel ? 'bg-primary text-white font-semibold' : 'hover:bg-accent',
                                )}
                            >
                                {format(day, 'd')}
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
