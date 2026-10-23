'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
    ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
        const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
            if (onCheckedChange) {
                onCheckedChange(event.target.checked);
            }
        };

        return (
            <label
                className={cn(
                    'relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors',
                    checked ? 'bg-primary dark:bg-primary' : 'bg-green-200 dark:bg-sidebar-accent/80',
                    disabled && 'cursor-not-allowed opacity-50',
                    className
                )}
            >
                <input
                    ref={ref}
                    type="checkbox"
                    checked={checked}
                    onChange={handleChange}
                    disabled={disabled}
                    className="sr-only"
                    {...props}
                />
                <span
                    className={cn(
                        'inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform',
                        checked ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                />
            </label>
        );
    }
);
Switch.displayName = 'Switch';

export { Switch };

