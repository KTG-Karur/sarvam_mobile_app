import { notFound } from 'next/navigation';
import { SingleReportRunner } from '@/components/hr/reports/SingleReportRunner';
import { getReportCatalogEntry } from '@/components/hr/reports/report-catalog';
import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';

export default async function HrReportSlugPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const report = getReportCatalogEntry(slug);
    if (!report) notFound();

    return (
        <ProtectedRoute>
            <div className="relative min-h-screen bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
                <div className="flex min-h-screen flex-col">
                    <div className="flex-1 px-4 md:px-8 py-8 md:py-12">
                        <SingleReportRunner report={report} />
                    </div>
                    <div className="px-6 pb-6">
                        <DashboardFooter />
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    );
}
