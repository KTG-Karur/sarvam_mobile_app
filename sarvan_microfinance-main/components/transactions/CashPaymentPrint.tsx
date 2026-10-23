'use client';

import React from 'react';
import { format } from 'date-fns';
import { useBrandNames } from '@/app/lib/brand-context';
import { amountToWords } from '@/app/lib/number-to-words';
import { stripPostingMarker } from '@/app/lib/narration';

export interface CashPaymentPrintData {
    voucherNo: string;
    transactionDate: string;
    /** The ledger/party account this payment is recorded against (Debit side). */
    accountName: string;
    /** The mode the amount was paid through, e.g. "CASH IN HAND" (Credit/self account). */
    throughAccount: string;
    narration?: string;
    amount: number;
}

export interface CashPaymentPrintBranch {
    code: string;
    name: string;
}

interface CashPaymentPrintProps {
    data: CashPaymentPrintData;
    branch?: CashPaymentPrintBranch | null;
}

const formatAmount = (value: number) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export const CashPaymentPrint = React.forwardRef<HTMLDivElement, CashPaymentPrintProps>(({ data, branch }, ref) => {
    const { companyNameFull } = useBrandNames();
    const formattedAmount = formatAmount(data.amount);

    return (
        <div
            ref={ref}
            className="bg-white text-black p-8 font-sans print:p-4"
            style={{ width: '210mm', minHeight: '148mm', margin: 'auto' }}
        >
            {/* Header */}
            <div className="relative flex items-center justify-center">
                <div className="absolute left-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/api/branding/asset/logo-wordmark" alt="K3 Logo" className="h-24 w-24 object-contain" />
                </div>
                <h1 className="whitespace-nowrap text-2xl font-bold uppercase tracking-wide">{companyNameFull.toUpperCase()}</h1>
            </div>

            {branch && (
                <p className="text-center text-sm font-semibold mt-1">
                    {branch.code} - {branch.name}
                </p>
            )}

            <p className="text-center text-lg font-bold mt-2 mb-3">Payment Voucher</p>

            {/* Voucher No / Date */}
            <div className="flex items-center justify-between border-b border-black pb-2 mb-4 text-sm font-medium">
                <span>Voucher No. : {data.voucherNo}</span>
                <span>Voucher Date : {format(new Date(data.transactionDate), 'dd/MM/yyyy')}</span>
            </div>

            {/* Particulars / Amount table */}
            <table className="w-full border-collapse border border-black text-sm">
                <thead>
                    <tr>
                        <th className="border border-black p-2 text-left font-bold w-2/3">Particulars</th>
                        <th className="border border-black p-2 text-right font-bold w-1/3">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td className="border border-black p-3 align-top">
                            <div className="space-y-3">
                                <div>
                                    <span className="font-bold">Account :</span>
                                    <div className="pl-6">{data.accountName}</div>
                                </div>
                                <div>
                                    <span className="font-bold">Through :</span>
                                    <div className="pl-6">{data.throughAccount}</div>
                                </div>
                                <div>
                                    <span className="font-bold">On Account of :</span>
                                    <div className="pl-6">{stripPostingMarker(data.narration) || '-'}</div>
                                </div>
                                <div>
                                    <span className="font-bold">Amount (in words) :</span>
                                    <div className="pl-6">INR {amountToWords(data.amount)}</div>
                                </div>
                            </div>
                        </td>
                        <td className="border border-black p-3 align-top">
                            <div className="flex h-full min-h-[180px] flex-col justify-between">
                                <div className="text-right font-semibold tabular-nums">{formattedAmount}</div>
                                <div className="text-right">
                                    <span className="inline-block border border-black px-2 py-1 font-bold underline tabular-nums">
                                        INR {formattedAmount}
                                    </span>
                                </div>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>

            {/* Signatures */}
            <div className="mt-20 flex items-end justify-between text-sm font-semibold">
                <span>Authorised Sign</span>
                <span>Receiver&apos;s Sign</span>
            </div>
        </div>
    );
});

CashPaymentPrint.displayName = 'CashPaymentPrint';
