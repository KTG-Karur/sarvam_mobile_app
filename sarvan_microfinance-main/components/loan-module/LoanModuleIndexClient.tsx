'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    Banknote,
    CheckCircle2,
    UserCog,
    ArrowLeftRight,
    Trash2,
    ChevronRight,
    BookOpen,
    CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { tokenStorage } from '@/app/lib/token-storage';

// ─── Types ────────────────────────────────────────────────────────────────────
type UserRole = 'ADMIN' | 'AREA_MANAGER' | 'BRANCH_MANAGER' | 'FDO' | 'ADMIN_NON_HO_BRANCH_SWITCH';

interface ActionCard {
    title: string;
    description: string;
    href: string;
    icon: React.ElementType;
    gradient: string;
    roles: UserRole[];
    badge?: string;
    badgeColor?: string;
}

// ─── Loan lifecycle steps ─────────────────────────────────────────────────────
const LIFECYCLE_STEPS = [
    { step: 1, label: 'Application',       sub: 'FDO submits',        color: 'bg-blue-500',    ring: 'ring-blue-200' },
    { step: 2, label: 'BM Verification',   sub: 'Branch review',      color: 'bg-amber-500',   ring: 'ring-amber-200' },
    { step: 3, label: 'Loan Indexation',   sub: 'BM creates index',   color: 'bg-primary',   ring: 'ring-primary/30' },
    { step: 4, label: 'Member Individual', sub: 'BM collects details',color: 'bg-teal-500',    ring: 'ring-teal-200' },
    { step: 5, label: 'AM Disbursement',   sub: 'Area Mgr approves',  color: 'bg-violet-500',  ring: 'ring-violet-200' },
    { step: 6, label: 'Final Disburse',    sub: 'BM releases cash',   color: 'bg-emerald-600', ring: 'ring-emerald-200' },
];

// ─── Action cards ─────────────────────────────────────────────────────────────
const ACTION_CARDS: ActionCard[] = [
    {
        title: 'Loan Indexation',
        description: 'Bundle approved loans into an index for disbursement.',
        href: '/dashboard/loan-module/loan-indexation',
        icon: BookOpen,
        gradient: 'from-sidebar-accent to-primary',
        roles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
        badge: 'BM',
        badgeColor: 'bg-green-50 text-primary',
    },
    {
        title: 'Disbursement',
        description: 'Review indexed loans and approve final disbursement amount.',
        href: '/dashboard/loan-module/disbursement',
        icon: Banknote,
        gradient: 'from-violet-500 to-violet-700',
        roles: ['AREA_MANAGER', 'ADMIN'],
        badge: 'AM',
        badgeColor: 'bg-violet-100 text-violet-700',
    },
    {
        title: 'Final Disbursement',
        description: 'Execute the cash disbursement to clients after AM approval.',
        href: '/dashboard/loan-module/final-disbursement',
        icon: CheckCircle2,
        gradient: 'from-emerald-500 to-emerald-700',
        roles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
        badge: 'BM',
        badgeColor: 'bg-emerald-100 text-emerald-700',
    },
    {
        title: 'Member Individual',
        description: 'Collect Cash Flow, Loan Appraisal, House Hold Assessment and GRT details per indexed client before disbursement.',
        href: '/dashboard/loan-module/member-individual',
        icon: UserCog,
        gradient: 'from-teal-500 to-teal-700',
        roles: ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
        badge: 'BM',
        badgeColor: 'bg-teal-100 text-teal-700',
    },
    {
        title: 'Change Funder',
        description: 'Reassign a loan to a different funder source.',
        href: '/dashboard/loan-module/change-funder',
        icon: ArrowLeftRight,
        gradient: 'from-orange-500 to-orange-600',
        roles: ['AREA_MANAGER', 'ADMIN', 'BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
    },
    {
        title: 'Delete Disbursement',
        description: 'Remove an incorrectly created disbursement record.',
        href: '/dashboard/loan-module/delete-disbursement',
        icon: Trash2,
        gradient: 'from-red-500 to-red-600',
        roles: ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
    },
];

// ─── Main Component ───────────────────────────────────────────────────────────
export function LoanModuleIndexClient() {
    const router = useRouter();
    const currentUser = tokenStorage.getUser();
    const userRole = (currentUser?.role ?? '') as UserRole;

    // Filter cards the current role can access
    const visibleCards = useMemo(
        () => ACTION_CARDS.filter((c) => c.roles.includes(userRole)),
        [userRole]
    );

    return (
        <div className="space-y-8">

            {/* ── Page Header ─────────────────────────────────────────── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-brand-green-darker via-sidebar-accent to-primary px-6 py-8 shadow-xl">
                <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/5 blur-2xl" />
                <div className="absolute -bottom-8 left-1/3 h-32 w-32 rounded-full bg-white/5 blur-xl" />
                <div className="relative flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20 backdrop-blur-sm">
                        <CreditCard className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                            Loan Module
                        </h1>
                        <p className="mt-0.5 text-sm text-green-200">
                            Manage loan applications, indexation and disbursements
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Loan Lifecycle Flow ─────────────────────────────────── */}
            <div className="rounded-2xl border border-primary/20 bg-white p-5 shadow-sm dark:border-sidebar-accent/40 dark:bg-green-950/60">
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Loan Disbursement Lifecycle
                </h2>
                <div className="flex items-center gap-0 overflow-x-auto pb-1">
                    {LIFECYCLE_STEPS.map((s, i) => (
                        <React.Fragment key={s.step}>
                            <div className="flex min-w-[100px] flex-col items-center gap-2">
                                <div className={cn(
                                    'flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow-md ring-4',
                                    s.color, s.ring
                                )}>
                                    {s.step}
                                </div>
                                <div className="text-center">
                                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{s.label}</p>
                                    <p className="text-[10px] text-slate-400">{s.sub}</p>
                                </div>
                            </div>
                            {i < LIFECYCLE_STEPS.length - 1 && (
                                <div className="mx-1 h-0.5 flex-1 min-w-[20px] bg-gradient-to-r from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600" />
                            )}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {/* ── Action Cards ────────────────────────────────────────── */}
            <div>
                <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Your Actions
                </h2>
                {visibleCards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400 dark:border-slate-700">
                        No loan module actions available for your role.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleCards.map((card) => {
                            const Icon = card.icon;
                            return (
                                <button
                                    key={card.href}
                                    type="button"
                                    onClick={() => router.push(card.href)}
                                    className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 dark:border-slate-700/50 dark:bg-green-950/80 dark:hover:bg-brand-green-darker/80"
                                >
                                    {/* Icon strip */}
                                    <div className={cn(
                                        'mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md',
                                        card.gradient
                                    )}>
                                        <Icon className="h-6 w-6" />
                                    </div>

                                    {/* Role badge */}
                                    {card.badge && (
                                        <span className={cn(
                                            'absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                            card.badgeColor
                                        )}>
                                            {card.badge}
                                        </span>
                                    )}

                                    <h3 className="mb-1 text-sm font-bold text-slate-800 group-hover:text-primary dark:text-slate-100 dark:group-hover:text-primary transition-colors">
                                        {card.title}
                                    </h3>
                                    <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                        {card.description}
                                    </p>

                                    <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100 dark:text-primary">
                                        Open <ChevronRight className="h-3 w-3" />
                                    </div>

                                    {/* Hover glow */}
                                    <div className="absolute inset-0 -z-10 rounded-2xl bg-gradient-to-br from-primary/0 to-primary/0 transition-all duration-300 group-hover:from-primary/5 group-hover:to-primary/0" />
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
