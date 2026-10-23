'use client';

import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MasterOption } from '@/app/lib/staff-loans/configuration';

export function FieldError({ id, message }: { id?: string; message?: string }) {
    return message ? <p id={id} className="text-sm text-destructive" role="alert">{message}</p> : null;
}

export function ConfigInput({ label, value, onChange, error, type = 'text', step, disabled, required }: {
    label: string; value: string; onChange: (value: string) => void; error?: string;
    type?: 'text' | 'number'; step?: string; disabled?: boolean; required?: boolean;
}) {
    const id = useId();
    return <div className="space-y-2">
        <Label htmlFor={id}>{label}{required && <span className="text-red-500"> *</span>}</Label>
        <Input id={id} value={value} onChange={e => onChange(e.target.value)} type={type}
            step={step} min={type === 'number' ? '0' : undefined} disabled={disabled} required={required}
            aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} />
        <FieldError id={`${id}-error`} message={error} />
    </div>;
}

export function ConfigSelect({ label, value, onChange, options, error, disabled, required }: {
    label: string; value: string; onChange: (value: string) => void;
    options: { value: string; label: string; disabled?: boolean }[]; error?: string; disabled?: boolean; required?: boolean;
}) {
    const id = useId();
    return <div className="space-y-2">
        <Label htmlFor={id}>{label}{required && <span className="text-red-500"> *</span>}</Label>
        <Select value={value} onValueChange={onChange} disabled={disabled} required={required}>
            <SelectTrigger id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}>
                <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent>{options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <FieldError id={`${id}-error`} message={error} />
    </div>;
}

export function ConfigChoices({ label, options, selected, onChange, error, hint, disabled, required }: {
    label: string; options: MasterOption[]; selected: string[]; onChange: (ids: string[]) => void;
    error?: string; hint?: string; disabled?: boolean; required?: boolean;
}) {
    const id = useId();
    const selectableIds = options.filter(o => o.isActive || selected.includes(o.id)).map(o => o.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every(optId => selected.includes(optId));
    return <fieldset className="space-y-2" disabled={disabled}>
        <div className="flex items-center justify-between gap-2">
            <legend className="text-sm font-medium">{label}{required && <span className="text-red-500"> *</span>}</legend>
            {selectableIds.length > 0 && (
                <button type="button" className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
                    disabled={disabled} onClick={() => onChange(allSelected ? [] : selectableIds)}>
                    {allSelected ? 'Clear all' : 'Select all'}
                </button>
            )}
        </div>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        <div className="max-h-44 overflow-y-auto rounded-md border p-3 space-y-3">
            {!options.length && <p className="text-sm text-muted-foreground">No options available.</p>}
            {options.map(option => <div key={option.id} className="flex items-center gap-2">
                <Checkbox id={`${id}-${option.id}`} checked={selected.includes(option.id)}
                    disabled={disabled || (!option.isActive && !selected.includes(option.id))}
                    onCheckedChange={checked => onChange(checked === true ? [...selected, option.id] : selected.filter(v => v !== option.id))} />
                <Label htmlFor={`${id}-${option.id}`}>{option.name}{!option.isActive && ' (inactive)'}</Label>
            </div>)}
        </div>
        <FieldError message={error} />
    </fieldset>;
}
