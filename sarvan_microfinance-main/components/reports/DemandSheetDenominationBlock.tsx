"use client";

import { DEMAND_SHEET_DENOMINATION_LABELS } from "@/app/lib/reports/demand-sheet-denomination";

/**
 * All-centers preview equivalent of the DENOMINATION + signature block in the
 * per-center "Detailed report" (components/reports/ClientWiseDemandReportDialog.tsx,
 * lines ~559-591) — same labels/order/markup, reproduced here (that file is left
 * untouched) rather than imported.
 *
 * There is no stored/calculated denomination data anywhere in the Demand Sheet
 * feature (per-center or aggregate) — the existing per-center report already
 * renders this as a blank manual fill-in-by-hand form. This block intentionally
 * preserves that same behavior instead of fabricating aggregated figures.
 */
export function DemandSheetDenominationBlock() {
  return (
    <div className="mt-6 flex flex-wrap border-t pt-4">
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
            {DEMAND_SHEET_DENOMINATION_LABELS.map((label, index) => {
              const isTotal = index === DEMAND_SHEET_DENOMINATION_LABELS.length - 1;
              return (
                <tr key={label} className={isTotal ? "font-bold bg-gray-50" : undefined}>
                  <td className="border border-black p-2">{label}</td>
                  {isTotal ? (
                    <>
                      <td className="border border-black p-2" />
                      <td className="border border-black p-2" />
                    </>
                  ) : (
                    <>
                      <td className="border border-black p-2">
                        <input type="text" className="w-full border-none p-0 text-sm" />
                      </td>
                      <td className="border border-black p-2">
                        <input type="text" className="w-full border-none p-0 text-sm" />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-1 items-start justify-around pt-12 pl-6 text-center text-sm">
        <div className="flex flex-col items-center gap-4">
          <div className="font-bold">Group Member Signature</div>
          <div className="font-bold">Receipt No:</div>
        </div>
        <div className="font-bold">FDO Signature</div>
        <div className="font-bold">BM Signature</div>
      </div>
    </div>
  );
}
