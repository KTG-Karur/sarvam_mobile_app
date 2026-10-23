'use client';

import { useState, useEffect } from 'react';
// TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
// import { useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Receipt,
    RotateCcw,
    Loader2,
    CheckCircle2,
    CalendarDays,
    Users,
    IndianRupee,
    AlertCircle,
    TrendingUp,
    Clock,
    UserCheck,
    UserX,
    Camera,
    ArrowLeft,
    ArrowRight,
    Banknote,
    ImageIcon,
    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    // FileDown,
    // Printer,
} from 'lucide-react';
import { CameraCapture } from '@/components/ui/CameraCapture';
import {
    DENOMINATION_VALUES,
    normalizeDenominationCounts,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
    type DenominationCounts,
} from '@/app/lib/denomination-money';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
// TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
// import { useReactToPrint } from 'react-to-print';
// import { CollectionReceipt } from './CollectionReceipt';
// import { jsPDF } from 'jspdf';
// import autoTable from 'jspdf-autotable';
// import { format } from 'date-fns';
// import {
//     Dialog,
//     DialogContent,
//     DialogHeader,
//     DialogTitle,
//     DialogFooter,
// } from '@/components/ui/dialog';
import { usePermission } from '@/app/hooks/usePermission';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEodWorkingDate } from '@/app/hooks/useEodWorkingDate';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';
// TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
// import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
// import { ensureReportFont } from '@/app/lib/reports/pdf-fonts';

// Local render order for the denomination step (500, 200, 100, 50, ...) — intentionally
// different from DENOMINATION_VALUES' own key order, which other consumers (e.g. the EOD
// checklist detail view) depend on and must not be affected by this page's display order.
const DENOMINATION_ROW_ORDER: Array<keyof DenominationCounts> = [
    'd500', 'd200', 'd100', 'd50', 'd20', 'd10', 'd5', 'd2', 'd1',
];

// ── Types ──────────────────────────────────────────────────────────────────

type Center = { id: string; name: string; code: string };

type CollectionItem = {
    loanId: string;
    loanNumber: string;
    clientId: string;
    clientName: string;
    clientCode: string;
    clientMobile?: string | null;
    installmentNo: number;
    loanProductTypeName: string | null;
    osPrincipal: number;
    osInterest: number;
    arrearPrincipal: number;
    arrearInterest: number;
    currentDemandPrincipal: number;
    currentDemandInterest: number;
    feesDue: number;
    penaltiesDue: number;
    savingsArrear: number;
    savingsCurrentDemand: number;
    totalSavingsDue: number;
    totalDemand: number;
    collectedAmount: number;
    remainingDue: number;
    status: 'PENDING' | 'PARTIAL' | 'COLLECTED';
    isOverdue: boolean;
    loanOutstanding: number;
    scheduleIds: string[];
};

type ArrearSummary = {
    centerName: string;
    centerCode: string;
    collectionDate: string;
    totalClients: number;
    totalDemand: number;
    loanOutstanding: number;
    openingArrears: number;
    totalArrearPrincipal: number;
    totalArrearInterest: number;
    totalCurrentDemandPrincipal: number;
    totalCurrentDemandInterest: number;
};

type ArrearData = { summary: ArrearSummary; collections: CollectionItem[] };

// ── Helpers ────────────────────────────────────────────────────────────────

const getTodayDate = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);

const isGoldLoanType = (name: string | null): boolean =>
    Boolean(name && name.toLowerCase().includes('gold'));

// ── Component ──────────────────────────────────────────────────────────────

export function ArrearCollectionClient() {
    const { canPage } = usePermission();
    const { enabled: loanAdvanceFeatureEnabled } = useLoanAdvanceEnabled();
    const canCreateCollection = canPage('/dashboard/collections/arrear-collection', 'add');
    const { toast } = useToast();

    // Branch state
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    // storedUser comes from localStorage (unavailable during SSR), so branching JSX on
    // isAdminOrAM straight away disagrees between the server's render (always "no user") and
    // the client's first render (real role) — a hydration mismatch. Delay that branch until
    // after mount, same pattern as UserMenu.tsx / CollectionApprovalClient.tsx.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // Scoped to the page's own branch selection so switching branch here re-resolves the
    // correct branch's EOD working date instead of staying pinned to the session-active branch.
    const { eodWorkingDate, isLoading: isEodLoading } = useEodWorkingDate(selectedBranchId);

    // Filter state
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [collectionDate, setCollectionDate] = useState(getTodayDate());
    const [isLoadingCenters, setIsLoadingCenters] = useState(false);
    const [isLoadingArrear, setIsLoadingArrear] = useState(false);

    // Arrear data state
    const [arrearData, setArrearData] = useState<ArrearData | null>(null);
    const [isCollectionSubmitted, setIsCollectionSubmitted] = useState(false);

    // Collection input state
    const [collectionAmounts, setCollectionAmounts] = useState<Record<string, string>>({});
    const [clientAttendance, setClientAttendance] = useState<Record<string, boolean>>({});
    const [selectedClients, setSelectedClients] = useState<Record<string, boolean>>({});
    const [is100Collection, setIs100Collection] = useState(false);
    const [is100Attendance, setIs100Attendance] = useState(false);
    const [loanAdvanceEnabled, setLoanAdvanceEnabled] = useState<Record<string, boolean>>({});
    const [loanAdvanceAmounts, setLoanAdvanceAmounts] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Wizard: collect (existing table) -> photo (meeting photo capture) -> denomination (cash count)
    const [step, setStep] = useState<'collect' | 'photo' | 'denomination'>('collect');
    const [pendingCollections, setPendingCollections] = useState<Array<{
        loanId: string;
        amountCollected: number;
        loanAdvanceAmount: number;
        paymentMode: string;
        remarks: string;
    }> | null>(null);
    const [pendingCashTotal, setPendingCashTotal] = useState(0);
    const [cameraOpen, setCameraOpen] = useState(false);
    const [meetingPhotoFile, setMeetingPhotoFile] = useState<File | null>(null);
    const [meetingPhotoPreviewUrl, setMeetingPhotoPreviewUrl] = useState<string | null>(null);
    // Soft GPS capture at the photo step — recorded for audit only, never blocks submission.
    const [photoLocation, setPhotoLocation] = useState<{ latitude: number; longitude: number } | null>(null);
    const [denomCounts, setDenomCounts] = useState<Record<keyof DenominationCounts, string>>({
        d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '',
    });
    const [denomUpi, setDenomUpi] = useState('');

    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    /*
    // Receipt state
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [savedBatchData, setSavedBatchData] = useState<any>(null);
    const receiptRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({ contentRef: receiptRef });
    */

    // ── Effects ──────────────────────────────────────────────────────────

    useEffect(() => {
        if (eodWorkingDate) setCollectionDate(eodWorkingDate);
    }, [eodWorkingDate]);

    useEffect(() => {
        loadBranches();
    }, []);

    useEffect(() => {
        if (selectedBranchId) {
            setSelectedCenterId('');
            setCenters([]);
            fetchCenters(selectedBranchId);
        }
    }, [selectedBranchId]);

    // ── Data fetching ─────────────────────────────────────────────────────

    const loadBranches = async () => {
        if (isAdminOrAM) {
            setIsLoadingBranches(true);
            try {
                const res = await fetch('/api/branches');
                const json = await res.json();
                const list: { id: string; name: string; code: string }[] = (json?.data ?? []).map(
                    (b: any) => ({ id: b.id, name: b.name, code: b.code })
                );
                setBranches(list);
                // Auto-select active branch or first
                const activeBranch = branchStorage.getActiveBranch();
                const preferredId = activeBranch?.id ?? storedUser?.branchId;
                const match = list.find(b => b.id === preferredId) ?? list[0];
                if (match) setSelectedBranchId(match.id);
            } catch {
                toast({ title: 'Error', description: 'Failed to load branches.', variant: 'destructive' });
            } finally {
                setIsLoadingBranches(false);
            }
        } else {
            const activeBranch = branchStorage.getActiveBranch();
            const branchId = activeBranch?.id ?? storedUser?.branchId ?? '';
            setBranchName(activeBranch?.name ?? '');
            setSelectedBranchId(branchId);
        }
    };

    const fetchCenters = async (branchId: string) => {
        if (!branchId) return;
        setIsLoadingCenters(true);
        try {
            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );
            if (result.success && result.data) {
                setCenters(result.data);
                if (result.data.length === 1 && !selectedCenterId) {
                    setSelectedCenterId(result.data[0].id);
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load centers.', variant: 'destructive' });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    const fetchArrearData = async () => {
        if (!selectedCenterId || !collectionDate) return;
        setIsLoadingArrear(true);
        try {
            setIsCollectionSubmitted(false);
            const result = await apiClient.get<ArrearData>(
                `/collections/arrear?centerId=${selectedCenterId}&collectionDate=${collectionDate}`
            );

            if (result.success && result.data) {
                setArrearData(result.data);

                const initialAmounts: Record<string, string> = {};
                const initialAttendance: Record<string, boolean> = {};
                const initialSelected: Record<string, boolean> = {};

                result.data.collections.forEach(item => {
                    initialAmounts[item.loanId] = String(Number(item.remainingDue.toFixed(2)));
                    initialAttendance[item.clientId] = false;
                    initialSelected[item.loanId] = item.remainingDue > 0;
                });

                const initialAdvanceEnabled: Record<string, boolean> = {};
                const initialAdvanceAmounts: Record<string, string> = {};
                result.data.collections.forEach(item => {
                    initialAdvanceEnabled[item.loanId] = loanAdvanceFeatureEnabled;
                    initialAdvanceAmounts[item.loanId] = '100';
                });

                setCollectionAmounts(initialAmounts);
                setClientAttendance(initialAttendance);
                setSelectedClients(initialSelected);
                setLoanAdvanceEnabled(initialAdvanceEnabled);
                setLoanAdvanceAmounts(initialAdvanceAmounts);

                toast({ title: 'Success', description: result.message || 'Arrear data loaded.' });

                // Check if already submitted today
                try {
                    const historyResult = await apiClient.patch<any>(
                        `/collections/arrear?centerId=${selectedCenterId}&date=${collectionDate}`,
                        {}
                    );
                    if (
                        historyResult.success &&
                        historyResult.data?.batches &&
                        Array.isArray(historyResult.data.batches) &&
                        historyResult.data.batches.length > 0
                    ) {
                        setIsCollectionSubmitted(true);
                    }
                } catch {
                    // non-critical
                }
            } else {
                toast({ title: 'Info', description: result.error || 'No arrear collections found for this center.' });
                setArrearData(null);
                setCollectionAmounts({});
                setClientAttendance({});
                setSelectedClients({});

                try {
                    const historyResult = await apiClient.patch<any>(
                        `/collections/arrear?centerId=${selectedCenterId}&date=${collectionDate}`,
                        {}
                    );
                    if (
                        historyResult.success &&
                        historyResult.data?.batches &&
                        Array.isArray(historyResult.data.batches) &&
                        historyResult.data.batches.length > 0
                    ) {
                        setIsCollectionSubmitted(true);
                    }
                } catch {
                    // non-critical
                }
            }
        } catch {
            toast({ title: 'Error', description: 'Failed to load arrear data.', variant: 'destructive' });
            setArrearData(null);
        } finally {
            setIsLoadingArrear(false);
        }
    };

    // ── Handlers ──────────────────────────────────────────────────────────

    const handleToggle100Collection = (checked: boolean) => {
        if (arrearData) {
            if (checked) {
                const newAmounts: Record<string, string> = {};
                arrearData.collections.forEach(item => {
                    if (selectedClients[item.loanId]) {
                        newAmounts[item.loanId] = item.remainingDue.toString();
                    }
                });
                setCollectionAmounts(prev => ({ ...prev, ...newAmounts }));
            } else {
                const newAmounts: Record<string, string> = {};
                arrearData.collections.forEach(item => {
                    newAmounts[item.loanId] = String(Number(item.remainingDue.toFixed(2)));
                });
                setCollectionAmounts(newAmounts);
            }
        }
        setIs100Collection(checked);
    };

    const handleToggle100Attendance = (checked: boolean) => {
        if (arrearData) {
            const newAttendance: Record<string, boolean> = {};
            arrearData.collections.forEach(item => {
                if (selectedClients[item.loanId]) {
                    newAttendance[item.clientId] = checked;
                }
            });
            setClientAttendance(prev => ({ ...prev, ...newAttendance }));
        }
        setIs100Attendance(checked);
    };

    const handleAttendanceChange = (clientId: string, isPresent: boolean) => {
        setClientAttendance(prev => ({ ...prev, [clientId]: isPresent }));
    };

    const resetWizardState = () => {
        setStep('collect');
        setPendingCollections(null);
        setPendingCashTotal(0);
        if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
        setMeetingPhotoFile(null);
        setMeetingPhotoPreviewUrl(null);
        setPhotoLocation(null);
        setDenomCounts({ d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '' });
        setDenomUpi('');
    };

    const handleReset = () => {
        setSelectedCenterId('');
        setCollectionDate(eodWorkingDate ?? getTodayDate());
        setArrearData(null);
        setCollectionAmounts({});
        setClientAttendance({});
        setSelectedClients({});
        setIs100Collection(false);
        setIs100Attendance(false);
        setLoanAdvanceEnabled({});
        setLoanAdvanceAmounts({});
        resetWizardState();
        toast({ title: 'Reset', description: 'Form has been reset.' });
    };

    // ── PDF download ──────────────────────────────────────────────────────

    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    /*
    const handleDownloadPDF = async () => {
        if (!savedBatchData) return;

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 200] });
        const reportFont = await ensureReportFont(doc);
        const data = savedBatchData;
        const margin = 5;

        try {
            let y = await drawPdfReportHeader(doc, 'ARREAR COLLECTION RECEIPT', {
                subtitle: 'Empowering Communities, Changing Lives  •  Salem, TN | Support: 1800-XXX-XXXX',
                fontFamily: reportFont,
            });

            doc.setFontSize(7); doc.setFont(reportFont, 'normal');
            doc.text(`Branch: ${data.branchName}`, margin, y); y += 4;
            doc.text(`Center: ${data.centerName} (${data.centerCode})`, margin, y); y += 4;
            doc.text(`Date: ${data.collectionDate}  Time: ${data.collectionTime}`, margin, y); y += 4;
            doc.text(`FDO: ${data.collectedBy}`, margin, y); y += 4;

            doc.setLineDashPattern([1, 1], 0); doc.line(margin, y, 75, y); y += 4;

            autoTable(doc, {
                startY: y,
                head: [['Client', 'Loan #', 'Arrear Amt', 'Loan Adv']],
                body: data.items.map((item: any) => [
                    item.clientName,
                    item.loanNumber,
                    `₹${item.amountCollected.toFixed(2)}`,
                    (item.savingsCollected ?? 0) > 0 ? `₹${(item.savingsCollected as number).toFixed(2)}` : '-',
                ]),
                styles: { font: reportFont, fontSize: 6, cellPadding: 1.5 },
                headStyles: { font: reportFont, fillColor: [3, 127, 53], textColor: 255, fontSize: 6 },
                columnStyles: {
                    0: { cellWidth: 20 },
                    1: { cellWidth: 18 },
                    2: { cellWidth: 14, halign: 'right' },
                    3: { cellWidth: 12, halign: 'right' },
                },
                margin: { left: margin, right: margin },
            });

            const finalY = (doc as any).lastAutoTable?.finalY ?? y + 10;
            const grandTotal = data.items.reduce((s: number, i: any) => s + i.amountCollected, 0);
            const totalAdv = data.items.reduce((s: number, i: any) => s + (i.savingsCollected || 0), 0);
            doc.setFontSize(8); doc.setFont(reportFont, 'bold');
            doc.text(`Arrear: ₹${grandTotal.toFixed(2)}  Adv: ₹${totalAdv.toFixed(2)}`, margin, finalY + 5);

            doc.setFontSize(6); doc.setFont(reportFont, 'normal');
            doc.text('System generated receipt. Subject to BM approval.', 40, finalY + 14, { align: 'center' });

            doc.save(`arrear-collection-${data.collectionDate}.pdf`);
        } catch (err) {
            console.error('[Arrear PDF]', err);
            toast({ title: 'PDF Error', description: 'Failed to generate PDF.', variant: 'destructive' });
        }
    };
    */

    // ── Submit handlers ───────────────────────────────────────────────────

    // Step 1 -> Step 2: validate & stash the collections array, then move to photo capture.
    // Nothing is persisted yet — the batch is only created once all 3 steps are done.
    const handleContinueToPhoto = () => {
        if (!arrearData || !selectedCenterId) {
            toast({ title: 'Error', description: 'Please select a center and load arrear data first.', variant: 'destructive' });
            return;
        }

        const validationErrors: string[] = [];
        const collections: Array<{
            loanId: string;
            amountCollected: number;
            loanAdvanceAmount: number;
            paymentMode: string;
            remarks: string;
        }> = [];

        for (const item of arrearData.collections) {
            if (!selectedClients[item.loanId]) continue;

            const rawAmount = collectionAmounts[item.loanId] || '0';
            const amount = parseFloat(rawAmount);

            if (isNaN(amount) || amount <= 0) continue;
            if (amount <= item.collectedAmount + 0.001) continue;

            if (amount > item.remainingDue * 1.001) {
                validationErrors.push(
                    `${item.clientName} (Loan ${item.loanNumber}): ₹${amount} exceeds remaining due ₹${item.remainingDue}`
                );
                continue;
            }

            if (!item.loanId) {
                validationErrors.push(`${item.clientName}: Missing loan reference`);
                continue;
            }

            const rawAdv = loanAdvanceEnabled[item.loanId]
                ? parseFloat(loanAdvanceAmounts[item.loanId] || '0')
                : 0;
            const loanAdvanceAmount = Math.max(0, isNaN(rawAdv) ? 0 : rawAdv);

            collections.push({
                loanId: item.loanId,
                amountCollected: Number(amount.toFixed(2)),
                loanAdvanceAmount: Number(loanAdvanceAmount.toFixed(2)),
                paymentMode: 'CASH',
                remarks: 'Arrear collection',
            });
        }

        if (validationErrors.length > 0) {
            toast({ title: 'Validation Errors', description: validationErrors.join('\n'), variant: 'destructive' });
            return;
        }

        if (collections.length === 0) {
            toast({ title: 'No Collections', description: 'Please enter collection amounts for at least one client.', variant: 'destructive' });
            return;
        }

        const cashTotal = collections.reduce((sum, c) => sum + c.amountCollected + c.loanAdvanceAmount, 0);
        setPendingCollections(collections);
        setPendingCashTotal(Number(cashTotal.toFixed(2)));
        setStep('photo');
    };

    const handlePhotoCaptured = (file: File) => {
        if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
        setMeetingPhotoFile(file);
        setMeetingPhotoPreviewUrl(URL.createObjectURL(file));
        setStep('denomination');

        // Soft GPS capture — recorded for audit only, never blocks the flow.
        setPhotoLocation(null);
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => setPhotoLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
                () => setPhotoLocation(null),
                { enableHighAccuracy: true, timeout: 8000 }
            );
        }
    };

    const handleDenomCountChange = (key: keyof DenominationCounts, value: string) => {
        setDenomCounts((prev) => ({ ...prev, [key]: value }));
    };

    const denomTotalEntered = Number(
        (
            calculateDenominationTotal(normalizeDenominationCounts(denomCounts)) +
            (Math.max(0, Number(denomUpi) || 0))
        ).toFixed(2)
    );
    const denomMatchesCollected = denominationMatchesFlooredCollection(denomTotalEntered, pendingCashTotal);

    const handleBackToCollect = () => setStep('collect');
    const handleBackToPhoto = () => setStep('photo');

    // Step 3 -> Final submit: everything (collections + attendance + photo + denomination)
    // goes to the server together in one multipart request — nothing was persisted before this.
    const handleFinalSubmit = async () => {
        if (!arrearData || !selectedCenterId || !pendingCollections || !meetingPhotoFile) {
            toast({
                title: 'Error',
                description: 'Missing collection, photo or denomination data. Please restart the submission.',
                variant: 'destructive',
            });
            return;
        }

        if (!denomMatchesCollected) {
            toast({
                title: 'Denomination Mismatch',
                description: `Denomination total (${formatCurrency(denomTotalEntered)}) must match collected cash (${formatCurrency(pendingCashTotal)}).`,
                variant: 'destructive',
            });
            return;
        }

        setIsSubmitting(true);
        try {
            const formData = new FormData();
            formData.append('centerId', selectedCenterId);
            formData.append('collectionDate', collectionDate);
            formData.append('collections', JSON.stringify(pendingCollections));
            formData.append('attendance', JSON.stringify(clientAttendance));
            formData.append('denomination', JSON.stringify({
                ...normalizeDenominationCounts(denomCounts),
                upi: Math.max(0, Number(denomUpi) || 0),
            }));
            formData.append('photo', meetingPhotoFile);
            if (photoLocation) {
                formData.append('latitude', String(photoLocation.latitude));
                formData.append('longitude', String(photoLocation.longitude));
            }

            const result = await apiClient.post('/collections/arrear', formData);

            if (result.success) {
                const responseData = result.data as any;

                const warnings = responseData.warnings as string[] | undefined;
                toast({
                    title: 'Success',
                    description: warnings?.length
                        ? `${result.message} (${warnings.join(', ')})`
                        : result.message || 'Arrear collections submitted for Review.',
                });

                setCollectionAmounts({});
                setPendingCollections(null);
                setPendingCashTotal(0);
                if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
                setMeetingPhotoFile(null);
                setMeetingPhotoPreviewUrl(null);
                setDenomCounts({ d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '' });
                setDenomUpi('');
                setStep('collect');
                await fetchArrearData();
            } else {
                toast({ title: 'Submission Failed', description: result.error || 'Failed to submit arrear collections.', variant: 'destructive' });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to submit arrear collections.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Computed values ───────────────────────────────────────────────────

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(arrearData?.collections ?? []);

    const totalCollected = arrearData
        ? arrearData.collections.reduce((sum, item) => {
            const amount = parseFloat(collectionAmounts[item.loanId] || '0');
            return sum + (isNaN(amount) ? 0 : amount);
        }, 0)
        : 0;

    const totalLoanAdvance = arrearData
        ? arrearData.collections.reduce((sum, item) => {
            if (!selectedClients[item.loanId]) return sum;
            if (!loanAdvanceEnabled[item.loanId]) return sum;
            const amt = parseFloat(loanAdvanceAmounts[item.loanId] || '0');
            return sum + (isNaN(amt) ? 0 : amt);
        }, 0)
        : 0;

    const collectionPercentage = arrearData && arrearData.summary.totalDemand > 0
        ? (totalCollected / arrearData.summary.totalDemand) * 100
        : 0;

    // ── Render ────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Arrear Collection
                </h1>
                <p className="text-muted-foreground">
                    Collect past-due installments for selected center
                </p>
            </div>

            {/* EOD loading indicator */}
            {isEodLoading && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-green-50 px-4 py-2.5 text-sm text-sidebar-accent dark:border-brand-green-darker/50 dark:bg-green-950/30 dark:text-green-200">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Loading EOD working date…</span>
                </div>
            )}

            <div className="space-y-6 mt-6">
                    {/* Filter Card */}
                    <Card className="border-2 border-primary/20 dark:border-sidebar-accent/60 shadow-xl">
                        <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                        <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <Receipt className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl">Arrear Collection Details</CardTitle>
                                    <CardDescription>Select center and date to view past-due collections</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                {/* Branch — visible only for Admin / Area Manager */}
                                {!mounted ? (
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Branch</Label>
                                        <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground" />
                                    </div>
                                ) : isAdminOrAM ? (
                                    <div className="space-y-2">
                                        <Label htmlFor="branch" className="text-sm font-medium">Branch</Label>
                                        <Select
                                            value={selectedBranchId}
                                            onValueChange={setSelectedBranchId}
                                            disabled={isLoadingBranches || branches.length === 0}
                                        >
                                            <SelectTrigger id="branch" className="h-11">
                                                <SelectValue placeholder="-- SELECT BRANCH --" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {branches.map(b => (
                                                    <SelectItem key={b.id} value={b.id}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium">{b.name}</span>
                                                            <span className="text-muted-foreground">({b.code})</span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <Label className="text-sm font-medium">Branch</Label>
                                        <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                                            {branchName || 'Current Branch'}
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    <Label htmlFor="center" className="text-sm font-medium">Center Name</Label>
                                    <Select
                                        value={selectedCenterId}
                                        onValueChange={setSelectedCenterId}
                                        disabled={isLoadingCenters || centers.length === 0 || !selectedBranchId}
                                    >
                                        <SelectTrigger id="center" className="h-11">
                                            <SelectValue placeholder="-- SELECT CENTER --" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {centers.map(center => (
                                                <SelectItem key={center.id} value={center.id}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium">{center.name}</span>
                                                        <span className="text-muted-foreground">({center.code})</span>
                                                    </div>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="date" className="text-sm font-medium">Collection Date</Label>
                                    <div className="relative">
                                        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                        <DateInput
                                            id="date"
                                            value={collectionDate}
                                            onChange={e => setCollectionDate(e.target.value)}
                                            max={eodWorkingDate ?? getTodayDate()}
                                            className="h-11 pr-9"
                                        />
                                    </div>
                                </div>

                                <div className="flex items-end gap-2">
                                    <Button
                                        onClick={fetchArrearData}
                                        disabled={!selectedCenterId || !collectionDate || isLoadingArrear}
                                        className="flex-1 h-11"
                                    >
                                        {isLoadingArrear ? (
                                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading...</>
                                        ) : (
                                            <><TrendingUp className="mr-2 h-4 w-4" />Load Data</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Summary Cards */}
                    {arrearData && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <Card>
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">Arrear Clients</p>
                                                <p className="text-2xl font-bold">{arrearData.summary.totalClients}</p>
                                            </div>
                                            <Users className="h-8 w-8 text-primary" />
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">Total Arrear Due</p>
                                                <p className="text-2xl font-bold">{formatCurrency(arrearData.summary.totalDemand)}</p>
                                            </div>
                                            <IndianRupee className="h-8 w-8 text-rose-500" />
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">Collected</p>
                                                <p className="text-2xl font-bold">{formatCurrency(totalCollected)}</p>
                                            </div>
                                            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardContent className="pt-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">Recovery %</p>
                                                <p className="text-2xl font-bold">{collectionPercentage.toFixed(1)}%</p>
                                            </div>
                                            <TrendingUp className="h-8 w-8 text-purple-500" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-2 gap-3">
                                <Card className="border-rose-200/60 dark:border-rose-800/40">
                                    <CardContent className="pt-4 pb-4">
                                        <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Arrear Principal</p>
                                        <p className="text-lg font-semibold">{formatCurrency(arrearData.summary.totalArrearPrincipal)}</p>
                                    </CardContent>
                                </Card>
                                <Card className="border-rose-200/60 dark:border-rose-800/40">
                                    <CardContent className="pt-4 pb-4">
                                        <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Arrear Interest</p>
                                        <p className="text-lg font-semibold">{formatCurrency(arrearData.summary.totalArrearInterest)}</p>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    )}

                    {/* Already submitted banner */}
                    {isCollectionSubmitted && (
                        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                            <div>
                                <p className="font-semibold">An arrear collection batch has already been submitted for this center on this date.</p>
                                <p className="text-xs mt-1 text-amber-700 dark:text-amber-200">
                                    Clients with remaining arrear due can still be submitted.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Collections Table */}
                    {step === 'collect' && arrearData && arrearData.collections.length > 0 && (
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between flex-wrap gap-4">
                                    <div>
                                        <CardTitle>Step 1 of 3 — Arrear Clients</CardTitle>
                                        <CardDescription className="flex items-center gap-4 flex-wrap mt-1">
                                            Enter collection amounts for past-due installments
                                            <span className="flex items-center gap-1.5 text-xs">
                                                <span className="inline-block h-3 w-4 rounded-sm border border-amber-400 bg-amber-100 dark:bg-amber-900/50" />
                                                <span className="text-amber-700 dark:text-amber-300 font-medium">Gold Loan</span>
                                            </span>
                                        </CardDescription>
                                    </div>
                                    <div className="flex items-center gap-6 flex-wrap">
                                        <TableSearchInput
                                            value={tableSearchQuery}
                                            onChange={setTableSearchQuery}
                                            placeholder="Search arrear clients..."
                                        />
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id="present-100"
                                                checked={is100Attendance}
                                                onCheckedChange={handleToggle100Attendance}
                                                disabled={isSubmitting}
                                            />
                                            <Label htmlFor="present-100" className="text-sm font-medium cursor-pointer">100% Present</Label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                id="collect-100"
                                                checked={is100Collection}
                                                onCheckedChange={handleToggle100Collection}
                                                disabled={isSubmitting}
                                            />
                                            <Label htmlFor="collect-100" className="text-sm font-medium cursor-pointer">100% Collection</Label>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <TooltipProvider delayDuration={200}>
                                    <div className="rounded-md border overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-[48px] min-w-[48px] sticky left-0 bg-background z-20">
                                                        <Checkbox
                                                            checked={
                                                                arrearData.collections.length > 0 &&
                                                                arrearData.collections
                                                                    .filter(i => i.remainingDue > 0)
                                                                    .every(i => selectedClients[i.loanId])
                                                            }
                                                            onCheckedChange={checked => {
                                                                const update: Record<string, boolean> = {};
                                                                arrearData.collections.forEach(i => {
                                                                    if (i.remainingDue > 0) update[i.loanId] = !!checked;
                                                                });
                                                                setSelectedClients(prev => ({ ...prev, ...update }));
                                                                if (!checked) {
                                                                    setCollectionAmounts(prev => {
                                                                        const next = { ...prev };
                                                                        arrearData.collections.forEach(i => { if (i.remainingDue > 0) next[i.loanId] = '0'; });
                                                                        return next;
                                                                    });
                                                                    setLoanAdvanceEnabled(prev => {
                                                                        const next = { ...prev };
                                                                        arrearData.collections.forEach(i => { if (i.remainingDue > 0) next[i.loanId] = false; });
                                                                        return next;
                                                                    });
                                                                } else {
                                                                    setCollectionAmounts(prev => {
                                                                        const next = { ...prev };
                                                                        arrearData.collections.forEach(i => { if (i.remainingDue > 0) next[i.loanId] = String(Number(i.remainingDue.toFixed(2))); });
                                                                        return next;
                                                                    });
                                                                    setLoanAdvanceEnabled(prev => {
                                                                        const next = { ...prev };
                                                                        arrearData.collections.forEach(i => { if (i.remainingDue > 0) next[i.loanId] = true; });
                                                                        return next;
                                                                    });
                                                                }
                                                            }}
                                                            disabled={isSubmitting}
                                                        />
                                                    </TableHead>
                                                    <TableHead className="w-[60px] min-w-[60px] max-w-[60px] sticky left-[48px] bg-background z-20">#</TableHead>
                                                    <TableHead className="min-w-[220px] w-[220px] sticky left-[108px] bg-background z-20">Client Name</TableHead>
                                                    <TableHead className="min-w-[110px]">Mobile</TableHead>
                                                    <TableHead className="min-w-[100px]">Loan No.</TableHead>
                                                    <TableHead className="text-center min-w-[60px]">Inst.</TableHead>
                                                    <TableHead className="text-right min-w-[100px]">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="cursor-help border-b border-dotted border-muted-foreground">OS Pri</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p>Outstanding Principal (Loan Level)</p></TooltipContent>
                                                        </Tooltip>
                                                    </TableHead>
                                                    <TableHead className="text-right min-w-[100px]">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="cursor-help border-b border-dotted border-muted-foreground">OS Int</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p>Outstanding Interest (Loan Level)</p></TooltipContent>
                                                        </Tooltip>
                                                    </TableHead>
                                                    <TableHead className="text-right min-w-[110px]">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="cursor-help border-b border-dotted border-muted-foreground text-rose-600 dark:text-rose-400">Arrear Pri</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p>Past-Due Principal (after allocation)</p></TooltipContent>
                                                        </Tooltip>
                                                    </TableHead>
                                                    <TableHead className="text-right min-w-[110px]">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="cursor-help border-b border-dotted border-muted-foreground text-rose-600 dark:text-rose-400">Arrear Int</span>
                                                            </TooltipTrigger>
                                                            <TooltipContent><p>Past-Due Interest (after allocation)</p></TooltipContent>
                                                        </Tooltip>
                                                    </TableHead>
                                                    <TableHead className="text-right min-w-[90px]">Fees</TableHead>
                                                    <TableHead className="text-right min-w-[90px]">Penalty</TableHead>
                                                    <TableHead className="text-right min-w-[110px] font-semibold">Total Arrear</TableHead>
                                                    <TableHead className="text-center min-w-[100px]">Attend.</TableHead>
                                                    <TableHead className="text-right min-w-[140px]">Collect Amt</TableHead>
                                                    {loanAdvanceFeatureEnabled && (
                                                        <TableHead className="min-w-[160px]">Loan Advance</TableHead>
                                                    )}
                                                    <TableHead className="min-w-[100px]">Status</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {searchedRows.map((item, index) => {
                                                    const isGold = isGoldLoanType(item.loanProductTypeName);
                                                    // Pinned (sticky) cells need an OPAQUE background — the row tint is
                                                    // translucent, so `bg-inherit` let scrolled columns show through.
                                                    const stickyCellBg = isGold
                                                        ? 'bg-amber-50 dark:bg-[#2b1d07]'
                                                        : 'bg-[#fff9f9] dark:bg-[#1f1014]';
                                                    return (
                                                        <TableRow
                                                            key={item.loanId}
                                                            className={cn(
                                                                isGold
                                                                    ? 'bg-amber-50 dark:bg-amber-950/30 border-l-2 border-l-amber-400 dark:border-l-amber-600'
                                                                    : 'bg-rose-50/40 dark:bg-rose-950/20',
                                                                'hover:bg-muted/50 transition-colors'
                                                            )}
                                                        >
                                                            <TableCell className={cn("w-[48px] min-w-[48px] sticky left-0 z-10", stickyCellBg)}>
                                                                <Checkbox
                                                                    checked={selectedClients[item.loanId] ?? false}
                                                                    onCheckedChange={checked => {
                                                                        setSelectedClients(prev => ({ ...prev, [item.loanId]: !!checked }));
                                                                        if (!checked) {
                                                                            setCollectionAmounts(prev => ({ ...prev, [item.loanId]: '0' }));
                                                                            setLoanAdvanceEnabled(prev => ({ ...prev, [item.loanId]: false }));
                                                                        } else {
                                                                            setCollectionAmounts(prev => ({ ...prev, [item.loanId]: String(Number(item.remainingDue.toFixed(2))) }));
                                                                            setLoanAdvanceEnabled(prev => ({ ...prev, [item.loanId]: true }));
                                                                        }
                                                                    }}
                                                                    disabled={item.remainingDue === 0 || isSubmitting}
                                                                />
                                                            </TableCell>
                                                            <TableCell className={cn("w-[60px] min-w-[60px] max-w-[60px] sticky left-[48px] z-10 font-medium", stickyCellBg)}>
                                                                {index + 1}
                                                            </TableCell>
                                                            <TableCell className={cn("min-w-[220px] w-[220px] sticky left-[108px] z-10", stickyCellBg)}>
                                                                <div className="break-words whitespace-normal">
                                                                    <p className="font-medium text-sm">{item.clientName}</p>
                                                                    <p className="text-xs text-muted-foreground">{item.clientCode}</p>
                                                                    {isGold && (
                                                                        <span className="inline-flex items-center gap-1 mt-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                                                                            🪙 {item.loanProductTypeName}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="min-w-[110px] text-sm">{item.clientMobile || '—'}</TableCell>
                                                            <TableCell className="font-mono text-xs whitespace-nowrap">{item.loanNumber}</TableCell>
                                                            <TableCell className="text-center whitespace-nowrap">{item.installmentNo}</TableCell>
                                                            <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.osPrincipal)}</TableCell>
                                                            <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.osInterest)}</TableCell>
                                                            <TableCell className={cn('text-right text-xs tabular-nums whitespace-nowrap', item.arrearPrincipal > 0 && 'text-rose-600 dark:text-rose-400 font-medium')}>
                                                                {formatCurrency(item.arrearPrincipal)}
                                                            </TableCell>
                                                            <TableCell className={cn('text-right text-xs tabular-nums whitespace-nowrap', item.arrearInterest > 0 && 'text-rose-600 dark:text-rose-400 font-medium')}>
                                                                {formatCurrency(item.arrearInterest)}
                                                            </TableCell>
                                                            <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.feesDue)}</TableCell>
                                                            <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.penaltiesDue)}</TableCell>
                                                            <TableCell className="text-right font-semibold text-sm tabular-nums whitespace-nowrap">{formatCurrency(item.totalDemand)}</TableCell>
                                                            <TableCell className="text-center whitespace-nowrap">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleAttendanceChange(item.clientId, !clientAttendance[item.clientId])}
                                                                    disabled={isSubmitting || is100Attendance}
                                                                    className={cn(
                                                                        'h-8 px-2',
                                                                        clientAttendance[item.clientId]
                                                                            ? 'text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100'
                                                                            : 'text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100'
                                                                    )}
                                                                >
                                                                    {clientAttendance[item.clientId] ? <UserCheck className="h-4 w-4 mr-1" /> : <UserX className="h-4 w-4 mr-1" />}
                                                                    {clientAttendance[item.clientId] ? 'P' : 'A'}
                                                                </Button>
                                                            </TableCell>
                                                            <TableCell className="whitespace-nowrap">
                                                                <Input
                                                                    type="number"
                                                                    step="0.01"
                                                                    min="0"
                                                                    max={item.remainingDue}
                                                                    value={collectionAmounts[item.loanId] || ''}
                                                                    onChange={e => setCollectionAmounts(prev => ({ ...prev, [item.loanId]: e.target.value }))}
                                                                    className="w-32 text-right text-sm"
                                                                    disabled={isSubmitting || is100Collection || item.remainingDue === 0}
                                                                />
                                                            </TableCell>
                                                            {loanAdvanceFeatureEnabled && (
                                                                <TableCell className="whitespace-nowrap">
                                                                    <div className="flex items-center gap-2">
                                                                        <Switch
                                                                            checked={loanAdvanceEnabled[item.loanId] ?? true}
                                                                            onCheckedChange={checked =>
                                                                                setLoanAdvanceEnabled(prev => ({ ...prev, [item.loanId]: checked }))
                                                                            }
                                                                            disabled={isSubmitting}
                                                                        />
                                                                        {(loanAdvanceEnabled[item.loanId] ?? true) && (
                                                                            <Input
                                                                                type="number"
                                                                                step="1"
                                                                                min="0"
                                                                                value={loanAdvanceAmounts[item.loanId] ?? '100'}
                                                                                onChange={e =>
                                                                                    setLoanAdvanceAmounts(prev => ({ ...prev, [item.loanId]: e.target.value }))
                                                                                }
                                                                                className="w-24 text-right text-sm"
                                                                                disabled={isSubmitting}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                            )}
                                                            <TableCell className="whitespace-nowrap">
                                                                {item.status === 'COLLECTED' ? (
                                                                    <Badge className="bg-emerald-600 hover:bg-emerald-600 whitespace-nowrap">Collected</Badge>
                                                                ) : item.status === 'PARTIAL' ? (
                                                                    <Badge className="bg-amber-600 hover:bg-amber-600 whitespace-nowrap">Partial</Badge>
                                                                ) : (
                                                                    <Badge variant="destructive" className="gap-1 whitespace-nowrap">
                                                                        <Clock className="h-3 w-3" />
                                                                        Overdue
                                                                    </Badge>
                                                                )}
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </TooltipProvider>

                                <div className="flex gap-3 mt-6">
                                    <div className="flex-1">
                                        <Button
                                            onClick={handleContinueToPhoto}
                                            disabled={!canCreateCollection || isSubmitting || totalCollected === 0}
                                            className="w-full bg-primary hover:bg-sidebar-accent"
                                            size="lg"
                                        >
                                            <ArrowRight className="mr-2 h-4 w-4" />
                                            {loanAdvanceFeatureEnabled
                                                ? `Continue (${formatCurrency(totalCollected)} + Loan Adv ${formatCurrency(totalLoanAdvance)})`
                                                : `Continue (${formatCurrency(totalCollected)})`}
                                        </Button>
                                    </div>
                                    <Button onClick={handleReset} disabled={isSubmitting} variant="destructive" size="lg">
                                        <RotateCcw className="mr-2 h-4 w-4" />
                                        Reset
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 2: Meeting Photo */}
                    {step === 'photo' && (
                        <Card className="border-2 border-primary/20 shadow-xl">
                            <CardHeader>
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Camera className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle>Step 2 of 3 — Meeting Photo</CardTitle>
                                        <CardDescription>Capture a photo of the center meeting before entering the cash count</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {meetingPhotoPreviewUrl ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <img
                                            src={meetingPhotoPreviewUrl}
                                            alt="Meeting photo preview"
                                            className="max-h-80 rounded-lg border object-contain"
                                        />
                                        <Button variant="outline" onClick={() => setCameraOpen(true)}>
                                            <Camera className="mr-2 h-4 w-4" />
                                            Retake Photo
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-12">
                                        <ImageIcon className="h-10 w-10 text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">No meeting photo captured yet</p>
                                        <Button onClick={() => setCameraOpen(true)} className="bg-primary hover:bg-primary">
                                            <Camera className="mr-2 h-4 w-4" />
                                            Take Photo
                                        </Button>
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <Button variant="outline" onClick={handleBackToCollect} disabled={isSubmitting}>
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Back
                                    </Button>
                                    {meetingPhotoFile && (
                                        <Button onClick={() => setStep('denomination')} className="flex-1 bg-primary hover:bg-primary">
                                            <ArrowRight className="mr-2 h-4 w-4" />
                                            Continue to Denomination
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Step 3: Denomination Entry */}
                    {step === 'denomination' && (
                        <Card className="border-2 border-primary/20 shadow-xl">
                            <CardHeader>
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                        <Banknote className="h-5 w-5 text-primary dark:text-primary" />
                                    </div>
                                    <div>
                                        <CardTitle>Step 3 of 3 — Cash Denomination</CardTitle>
                                        <CardDescription>Count the physical cash collected and enter the note breakdown</CardDescription>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                                    {DENOMINATION_ROW_ORDER.map((key) => (
                                        <div key={key} className="space-y-1">
                                            <Label htmlFor={`denom-${key}`} className="text-xs text-muted-foreground">
                                                ₹{DENOMINATION_VALUES[key]}
                                            </Label>
                                            <Input
                                                id={`denom-${key}`}
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={denomCounts[key]}
                                                onChange={(e) => handleDenomCountChange(key, e.target.value)}
                                                className="text-right"
                                                disabled={isSubmitting}
                                            />
                                        </div>
                                    ))}
                                    <div className="space-y-1">
                                        <Label htmlFor="denom-upi" className="text-xs text-muted-foreground">UPI (₹)</Label>
                                        <Input
                                            id="denom-upi"
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={denomUpi}
                                            onChange={(e) => setDenomUpi(e.target.value)}
                                            className="text-right"
                                            disabled={isSubmitting}
                                        />
                                    </div>
                                </div>

                                <div className={cn(
                                    "flex items-center justify-between rounded-lg border px-4 py-3",
                                    denomMatchesCollected
                                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                                        : "border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/30"
                                )}>
                                    <div>
                                        <p className="text-sm font-medium">
                                            Denomination Total: {formatCurrency(denomTotalEntered)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Must match collected cash: {formatCurrency(pendingCashTotal)}
                                        </p>
                                    </div>
                                    {denomMatchesCollected ? (
                                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Matched</Badge>
                                    ) : (
                                        <Badge variant="destructive">Mismatch</Badge>
                                    )}
                                </div>

                                <div className="flex gap-3">
                                    <Button variant="outline" onClick={handleBackToPhoto} disabled={isSubmitting}>
                                        <ArrowLeft className="mr-2 h-4 w-4" />
                                        Back
                                    </Button>
                                    <Button
                                        onClick={handleFinalSubmit}
                                        disabled={isSubmitting || !denomMatchesCollected}
                                        className="flex-1 bg-primary hover:bg-primary"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                Submitting...
                                            </>
                                        ) : (
                                            <>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Submit Arrear Collection
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <CameraCapture
                        open={cameraOpen}
                        onClose={() => setCameraOpen(false)}
                        onCapture={handlePhotoCaptured}
                        label="Arrear Collection"
                    />

                    {/* Empty state */}
                    {!isLoadingArrear && arrearData && arrearData.collections.length === 0 && (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="rounded-full bg-muted p-4 mb-4">
                                    <AlertCircle className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">No Arrear Clients Found</h3>
                                <p className="text-sm text-muted-foreground text-center max-w-md">
                                    There are no past-due installments for this center. All clients are up to date.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* No center selected */}
                    {!selectedCenterId && !isLoadingCenters && (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-12">
                                <div className="rounded-full bg-muted p-4 mb-4">
                                    <Receipt className="h-8 w-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2">Select a Center</h3>
                                <p className="text-sm text-muted-foreground text-center max-w-md">
                                    Please select a center and date to view clients with arrear installments.
                                </p>
                            </CardContent>
                        </Card>
                    )}
            </div>

            {/* TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
            <Dialog open={showReceiptModal} onOpenChange={setShowReceiptModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Arrear Collection Receipt</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col items-center py-4 max-h-[70vh] overflow-y-auto">
                        {savedBatchData && (
                            <CollectionReceipt ref={receiptRef} batchData={savedBatchData} />
                        )}
                    </div>
                    <DialogFooter className="flex-row gap-2 sm:justify-end">
                        <Button variant="outline" onClick={() => setShowReceiptModal(false)} className="flex-1 sm:flex-none">
                            Close
                        </Button>
                        <Button
                            onClick={handleDownloadPDF}
                            variant="outline"
                            className="flex-1 sm:flex-none text-red-600 border-red-200 hover:bg-red-50"
                        >
                            <FileDown className="mr-2 h-4 w-4" />
                            Download PDF
                        </Button>
                        <Button
                            onClick={() => handlePrint()}
                            className="flex-1 sm:flex-none bg-primary hover:bg-primary"
                        >
                            <Printer className="mr-2 h-4 w-4" />
                            Print Receipt
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            */}
        </div>
    );
}
