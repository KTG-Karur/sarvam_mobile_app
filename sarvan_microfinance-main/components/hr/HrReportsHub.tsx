'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { FileBarChart2, ExternalLink, ChevronRight } from 'lucide-react';
import { REPORT_CATALOG, EXTERNAL_REPORT_LINKS, type ReportCatalogEntry } from '@/components/hr/reports/report-catalog';

const CATEGORY_SECTIONS: {
    key: ReportCatalogEntry['category'];
    title: string;
    description: string;
}[] = [
    {
        key: 'Attendance',
        title: 'Attendance, Leave & Permission Reports',
        description: 'Daily attendance records, late arrivals, absentees, leave register & balances, and gate-pass permissions',
    },
    {
        key: 'Employee',
        title: 'Employee Lifecycle Reports',
        description: 'Employee master data, new joinings, transfers, promotions, and exits',
    },
    {
        key: 'Payroll',
        title: 'Payroll & Compensation Reports',
        description: 'Monthly salary register, staff loan deductions, and advance deductions',
    },
    {
        key: 'Staff Loans & Advances',
        title: 'Staff Loan & Staff Advance Reports',
        description: 'Active loans and advances, repayment schedules, and total staff outstanding',
    },
    {
        key: 'Live Tracking',
        title: 'Field Tracking Reports',
        description: 'Employee travel distances, GPS breadcrumbs, and client visit logs',
    },
];

/**
 * Reports landing page — a card per report (grouped by category), replacing
 * the old single dropdown-driven hub now that each report has its own page
 * at /dashboard/hr/reports/[slug]. External reports (already generated on
 * their own existing pages elsewhere in the app) are shown as quick-link
 * cards here too, but aren't part of the sidebar's Reports submenu.
 */
export function HrReportsHub() {
    const router = useRouter();

    return (
        <div className="relative min-h-screen">
            <div className="mx-auto max-w-6xl space-y-6">
                <div className="mb-8 flex items-center gap-4 mt-4">
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                        <FileBarChart2 className="h-7 w-7 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-foreground dark:text-white">Reports</h1>
                        <p className="text-sm text-sidebar-accent dark:text-slate-400 mt-1">
                            Select a report to filter and generate it.
                        </p>
                    </div>
                </div>

                {CATEGORY_SECTIONS.map((section) => {
                    const reports = REPORT_CATALOG.filter((r) => r.category === section.key);
                    const externalLinks = EXTERNAL_REPORT_LINKS.filter((r) => r.category === section.key);
                    if (reports.length === 0 && externalLinks.length === 0) return null;
                    return (
                        <div key={section.key} className="space-y-3">
                            <div>
                                <h2 className="text-sm font-bold uppercase tracking-wide text-foreground dark:text-slate-200">{section.title}</h2>
                                <p className="text-xs text-muted-foreground">{section.description}</p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {reports.map((r) => (
                                    <Card
                                        key={r.slug}
                                        className="border-primary/20 bg-white/80 shadow-sm hover:shadow-md transition-shadow cursor-pointer dark:border-sidebar-accent dark:bg-brand-green-darker/40"
                                        onClick={() => router.push(`/dashboard/hr/reports/${r.slug}`)}
                                    >
                                        <CardContent className="p-4 flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-foreground dark:text-slate-100">{r.label}</span>
                                            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
                                        </CardContent>
                                    </Card>
                                ))}
                                {externalLinks.map((r) => (
                                    <Card
                                        key={r.label}
                                        className="border-primary/20 bg-white/60 shadow-sm hover:shadow-md transition-shadow cursor-pointer dark:border-sidebar-accent dark:bg-brand-green-darker/20"
                                        onClick={() => router.push(r.href)}
                                    >
                                        <CardContent className="p-4 flex items-center justify-between gap-2">
                                            <span className="text-sm font-medium text-sidebar-accent dark:text-slate-300">{r.label}</span>
                                            <ExternalLink className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
