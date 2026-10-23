"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";

export interface PasswordInputProps
    extends Omit<React.ComponentProps<typeof Input>, "type"> {
    showToggle?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
    ({ className, showToggle = true, ...props }, ref) => {
        const [showPassword, setShowPassword] = React.useState(false);

        return (
            <div className="relative">
                <Input
                    type={showPassword ? "text" : "password"}
                    className={cn("pr-10", className)}
                    ref={ref}
                    {...props}
                />
                {showToggle && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        tabIndex={-1}
                    >
                        {showPassword ? (
                            <EyeOff className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        ) : (
                            <Eye className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                        )}
                    </Button>
                )}
            </div>
        );
    }
);

PasswordInput.displayName = "PasswordInput";

export { PasswordInput };

