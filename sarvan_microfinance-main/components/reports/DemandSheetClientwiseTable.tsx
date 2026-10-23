"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DemandClientTableRow } from "@/app/lib/actions/demand";
import { formatCurrency, formatTime } from "./demand-sheet-format";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";

interface DemandSheetClientwiseTableProps {
  rows: DemandClientTableRow[];
}

/** Clientwise Demand Sheet table — extracted so the same 33-column markup can be
 * reused both on the report page and inside the "Download All Centers" preview dialog. */
export function DemandSheetClientwiseTable({ rows }: DemandSheetClientwiseTableProps) {
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
  return (
    <div className="rounded-md border-2 border-primary/20 shadow-lg p-2 bg-white/50 backdrop-blur-sm overflow-x-auto">
      <Table className="min-w-[2400px]">
        <TableHeader>
          <TableRow className="bg-green-50 dark:bg-sidebar-accent/40 border-b border-primary/30 dark:border-sidebar-accent">
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">S.No</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Member ID</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[160px]">Member Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Member Phone</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[110px]">Branch Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[130px]">Center Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[110px]">Group Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[120px]">Product Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Disb Date</TableHead>
            <TableHead colSpan={3} className="font-bold py-2 h-auto text-xs tracking-wide text-sidebar-accent text-center border-r border-primary/10">Loan Amount</TableHead>
            <TableHead colSpan={3} className="font-bold py-2 h-auto text-xs tracking-wide text-sidebar-accent text-center border-r border-primary/10">Loan OS</TableHead>
            <TableHead colSpan={2} className="font-bold py-2 h-auto text-xs tracking-wide text-sidebar-accent text-center border-r border-primary/10">Dues</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Demand Date</TableHead>
            <TableHead colSpan={3} className="font-bold py-2 h-auto text-xs tracking-wide text-rose-700 text-center border-r border-primary/10">Arrear Demand</TableHead>
            <TableHead colSpan={3} className="font-bold py-2 h-auto text-xs tracking-wide text-sidebar-accent text-center border-r border-primary/10">Current Demand</TableHead>
            {loanAdvanceEnabled && (
              <TableHead colSpan={2} className="font-bold py-2 h-auto text-xs tracking-wide text-emerald-700 text-center border-r border-primary/10">Loan Advance</TableHead>
            )}
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Total Demand Amount</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom border-r border-primary/10 min-w-[130px]">Officer Name</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-emerald-700 text-center align-bottom border-r border-primary/10">Current Demand Coll Amount</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10 min-w-[130px]">Collection Date</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">Collection Status</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent text-center align-bottom border-r border-primary/10">MeetUp Time</TableHead>
            <TableHead rowSpan={2} className="font-bold py-3 h-auto text-xs tracking-wide text-sidebar-accent align-bottom min-w-[110px]">Funder Name</TableHead>
          </TableRow>
          <TableRow className="bg-green-50 dark:bg-sidebar-accent/40 border-b border-primary/30 dark:border-sidebar-accent">
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Principal</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Interest</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Total</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">OS Principal</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">OS Interest</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">OS Total</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-center border-r border-primary/10">Cur Due</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-center border-r border-primary/10">Coll Dues</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-rose-700 text-right border-r border-primary/10">Arrear Principal</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-rose-700 text-right border-r border-primary/10">Arrear Interest</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-rose-700 text-right border-r border-primary/10">Arrear Total</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Demand Principal</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Demand Interest</TableHead>
            <TableHead className="font-semibold py-2 h-auto text-[11px] text-sidebar-accent text-right border-r border-primary/10">Demand Total</TableHead>
            {loanAdvanceEnabled && (
              <>
                <TableHead className="font-semibold py-2 h-auto text-[11px] text-emerald-700 text-right border-r border-primary/10">Loan Advance OS</TableHead>
                <TableHead className="font-semibold py-2 h-auto text-[11px] text-emerald-700 text-right border-r border-primary/10">Loan Advance Due</TableHead>
              </>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={33}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                No clients for the selected center.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => {
              const hasArrear = row.arrear > 0;
              return (
                <TableRow
                  key={`${row.clientId}_${row.centerId}_${row.loanId}`}
                  className={cn(
                    "border-b border-primary/20 dark:border-sidebar-accent h-12",
                    hasArrear
                      ? "bg-red-50 text-red-700 font-medium hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
                      : "hover:bg-green-50/60 dark:hover:bg-sidebar-accent/20"
                  )}
                >
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{index + 1}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10 font-mono">{row.clientId}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10 uppercase">{row.clientName}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.memberPhone || "-"}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10 uppercase">{row.branchName}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10">{row.centerName}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10">{row.groupName}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10">{row.productName}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.approvedLevel2At || "-"}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.loanAmount)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.loanAmountInterest)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-medium">{formatCurrency(row.loanAmountTotal)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.loanOSPrincipal)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.loanOSInterest)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-medium">{formatCurrency(row.loanOS)}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.curDue}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.collDue}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.demandDate}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.arrearPrincipal)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.arrearInterest)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-semibold">{formatCurrency(row.arrear)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.demandPrincipal)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10">{formatCurrency(row.demandInterest)}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-medium">{formatCurrency(row.demand)}</TableCell>
                  {loanAdvanceEnabled && (
                    <>
                      <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-medium text-emerald-700">{row.loanAdvanceOS > 0 ? formatCurrency(row.loanAdvanceOS) : ""}</TableCell>
                      <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-medium text-emerald-700">{row.loanAdvanceDemand > 0 ? formatCurrency(row.loanAdvanceDemand) : ""}</TableCell>
                    </>
                  )}
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-semibold">{formatCurrency(row.totalDemandAmount)}</TableCell>
                  <TableCell className="py-3 text-xs border-r border-primary/10">{row.officerName}</TableCell>
                  <TableCell className="text-right py-3 text-xs border-r border-primary/10 font-semibold text-emerald-700 dark:text-emerald-400">{formatCurrency(row.currentDemandCollAmount)}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10 whitespace-nowrap">{row.collectionDate || "-"}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{row.collectionStatus}</TableCell>
                  <TableCell className="text-center py-3 text-xs border-r border-primary/10">{formatTime(row.meetingTime)}</TableCell>
                  <TableCell className="py-3 text-xs">{row.funderName}</TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
