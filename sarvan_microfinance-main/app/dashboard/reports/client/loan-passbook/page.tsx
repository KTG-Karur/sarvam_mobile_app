import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PassbookFormPage } from '@/components/reports/PassbookFormPage';
import { BookOpen } from 'lucide-react';

export default function LoanPassbookPage() {
    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-gradient-to-br from-background via-green-50/20 to-emerald-50/30 dark:from-brand-green-darker dark:via-green-950 dark:to-brand-green-darker">
                <div className="border-b border-primary/20 dark:border-sidebar-accent/40 bg-white/80 dark:bg-green-950/80 backdrop-blur-sm">
                    <div className="px-6 py-4 flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                            <BookOpen className="h-5 w-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-foreground dark:text-white">Loan Passbook</h1>
                            <p className="text-xs text-muted-foreground">Generate Tamil passbook PDF for member handout</p>
                        </div>
                    </div>
                </div>
                <div className="p-6">
                    <PassbookFormPage />
                </div>
            </div>
        </ProtectedRoute>
    );
}
