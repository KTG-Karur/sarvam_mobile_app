import { Metadata } from 'next';
import { UserPlus, Users, Shield } from 'lucide-react';
import { CoApplicantForm } from '@/components/client/CoApplicantForm';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { getActiveBrandNames } from '@/app/lib/brand-server';

export async function generateMetadata(): Promise<Metadata> {
    const { companyNameShort } = await getActiveBrandNames();
    return {
        title: `Client Co-Applicant | ${companyNameShort} Microfinance`,
        description: 'Manage co-applicant details for clients',
    };
}

export default function CoApplicantPage() {
    return (
        <div className="relative min-h-screen bg-gradient-to-br from-background via-purple-50/20 to-pink-50/20 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            {/* Background decoration */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-purple-400/10 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-pink-400/10 blur-3xl" />
            </div>

            <div className="relative container mx-auto px-4 sm:px-3 sm:px-6 py-4 sm:py-8 max-w-6xl">
                {/* Page Header */}
                <div className="mb-8">
                    <div className="flex items-start gap-5">
                        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 shadow-xl shadow-purple-500/30">
                            <UserPlus className="h-7 w-7 text-white" />
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/20 to-transparent" />
                        </div>
                        <div>
                            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-foreground dark:text-white">
                                Client Co-Applicant
                            </h1>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-xl">
                                Select a center and client to view, create, or update co-applicant details.
                                The form automatically switches between create and edit mode.
                            </p>
                            {/* Stats row */}
                            <div className="flex flex-wrap gap-4 mt-4">
                                {[
                                    { icon: Users, label: 'Filter by Center & Client', color: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20' },
                                    { icon: UserPlus, label: 'Create or Edit Co-Applicant', color: 'text-pink-500 bg-pink-50 dark:bg-pink-900/20' },
                                    { icon: Shield, label: 'Secure & Validated', color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' },
                                ].map(({ icon: Icon, label, color }) => (
                                    <div key={label} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${color}`}>
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Main Card */}
                <div className="rounded-3xl border border-primary/20/80 dark:border-sidebar-accent/60 bg-white/90 dark:bg-brand-green-darker/80 backdrop-blur-sm shadow-2xl shadow-slate-200/60 dark:shadow-green-950/50 overflow-hidden">
                    {/* Top gradient bar */}
                    <div className="h-1.5 bg-gradient-to-r from-purple-600 via-pink-500 to-purple-600 bg-[length:200%] animate-[shimmer_3s_linear_infinite]" />

                    {/* Card header */}
                    <div className="px-6 sm:px-8 py-5 border-b border-slate-100 dark:border-sidebar-accent bg-gradient-to-r from-slate-50/80 via-purple-50/40 to-transparent dark:from-brand-green-darker/80 dark:via-purple-950/20">
                        <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/40">
                                <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-sidebar-accent dark:text-slate-100">
                                    Co-Applicant Management
                                </h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Edits the Primary co-applicant only — see{' '}
                                    <a href="/dashboard/client/co-applicants" className="underline hover:text-purple-600">
                                        Co-Applicant Management
                                    </a>{' '}
                                    to add additional co-applicants or review approval status
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Form */}
                    <div className="px-6 sm:px-8 py-7">
                        <CoApplicantForm />
                    </div>
                </div>
            </div>

            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
