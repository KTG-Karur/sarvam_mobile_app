'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { StorageImage } from '@/components/storage/StorageMedia';
import { PageLoader } from '@/components/ui/page-loader';
import { useToast } from '@/hooks/use-toast';
import { Coins, Download, Loader2, ImageOff } from 'lucide-react';
import type { GoldTakenRow, GoldReturnedRow } from '@/app/lib/actions/reports';
import { getGoldTakenPhotos, getGoldPhotoDataUrls, GoldRecordPhotoMeta } from '@/app/lib/actions/gold-record-photos';
import { buildGoldRecordPdf, GoldRecordPdfField, GoldRecordPdfPhotoGroup } from '@/app/lib/reports/gold-record-pdf';
import { formatReportAmount } from '@/app/lib/utils/format-amount';

type GoldRecordDetailModalProps = {
    type: 'taken' | 'returned';
    row: GoldTakenRow | GoldReturnedRow | null;
    open: boolean;
    onClose: () => void;
};

type NormalizedDetail = {
    loanId: string; // internal DB loan id — used to fetch pledge photos on the Taken tab
    loanNo: string;
    client: string;
    center: string;
    branch: string;
    karat: string;
    grams: number;
    pricePerGram: number;
    goldValue: number;
    cashGiven: number | null;
    disbursementDate: string;
    returnDate: string | null;
    item: string;
    referenceNo: string;
    remark: string;
    photos: { id: string; photoUrl: string; photoKey: string | null }[];
    recipientName: string | null;
    recipientMobile: string | null;
    recipientRelation: string | null;
    recipientPhotoUrl: string | null;
    recipientPhotoKey: string | null;
};

function formatCurrency(v: number) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.trunc(v));
}

function normalize(type: 'taken' | 'returned', row: GoldTakenRow | GoldReturnedRow): NormalizedDetail {
    if (type === 'taken') {
        const r = row as GoldTakenRow;
        return {
            loanId: r.loanId,
            loanNo: r.loanNumber,
            client: `${r.clientName} (${r.clientId})`,
            center: r.centerName,
            branch: r.branchName,
            karat: r.karatType,
            grams: r.gramCount,
            pricePerGram: r.pricePerGram,
            goldValue: r.goldTakenValue,
            cashGiven: r.cashGiven,
            disbursementDate: r.disbursementDate,
            returnDate: null,
            item: r.itemDescription,
            referenceNo: r.goldTokenNo,
            remark: r.remarks,
            photos: [],
            recipientName: null,
            recipientMobile: null,
            recipientRelation: null,
            recipientPhotoUrl: null,
            recipientPhotoKey: null,
        };
    }
    const r = row as GoldReturnedRow;
    return {
        loanId: r.internalLoanId,
        loanNo: r.loanNumber,
        client: `${r.clientName} (${r.clientId})`,
        center: r.centerName,
        branch: r.branchName,
        karat: r.karatType,
        grams: r.gramsReturned,
        pricePerGram: r.pricePerGram,
        goldValue: r.goldValue,
        cashGiven: null,
        disbursementDate: r.ldDate,
        returnDate: r.returnDate,
        item: r.itemDescription,
        referenceNo: r.goldTokenNo,
        remark: r.remarks,
        photos: r.photos,
        recipientName: r.recipientName,
        recipientMobile: r.recipientMobile,
        recipientRelation: r.recipientRelation,
        recipientPhotoUrl: r.recipientPhotoUrl,
        recipientPhotoKey: r.recipientPhotoKey,
    };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-sm font-medium">{value ?? '—'}</div>
        </div>
    );
}

export function GoldRecordDetailModal({ type, row, open, onClose }: GoldRecordDetailModalProps) {
    const { toast } = useToast();
    const [takenPhotos, setTakenPhotos] = useState<GoldRecordPhotoMeta[]>([]);
    const [isLoadingPhotos, setIsLoadingPhotos] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

    const detail = row ? normalize(type, row) : null;

    useEffect(() => {
        if (!open || type !== 'taken' || !detail) {
            setTakenPhotos([]);
            return;
        }
        setIsLoadingPhotos(true);
        getGoldTakenPhotos(detail.loanId)
            .then(setTakenPhotos)
            .catch(() => {
                toast({ title: 'Error', description: 'Failed to load photos', variant: 'destructive' });
                setTakenPhotos([]);
            })
            .finally(() => setIsLoadingPhotos(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, type, detail?.loanId]);

    if (!detail) return null;

    const recipientPhotoKey = detail.recipientPhotoKey ?? detail.recipientPhotoUrl;
    const hasRecipientPhoto = type === 'returned' && !!recipientPhotoKey;

    const handleDownloadPdf = async () => {
        setIsGeneratingPdf(true);
        try {
            const fields: GoldRecordPdfField[] = [
                { label: 'Loan No', value: detail.loanNo },
                { label: 'Client', value: detail.client },
                { label: 'Center', value: detail.center },
                { label: 'Branch', value: detail.branch },
                { label: 'Karat', value: detail.karat || '—' },
                { label: 'Grams', value: `${Number(detail.grams).toFixed(3)}g` },
                { label: 'Price/g', value: formatCurrency(detail.pricePerGram) },
                { label: 'Gold Value', value: formatCurrency(detail.goldValue) },
                { label: 'Cash Given', value: detail.cashGiven !== null ? formatCurrency(detail.cashGiven) : '—' },
                { label: 'Disbursement Date', value: detail.disbursementDate || '—' },
                ...(detail.returnDate ? [{ label: 'Return Date', value: detail.returnDate }] : []),
                { label: 'Item', value: detail.item || '—' },
                { label: 'Reference No.', value: detail.referenceNo || '—' },
                { label: 'Remark', value: detail.remark || '—' },
                ...(type === 'returned'
                    ? [
                          { label: 'Received By', value: detail.recipientName || '—' },
                          { label: 'Recipient Mobile', value: detail.recipientMobile || '—' },
                          { label: 'Recipient Relationship', value: detail.recipientRelation || '—' },
                      ]
                    : []),
            ];

            let photoGroups: GoldRecordPdfPhotoGroup[];
            if (type === 'taken') {
                const keys = takenPhotos.map((p) => p.photoKey ?? p.photoUrl).filter(Boolean) as string[];
                const dataUrls = keys.length > 0 ? await getGoldPhotoDataUrls(keys) : [];
                photoGroups = [{ title: 'Photos', photos: dataUrls }];
            } else {
                const goldKeys = detail.photos.map((p) => p.photoKey ?? p.photoUrl).filter(Boolean) as string[];
                const allKeys = recipientPhotoKey ? [...goldKeys, recipientPhotoKey] : goldKeys;
                const dataUrls = allKeys.length > 0 ? await getGoldPhotoDataUrls(allKeys) : [];
                const dataUrlByKey = new Map(dataUrls.map((d) => [d.key, d]));
                photoGroups = [
                    { title: 'Gold Photos', photos: goldKeys.map((k) => dataUrlByKey.get(k)).filter((d): d is { key: string; dataUrl: string } => !!d) },
                    { title: 'Recipient Photo', photos: recipientPhotoKey && dataUrlByKey.has(recipientPhotoKey) ? [dataUrlByKey.get(recipientPhotoKey)!] : [] },
                ];
            }

            await buildGoldRecordPdf(
                type === 'taken' ? 'Gold Taken Record' : 'Gold Returned Record',
                detail.loanNo,
                fields,
                photoGroups,
                `gold-${type}-${detail.loanNo}.pdf`
            );
        } catch {
            toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Coins className="h-4 w-4 text-yellow-600" />
                        {type === 'taken' ? 'Gold Taken Record' : 'Gold Returned Record'}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Loan No" value={detail.loanNo} />
                        <Field label="Client" value={detail.client} />
                        <Field label="Center" value={detail.center} />
                        <Field label="Branch" value={detail.branch} />
                        <Field label="Karat" value={detail.karat} />
                        <Field label="Grams" value={`${Number(detail.grams).toFixed(3)}g`} />
                        <Field label="Price/g" value={formatCurrency(detail.pricePerGram)} />
                        <Field label="Gold Value" value={formatCurrency(detail.goldValue)} />
                        <Field label="Cash Given" value={detail.cashGiven !== null ? formatCurrency(detail.cashGiven) : '—'} />
                        <Field label="Disbursement Date" value={detail.disbursementDate} />
                        {detail.returnDate && <Field label="Return Date" value={detail.returnDate} />}
                        <Field label="Item" value={detail.item} />
                        <Field label="Reference No." value={detail.referenceNo} />
                        <Field label="Remark" value={detail.remark} />
                    </div>

                    {type === 'returned' && (
                        <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-sidebar-accent/30 rounded-lg p-3">
                            <Field label="Received By" value={detail.recipientName} />
                            <Field label="Mobile Number" value={detail.recipientMobile} />
                            <Field label="Relationship to Client" value={detail.recipientRelation} />
                        </div>
                    )}

                    <div>
                        <div className="text-xs text-muted-foreground mb-2">
                            {type === 'taken' ? 'Photos' : 'Gold Photos'}
                        </div>
                        {type === 'taken' ? (
                            isLoadingPhotos ? (
                                <PageLoader fullScreen={false} />
                            ) : takenPhotos.length === 0 ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <ImageOff className="h-4 w-4" /> No photos attached.
                                </div>
                            ) : (
                                <div className="grid grid-cols-4 gap-2">
                                    {takenPhotos.map((p) => (
                                        <StorageImage
                                            key={p.id}
                                            src={p.photoKey ?? p.photoUrl}
                                            alt="Gold pledge photo"
                                            className="h-24 w-24 rounded-lg object-cover border border-slate-200 dark:border-sidebar-accent"
                                        />
                                    ))}
                                </div>
                            )
                        ) : detail.photos.length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <ImageOff className="h-4 w-4" /> No photos attached.
                            </div>
                        ) : (
                            <div className="grid grid-cols-4 gap-2">
                                {detail.photos.map((p) => (
                                    <StorageImage
                                        key={p.id}
                                        src={p.photoKey ?? p.photoUrl}
                                        alt="Gold return evidence photo"
                                        className="h-24 w-24 rounded-lg object-cover border border-slate-200 dark:border-sidebar-accent"
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {type === 'returned' && (
                        <div>
                            <div className="text-xs text-muted-foreground mb-2">Recipient Photo</div>
                            {hasRecipientPhoto ? (
                                <StorageImage
                                    src={recipientPhotoKey}
                                    alt="Recipient photo"
                                    className="h-32 w-32 rounded-lg object-cover border border-slate-200 dark:border-sidebar-accent"
                                />
                            ) : (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <ImageOff className="h-4 w-4" /> No photo attached.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        onClick={handleDownloadPdf}
                        disabled={isGeneratingPdf || isLoadingPhotos}
                        className="bg-yellow-600 hover:bg-yellow-700 text-white"
                    >
                        {isGeneratingPdf ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                        Download PDF
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
