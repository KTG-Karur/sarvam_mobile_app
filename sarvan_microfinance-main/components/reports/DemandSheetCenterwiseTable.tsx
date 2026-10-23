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
import type { DemandSheetData } from "@/app/lib/actions/demand";
import { formatCurrency, formatTime } from "./demand-sheet-format";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";

interface DemandSheetCenterwiseTableProps {
  rows: DemandSheetData[];
}

/** Centerwise Demand Sheet table — extracted so the same markup can be reused both
 * on the report page and inside the "Download All Centers" preview dialog. */
export function DemandSheetCenterwiseTable({ rows }: DemandSheetCenterwiseTableProps) {
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
  const totalClients = rows.reduce((sum, e) => sum + e.noOfClients, 0);
  const totalWB = rows.reduce((sum, e) => sum + e.wb, 0);
  const totalLoanOS = rows.reduce((sum, e) => sum + e.loanOS, 0);
  const totalArrear = rows.reduce((sum, e) => sum + e.arrear, 0);
  const totalDemand = rows.reduce((sum, e) => sum + e.demand, 0);
  const totalCollected = rows.reduce((sum, e) => sum + e.collected, 0);

  return (
    <div className="rounded-md border-2 border-primary/20 shadow-lg p-2 bg-white/50 backdrop-blur-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-white dark:bg-brand-green-darker border-b border-primary/30 dark:border-sidebar-accent">
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-10 text-center">
              Sl No
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent pl-2">
              Center Name
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-24 text-center">
              Phone
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-16 text-center">
              Nof. Clients
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-10 text-center">
              WB
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-12 text-center">
              Avg Due No
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-20 text-center">
              Meeting Time
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-24 text-right">
              Loan OS
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-20 text-right">
              Arrear
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-20 text-right">
              Demand
            </TableHead>
            {loanAdvanceEnabled && (
              <>
                <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-emerald-700 w-24 text-right">
                  Loan Advance OS
                </TableHead>
                <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-emerald-700 w-24 text-right">
                  Loan.AD Demand
                </TableHead>
              </>
            )}
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-20 text-right">
              Collected
            </TableHead>
            <TableHead className="font-bold text-foreground py-5 h-auto text-sm tracking-wide text-sidebar-accent w-24 text-center">
              CL Signature
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((entry, index) => (
            <TableRow
              key={entry.centerId}
              className={cn(
                "border-b border-primary/20 dark:border-sidebar-accent h-14",
                entry.arrear > 0 && "text-red-600 font-medium"
              )}
            >
              <TableCell className="text-center py-4 text-sm border-primary/20">
                {index + 1}
              </TableCell>
              <TableCell className="font-medium py-4 text-sm border-primary/20 uppercase pl-2">
                {entry.centerName}
              </TableCell>
              <TableCell className="py-4 text-sm border-primary/20 text-center">
                {entry.phone}
              </TableCell>
              <TableCell className="text-center font-medium py-4 text-sm border-primary/20 text-foreground">
                {entry.noOfClients}
              </TableCell>
              <TableCell className="text-center py-4 text-sm border-primary/20">
                {entry.wb}
              </TableCell>
              <TableCell className="text-center py-4 text-sm border-primary/20">
                {entry.dueNo}
              </TableCell>
              <TableCell className="text-center py-4 text-sm border-primary/20">
                {formatTime(entry.meetingTime)}
              </TableCell>
              <TableCell className="text-right py-4 text-sm border-primary/20 font-medium">
                {formatCurrency(entry.loanOS)}
              </TableCell>
              <TableCell className="text-right py-4 text-sm border-primary/20 font-medium">
                {formatCurrency(entry.arrear)}
                {entry.arrear > 0 && (
                  <div className="text-[10px] font-normal text-muted-foreground">
                    P: {formatCurrency(entry.arrearPrincipal)} / I: {formatCurrency(entry.arrearInterest)}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-right py-4 text-sm border-primary/20 font-medium text-foreground">
                {formatCurrency(entry.demand)}
                {entry.demand > 0 && (
                  <div className="text-[10px] font-normal text-muted-foreground">
                    P: {formatCurrency(entry.demandPrincipal)} / I: {formatCurrency(entry.demandInterest)}
                  </div>
                )}
              </TableCell>
              {loanAdvanceEnabled && (
                <>
                  <TableCell className="text-right py-4 text-sm border-primary/20 font-medium text-emerald-700">
                    {entry.loanAdvanceOS > 0 ? formatCurrency(entry.loanAdvanceOS) : ""}
                  </TableCell>
                  <TableCell className="text-right py-4 text-sm border-primary/20 font-medium text-emerald-700">
                    {entry.savingsDemand > 0 ? formatCurrency(entry.savingsDemand) : ""}
                  </TableCell>
                </>
              )}
              <TableCell className="text-right py-4 text-sm border-primary/20 font-medium text-green-700">
                {entry.collected > 0
                  ? formatCurrency(entry.collected)
                  : ""}
              </TableCell>
              <TableCell className="text-center py-4 text-sm">
                {/* Signature Space */}
              </TableCell>
            </TableRow>
          ))}

          {/* Total Row */}
          <TableRow className="font-extrabold bg-green-50/50 border-t-4 border-primary/30 text-foreground">
            <TableCell className="border-primary/30"></TableCell>
            <TableCell className="text-right px-4 py-5 text-sm border-primary/30 uppercase font-black text-sidebar-accent">
              Grand Total
            </TableCell>
            <TableCell className="border-primary/30"></TableCell>
            <TableCell className="text-center py-5 text-sm border-primary/30 font-bold text-foreground">
              {totalClients}
            </TableCell>
            <TableCell className="text-center py-5 text-sm border-primary/30 font-bold text-foreground">
              {totalWB}
            </TableCell>
            <TableCell className="text-center py-5 text-sm border-primary/30 font-bold text-foreground">
              {rows.reduce((sum, e) => sum + e.dueNo, 0)}
            </TableCell>
            <TableCell className="border-primary/30"></TableCell>
            <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-foreground">
              {formatCurrency(totalLoanOS)}
            </TableCell>
            <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-foreground">
              {formatCurrency(totalArrear)}
            </TableCell>
            <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-foreground">
              {formatCurrency(totalDemand)}
            </TableCell>
            {loanAdvanceEnabled && (
              <>
                <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-emerald-700">
                  {formatCurrency(rows.reduce((s, e) => s + e.loanAdvanceOS, 0))}
                </TableCell>
                <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-emerald-700">
                  {formatCurrency(rows.reduce((s, e) => s + e.savingsDemand, 0))}
                </TableCell>
              </>
            )}
            <TableCell className="text-right py-5 text-sm border-primary/30 font-bold text-green-700">
              {formatCurrency(totalCollected)}
            </TableCell>
            <TableCell></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
