'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';
import { cn } from '@/lib/utils';
import type { DashboardFilters } from '@/components/dashboard/v2/DashboardFiltersBar';
import {
  Target, UserPlus, RefreshCw, Banknote,
  Users, TrendingUp, Coins, RotateCcw,
  Building2, UserCheck, Wallet, Activity,
  AlertTriangle, IndianRupee, Percent, ChevronRight,
} from 'lucide-react';

interface ExtendedTaskDetails {
  role: string;
  name: string;
  month: number;
  year: number;
  subordinateCount: number;

  targets: { enrollmentTarget: number; newMemberTarget: number; renewalMemberTarget: number; loanDisbursementTarget: number };
  achievement: { newMember: number; renewal: number; goldLoan: number; disbursementAmount: number };
  operations: { numberOfCenters: number; activeClients: number; activeMembers: number; activeClientsWithLoan: number; totalDisbursementMembers: number; totalDisbursementAmount: number };
  goldLoan: { numberOfMembers: number; disbursementAmount: number; goldReturn: number };
  portfolio: { principalOutstanding: number; interestOutstanding: number };
  arrear: { arrearClients: number; arrearPrincipal: number; arrearInterest: number };
  arrearMemberPct: number;

  enrollmentTarget: number;
  enrollmentAchieved: number;
  enrollmentBalance: number;
  collectionTargetPct: number;
  actualCollectionPct: number;
  collectionDifferencePct: number;
}

type SubUser = { id: string; name: string; role: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ROLE_LABELS: Record<string, string> = {
  FDO: 'FDO',
  BRANCH_MANAGER: 'Branch Manager',
  AREA_MANAGER: 'Area Manager',
  DIVISION_MANAGER: 'Division Manager',
  ADMIN: 'Admin',
};

const SUBORDINATE_LABELS: Record<string, string> = {
  BRANCH_MANAGER: 'FDOs',
  AREA_MANAGER: 'BMs',
  DIVISION_MANAGER: 'AMs',
  ADMIN: 'FDOs',
};

const DRILL_DOWN_LEVELS: Record<string, string[]> = {
  BRANCH_MANAGER: ['FDO'],
  AREA_MANAGER: ['BM', 'FDO'],
  DIVISION_MANAGER: ['AM', 'BM', 'FDO'],
  ADMIN: ['AM', 'BM', 'FDO'],
};

const ROLE_PARAM_TO_FULL: Record<string, string> = {
  AM: 'AREA_MANAGER',
  BM: 'BRANCH_MANAGER',
  FDO: 'FDO',
};

function fmtAmt(v: number) {
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}

function pct(achieved: number, target: number) {
  if (target === 0) return achieved > 0 ? '—' : '0%';
  return `${Math.round((achieved / target) * 100)}%`;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary mb-2">{children}</p>
  );
}

interface TargetItemProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  iconClass?: string;
  iconBg?: string;
  sub?: string;
  last?: boolean;
}

function TargetItem({ icon: Icon, label, value, iconClass = 'text-primary', iconBg = 'bg-brand-green-tint dark:bg-[#01230f]', sub, last }: TargetItemProps) {
  return (
    <div className={cn('flex items-center gap-2.5 py-2.5 px-3', !last && 'border-r border-brand-green-tint dark:border-sidebar-accent')}>
      <div className={cn('shrink-0 flex items-center justify-center w-8 h-8 rounded-lg', iconBg)}>
        <Icon className={cn('w-4 h-4', iconClass)} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight truncate">{label}</p>
        <p className="text-sm font-bold text-foreground dark:text-slate-100 leading-tight">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">{sub}</p>}
      </div>
    </div>
  );
}

function SectionBox({ children, cols }: { children: React.ReactNode; cols: string }) {
  return (
    <div className="rounded-xl border border-brand-green-tint dark:border-sidebar-accent bg-white dark:bg-green-950 overflow-hidden">
      <div className={cn('grid divide-brand-green-tint dark:divide-sidebar-accent', cols)}>
        {children}
      </div>
    </div>
  );
}

function DrillPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-[10px] px-2.5 py-0.5 rounded-full border transition-colors',
        active
          ? 'bg-primary text-white border-primary'
          : 'text-slate-500 border-slate-300 dark:border-sidebar-accent hover:border-primary dark:text-slate-400',
      )}
    >
      {label}
    </button>
  );
}

function DrillSelect({ value, onChange, disabled, users, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  users: SubUser[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="text-[10px] border border-slate-300 dark:border-sidebar-accent rounded px-2 py-0.5 bg-white dark:bg-green-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:border-primary disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}

interface Props {
  filters?: DashboardFilters;
}

export function TaskDetailsCard({ filters }: Props) {
  const myRole = useRef(tokenStorage.getUser()?.role ?? '').current;

  const [data, setData] = useState<ExtendedTaskDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Level 1: subordinate of the logged-in user
  const [l1Role, setL1Role] = useState('');
  const [l1UserId, setL1UserId] = useState('');
  const [l1Users, setL1Users] = useState<SubUser[]>([]);
  const [l1Loading, setL1Loading] = useState(false);

  // Level 2: subordinate of the L1 user
  const [l2Role, setL2Role] = useState('');
  const [l2UserId, setL2UserId] = useState('');
  const [l2Users, setL2Users] = useState<SubUser[]>([]);
  const [l2Loading, setL2Loading] = useState(false);

  // Fetch L1 subordinates when L1 role pill changes
  useEffect(() => {
    if (!l1Role) { setL1Users([]); setL1UserId(''); setL2Role(''); setL2UserId(''); setL2Users([]); return; }
    setL1Loading(true);
    setL1UserId('');
    setL2Role('');
    setL2UserId('');
    setL2Users([]);
    apiClient.get<{ users: SubUser[] }>(`/employee/current/subordinates?role=${l1Role}`)
      .then((res) => { if (res.success && res.data) setL1Users(res.data.users); })
      .finally(() => setL1Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l1Role]);

  // Fetch L2 subordinates when L2 role pill changes (needs l1UserId as context)
  useEffect(() => {
    if (!l2Role || !l1UserId) { setL2Users([]); setL2UserId(''); return; }
    setL2Loading(true);
    setL2UserId('');
    apiClient.get<{ users: SubUser[] }>(`/employee/current/subordinates?role=${l2Role}&fromUserId=${l1UserId}`)
      .then((res) => { if (res.success && res.data) setL2Users(res.data.users); })
      .finally(() => setL2Loading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l2Role, l1UserId]);

  // Fetch task details
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters?.branchId) params.set('branchId', filters.branchId);
        if (filters?.areaId) params.set('areaId', filters.areaId);
        if (filters?.divisionId) params.set('divisionId', filters.divisionId);
        if (filters?.regionId) params.set('regionId', filters.regionId);
        const effectiveViewUserId = l2UserId || l1UserId;
        if (effectiveViewUserId) params.set('viewUserId', effectiveViewUserId);
        const qs = params.toString();
        const result = await apiClient.get<ExtendedTaskDetails>(
          `/employee/current/task-details${qs ? `?${qs}` : ''}`,
        );
        if (result.success && result.data) setData(result.data);
      } catch {
        // silently ignore
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters?.branchId, filters?.areaId, filters?.divisionId, filters?.regionId, l1UserId, l2UserId]);

  if (isLoading || !data) return null;

  const monthName = MONTHS[data.month - 1];
  const roleLabel = ROLE_LABELS[data.role] ?? data.role;
  const subLabel = SUBORDINATE_LABELS[data.role];
  const arrearBarWidth = Math.min(data.arrearMemberPct, 100);
  const arrearBarColor =
    data.arrearMemberPct >= 20 ? 'bg-red-500' :
    data.arrearMemberPct >= 10 ? 'bg-amber-500' : 'bg-yellow-400';

  const collPctColor =
    data.actualCollectionPct >= 100 ? 'text-green-600 dark:text-green-400' :
    data.actualCollectionPct >= 80 ? 'text-amber-600 dark:text-amber-400' :
    'text-red-600 dark:text-red-400';

  const collPctBg =
    data.actualCollectionPct >= 100 ? 'bg-green-100 dark:bg-green-900/40' :
    data.actualCollectionPct >= 80 ? 'bg-amber-100 dark:bg-amber-900/40' :
    'bg-red-100 dark:bg-red-900/40';

  const collDiffColor = data.collectionDifferencePct <= 0
    ? 'text-green-600 dark:text-green-400'
    : data.collectionDifferencePct <= 20
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';

  const collDiffBg = data.collectionDifferencePct <= 0
    ? 'bg-green-100 dark:bg-green-900/40'
    : data.collectionDifferencePct <= 20
    ? 'bg-amber-100 dark:bg-amber-900/40'
    : 'bg-red-100 dark:bg-red-900/40';

  // Drill-down derived values
  const l1AvailableLevels = DRILL_DOWN_LEVELS[myRole] ?? [];
  const l1UserName = l1Users.find((u) => u.id === l1UserId)?.name ?? '';
  const l1UserRoleLabel = l1Users.find((u) => u.id === l1UserId)?.role ?? '';
  const l1UserRoleFull = ROLE_PARAM_TO_FULL[l1UserRoleLabel] ?? '';
  const l2AvailableLevels = l1UserId ? (DRILL_DOWN_LEVELS[l1UserRoleFull] ?? []) : [];

  return (
    <Card className="border-primary/20 dark:border-sidebar-accent">
      <CardContent className="p-4 space-y-4">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Task Details</p>
            <p className="text-sm font-medium text-foreground dark:text-slate-100">{monthName} {data.year} — {data.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {subLabel && data.subordinateCount > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">{data.subordinateCount} {subLabel} reporting</span>
            )}
            <span className="text-xs font-semibold bg-primary text-white px-2 py-0.5 rounded-full">{roleLabel}</span>
          </div>
        </div>

        {/* ── Drill-down filter ── */}
        {l1AvailableLevels.length > 0 && (
          <div className="space-y-2 pb-3 border-b border-brand-green-tint dark:border-sidebar-accent">

            {/* Level 1 row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-1">View by:</span>
              <DrillPill
                label={ROLE_LABELS[myRole] ?? myRole}
                active={!l1Role}
                onClick={() => { setL1Role(''); }}
              />
              {l1AvailableLevels.map((level) => (
                <DrillPill
                  key={level}
                  label={level}
                  active={l1Role === level}
                  onClick={() => setL1Role(level)}
                />
              ))}
              {l1Role && (
                <DrillSelect
                  value={l1UserId}
                  onChange={(v) => { setL1UserId(v); setL2Role(''); setL2UserId(''); setL2Users([]); }}
                  disabled={l1Loading}
                  users={l1Users}
                  placeholder={l1Loading ? 'Loading…' : `— All ${l1Role}s —`}
                />
              )}
            </div>

            {/* Level 2 row — only when an L1 user is selected and they have subordinates */}
            {l1UserId && l2AvailableLevels.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pl-3 border-l-2 border-primary/30">
                <ChevronRight className="w-3 h-3 text-primary shrink-0" />
                <span className="text-[10px] font-medium text-primary dark:text-primary mr-1 truncate max-w-[120px]">{l1UserName}:</span>
                <DrillPill
                  label={l1UserName.split(' ')[0]}
                  active={!l2Role}
                  onClick={() => { setL2Role(''); setL2UserId(''); }}
                />
                {l2AvailableLevels.map((level) => (
                  <DrillPill
                    key={level}
                    label={level}
                    active={l2Role === level}
                    onClick={() => setL2Role(level)}
                  />
                ))}
                {l2Role && (
                  <DrillSelect
                    value={l2UserId}
                    onChange={setL2UserId}
                    disabled={l2Loading}
                    users={l2Users}
                    placeholder={l2Loading ? 'Loading…' : `— All ${l2Role}s —`}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TARGETS ── */}
        <div>
          <SectionHeader>Targets</SectionHeader>
          <SectionBox cols="grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x">
            <TargetItem icon={UserPlus} label="New Member Target" value={data.targets.newMemberTarget} iconClass="text-sky-600" />
            <TargetItem icon={RefreshCw} label="Renewal Target" value={data.targets.renewalMemberTarget} iconClass="text-violet-600" />
            <TargetItem icon={Target} label="Total Enr. Target" value={data.targets.enrollmentTarget} iconClass="text-primary" />
            <TargetItem icon={Banknote} label="Loan Disbmt Target" value={fmtAmt(data.targets.loanDisbursementTarget)} iconClass="text-amber-600" last />
          </SectionBox>
        </div>

        {/* ── ACHIEVEMENT + OPERATIONS ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SectionHeader>Achievement</SectionHeader>
            <SectionBox cols="grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x">
              <TargetItem
                icon={UserPlus} label="New Members"
                value={data.achievement.newMember}
                sub={pct(data.achievement.newMember, data.targets.newMemberTarget)}
                iconClass="text-sky-600"
              />
              <TargetItem
                icon={RefreshCw} label="Renewals"
                value={data.achievement.renewal}
                sub={pct(data.achievement.renewal, data.targets.renewalMemberTarget)}
                iconClass="text-violet-600"
              />
              <TargetItem icon={Coins} label="Gold Loans" value={data.achievement.goldLoan} iconClass="text-amber-600" />
              <TargetItem
                icon={TrendingUp} label="Disbmt Amount"
                value={fmtAmt(data.achievement.disbursementAmount)}
                sub={pct(data.achievement.disbursementAmount, data.targets.loanDisbursementTarget)}
                iconClass="text-primary"
                last
              />
            </SectionBox>
          </div>
          <div>
            <SectionHeader>Operations</SectionHeader>
            <SectionBox cols="grid-cols-2 sm:grid-cols-3 divide-y sm:divide-y-0 divide-x">
              <TargetItem icon={Building2} label="No. of Centers" value={data.operations.numberOfCenters} iconClass="text-blue-600" />
              <TargetItem icon={Users} label="Active (Total)" value={data.operations.activeClients} iconClass="text-primary" />
              <TargetItem icon={Users} label="Active Members" value={data.operations.activeMembers} iconClass="text-sky-600" />
              <TargetItem icon={Users} label="Active Clients" value={data.operations.activeClientsWithLoan} iconClass="text-primary" />
              <TargetItem icon={UserCheck} label="Disbmt (Clients)" value={data.operations.totalDisbursementMembers} iconClass="text-teal-600" />
              <TargetItem icon={Wallet} label="Disbmt Amount" value={fmtAmt(data.operations.totalDisbursementAmount)} iconClass="text-orange-600" last />
            </SectionBox>
          </div>
        </div>

        {/* ── GOLD LOAN + COLLECTION ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SectionHeader>Gold Loan</SectionHeader>
            <SectionBox cols="grid-cols-3 divide-x">
              <TargetItem icon={Users} label="Clients" value={data.goldLoan.numberOfMembers} iconClass="text-amber-600" />
              <TargetItem icon={Banknote} label="Disbmt Amt" value={fmtAmt(data.goldLoan.disbursementAmount)} iconClass="text-yellow-600" />
              <TargetItem icon={RotateCcw} label="Returns" value={data.goldLoan.goldReturn} iconClass="text-red-500" last />
            </SectionBox>
          </div>
          <div>
            <SectionHeader>Collection</SectionHeader>
            <SectionBox cols="grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 divide-x">
              <TargetItem
                icon={Target} label="Target" value="100%"
                iconClass="text-green-600" iconBg="bg-green-100 dark:bg-green-900/40"
              />
              <TargetItem
                icon={Activity} label="Actual"
                value={<span className={collPctColor}>{data.actualCollectionPct}%</span>}
                iconClass={collPctColor} iconBg={collPctBg}
              />
              <TargetItem
                icon={Percent} label="Difference"
                value={
                  <span className={collDiffColor}>
                    {data.collectionDifferencePct > 0 ? '-' : ''}{data.collectionDifferencePct}%
                  </span>
                }
                iconClass={collDiffColor} iconBg={collDiffBg}
              />
              <TargetItem
                icon={Coins} label="Gold Loan Coll."
                value={<span className={collPctColor}>{data.actualCollectionPct}%</span>}
                iconClass={collPctColor} iconBg={collPctBg}
                last
              />
            </SectionBox>
          </div>
        </div>

        {/* ── PORTFOLIO + ARREARS ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SectionHeader>Portfolio Outstanding</SectionHeader>
            <SectionBox cols="grid-cols-2 divide-x">
              <TargetItem icon={Wallet} label="Principal O/S" value={fmtAmt(data.portfolio.principalOutstanding)} iconClass="text-blue-600" />
              <TargetItem icon={IndianRupee} label="Interest O/S" value={fmtAmt(data.portfolio.interestOutstanding)} iconClass="text-orange-600" last />
            </SectionBox>
          </div>
          <div>
            <SectionHeader>Arrears</SectionHeader>
            <SectionBox cols="grid-cols-3 divide-x">
              <TargetItem icon={AlertTriangle} label="Arrear Clients" value={data.arrear.arrearClients} iconClass="text-red-600" />
              <TargetItem icon={IndianRupee} label="Principal" value={fmtAmt(data.arrear.arrearPrincipal)} iconClass="text-red-600" />
              <TargetItem icon={Percent} label="Interest" value={fmtAmt(data.arrear.arrearInterest)} iconClass="text-red-600" last />
            </SectionBox>
          </div>
        </div>

        {/* ── PAR — Portfolio At Risk ── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <SectionHeader>PAR</SectionHeader>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 -mt-2">(Portfolio At Risk)</span>
            </div>
            <span className={cn('text-xs font-bold', {
              'text-green-600 dark:text-green-400': data.arrearMemberPct < 10,
              'text-amber-600 dark:text-amber-400': data.arrearMemberPct >= 10 && data.arrearMemberPct < 20,
              'text-red-600 dark:text-red-400': data.arrearMemberPct >= 20,
            })}>
              {data.arrearMemberPct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
            <div
              className={cn('h-3 rounded-full transition-all duration-500', arrearBarColor)}
              style={{ width: `${arrearBarWidth}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {data.arrear.arrearClients} of {data.operations.activeClients} members/clients in arrears
          </p>
        </div>

      </CardContent>
    </Card>
  );
}
