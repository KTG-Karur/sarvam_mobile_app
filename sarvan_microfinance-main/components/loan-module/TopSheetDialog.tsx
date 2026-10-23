'use client';

import { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useReactToPrint } from 'react-to-print';
import { ReportHeader } from '@/components/reports/ReportHeader';
import { toDisplayDate } from '@/app/lib/date-format';

type LoanDetail = {
  id: string;
  clientId: string;
  clientName: string;
  clientPhoto?: string;
  age: number | null;
  purpose: string;
  amount: number;
  product: string;
  frequency: string;
  tenureMonths: number;
  interestRate: number;
  loanCycle: number;
};

type TopSheetData = {
  indexNo: string;
  indexDate: string;
  branchName: string;
  centerCode: string;
  centerName: string;
  centerAddress?: string;
  centerMeetingDay?: string;
  centerMeetingPlace?: string;
  totalApps: number;
  totalAmount: number;
  frequency: string;
  bmName?: string | null;
  bmMobile?: string | null;
  amName?: string | null;
  amMobile?: string | null;
  fdoName?: string | null;
  fdoMobile?: string | null;
  loans: LoanDetail[];
};

interface TopSheetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexId: string;
  indexNo: string;
}

export function TopSheetDialog({
  open,
  onOpenChange,
  indexId,
  indexNo,
}: TopSheetDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [topSheetData, setTopSheetData] = useState<TopSheetData | null>(null);
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && indexId) {
      fetchTopSheetData();
    }
  }, [open, indexId]);

  const fetchTopSheetData = async () => {
    setIsLoading(true);
    try {
      const result = await apiClient.get<TopSheetData>(`/loan-indexes/${indexId}/top-sheet`);

      if (result.success && result.data) {
        setTopSheetData(result.data);
      } else {
        toast({
          title: 'Error',
          description: result.error || 'Failed to load top sheet data.',
          variant: 'destructive',
        });
        setTopSheetData(null);
      }
    } catch (error) {
      console.error('Error fetching top sheet data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load top sheet data. Please try again.',
        variant: 'destructive',
      });
      setTopSheetData(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `TopSheet_${indexNo}_${new Date().toISOString().split('T')[0]}`,
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
      @media print {
        html, body {
          width: 194mm;
          height: 281mm;
        }
        body {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
          margin: 0;
          padding: 0;
        }
      }
    `,
  });

  const handleSave = async () => {
    try {
      toast({
        title: 'Success',
        description: 'Top sheet saved successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save top sheet.',
        variant: 'destructive',
      });
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    // Already a display date (dd/MM/yyyy, or legacy dd-MM-yyyy) — never re-parse it:
    // new Date('01/10/2026') would read it as January 10.
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(dateString)) {
      return dateString.replace(/-/g, '/');
    }
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-none w-[90vw] max-w-[1400px] max-h-[95vh] overflow-hidden p-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-green-50 dark:from-brand-green-darker dark:to-sidebar-accent">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold text-foreground dark:text-white">
              கடன் விண்ணப்பம் - {indexNo}
            </DialogTitle>
            <div className="flex items-center gap-2">
                            <Button
                                onClick={handleSave}
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                disabled={isLoading || !topSheetData}
                            >
                <Download className="h-4 w-4" />
                Save
              </Button>
                            <Button
                                onClick={handlePrint}
                                variant="default"
                                size="sm"
                                className="gap-2 bg-primary hover:bg-primary"
                                disabled={isLoading || !topSheetData}
                            >
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(95vh-80px)]">
          {isLoading ? (
            <PageLoader label="Loading top sheet..." fullScreen={false} />
          ) : topSheetData ? (
            <div ref={printRef} className="p-4 bg-white font-mono text-sm">
              {/* Header with Branch Stamp Area */}
              <div className="mb-2">
                <ReportHeader title="கடன் விண்ணப்பம்" />
                <div className="flex justify-end items-start">
                  <div className="text-right">
                    <div className="text-sm font-bold">{topSheetData.branchName}</div>
                    <div className="mt-1 border border-black px-4 py-3 w-44 h-16 flex items-center justify-center text-[10px] leading-tight">
                      <span>
                        கிளை முத்திரை
                        <br />
                        <span className="text-[8px]">(Branch Stamp)</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Center Meeting Details Table - Removed கடன் சுற்று from here */}
              <table className="w-full border-collapse border border-black mb-2 text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black px-1.5 py-0.5 text-[10px]">மைய எண்</th>
                    <th className="border border-black px-1.5 py-0.5 text-[10px]">மையத்தின் பெயர்</th>
                    <th className="border border-black px-1.5 py-0.5 text-[10px]">இடம்</th>
                    <th className="border border-black px-1.5 py-0.5 text-[10px]">மைய கூட்டம் நடக்கும் நாள்</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-black px-1.5 py-0.5 text-center">{topSheetData.centerCode}</td>
                    <td className="border border-black px-1.5 py-0.5">{topSheetData.centerName}</td>
                    <td className="border border-black px-1.5 py-0.5">{topSheetData.centerMeetingPlace}</td>
                    <td className="border border-black px-1.5 py-0.5">{topSheetData.centerMeetingDay}</td>
                  </tr>
                </tbody>
              </table>

              {/* Center Address */}
              <div className="mb-2 text-xs">
                <span className="font-bold">முகவரி :</span> {topSheetData.centerAddress}
              </div>

              {/* Loan Applications Table - Added கடன் சுற்று column before signature */}
              <table className="w-full border-collapse border border-black text-xs">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-black px-1.5 py-1 text-xs w-6">வ.எண்</th>
                    <th className="border border-black px-1.5 py-1 text-xs">புகைப்படம்</th>
                    <th className="border border-black px-1.5 py-1 text-xs">பெயர்</th>
                    <th className="border border-black px-1.5 py-1 text-xs">வயது</th>
                    <th className="border border-black px-1.5 py-1 text-xs">தொழில்</th>
                    <th className="border border-black px-1.5 py-1 text-xs">கடன் தொகை</th>
                    <th className="border border-black px-1.5 py-1 text-xs">கடன் சுற்று</th>
                    <th className="border border-black px-1.5 py-1 text-xs w-40">கையொப்பம்</th>
                  </tr>
                </thead>
                <tbody>
                  {topSheetData.loans.map((loan, index) => (
                    <tr key={loan.id} className="even:bg-gray-50" style={{ breakInside: 'avoid' }}>
                      <td className="border border-black px-1.5 py-2.5 text-center font-bold">
                        {index + 1}
                      </td>
                      <td className="border border-black px-1.5 py-2.5">
                        <div className="w-20 h-20 bg-gray-100 border border-gray-300 flex items-center justify-center overflow-hidden mx-auto">
                          {loan.clientPhoto ? (
                            <img src={loan.clientPhoto} alt={loan.clientName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="text-[9px] text-gray-400 text-center leading-tight">
                              No Photo
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="border border-black px-1.5 py-2.5">
                        <div className="font-bold">{loan.clientName}</div>
                        <div className="text-[10px] text-gray-600">{loan.clientId}</div>
                      </td>
                      <td className="border border-black px-1.5 py-2.5 text-center">
                        {loan.age !== null && loan.age !== undefined ? loan.age : '-'}
                      </td>
                      <td className="border border-black px-1.5 py-2.5">
                        {loan.purpose}
                      </td>
                      <td className="border border-black px-1.5 py-2.5 text-right font-bold">
                        {formatCurrency(loan.amount)}
                      </td>
                      <td className="border border-black px-1.5 py-2.5 text-center font-semibold">
                        {loan.loanCycle}
                      </td>
                      <td className="border border-black px-1.5 py-2.5">
                        <div className="min-w-[140px] h-20">
                          {/* Empty space for signature */}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={5} className="border border-black px-1.5 py-1.5 text-right">
                      மொத்தம்
                    </td>
                    <td className="border border-black px-1.5 py-1.5 text-right">
                      {formatCurrency(topSheetData.totalAmount)}
                    </td>
                    <td className="border border-black px-1.5 py-1.5" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>

              {/* Footer Signatures */}
              <div className="grid grid-cols-3 gap-6 mt-6">
                <div className="text-center">
                  <div className="border-t-2 border-black pt-1 mt-12">
                    <p className="text-xs font-semibold">Field Development Officer</p>
                    <p className="text-[10px]">{topSheetData.fdoName || ''}</p>
                    <p className="text-[10px]">{topSheetData.fdoMobile || ''}</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="border-t-2 border-black pt-1 mt-12">
                    <p className="text-xs font-semibold">Branch Manager</p>
                    <p className="text-[10px]">{topSheetData.bmName || ''}</p>
                    <p className="text-[10px]">{topSheetData.bmMobile || ''}</p>
                  </div>
                </div>
                <div className="text-center">
                  <div className="border-t-2 border-black pt-1 mt-12">
                    <p className="text-xs font-semibold">Area Manager</p>
                    <p className="text-[10px]">{topSheetData.amName || ''}</p>
                    <p className="text-[10px]">{topSheetData.amMobile || ''}</p>
                  </div>
                </div>
              </div>

              {/* Print Footer */}
              <div className="text-center mt-2 text-[9px] text-gray-500">
                <p>
                  Printed on: {toDisplayDate(new Date())} at{' '}
                  {new Date().toLocaleTimeString('en-IN')}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">
                No data available for this index.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}