'use client';

import React from 'react';
import { format } from 'date-fns';
import { MapPin, Phone } from 'lucide-react';
import { useBrandNames } from '@/app/lib/brand-context';

interface CollectionReceiptProps {
    batchData: {
        branchId: string;
        branchName: string;
        centerName: string;
        centerCode: string;
        collectionDate: string;
        collectionTime: string;
        collectedBy: string;
        fdoMobileNumber?: string;
        totalAmount: number;
        totalSavings?: number;
        items: {
            clientName: string;
            clientCode: string;
            loanNumber: string;
            installmentNo: number;
            amountCollected: number;
            savingsCollected?: number;
            paymentMode: string;
        }[];
    };
}

export const CollectionReceipt = React.forwardRef<HTMLDivElement, CollectionReceiptProps>(({ batchData }, ref) => {
    const { companyNameShort, companyNameFull } = useBrandNames();
    return (
        <div ref={ref} className="bg-white text-black font-sans selection:bg-transparent" style={{ width: '80mm', margin: 'auto' }}>
            {batchData.items.map((item, idx) => (
                <div
                    key={idx}
                    className="p-4 print:p-2"
                    style={{ pageBreakAfter: idx === batchData.items.length - 1 ? 'avoid' : 'always' }}
                >
                    {/* Business Header */}
                    <div className="text-center border-b-2 border-dashed border-gray-300 pb-3 mb-3">
                        <div className="flex justify-center mb-2">
                            <img
                                src="/api/branding/asset/tamil-logo"
                                alt={`${companyNameShort} Logo`}
                                className="w-36 h-auto object-contain"
                            />
                            </div>
                    </div>

                    {/* Receipt Title */}
                    <div className="text-center mb-4">
                        <div className="inline-block border border-black px-3 py-0.5 text-xs font-bold uppercase">
                            Collection Receipt
                        </div>
                    </div>

                    {/* Receipt Details */}
                    <div className="space-y-1 mb-4 text-[11px]">
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Branch</span>
                            <span>{batchData.branchName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Center</span>
                            <span>{batchData.centerName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Client</span>
                            <span>{item.clientName}</span>
                        </div>
                    </div>

                    {/* Loan Details */}
                    <div className="border-t border-b border-dashed border-gray-400 py-2 mb-4 text-[11px] space-y-1">
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Loan</span>
                            <span className="font-mono">{item.loanNumber}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Inst.</span>
                            <span>#{item.installmentNo}</span>
                        </div>
                    </div>

                    {/* Amounts */}
                    <div className="border border-gray-200 divide-y divide-gray-100 mb-4">
                        <div className="flex justify-between items-center bg-gray-50 px-2 py-1.5 text-[10px]">
                            <span className="font-semibold text-gray-600">EMI Collected</span>
                            <span className="font-bold">
                                ₹{item.amountCollected.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                        {(item.savingsCollected ?? 0) > 0 && (
                            <div className="flex justify-between items-center bg-emerald-50 px-2 py-1.5 text-[10px]">
                                <span className="font-semibold text-emerald-700">Loan Advance</span>
                                <span className="font-bold text-emerald-700">
                                    ₹{(item.savingsCollected!).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        )}
                        <div className="flex justify-between items-center bg-gray-100 px-2 py-2 text-[11px]">
                            <span className="font-bold uppercase">Total</span>
                            <span className="font-bold">
                                ₹{((item.amountCollected) + (item.savingsCollected ?? 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </span>
                        </div>
                    </div>

                    {/* Date & Time */}
                    <div className="space-y-1 mb-4 text-[11px]">
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">Date & Time</span>
                            <span>{format(new Date(batchData.collectionDate), 'dd/MM/yyyy')}  {batchData.collectionTime}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="font-semibold text-gray-600">FDO</span>
                            <span>
                                {batchData.collectedBy}
                                {batchData.fdoMobileNumber && ` | ${batchData.fdoMobileNumber}`}
                            </span>
                        </div>
                    </div>

                    {/* Signature Area */}
                    <div className="border-t border-gray-300 pt-6">
                        <div className="flex justify-between gap-4 text-[10px]">
                            <div className="flex-1 text-center">
                                <div className="border-b border-gray-400 h-8 mb-1" />
                                <div className="text-gray-600">FDO Signature</div>
                            </div>
                            <div className="flex-1 text-center">
                                <div className="border-b border-gray-400 h-8 mb-1" />
                                <div className="text-gray-600">Client Signature</div>
                            </div>
                        </div>
                    </div>

                    {/* Receipt Footer */}
                    <div className="mt-4 text-center text-[7px] text-gray-400 space-y-0.5">
                        <p className="uppercase tracking-widest font-semibold text-gray-500">System Generated Receipt</p>
                        <div className="mt-2 border-t border-gray-100 pt-1 italic">
                            Thank you for choosing {companyNameFull}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
});

CollectionReceipt.displayName = 'CollectionReceipt';
