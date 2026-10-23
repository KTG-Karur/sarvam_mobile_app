'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBrandNames } from '@/app/lib/brand-context';

/**
 * Shared 404 body — used by both app/dashboard/not-found.tsx (wrapped in the
 * dashboard shell's sidebar/header via ProtectedRoute) and the root
 * app/not-found.tsx (which bounces logged-in users into the dashboard shell
 * before this ever renders, and redirects logged-out users to /login).
 *
 * Uses the tenant's live branding assets (logo-wordmark / logo-icon), same as
 * LoginForm/SidebarBrand, rather than a hardcoded logo — this page follows
 * whatever brand is configured in Settings, not just Sarvam.
 */
export function NotFoundContent() {
    const router = useRouter();
    const { companyNameFull, logoVersion } = useBrandNames();

    return (
        <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 p-6 text-center">
            {/* Brand Logo (wordmark) */}
            <Image
                src={`/api/branding/asset/logo-wordmark?v=${logoVersion}`}
                alt={companyNameFull}
                width={220}
                height={68}
                unoptimized
                className="h-14 w-auto object-contain sm:h-16"
            />

            {/* 404 */}
            <div className="space-y-2">
                <h1 className="bg-gradient-to-r from-primary via-secondary to-primary bg-clip-text text-[6rem] font-extrabold leading-none tracking-tight text-transparent sm:text-[8rem]">
                    404
                </h1>
                <p className="text-xl font-semibold text-foreground dark:text-white sm:text-2xl">
                    Page Not Found
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                    The page you&apos;re looking for doesn&apos;t exist or may have been moved.
                </p>
            </div>

            {/* Brand Logo (icon mark) */}
            <div className="relative h-14 w-14 overflow-hidden rounded-full bg-white/10 p-0.5 ring-2 ring-secondary/60">
                <Image
                    src={`/api/branding/asset/logo-icon?v=${logoVersion}`}
                    alt={companyNameFull}
                    fill
                    unoptimized
                    className="rounded-full object-cover"
                />
            </div>

            {/* Go to Home Page */}
            <Button
                onClick={() => router.push('/dashboard')}
                variant="default"
                size="lg"
                className="bg-gradient-to-r from-primary to-secondary text-white hover:opacity-90"
            >
                <Home className="mr-2 h-4 w-4" />
                Go to Home Page
            </Button>
        </div>
    );
}
