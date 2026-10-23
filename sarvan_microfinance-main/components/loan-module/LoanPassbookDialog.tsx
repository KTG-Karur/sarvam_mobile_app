'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Download, Printer } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { tokenStorage } from '@/app/lib/token-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

type PassbookInstallment = {
    no: number;
    date: string;
    principal: string;
    interest: string;
    balance: string;
};

type MemberDetails = {
    loanAmount: number;
    accountNumber: string;
    branchCode: string;
    branchName: string;
    memberName: string;
    disbursementDate: string;
    loanPurpose: string;
    centerCode: string;
    centerName: string;
    centerMemberNo: string;
    husbandName: string;
    loanType: string;
    firstInstallmentDate: string;
    memberPhone: string;
    upiNumber: string;
    clientPhotoUrl?: string | null;
};

type PassbookData = {
    memberDetails: MemberDetails;
    installments: PassbookInstallment[];
};

interface LoanPassbookDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    loanId: string;
    loanNumber: string;
    clientName: string;
    /** When set, and the loan has no persisted schedule yet, the passbook is
     *  computed live from this date for pre-disbursement audit preview. */
    firstDueDate?: string;
}

// ─── Main Dialog ──────────────────────────────────────────────────────────────

export function LoanPassbookDialog({
    open,
    onOpenChange,
    loanId,
    loanNumber,
    clientName,
    firstDueDate,
}: LoanPassbookDialogProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [passbookData, setPassbookData] = useState<PassbookData | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [previewPages, setPreviewPages] = useState<string[]>([]);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { toast } = useToast();

    useEffect(() => {
        if (open && loanId) {
            loadPreview();
        }
        if (!open) {
            setPdfUrl(null);
            setPreviewPages([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, loanId, firstDueDate]);

    // Release the previous blob URL whenever it is replaced or the dialog unmounts.
    useEffect(() => {
        return () => {
            if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        };
    }, [pdfUrl]);

    const loadPreview = async () => {
        setIsLoading(true);
        setPdfUrl(null);
        setPreviewPages([]);
        try {
            const url = firstDueDate
                ? `/loans/${loanId}/passbook?firstDueDate=${firstDueDate}`
                : `/loans/${loanId}/passbook`;
            const result = await apiClient.get<PassbookData>(url);
            if (result.success && result.data) {
                setPassbookData(result.data);
                if (result.data.installments.length > 0) {
                    await generatePdf(result.data);
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load passbook data.',
                    variant: 'destructive',
                });
                setPassbookData(null);
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to load passbook data. Please try again.',
                variant: 'destructive',
            });
            setPassbookData(null);
        } finally {
            setIsLoading(false);
        }
    };

    const generatePdf = async (data: PassbookData) => {
        setIsGenerating(true);
        try {
            const token = tokenStorage.getAccessToken();

            // Convert memberDetails.loanAmount (number) to string for the API
            const m = data.memberDetails;
            const payload = {
                memberDetails: {
                    loanAmount: String(m.loanAmount),
                    upiNumber: m.upiNumber,
                    accountNumber: m.accountNumber,
                    branchCode: m.branchCode,
                    branchName: m.branchName,
                    memberName: m.memberName,
                    disbursementDate: m.disbursementDate,
                    loanPurpose: m.loanPurpose,
                    centerCode: m.centerCode,
                    centerName: m.centerName,
                    centerMemberNo: m.centerMemberNo,
                    husbandName: m.husbandName,
                    loanType: m.loanType,
                    firstInstallmentDate: m.firstInstallmentDate,
                    memberPhone: m.memberPhone,
                    clientPhotoUrl: m.clientPhotoUrl ?? null,
                },
                installments: data.installments.map((inst) => ({
                    no: inst.no,
                    date: inst.date,
                    principal: parseFloat(inst.principal),
                    interest: parseFloat(inst.interest),
                    balance: parseFloat(inst.balance),
                })),
            };

            // PDF via raw fetch (not apiClient): the response is a binary blob, not JSON.
            // The on-screen preview (every sheet as an upright landscape image) is JSON.
            const [response, previewResult] = await Promise.all([
                fetch('/api/generate-passbook', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    },
                    body: JSON.stringify(payload),
                }),
                apiClient.post<{ pages: string[] }>('/generate-passbook?preview=pages', payload),
            ]);

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                toast({
                    title: 'Error',
                    description: err.error || 'PDF generation failed.',
                    variant: 'destructive',
                });
                return;
            }

            const blob = await response.blob();
            setPdfUrl(URL.createObjectURL(blob));
            if (previewResult.success && previewResult.data) {
                setPreviewPages(previewResult.data.pages);
            }
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to generate PDF. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsGenerating(false);
        }
    };

    const handlePrint = () => {
        const win = iframeRef.current?.contentWindow;
        if (win) {
            win.focus();
            win.print();
        } else if (pdfUrl) {
            window.open(pdfUrl, '_blank');
        }
    };

    const handleDownload = () => {
        if (!pdfUrl || !passbookData) return;
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = `passbook_${passbookData.memberDetails.memberName.replace(/\s+/g, '_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const busy = isLoading || isGenerating;
    const hasSchedule = !!passbookData && passbookData.installments.length > 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-w-[1100px] sm:max-w-[1100px] max-h-[94vh] overflow-hidden p-0 gap-0 flex flex-col">
                <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-green-50 to-emerald-50 dark:from-brand-green-darker dark:to-sidebar-accent">
                    <div className="flex items-center justify-between gap-3 pr-6">
                        <div>
                            <DialogTitle className="text-xl font-bold text-foreground dark:text-white">
                                கடன் பாஸ் புத்தகம் — {loanNumber}
                            </DialogTitle>
                            <p className="text-sm text-muted-foreground mt-0.5">{clientName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handlePrint}
                                size="sm"
                                className="gap-2 bg-green-600 hover:bg-green-700 text-white shadow-md"
                                disabled={busy || !pdfUrl}
                            >
                                <Printer className="h-4 w-4" />
                                Print
                            </Button>
                            <Button
                                onClick={handleDownload}
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                disabled={busy || !pdfUrl}
                            >
                                <Download className="h-4 w-4" />
                                Download PDF
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex-1 min-h-[320px] overflow-auto bg-slate-100 dark:bg-slate-900">
                    {busy ? (
                        <div className="h-[420px] flex flex-col items-center justify-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-green-600" />
                            <p className="text-sm text-muted-foreground">
                                {isGenerating ? 'Preparing passbook preview...' : 'Loading passbook data...'}
                            </p>
                        </div>
                    ) : previewPages.length > 0 ? (
                        <div className="p-4 space-y-4">
                            {previewPages.map((src, idx) => (
                                <div key={idx}>
                                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                                        Page {idx + 1} of {previewPages.length}
                                    </p>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- server-rendered data URI, nothing for next/image to optimize */}
                                    <img
                                        src={src}
                                        alt={`Passbook page ${idx + 1} — ${clientName}`}
                                        className="w-full h-auto bg-white shadow-md border border-slate-300"
                                    />
                                </div>
                            ))}
                        </div>
                    ) : pdfUrl ? (
                        <iframe
                            src={pdfUrl}
                            title={`Passbook ${loanNumber}`}
                            className="w-full h-[75vh] border-0"
                        />
                    ) : passbookData && !hasSchedule ? (
                        <div className="h-[420px] flex items-center justify-center p-6">
                            <p className="max-w-md text-center text-sm text-amber-600 dark:text-amber-400">
                                No schedule available yet — this loan has no First Due Date set (it hasn&apos;t
                                been submitted through Loan Index, or disbursed). Set a First Due Date to preview.
                            </p>
                        </div>
                    ) : (
                        <div className="h-[420px] flex items-center justify-center">
                            <p className="text-sm text-muted-foreground">No passbook preview available.</p>
                        </div>
                    )}
                </div>

                {/* Hidden full PDF (all pages) used by the Print button. */}
                {pdfUrl && (
                    <iframe
                        ref={iframeRef}
                        src={pdfUrl}
                        title={`Passbook ${loanNumber} print`}
                        className="absolute w-0 h-0 border-0 opacity-0 pointer-events-none"
                        aria-hidden="true"
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
