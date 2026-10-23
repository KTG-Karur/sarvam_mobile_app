import { DashboardFooter } from '@/components/dashboard/DashboardFooter';
import { BankReceiptPage } from '@/components/transactions/BankReceiptPage';

export default function BankReceiptPageRoute() {
    return (
        <div className="relative min-h-screen flex flex-col bg-gradient-to-br from-background via-green-50/30 to-green-50/30 dark:from-background dark:via-brand-green-darker dark:to-green-950">
            <div className="flex-1 px-6 py-6 md:px-8">
                <BankReceiptPage />
            </div>
            <div className="px-6 pb-6">
                <DashboardFooter />
            </div>
        </div>
    );
}
