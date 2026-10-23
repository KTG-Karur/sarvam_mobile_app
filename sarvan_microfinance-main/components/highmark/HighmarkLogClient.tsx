'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiClient } from '@/app/lib/api-client';
import { Eye, ChevronLeft, ChevronRight, Search, RotateCcw } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { CreditReportResult } from './RunCreditCheckClient';
import type { HighmarkReportSummary } from './types';
import { DateInput } from '@/components/ui/date-input';
import { toDisplayDateTime } from '@/app/lib/date-format';

const PAGE_SIZE = 50;

interface Branch { id: string; name: string; code: string }
interface Center { id: string; name: string; code: string }

interface Filters {
  branchId: string;
  centerId: string;
  fromDate: string;
  toDate: string;
  aadhaar: string;
  phone: string;
  clientId: string;
}

const EMPTY_FILTERS: Filters = { branchId: '', centerId: '', fromDate: '', toDate: '', aadhaar: '', phone: '', clientId: '' };

const toVal = (v: string) => (v === 'all' ? '' : v);
const fromVal = (v: string) => (v === '' ? 'all' : v);

export function HighmarkLogClient() {
  const [items, setItems] = useState<HighmarkReportSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalCost, setTotalCost] = useState(0);
  const [skip, setSkip] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<HighmarkReportSummary | null>(null);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [centers, setCenters] = useState<Center[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Aadhaar/phone/client-id are free-text — held as drafts until Apply/Enter so
  // every keystroke doesn't trigger a request.
  const [draft, setDraft] = useState({ aadhaar: '', phone: '', clientId: '' });

  useEffect(() => {
    apiClient.get<Branch[]>('/branches?includeInactive=false').then((res) => {
      if (res.success && res.data) setBranches(res.data);
    });
  }, []);

  async function handleBranchChange(raw: string) {
    const branchId = toVal(raw);
    setCenters([]);
    setFilters((f) => ({ ...f, branchId, centerId: '' }));
    setSkip(0);
    if (!branchId) return;
    const res = await apiClient.get<Center[]>(`/centers?branchId=${branchId}&includeInactive=false`);
    if (res.success && res.data) setCenters(res.data);
  }

  function applyTextFilters() {
    setFilters((f) => ({ ...f, ...draft }));
    setSkip(0);
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setDraft({ aadhaar: '', phone: '', clientId: '' });
    setCenters([]);
    setSkip(0);
  }

  useEffect(() => {
    setIsLoading(true);
    const params = new URLSearchParams({ skip: String(skip), take: String(PAGE_SIZE) });
    if (filters.branchId) params.set('branchId', filters.branchId);
    if (filters.centerId) params.set('centerId', filters.centerId);
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    if (filters.aadhaar) params.set('aadhaar', filters.aadhaar);
    if (filters.phone) params.set('phone', filters.phone);
    if (filters.clientId) params.set('clientId', filters.clientId);

    apiClient
      .get<{ items: HighmarkReportSummary[]; total: number; totalCost: number }>(`/highmark/register?${params.toString()}`)
      .then((res) => {
        if (res.success && res.data) {
          setItems(res.data.items);
          setTotal(res.data.total);
          setTotalCost(res.data.totalCost);
        }
      })
      .finally(() => setIsLoading(false));
  }, [skip, filters]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Highmark Log"
        description="Every Highmark (CRIF) pull — who ran it, for whom, when, and at what cost."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total pulls (matching filters)</span>
            <span className="text-xl font-semibold tabular-nums">{total}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total cost (matching filters)</span>
            <span className="text-xl font-semibold tabular-nums">₹{totalCost.toFixed(2)}</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Branch</Label>
              <Select value={fromVal(filters.branchId)} onValueChange={(v) => void handleBranchChange(v)}>
                <SelectTrigger className="h-9"><SelectValue placeholder="All Branches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Center</Label>
              <Select
                value={fromVal(filters.centerId)}
                onValueChange={(v) => { setFilters((f) => ({ ...f, centerId: toVal(v) })); setSkip(0); }}
                disabled={!filters.branchId}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="All Centers" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Centers</SelectItem>
                  {centers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From date</Label>
              <DateInput className="h-9" value={filters.fromDate}
                onChange={(e) => { setFilters((f) => ({ ...f, fromDate: e.target.value })); setSkip(0); }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To date</Label>
              <DateInput className="h-9" value={filters.toDate}
                onChange={(e) => { setFilters((f) => ({ ...f, toDate: e.target.value })); setSkip(0); }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Aadhaar</Label>
              <Input className="h-9" placeholder="Full or last 4 digits" value={draft.aadhaar}
                onChange={(e) => setDraft((d) => ({ ...d, aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) }))}
                onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input className="h-9" placeholder="Phone number" value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Client ID</Label>
              <Input className="h-9" placeholder="e.g. C000123" value={draft.clientId}
                onChange={(e) => setDraft((d) => ({ ...d, clientId: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && applyTextFilters()} />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={applyTextFilters}>
              <Search className="mr-2 h-4 w-4" />
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={resetFilters}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </div>

          {isLoading ? (
            <PageLoader fullScreen={false} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pulled at</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Aadhaar</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-xs">{toDisplayDateTime(new Date(r.pulledAt))}</TableCell>
                      <TableCell>{r.firstName} {r.lastName}</TableCell>
                      <TableCell className="tabular-nums">{r.aadhaarMasked}</TableCell>
                      <TableCell>{r.client ? `${r.client.firstName} ${r.client.lastName} (${r.client.clientId})` : '—'}</TableCell>
                      <TableCell>{r.requestedBy ? `${r.requestedBy.firstName} ${r.requestedBy.lastName}` : '—'}</TableCell>
                      <TableCell>{r.branch ? `${r.branch.name} (${r.branch.code})` : '—'}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{r.creditScore ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === 'Completed' ? 'default' : 'destructive'}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">₹{Number(r.creditsCharged).toFixed(2)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No Highmark pulls match these filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {total === 0 ? '0 results' : `${skip + 1}–${Math.min(skip + PAGE_SIZE, total)} of ${total}`}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={skip + PAGE_SIZE >= total} onClick={() => setSkip(skip + PAGE_SIZE)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.firstName} {selected?.lastName} — {selected?.aadhaarMasked}</DialogTitle>
          </DialogHeader>
          {selected && <CreditReportResult report={selected} reused={selected.fromCache} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
