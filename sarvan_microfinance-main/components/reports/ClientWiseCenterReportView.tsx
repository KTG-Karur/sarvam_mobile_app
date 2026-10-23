"use client";

import type { DemandClientWiseReportData } from "@/app/lib/actions/demand";
import { ReportHeader } from "@/components/reports/ReportHeader";
import { normalizeMeetingTime } from "@/app/lib/utils/meeting-time";
import { formatAmount, formatArrearAmount, formatDateToDDMMYY } from "@/app/lib/reports/client-wise-center-report";
import { useLoanAdvanceEnabled } from "@/app/hooks/useLoanAdvanceEnabled";

interface ClientWiseCenterReportViewProps {
  report: DemandClientWiseReportData;
}

/**
 * One center's complete Client Wise Demand Sheet — header info, client table,
 * denomination table, and signature/receipt block — extracted verbatim from
 * components/reports/ClientWiseDemandReportDialog.tsx so the exact same
 * markup renders both there (single center) and in the "Download All Centers"
 * preview (one of these per center, never a single shared denomination block).
 */
export function ClientWiseCenterReportView({ report }: ClientWiseCenterReportViewProps) {
  const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
  return (
    <>
      {/* Header */}
      <ReportHeader title="Client Wise Demand Sheet" />

      {/* Info Section */}
      <div className="mb-4 text-xs">
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div>Branch : {report.branchCode} - {report.branchName}</div>
          <div className="text-right">Meeting Time : {report.meetingTime ? normalizeMeetingTime(report.meetingTime) : "-"}</div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div>Center : {report.centerCode} - {report.centerName}</div>
          <div className="text-right">Meeting Day : {report.meetingDay}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>FDO : {report.fdoName || "-"}</div>
          <div className="text-right">Meeting Date : {formatDateToDDMMYY(report.meetingDate)}</div>
        </div>
      </div>

      {/* Client Table */}
      <div className="overflow-x-auto mb-4 print:overflow-visible">
        <table className="w-full text-xs border-collapse border border-black print:table-fixed print:text-[6.5pt]">
          <colgroup>
            <col style={{ width: "8%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "4%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "6%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-1 print:p-0.5 text-left break-words" rowSpan={2}>ID</th>
              <th className="border border-black p-1 print:p-0.5 text-left break-words" rowSpan={2}>Member Name</th>
              <th className="border border-black p-1 print:p-0.5 text-left break-words" rowSpan={2}>Member Phone</th>
              <th className="border border-black p-1 print:p-0.5 text-right break-words" rowSpan={2}>Loan Amount</th>
              <th className="border border-black p-1 print:p-0.5 text-center break-words" colSpan={2}>OS Amount</th>
              <th className="border border-black p-1 print:p-0.5 text-center break-words" colSpan={2}>Dues</th>
              <th className="border border-black p-1 print:p-0.5 text-right break-words" rowSpan={2}>Arrear OS</th>
              <th className="border border-black p-1 print:p-0.5 text-center break-words" colSpan={3}>Current Demand</th>
              {loanAdvanceEnabled && (
                <th className="border border-black p-1 print:p-0.5 text-center text-emerald-700 break-words" colSpan={2}>Loan Advance</th>
              )}
              <th className="border border-black p-1 print:p-0.5 text-right break-words" rowSpan={2}>Total Demand Amount</th>
              <th className="border border-black p-1 print:p-0.5 text-right break-words" rowSpan={2}>Coll Amount</th>
             </tr>
            <tr className="bg-gray-100">
              <th className="border border-black p-1 print:p-0.5 text-center">Pri</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Int</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Cur</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Coll</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Pri</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Int</th>
              <th className="border border-black p-1 print:p-0.5 text-center">Total</th>
              {loanAdvanceEnabled && (
                <>
                  <th className="border border-black p-1 print:p-0.5 text-center text-emerald-700">OS</th>
                  <th className="border border-black p-1 print:p-0.5 text-center text-emerald-700">Due</th>
                </>
              )}
             </tr>
          </thead>
          <tbody>
            {report.clients.map((row) => {
              const hasArrear = (row.arrear || 0) > 0;
              const rowClass = hasArrear ? "text-red-600 font-bold bg-red-50" : "";
              return (
                <tr key={`${row.clientId}-${row.cid}`} className={rowClass}>
                  <td className="border border-black p-1 print:p-0.5">{row.clientId}</td>
                  <td className="border border-black p-1 print:p-0.5 uppercase break-words">{row.clientName.substring(0, 25)}</td>
                  <td className="border border-black p-1 print:p-0.5">{row.mobileNumber || "-"}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.loanAmount)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.loanOSPrincipal)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.loanOSInterest)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-center">{row.currentDueNo || "0"}</td>
                  <td className="border border-black p-1 print:p-0.5 text-center">{row.collectionDueNo || "0"}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatArrearAmount(row.arrear)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.currentDemandPrincipal)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.currentDemandInterest)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(row.currentDemand)}</td>
                  {loanAdvanceEnabled && (
                    <>
                      <td className="border border-black p-1 print:p-0.5 text-right text-emerald-700">{row.loanAdvanceOS > 0 ? formatAmount(row.loanAdvanceOS) : ""}</td>
                      <td className="border border-black p-1 print:p-0.5 text-right text-emerald-700">{row.loanAdvanceDemand > 0 ? formatAmount(row.loanAdvanceDemand) : ""}</td>
                    </>
                  )}
                  <td className="border border-black p-1 print:p-0.5 text-right font-semibold">{formatAmount(row.totalDemandAmount)}</td>
                  <td className="border border-black p-1 print:p-0.5 text-right">{row.collectedIncludingSavings > 0 ? formatAmount(row.collectedIncludingSavings) : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold bg-gray-50">
              <td className="border border-black p-1 print:p-0.5" colSpan={3}>Total : ({report.totalClients} clients)</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalLoanAmount)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalLoanOSPrincipal)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalLoanOSInterest)}</td>
              <td className="border border-black p-1 print:p-0.5 text-center">{report.clients.reduce((s, c) => s + (c.currentDueNo || 0), 0)}</td>
              <td className="border border-black p-1 print:p-0.5 text-center">{report.clients.reduce((s, c) => s + (c.collectionDueNo || 0), 0)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatArrearAmount(report.grandTotalArrear)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalCurrentDemandPrincipal)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalCurrentDemandInterest)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalCurrentDemand)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right text-emerald-700">{formatAmount(report.grandTotalLoanAdvanceOS)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right text-emerald-700">{formatAmount(report.grandTotalLoanAdvanceDemand)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalDemandAmount)}</td>
              <td className="border border-black p-1 print:p-0.5 text-right">{formatAmount(report.grandTotalCollectedIncludingSavings)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Denomination Section */}
      <div className="flex flex-wrap mt-4">
        <div className="w-[280px]">
          <table className="w-full border-collapse border border-black text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-2 text-center font-bold">DENOMINATION</th>
                <th className="border border-black p-2 text-center font-bold">COUNT</th>
                <th className="border border-black p-2 text-center font-bold">VALUE</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="border border-black p-2">Rs.500</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Rs.200</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Rs.100</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Rs.50</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Rs.20</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Rs.10</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">Coins</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr><td className="border border-black p-2">UPI</td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td><td className="border border-black p-2"><input type="text" className="w-full border-none p-0 text-sm" /></td></tr>
              <tr className="font-bold bg-gray-50"><td className="border border-black p-2">Total</td><td className="border border-black p-2"></td><td className="border border-black p-2"></td></tr>
            </tbody>
          </table>
        </div>
        <div className="flex-1 flex justify-around items-start text-center text-sm pl-6 pt-50">
          <div className="flex flex-col items-center gap-4">
            <div className="font-bold">Group Member Signature</div>
            <div className="font-bold">Receipt No:</div>
          </div>
          <div className="font-bold">FDO Signature</div>
          <div className="font-bold">BM Signature</div>
        </div>
      </div>
    </>
  );
}
