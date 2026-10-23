'use client';

import { useMemo } from 'react';
import { Home, Users, TrendingUp, Banknote, ClipboardCheck } from 'lucide-react';
import { MetricCard } from './MetricCard';
import { tokenStorage } from '@/app/lib/token-storage';

export interface DashboardStatsData {
  totalCenters: { value: number; trend: number };
  totalClients: { value: number; trend: number };
  loanDisbursement: { value: number; trend: number };
  portfolioOS: { value: number; trend: number };
  pendingAmApproval?: number;
  pendingAdminApproval?: number;
}

export function DashboardStats({ stats }: { stats?: DashboardStatsData }) {
  const userRole = useMemo(() => tokenStorage.getUser()?.role, []);
  const isAmOrAdmin = userRole === 'AREA_MANAGER' || userRole === 'ADMIN';

  const pendingCount = userRole === 'AREA_MANAGER'
    ? (stats?.pendingAmApproval ?? 0)
    : (stats?.pendingAdminApproval ?? 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className={`grid gap-6 md:grid-cols-2 ${isAmOrAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      <MetricCard
        title="Total Centers"
        value={stats?.totalCenters?.value?.toString() || '0'}
        subtitle="Active centers across all branches"
        icon={Home}
        gradient="blue"
        href="/dashboard/centers"
        trend={{
          value: stats?.totalCenters?.trend || 0,
          isPositive: (stats?.totalCenters?.trend || 0) >= 0,
          label: 'vs last month',
        }}
      />
      <MetricCard
        title="Total Clients"
        value={stats?.totalClients?.value?.toString() || '0'}
        subtitle="Active clients in the system"
        icon={Users}
        gradient="green"
        href="/dashboard/client-search"
        trend={{
          value: stats?.totalClients?.trend || 0,
          isPositive: (stats?.totalClients?.trend || 0) >= 0,
          label: 'vs last month',
        }}
      />
      <MetricCard
        title="Loan Disbursement"
        value={formatCurrency(stats?.loanDisbursement?.value || 0)}
        subtitle="Total disbursed (all-time)"
        icon={TrendingUp}
        gradient="purple"
        href="/dashboard/reports/portfolio/loan-disbursement"
        trend={{
          value: stats?.loanDisbursement?.trend || 0,
          isPositive: (stats?.loanDisbursement?.trend || 0) >= 0,
          label: 'vs last month',
        }}
      />
      <MetricCard
        title="Portfolio OS"
        value={formatCurrency(stats?.portfolioOS?.value || 0)}
        subtitle="Outstanding portfolio value"
        icon={Banknote}
        gradient="orange"
        href="/dashboard/admin-reports/portfolio/os-branchwise"
        trend={{
          value: stats?.portfolioOS?.trend || 0,
          isPositive: (stats?.portfolioOS?.trend || 0) >= 0,
          label: 'vs last month',
        }}
      />
      {isAmOrAdmin && (
        <MetricCard
          title="Pending Approvals"
          value={pendingCount.toString()}
          subtitle={userRole === 'AREA_MANAGER' ? 'Awaiting your AM approval' : 'Awaiting admin approval'}
          icon={ClipboardCheck}
          gradient="blue"
          href="/dashboard/transactions/cash-receipt"
        />
      )}
    </div>
  );
}
