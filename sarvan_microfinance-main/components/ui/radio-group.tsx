'use client';

import * as React from 'react';
import { Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RadioGroupContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue>({});

interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
}

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
    ({ className, value, onValueChange, disabled, children, ...props }, ref) => {
        return (
            <RadioGroupContext.Provider value={{ value, onValueChange, disabled }}>
                <div
                    ref={ref}
                    className={cn('grid gap-2', className)}
                    role="radiogroup"
                    {...props}
                >
                    {children}
                </div>
            </RadioGroupContext.Provider>
        );
    }
);
RadioGroup.displayName = 'RadioGroup';

interface RadioGroupItemProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value: string;
    onCheckedChange?: () => void;
}

const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
    ({ className, value, checked: checkedProp, onCheckedChange, disabled: disabledProp, id, ...props }, ref) => {
        const ctx = React.useContext(RadioGroupContext);

        const checked = checkedProp !== undefined ? checkedProp : ctx.value === value;
        const disabled = disabledProp !== undefined ? disabledProp : ctx.disabled;
        const inputId = id || `radio-${value}`;

        const handleChange = () => {
            onCheckedChange?.();
            ctx.onValueChange?.(value);
        };

        return (
            <div className="relative flex items-center">
                <input
                    ref={ref}
                    type="radio"
                    id={inputId}
                    value={value}
                    checked={checked}
                    onChange={handleChange}
                    disabled={disabled}
                    className="peer sr-only"
                    {...props}
                />
                <label
                    htmlFor={inputId}
                    className={cn(
                        'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-2 transition-all',
                        'border-primary/30 text-primary',
                        'peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary peer-focus:ring-offset-2',
                        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                        'dark:border-sidebar-accent dark:peer-focus:ring-secondary',
                        checked && 'border-primary dark:border-primary',
                        className
                    )}
                >
                    {checked && (
                        <Circle className="h-2.5 w-2.5 fill-current text-current" />
                    )}
                </label>
            </div>
        );
    }
);
RadioGroupItem.displayName = 'RadioGroupItem';

export { RadioGroup, RadioGroupItem };
