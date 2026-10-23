'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, CheckCircle2, Lock, RefreshCw, ShieldCheck, User, WifiOff, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';
import { useBrandNames } from '@/app/lib/brand-context';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';
import type { ApiResponse } from '@/app/types';
import type { EmployeeVerificationResult, EmploymentStatus } from '@/app/types/employee-verification';

const NA = 'Not Available';

type LoadState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'done'; result: EmployeeVerificationResult };

// Same convention as the .badge-* helpers in globals.css: green (brand primary)
// = valid, yellow (theme accent) = warning, red = invalid. red is the one family
// the theme never remaps, so "exited" reads as red under every theme preset.
const STATUS_UI: Record<
    EmploymentStatus,
    { label: string; banner: string; iconWrap: string; pill: string; dot: string; icon: React.ElementType }
> = {
    ACTIVE: {
        label: 'Active',
        banner: 'border-green-200 bg-green-50 text-green-900',
        iconWrap: 'bg-green-600 text-white',
        pill: 'bg-green-500 text-white',
        dot: 'bg-white',
        icon: CheckCircle2,
    },
    INACTIVE: {
        label: 'Inactive',
        banner: 'border-yellow-200 bg-yellow-50 text-yellow-900',
        iconWrap: 'bg-yellow-500 text-white',
        pill: 'bg-yellow-400 text-yellow-950',
        dot: 'bg-yellow-950',
        icon: AlertTriangle,
    },
    EXITED: {
        label: 'Exited',
        banner: 'border-red-200 bg-red-50 text-red-900',
        iconWrap: 'bg-red-600 text-white',
        pill: 'bg-red-500 text-white',
        dot: 'bg-white',
        icon: XCircle,
    },
    NOT_FOUND: {
        label: 'Not Found',
        banner: 'border-red-200 bg-red-50 text-red-900',
        iconWrap: 'bg-red-600 text-white',
        pill: 'bg-red-500 text-white',
        dot: 'bg-white',
        icon: XCircle,
    },
};

function fmtDate(value: string | null): string | null {
    return value ? toDisplayDate(new Date(value), NA) : null;
}

// Raw fetch (not apiClient) on purpose: this page is public, and apiClient
// refuses to send any request when there is no session token. A signed-in
// staff member's cookie / bearer token is still forwarded so the API can
// return the restricted `internal` block to them. Resolves to null when aborted.
async function fetchVerification(employeeId: string, signal?: AbortSignal): Promise<LoadState | null> {
    try {
        const headers: Record<string, string> = {};
        const token = tokenStorage.getAccessToken();
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(`/api/public/verify-employee/${encodeURIComponent(employeeId)}`, {
            cache: 'no-store',
            credentials: 'include',
            headers,
            signal,
        });
        const json: ApiResponse<EmployeeVerificationResult> = await res.json();
        if (json.success && json.data) return { kind: 'done', result: json.data };
        return { kind: 'error', message: json.error || 'Verification service is temporarily unavailable.' };
    } catch (err) {
        if ((err as Error).name === 'AbortError') return null;
        return { kind: 'error', message: 'Unable to reach the verification server. Check your connection and try again.' };
    }
}

// Single-screen, landscape layout: identity panel on the left, status + details on
// the right. Sized to fit the viewport without scrolling; on a portrait phone the
// identity panel becomes a horizontal strip above the details.
export function EmployeeVerificationClient({ employeeId }: { employeeId: string }) {
    const { companyNameFull, logoVersion, primaryColor, primaryDark, primaryTint } = useBrandNames();
    const [state, setState] = useState<LoadState>({ kind: 'loading' });
    const [logoFailed, setLogoFailed] = useState(false);

    const reload = useCallback(() => {
        setState({ kind: 'loading' });
        fetchVerification(employeeId).then((next) => next && setState(next));
    }, [employeeId]);

    useEffect(() => {
        const controller = new AbortController();
        fetchVerification(employeeId, controller.signal).then((next) => next && setState(next));
        // Re-verify when the page is restored from the back/forward cache, so a
        // stale result is never shown as current.
        const onPageShow = (e: PageTransitionEvent) => {
            if (e.persisted) reload();
        };
        window.addEventListener('pageshow', onPageShow);
        return () => {
            controller.abort();
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [employeeId, reload]);

    // Brand palette as local CSS variables so every accent follows the active theme preset.
    const brandVars = {
        '--vb-primary': primaryColor,
        '--vb-dark': primaryDark,
        '--vb-tint': primaryTint,
    } as React.CSSProperties;

    return (
        <div style={brandVars} className="flex min-h-[100dvh] flex-col bg-slate-100 text-slate-900">
            <header className="shrink-0 border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--vb-tint)]">
                        {logoFailed ? (
                            <ShieldCheck className="h-5 w-5 text-[var(--vb-primary)]" />
                        ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={`/api/branding/asset/logo-icon?v=${logoVersion}`}
                                alt=""
                                className="h-7 w-7 object-contain"
                                onError={() => setLogoFailed(true)}
                            />
                        )}
                    </div>
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold leading-tight text-slate-900">{companyNameFull}</p>
                        <p className="text-[11px] text-slate-500">Employee Identity Verification</p>
                    </div>
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-medium text-slate-600">
                        <Lock className="h-3 w-3" /> Secure
                    </span>
                </div>
            </header>

            <main className="flex flex-1 items-center justify-center p-3 sm:p-5">
                <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_40px_-16px_rgba(15,23,42,0.3)]">
                    {state.kind === 'loading' && <LoadingSkeleton />}
                    {state.kind === 'error' && <ErrorState message={state.message} onRetry={reload} />}
                    {state.kind === 'done' && (
                        <VerificationResult result={state.result} orgName={companyNameFull} onRefresh={reload} />
                    )}
                </div>
            </main>

            <footer className="shrink-0 pb-3 text-center text-[10.5px] text-slate-400">
                © {new Date().getFullYear()} {companyNameFull} · Match the photo and name with the person presenting this card
            </footer>
        </div>
    );
}

const panelBg = {
    background:
        'linear-gradient(160deg, color-mix(in srgb, var(--vb-dark) 72%, #000) 0%, var(--vb-dark) 60%, color-mix(in srgb, var(--vb-primary) 80%, #000) 100%)',
};

function VerificationResult({
    result,
    orgName,
    onRefresh,
}: {
    result: EmployeeVerificationResult;
    orgName: string;
    onRefresh: () => void;
}) {
    const { status, employee, internal, checkedAt } = result;
    const [tab, setTab] = useState<'overview' | 'staff'>('overview');
    const ui = STATUS_UI[status];
    const checkedLabel = `${toDisplayDateTime(new Date(checkedAt))} IST`;

    if (status === 'NOT_FOUND' || !employee) {
        return (
            <div className="grid md:grid-cols-[260px_1fr]">
                <div style={panelBg} className="flex items-center justify-center gap-3 p-5 text-white md:flex-col md:p-8">
                    <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                        <User className="h-8 w-8 text-white/60" />
                    </span>
                    <p className="text-sm font-medium text-white/80">No matching employee</p>
                </div>
                <div className="flex flex-col gap-4 p-4 sm:p-6">
                    <StatusBanner ui={ui} title="Verification Failed" text="This ID card could not be matched to any employee record." />
                    <FraudWarning orgName={orgName} />
                    <VerificationFooter checkedLabel={checkedLabel} accessLevel="Public" onRefresh={onRefresh} />
                </div>
            </div>
        );
    }

    const isActive = status === 'ACTIVE';
    const exitDate = fmtDate(employee.dateOfExit);
    const title =
        status === 'ACTIVE' ? 'Verified — Currently Employed' : status === 'EXITED' ? 'No Longer Employed' : 'Employee Record Inactive';
    const text =
        status === 'ACTIVE'
            ? employee.dateOfExit
                ? `Current employee of ${orgName} — serving notice, last working day ${exitDate}.`
                : `This person is a current employee of ${orgName}.`
            : status === 'EXITED'
              ? `Left ${orgName} — last working day ${exitDate}. This ID card is no longer valid.`
              : `Not currently active with ${orgName}. Do not accept this card as authorization.`;

    const manager = internal?.reportingManager;
    const managerLabel = manager
        ? [manager.name, manager.employeeId && `(${manager.employeeId})`].filter(Boolean).join(' ')
        : null;

    return (
        <div className="grid md:grid-cols-[260px_1fr]">
            {/* Employee Identity */}
            <section
                aria-label="Employee Identity"
                style={panelBg}
                className="flex items-center gap-4 p-4 text-white sm:p-5 md:flex-col md:justify-center md:p-7 md:text-center"
            >
                <div className="h-28 w-24 shrink-0 overflow-hidden rounded-xl bg-white/10 ring-2 ring-white/25 md:h-40 md:w-32">
                    {employee.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={employee.photoUrl}
                            alt={employee.fullName}
                            className={cn('h-full w-full object-cover', !isActive && 'grayscale')}
                        />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/50">
                            <User className="h-9 w-9" />
                            <span className="text-[9.5px] font-medium uppercase tracking-wide">No photo</span>
                        </div>
                    )}
                </div>
                <div className="min-w-0">
                    <h1 className="line-clamp-2 break-words text-lg font-semibold leading-tight md:text-xl">{employee.fullName}</h1>
                    <p className="mt-1 text-[13px] text-white/75">{employee.designation ?? NA}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 md:justify-center">
                        <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11.5px] font-medium ring-1 ring-inset ring-white/20">
                            {employee.employeeId}
                        </span>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold', ui.pill)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', ui.dot, isActive && 'animate-pulse')} />
                            {ui.label}
                        </span>
                    </div>
                </div>
            </section>

            <div className="flex min-w-0 flex-col gap-3 p-4 sm:gap-4 sm:p-6">
                <StatusBanner ui={ui} title={title} text={text} />

                {internal && (
                    <div role="tablist" className="inline-flex w-fit rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
                        {(['overview', 'staff'] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                role="tab"
                                aria-selected={tab === t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    'rounded-md px-3 py-1.5 transition-colors',
                                    tab === t ? 'bg-white text-[var(--vb-dark)] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                )}
                            >
                                {t === 'overview' ? 'Overview' : 'Staff Details'}
                            </button>
                        ))}
                    </div>
                )}

                {tab === 'staff' && internal ? (
                    <FactGrid>
                        <Fact label="Grade" value={internal.grade} />
                        <Fact label="Confirmation Date" value={fmtDate(internal.confirmationDate)} />
                        <Fact label="Shift" value={internal.shift} />
                        <Fact label="Mobile" value={internal.mobileNumber} />
                        <Fact label="Gender" value={internal.gender} />
                        <Fact label="Blood Group" value={internal.bloodGroup} />
                        <Fact label="Reporting Manager" value={managerLabel} wide />
                        <Fact label="Email" value={internal.email} className="max-lg:col-span-2" />
                    </FactGrid>
                ) : (
                    <FactGrid>
                        <Fact label="Department" value={employee.department} />
                        <Fact label="Branch" value={employee.branchName} />
                        <Fact label="Branch Code" value={employee.branchCode} />
                        <Fact label="Date of Joining" value={fmtDate(employee.dateOfJoining)} />
                        {employee.dateOfExit ? (
                            <Fact label="Last Working Day" value={exitDate} />
                        ) : (
                            <Fact label="Employment Status" value={ui.label} />
                        )}
                        {/* Org name is already in the header — dropped on phones to keep one screen. */}
                        <Fact label="Organization" value={orgName} className="max-sm:hidden" />
                        <Fact label="Branch Office" value={employee.branchAddress} className="sm:col-span-2 lg:col-span-3" />
                    </FactGrid>
                )}

                {!internal && (
                    <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Lock className="h-3 w-3 shrink-0" />
                        Personal and contact details are visible only to authorized staff who are signed in.
                    </p>
                )}

                {!isActive && <FraudWarning orgName={orgName} />}

                <VerificationFooter
                    checkedLabel={checkedLabel}
                    accessLevel={internal ? 'Authorized staff' : 'Public'}
                    onRefresh={onRefresh}
                />
            </div>
        </div>
    );
}

function StatusBanner({ ui, title, text }: { ui: (typeof STATUS_UI)[EmploymentStatus]; title: string; text: string }) {
    const Icon = ui.icon;
    return (
        <div role="status" className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-3', ui.banner)}>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', ui.iconWrap)}>
                <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">{title}</p>
                <p className="mt-0.5 text-xs leading-snug opacity-80">{text}</p>
            </div>
        </div>
    );
}

function FactGrid({ children }: { children: React.ReactNode }) {
    return (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 lg:grid-cols-3">
            {children}
        </dl>
    );
}

/** `wide` spans two columns (the whole row on mobile). */
function Fact({
    label,
    value,
    wide,
    className,
}: {
    label: string;
    value: React.ReactNode;
    wide?: boolean;
    className?: string;
}) {
    const empty = value === null || value === undefined || value === '';
    return (
        <div className={cn('min-w-0 bg-white px-3 py-2 sm:px-3.5 sm:py-2.5', wide && 'col-span-2', className)}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
            <dd
                className={cn(
                    'mt-0.5 line-clamp-2 break-words text-[13px] leading-snug',
                    empty ? 'italic text-slate-400' : 'font-semibold text-slate-800'
                )}
            >
                {empty ? NA : value}
            </dd>
        </div>
    );
}

function VerificationFooter({
    checkedLabel,
    accessLevel,
    onRefresh,
}: {
    checkedLabel: string;
    accessLevel: string;
    onRefresh: () => void;
}) {
    return (
        <section
            aria-label="Verification Details"
            className="mt-auto flex items-center gap-3 rounded-xl bg-[var(--vb-tint)] px-3.5 py-2.5"
        >
            <BadgeCheck className="h-5 w-5 shrink-0 text-[var(--vb-primary)]" />
            <div className="min-w-0 text-[11px] leading-snug text-slate-600">
                <p className="font-semibold text-[var(--vb-dark)]">Checked {checkedLabel}</p>
                <p>Live HR record · {accessLevel} view</p>
            </div>
            <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onRefresh}
                className="ml-auto h-8 shrink-0 border-[var(--vb-primary)]/30 bg-white px-2.5 text-xs text-[var(--vb-dark)] hover:bg-white/80"
            >
                <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Re-verify</span>
            </Button>
        </section>
    );
}

function FraudWarning({ orgName }: { orgName: string }) {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3.5 py-2.5 text-[11.5px] leading-snug text-yellow-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />
            <p>
                Do not hand over money or documents to anyone presenting this card for {orgName}. Contact your
                nearest branch.
            </p>
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:text-left">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <WifiOff className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold text-slate-900">Could not verify right now</h1>
                <p className="mt-0.5 text-sm text-slate-500">{message}</p>
                <p className="mt-1.5 text-xs font-medium text-yellow-700">
                    Until verification succeeds, do not treat this card as confirmed.
                </p>
            </div>
            <Button type="button" onClick={onRetry} className="shrink-0 bg-[var(--vb-primary)] text-white hover:bg-[var(--vb-dark)]">
                <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div aria-busy="true" aria-label="Verifying employee" className="grid md:grid-cols-[260px_1fr]">
            <div style={panelBg} className="flex items-center gap-4 p-5 md:flex-col md:justify-center md:p-7">
                <div className="h-28 w-24 animate-pulse rounded-xl bg-white/10 md:h-40 md:w-32" />
                <div className="w-full max-w-[160px] space-y-2">
                    <div className="h-4 animate-pulse rounded bg-white/15" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-white/10 md:mx-auto" />
                </div>
            </div>
            <div className="space-y-4 p-4 sm:p-6">
                <div className="h-[62px] animate-pulse rounded-xl bg-slate-100" />
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-[52px] animate-pulse rounded-lg bg-slate-100" />
                    ))}
                </div>
                <p className="text-center text-xs text-slate-400">Checking the live employee register…</p>
            </div>
        </div>
    );
}
