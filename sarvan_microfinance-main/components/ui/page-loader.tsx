'use client';

import { cn } from '@/lib/utils';
import { useBrandNames } from '@/app/lib/brand-context';

interface PageLoaderProps {
    /** Optional text shown under the icon, e.g. "Loading Cash Payment Module..." */
    label?: string;
    /** true (default) = min-h-screen; false = fills the parent's height instead */
    fullScreen?: boolean;
    className?: string;
}

export function PageLoader({ label, fullScreen = true, className }: PageLoaderProps) {
    const { logoVersion } = useBrandNames();
    return (
        <div
            className={cn(
                'flex w-full flex-col items-center justify-center gap-4 bg-background',
                fullScreen ? 'min-h-screen' : 'h-full min-h-[16rem]',
                className
            )}
        >
            <div className="relative flex h-16 w-16 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-t-primary border-r-primary border-b-secondary border-l-secondary" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={`/api/branding/asset/page-loader?v=${logoVersion}`}
                    alt=""
                    className="h-9 w-9 rounded-full object-contain"
                />
            </div>
            {label && (
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
            )}
        </div>
    );
}
