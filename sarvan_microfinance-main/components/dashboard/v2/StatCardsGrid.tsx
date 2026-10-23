'use client';

import {
    Building2, Users, UserCheck, UserX, BriefcaseBusiness,
    Landmark, TrendingUp, Wallet, ShieldCheck, CircleDollarSign, Group,
} from 'lucide-react';

export interface DashboardStats {
    centers: number;
    groups: number;
    totalMembers: number;
    activeMembers: number;
    rejectedMembers: number;
    totalStaff: number;
    totalFunders: number;
    loanDisbursement: number;
    outstandingBalance: number;
    highmarkChecked: number;
    highmarkBalance: number;
}

function fmt(n: number) {
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}
function fmtCur(n: number) {
    if (n >= 10_00_00_000) return `₹${(n / 10_00_00_000).toFixed(2)} Cr`;
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L`;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

interface CardDef {
    label: string;
    getValue: (s: DashboardStats) => string;
    icon: React.ElementType;
    bg: string;
    text: string;
    iconBg: string;
    adminOnly?: boolean;
}

const CARDS: CardDef[] = [
    {
        label: 'No of Centers',
        getValue: (s) => fmt(s.centers),
        icon: Building2,
        bg: 'from-primary to-primary',
        text: 'text-sidebar-accent dark:text-green-300',
        iconBg: 'bg-brand-green-tint dark:bg-brand-green-darker/40',
    },
    {
        label: 'Total Groups',
        getValue: (s) => fmt(s.groups),
        icon: Group,
        bg: 'from-primary to-primary',
        text: 'text-sidebar-accent dark:text-green-300',
        iconBg: 'bg-brand-green-tint dark:bg-brand-green-darker/40',
    },
    {
        label: 'Total Members',
        getValue: (s) => fmt(s.totalMembers),
        icon: Users,
        bg: 'from-cyan-500 to-cyan-600',
        text: 'text-cyan-700 dark:text-cyan-300',
        iconBg: 'bg-cyan-100 dark:bg-cyan-900/40',
    },
    {
        label: 'Active Members',
        getValue: (s) => fmt(s.activeMembers),
        icon: UserCheck,
        bg: 'from-emerald-500 to-emerald-600',
        text: 'text-emerald-700 dark:text-emerald-300',
        iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    },
    {
        label: 'Rejected Members',
        getValue: (s) => fmt(s.rejectedMembers),
        icon: UserX,
        bg: 'from-rose-500 to-rose-600',
        text: 'text-rose-700 dark:text-rose-300',
        iconBg: 'bg-rose-100 dark:bg-rose-900/40',
    },
    {
        label: 'Total Staff',
        getValue: (s) => fmt(s.totalStaff),
        icon: BriefcaseBusiness,
        bg: 'from-violet-500 to-violet-600',
        text: 'text-violet-700 dark:text-violet-300',
        iconBg: 'bg-violet-100 dark:bg-violet-900/40',
        adminOnly: true,
    },
    {
        label: 'Total Funder',
        getValue: (s) => fmt(s.totalFunders),
        icon: Landmark,
        bg: 'from-amber-500 to-amber-600',
        text: 'text-amber-700 dark:text-amber-300',
        iconBg: 'bg-amber-100 dark:bg-amber-900/40',
        adminOnly: true,
    },
    {
        label: 'Loan Disbursement',
        getValue: (s) => fmtCur(s.loanDisbursement),
        icon: TrendingUp,
        bg: 'from-teal-500 to-teal-600',
        text: 'text-teal-700 dark:text-teal-300',
        iconBg: 'bg-teal-100 dark:bg-teal-900/40',
    },
    {
        label: 'Outstanding Balance',
        getValue: (s) => fmtCur(s.outstandingBalance),
        icon: Wallet,
        bg: 'from-orange-500 to-orange-600',
        text: 'text-orange-700 dark:text-orange-300',
        iconBg: 'bg-orange-100 dark:bg-orange-900/40',
    },
    {
        label: 'Highmark Checked',
        getValue: (s) => fmt(s.highmarkChecked),
        icon: ShieldCheck,
        bg: 'from-sky-500 to-sky-600',
        text: 'text-sky-700 dark:text-sky-300',
        iconBg: 'bg-sky-100 dark:bg-sky-900/40',
        adminOnly: true,
    },
    {
        label: 'Highmark Balance',
        getValue: (s) => fmtCur(s.highmarkBalance),
        icon: CircleDollarSign,
        bg: 'from-pink-500 to-pink-600',
        text: 'text-pink-700 dark:text-pink-300',
        iconBg: 'bg-pink-100 dark:bg-pink-900/40',
        adminOnly: true,
    },
];

export function StatCardsGrid({ stats, isAdmin }: { stats?: DashboardStats; isAdmin?: boolean }) {
    const s: DashboardStats = stats ?? {
        centers: 0, groups: 0, totalMembers: 0, activeMembers: 0,
        rejectedMembers: 0, totalStaff: 0, totalFunders: 0,
        loanDisbursement: 0, outstandingBalance: 0,
        highmarkChecked: 0, highmarkBalance: 0,
    };

    const visibleCards = CARDS.filter((c) => !c.adminOnly || isAdmin);

    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {visibleCards.map((card) => {
                const Icon = card.icon;
                return (
                    <div
                        key={card.label}
                        className="relative overflow-hidden rounded-xl border border-primary/20 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-sidebar-accent dark:bg-brand-green-darker"
                    >
                        <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.bg}`} />
                        <div className={`mb-3 inline-flex rounded-lg p-2 ${card.iconBg}`}>
                            <Icon className={`h-5 w-5 ${card.text}`} />
                        </div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {card.label}
                        </p>
                        <p className={`mt-1 text-xl font-bold ${card.text}`}>
                            {card.getValue(s)}
                        </p>
                    </div>
                );
            })}
        </div>
    );
}

export function StatCardsGridSkeleton({ isAdmin }: { isAdmin?: boolean }) {
    const count = isAdmin ? 11 : 7;
    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="relative overflow-hidden rounded-xl border border-primary/20 bg-white p-4 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker"
                >
                    <div className="absolute inset-x-0 top-0 h-1 bg-brand-green-tint dark:bg-sidebar-accent" />
                    <div className="mb-3 h-9 w-9 rounded-lg bg-brand-green-tint dark:bg-sidebar-accent" />
                    <div className="h-3 w-24 rounded bg-brand-green-tint dark:bg-sidebar-accent" />
                    <div className="mt-1 h-7 w-16 rounded bg-brand-green-tint dark:bg-sidebar-accent" />
                </div>
            ))}
        </div>
    );
}
