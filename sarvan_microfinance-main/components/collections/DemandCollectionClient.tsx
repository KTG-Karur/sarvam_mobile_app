'use client';

import { useState, useEffect } from 'react';
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
    // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
    // FileDown,
    // Printer,
    Camera,
    ArrowLeft,
    ArrowRight,
    Banknote,
    ImageIcon,
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
// import { useRef } from 'react';
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
import { allocateCollectionAmount } from '@/app/lib/collections/demand-calculation';
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

// Types
type Center = {
    id: string;
    name: string;
    code: string;
};

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
    loanAdvanceCollectedToday: number;

    totalDemand: number;
    duePrincipal: number;
    dueInterest: number;
    remainingPrincipal: number;
    remainingInterest: number;

    collectedAmount: number;
    remainingDue: number;
    status: 'PENDING' | 'PARTIAL' | 'COLLECTED';
    isOverdue: boolean;
    loanOutstanding: number;

    scheduleIds: string[];
};

type DemandSummary = {
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

type DemandData = {
    summary: DemandSummary;
    collections: CollectionItem[];
};

// Returns true when the loan product type is a gold loan (case-insensitive)
const isGoldLoanType = (typeName: string | null | undefined): boolean =>
    !!typeName && typeName.trim().toLowerCase().includes('gold');

// Get today's date in YYYY-MM-DD format
const getTodayDate = (): string => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Format currency
const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
    }).format(amount);
};

export function DemandCollectionClient() {
    const { canPage } = usePermission();
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    const canCreateCollection = canPage('/dashboard/collections/demand-collection', 'add');
    const { toast } = useToast();

    // Branch state — Admin/Area Manager can pick any branch; others are locked to their own
    const storedUser = tokenStorage.getUser();
    const isAdminOrAM = storedUser?.role === 'ADMIN' || storedUser?.role === 'AREA_MANAGER';
    // storedUser comes from localStorage (unavailable during SSR), so branching JSX on
    // isAdminOrAM straight away disagrees between the server's render (always "no user") and
    // the client's first render (real role) — a hydration mismatch. Delay that branch until
    // after mount, same pattern as UserMenu.tsx / ArrearCollectionClient.tsx.
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [branchName, setBranchName] = useState('');
    const [isLoadingBranches, setIsLoadingBranches] = useState(false);

    // State
    const [centers, setCenters] = useState<Center[]>([]);
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [collectionDate, setCollectionDate] = useState(getTodayDate());
    const [demandData, setDemandData] = useState<DemandData | null>(null);
    const [pendingLevel2Count, setPendingLevel2Count] = useState(0);
    const [collectionAmounts, setCollectionAmounts] = useState<Record<string, string>>({});
    const [savingsAmounts, setSavingsAmounts] = useState<Record<string, string>>({});
    const [clientAttendance, setClientAttendance] = useState<Record<string, boolean>>({});
    const [is100Collection, setIs100Collection] = useState(false);
    const [is100Attendance, setIs100Attendance] = useState(false);
    const [is100LoanAdvance, setIs100LoanAdvance] = useState(false);
    const [isCollectionSubmitted, setIsCollectionSubmitted] = useState(false);
    const [selectedClients, setSelectedClients] = useState<Record<string, boolean>>({});

    // Wizard: collect (existing table) -> photo (meeting photo capture) -> denomination (cash count)
    const [step, setStep] = useState<'collect' | 'photo' | 'denomination'>('collect');
    const [pendingCollections, setPendingCollections] = useState<Array<{
        loanId: string;
        amountCollected: number;
        savingsCollected: number;
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
    // Receipt State
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [savedBatchData, setSavedBatchData] = useState<any>(null);
    const receiptRef = useRef<HTMLDivElement>(null);

    const handlePrint = useReactToPrint({
        contentRef: receiptRef,
    });

    const handleDownloadPDF = async () => {
        if (!savedBatchData) return;

        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [80, 200] // Thermal printer width 80mm
        });
        const reportFont = await ensureReportFont(doc);

        const data = savedBatchData;
        const margin = 5;

        try {
            let y = await drawPdfReportHeader(doc, 'COLLECTION RECEIPT', {
                subtitle: 'Empowering Communities, Changing Lives  •  Salem, TN | Support: 1800-XXX-XXXX',
                fontFamily: reportFont,
            });

            // Batch Info
            doc.setFontSize(7);
            doc.setFont(reportFont, 'normal');
            doc.text(`Batch ID: ${data.batchId}`, margin, y); y += 4;
            doc.text(`Center: ${data.centerName} (${data.centerCode})`, margin, y); y += 4;
            doc.text(`Date: ${format(new Date(data.collectionDate), 'dd/MM/yyyy')}`, margin, y); y += 4;
            doc.text(`FDO: ${data.collectedBy}`, margin, y); y += 6;

            doc.line(margin, y, 75, y);
            y += 2;

            // Items Table
            autoTable(doc, {
                startY: y,
                margin: { left: margin, right: margin },
                head: [['Client', 'Inst', 'Loan', 'Loan Adv']],
                body: data.items.map((item: any) => [
                    `${item.clientName}\n${item.loanNumber}`,
                    `#${item.installmentNo}`,
                    `INR ${item.amountCollected.toFixed(2)}`,
                    item.savingsCollected > 0 ? `INR ${item.savingsCollected.toFixed(2)}` : '-'
                ]),
                theme: 'plain',
                styles: { font: reportFont, fontSize: 6, cellPadding: 1 },
                headStyles: { font: reportFont, fontStyle: 'bold' },
                columnStyles: {
                    0: { cellWidth: 30 },
                    1: { cellWidth: 8, halign: 'center' },
                    2: { cellWidth: 16, halign: 'right' },
                    3: { cellWidth: 16, halign: 'right' }
                }
            });

            y = (doc as any).lastAutoTable.finalY + 5;

            doc.setLineDashPattern([], 0);
            const hasSavings = (data.totalSavings ?? 0) > 0;

            // Loan collection row
            doc.setFillColor(245, 245, 245);
            doc.rect(margin, y, 70, 7, 'F');
            doc.setFontSize(7);
            doc.setFont(reportFont, 'bold');
            doc.text('LOAN COLLECTION', margin + 2, y + 4.5);
            doc.text(`INR ${data.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 73, y + 4.5, { align: 'right' });
            y += 8;

            // Savings collection row
            if (hasSavings) {
                doc.setFillColor(236, 253, 245);
                doc.rect(margin, y, 70, 7, 'F');
                doc.setTextColor(6, 95, 70);
                doc.text('LOAN ADVANCE COLLECTION', margin + 2, y + 4.5);
                doc.text(`INR ${(data.totalSavings!).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 73, y + 4.5, { align: 'right' });
                doc.setTextColor(0, 0, 0);
                y += 8;
            }

            // Grand total row
            doc.setFillColor(220, 220, 220);
            doc.rect(margin, y, 70, 8, 'F');
            doc.setFontSize(8);
            doc.setFont(reportFont, 'bold');
            doc.text('TOTAL COLLECTED', margin + 2, y + 5.5);
            const grandTotal = data.totalAmount + (data.totalSavings ?? 0);
            doc.text(`INR ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 73, y + 5.5, { align: 'right' });
            y += 15;

            // Success Badge
            doc.setDrawColor(16, 185, 129); // emerald-500
            doc.setFillColor(236, 253, 245);
            doc.roundedRect(20, y, 40, 8, 2, 2, 'FD');
            doc.setTextColor(6, 95, 70);
            doc.setFontSize(7);
            doc.text('PAYMENT SUCCESSFUL', 40, y + 5.5, { align: 'center' });
            y += 15;

            // Footer
            doc.setTextColor(150, 150, 150);
            doc.setFontSize(6);
            doc.text('SYSTEM GENERATED', 40, y, { align: 'center' });
            y += 4;
            doc.text(format(new Date(), 'dd/MM/yyyy HH:mm:ss'), 40, y, { align: 'center' });

            doc.save(`Receipt_${data.batchId}.pdf`);
            toast({
                title: 'Success',
                description: 'Receipt downloaded successfully.',
            });
        } catch (error) {
            console.error('PDF Error:', error);
            toast({
                title: 'Error',
                description: 'Failed to generate PDF.',
                variant: 'destructive',
            });
        }
    };
    */

    // Loading states
    const [isLoadingCenters, setIsLoadingCenters] = useState(true);
    const [isLoadingDemand, setIsLoadingDemand] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch PENDING_LEVEL2 (AM not yet approved) count whenever center changes
    useEffect(() => {
        if (!selectedCenterId) {
            setPendingLevel2Count(0);
            return;
        }
        fetch(`/api/disbursements/pending-level2?centerId=${selectedCenterId}`)
            .then((r) => r.json())
            .then((d) => {
                const data = d?.data ?? d;
                // The endpoint returns { totalPendingClients, totalAmount, ... } or similar
                const count =
                    typeof data?.totalPendingClients === 'number'
                        ? data.totalPendingClients
                        : typeof data?.totalClients === 'number'
                        ? data.totalClients
                        : typeof data?.count === 'number'
                        ? data.count
                        : 0;
                setPendingLevel2Count(count);
            })
            .catch(() => setPendingLevel2Count(0));
    }, [selectedCenterId]);

    // Load branches on mount — the endpoint resolves the branch's current
    // EOD working date server-side and returns only eligible centers for it.
    useEffect(() => {
        loadBranches();
    }, []);

    // Fetch centers whenever the selected branch changes
    useEffect(() => {
        if (selectedBranchId) {
            setSelectedCenterId('');
            setCenters([]);
            fetchCenters(selectedBranchId);
        }
    }, [selectedBranchId]);

    // Fetch demand data when center or date changes
    useEffect(() => {
        if (selectedCenterId && collectionDate) {
            fetchDemandData();
        } else {
            setDemandData(null);
            setCollectionAmounts({});
            setSavingsAmounts({});
        }
    }, [selectedCenterId, collectionDate]);

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
                const match = list.find((b) => b.id === preferredId) ?? list[0];
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
            const result = await apiClient.get<{ collectionDate: string; centers: Center[] }>(
                `/collections/demand/centers?branchId=${branchId}`
            );

            if (result.success && result.data) {
                const { collectionDate: resolvedDate, centers: eligibleCenters } = result.data;
                setCenters(eligibleCenters);
                if (resolvedDate && /^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)) {
                    setCollectionDate(resolvedDate);
                }
                if (eligibleCenters.length === 1 && !selectedCenterId) {
                    setSelectedCenterId(eligibleCenters[0].id);
                } else if (selectedCenterId && !eligibleCenters.some((c) => c.id === selectedCenterId)) {
                    // Previously selected center is no longer eligible (e.g. fully collected)
                    setSelectedCenterId('');
                }
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to load centers.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingCenters(false);
        }
    };

    const fetchDemandData = async () => {
        setIsLoadingDemand(true);
        try {
            setIsCollectionSubmitted(false);
            const result = await apiClient.get<DemandData>(
                `/collections/demand?centerId=${selectedCenterId}&collectionDate=${collectionDate}`
            );

            if (result.success && result.data) {
                setDemandData(result.data);

                // State-aware initialization:
                // Pre-fill with already collected amount for the selected center/date,
                // so users cannot unknowingly duplicate collections.
                const initialAmounts: Record<string, string> = {};
                const initialSavings: Record<string, string> = {};
                const initialAttendance: Record<string, boolean> = {};
                const initialSelected: Record<string, boolean> = {};

                result.data.collections.forEach((item) => {
                    // Prefill with the NET remaining balance — Collect Amt is the
                    // amount to collect in THIS submission, not a cumulative total.
                    initialAmounts[item.loanId] = String(Number(item.remainingDue.toFixed(2)));
                    initialSavings[item.loanId] = String(item.savingsCurrentDemand || 0);
                    initialAttendance[item.clientId] = is100Attendance ? true : false;
                    // Pre-select clients that still have remaining demand; COLLECTED ones are excluded
                    initialSelected[item.loanId] = item.remainingDue > 0;
                });

                setCollectionAmounts(initialAmounts);
                setSavingsAmounts(initialSavings);
                setClientAttendance(initialAttendance);
                setSelectedClients(initialSelected);

                toast({
                    title: 'Success',
                    description: result.message || 'Demand data loaded successfully.',
                });

                // Check if collection is already submitted by fetching history
                try {
                    const historyResult = await apiClient.patch<any>(
                        `/collections/demand?centerId=${selectedCenterId}&date=${collectionDate}`,
                        {}
                    );
                    if (historyResult.success && historyResult.data && Array.isArray(historyResult.data) && historyResult.data.length > 0) {
                        setIsCollectionSubmitted(true);
                    }
                } catch (historyError) {
                    // Silently ignore history check errors
                }
            } else {
                toast({
                    title: 'Info',
                    description: result.error || 'No pending collections found.',
                });
                setDemandData(null);
                setCollectionAmounts({});
                setSavingsAmounts({});
                setClientAttendance({});
                setSelectedClients({});

                // Still check if collection was submitted even if no data
                try {
                    const historyResult = await apiClient.patch<any>(
                        `/collections/demand?centerId=${selectedCenterId}&date=${collectionDate}`,
                        {}
                    );
                    if (historyResult.success && historyResult.data && Array.isArray(historyResult.data) && historyResult.data.length > 0) {
                        setIsCollectionSubmitted(true);
                    }
                } catch (historyError) {
                    // Silently ignore history check errors
                }
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Failed to load demand data.',
                variant: 'destructive',
            });
            setDemandData(null);
        } finally {
            setIsLoadingDemand(false);
        }
    };

    const handleCollectionAmountChange = (loanId: string, value: string) => {
        setCollectionAmounts((prev) => ({
            ...prev,
            [loanId]: value,
        }));
    };

    const handleAttendanceChange = (clientId: string, isPresent: boolean) => {
        setClientAttendance((prev) => ({
            ...prev,
            [clientId]: isPresent,
        }));
    };

    const handleToggle100Collection = (checked: boolean) => {
        if (demandData) {
            const newAmounts: Record<string, string> = {};
            if (checked) {
                // Apply 100% collection ONLY to selected clients
                demandData.collections.forEach((item) => {
                    if (selectedClients[item.loanId]) {
                        newAmounts[item.loanId] = item.totalDemand.toString();
                    }
                });
                setCollectionAmounts(prev => ({ ...prev, ...newAmounts }));
            } else {
                // Return to default (totalDemand) for all clients when unchecked
                demandData.collections.forEach((item) => {
                    newAmounts[item.loanId] = String(Number(item.totalDemand.toFixed(2)));
                });
                setCollectionAmounts(newAmounts);
            }
        }
        setIs100Collection(checked);
    };

    const handleToggle100Attendance = (checked: boolean) => {
        if (demandData) {
            if (checked) {
                // Apply 100% attendance ONLY to selected clients
                const newAttendance: Record<string, boolean> = {};
                demandData.collections.forEach((item) => {
                    if (selectedClients[item.loanId]) {
                        newAttendance[item.clientId] = true;
                    }
                });
                setClientAttendance(prev => ({ ...prev, ...newAttendance }));
            } else {
                // Return to default (not present) for all clients when unchecked
                const newAttendance: Record<string, boolean> = {};
                demandData.collections.forEach((item) => {
                    newAttendance[item.clientId] = false;
                });
                setClientAttendance(newAttendance);
            }
        }
        setIs100Attendance(checked);
    };

    const handleToggle100LoanAdvance = (checked: boolean) => {
        if (demandData) {
            const newAmounts: Record<string, string> = {};
            if (checked) {
                // Apply 100% loan advance ONLY to selected clients
                demandData.collections.forEach((item) => {
                    if (selectedClients[item.loanId]) {
                        newAmounts[item.loanId] = item.savingsCurrentDemand.toString();
                    }
                });
                setSavingsAmounts(prev => ({ ...prev, ...newAmounts }));
            } else {
                // Return to default (savingsCurrentDemand) for all clients when unchecked
                demandData.collections.forEach((item) => {
                    newAmounts[item.loanId] = String(item.savingsCurrentDemand || 0);
                });
                setSavingsAmounts(newAmounts);
            }
        }
        setIs100LoanAdvance(checked);
    };

    // Step 1 -> Step 2: validate & stash the collections array, then move to photo capture.
    // Nothing is persisted yet — the batch is only created once all 3 steps are done.
    const handleContinueToPhoto = () => {
        if (!demandData || !selectedCenterId) {
            toast({
                title: 'Error',
                description: 'Please select a center and load demand data first.',
                variant: 'destructive',
            });
            return;
        }

        const validationErrors: string[] = [];
        const collections: Array<{
            loanId: string;
            amountCollected: number;
            savingsCollected: number;
            paymentMode: string;
            remarks: string;
        }> = [];

        for (const item of demandData.collections) {
            // Skip unchecked clients
            if (!selectedClients[item.loanId]) continue;

            const rawAmount = collectionAmounts[item.loanId] || '0';
            const amount = parseFloat(rawAmount);

            if (isNaN(amount) || amount <= 0) continue;

            if (amount > item.remainingDue * 1.001) {
                validationErrors.push(
                    `${item.clientName} (Loan ${item.loanNumber}): ₹${amount} exceeds remaining due ₹${item.remainingDue}`
                );
                continue;
            }

            if (!item.loanId) {
                validationErrors.push(
                    `${item.clientName}: Missing loan reference`
                );
                continue;
            }

            const rawSavings = loanAdvanceEnabled
                ? (savingsAmounts[item.loanId] || String(item.savingsCurrentDemand || 0))
                : '0';
            const savingsCollected = Math.max(0, Math.min(parseFloat(rawSavings) || 0, item.totalSavingsDue || 0));

            collections.push({
                loanId: item.loanId,
                amountCollected: Number(amount.toFixed(2)),
                savingsCollected: Number(savingsCollected.toFixed(2)),
                paymentMode: 'CASH',
                remarks: `Demand collection`,
            });
        }

        if (validationErrors.length > 0) {
            toast({
                title: 'Validation Errors',
                description: validationErrors.join('\n'),
                variant: 'destructive',
            });
            return;
        }

        if (collections.length === 0) {
            toast({
                title: 'No Collections',
                description: 'Please enter collection amounts for at least one client.',
                variant: 'destructive',
            });
            return;
        }

        const cashTotal = collections.reduce((sum, c) => sum + c.amountCollected + c.savingsCollected, 0);
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
        if (!demandData || !selectedCenterId || !pendingCollections || !meetingPhotoFile) {
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
                description: `Denomination total (₹${denomTotalEntered.toFixed(2)}) must match collected cash (₹${pendingCashTotal.toFixed(2)}).`,
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

            const result = await apiClient.post('/collections/demand', formData);

            if (result.success) {
                const responseData = result.data as any;

                // TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
                /*
                const collections = pendingCollections;

                const totalSavingsCollected = collections.reduce((sum, c) => sum + c.savingsCollected, 0);

                const batchReceiptData = {
                    branchId: branchStorage.getActiveBranch()?.id || '',
                    branchName: branchStorage.getActiveBranch()?.name || '',
                    centerName: demandData.summary.centerName,
                    centerCode: demandData.summary.centerCode,
                    collectionDate: collectionDate,
                    collectionTime: format(new Date(), 'hh:mm a'),
                    collectedBy: tokenStorage.getUser()?.firstName || 'System',
                    totalAmount: totalCollected,
                    totalSavings: totalSavingsCollected,
                    items: collections.map(c => {
                        const originalItem = demandData.collections.find(d => d.loanId === c.loanId);
                        return {
                            clientName: originalItem?.clientName || 'Unknown',
                            clientCode: originalItem?.clientCode || '',
                            loanNumber: originalItem?.loanNumber || '',
                            installmentNo: originalItem?.installmentNo || 0,
                            amountCollected: c.amountCollected,
                            savingsCollected: c.savingsCollected,
                            paymentMode: c.paymentMode
                        };
                    }),
                };

                setSavedBatchData(batchReceiptData);
                setShowReceiptModal(true);
                */

                const warnings = responseData.warnings as string[] | undefined;
                toast({
                    title: 'Success',
                    description: warnings?.length
                        ? `${result.message} (${warnings.join(', ')})`
                        : (result.message || 'Collections submitted for Review.'),
                });

                setCollectionAmounts({});
                setSavingsAmounts({});
                setPendingCollections(null);
                setPendingCashTotal(0);
                if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
                setMeetingPhotoFile(null);
                setMeetingPhotoPreviewUrl(null);
                setPhotoLocation(null);
                setDenomCounts({ d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '' });
                setDenomUpi('');
                setStep('collect');
                await fetchDemandData();
            } else {
                toast({
                    title: 'Submission Failed',
                    description: result.error || 'Failed to submit collections. Please try again.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to submit collections.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReset = () => {
        setSelectedCenterId('');
        if (selectedBranchId) fetchCenters(selectedBranchId);
        setDemandData(null);
        setPendingLevel2Count(0);
        setCollectionAmounts({});
        setSavingsAmounts({});
        setClientAttendance({});
        setSelectedClients({});
        setIs100Collection(false);
        setIs100Attendance(false);
        setStep('collect');
        setPendingCollections(null);
        setPendingCashTotal(0);
        if (meetingPhotoPreviewUrl) URL.revokeObjectURL(meetingPhotoPreviewUrl);
        setMeetingPhotoFile(null);
        setMeetingPhotoPreviewUrl(null);
        setPhotoLocation(null);
        setDenomCounts({ d500: '', d200: '', d100: '', d50: '', d20: '', d10: '', d5: '', d2: '', d1: '' });
        setDenomUpi('');

        toast({
            title: 'Reset',
            description: 'Form has been reset.',
        });
    };

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(demandData?.collections ?? []);

    // Calculate totals
    const totalCollected = demandData
        ? demandData.collections.reduce((sum, item) => {
            const amount = parseFloat(collectionAmounts[item.loanId] || '0');
            return sum + amount;
        }, 0)
        : 0;

    const totalSavings = demandData && loanAdvanceEnabled
        ? demandData.collections.reduce((sum, item) => {
            const amount = parseFloat(savingsAmounts[item.loanId] ?? String(item.savingsCurrentDemand || 0));
            return sum + (isNaN(amount) ? 0 : amount);
        }, 0)
        : 0;

    const collectionPercentage = demandData && demandData.summary.totalDemand > 0
        ? (totalCollected / demandData.summary.totalDemand) * 100
        : 0;

    const getCollectionBreakdown = (item: CollectionItem) => {
        const entered = parseFloat(collectionAmounts[item.loanId] || '0') || 0;
        if (entered <= 0) {
            return {
                arrearPrincipal: item.arrearPrincipal,
                arrearInterest: item.arrearInterest,
                // Show today's scheduled remaining (expected) demand by default
                currentDemandPrincipal: item.currentDemandPrincipal,
                currentDemandInterest: item.currentDemandInterest,
            };
        }

        const alloc = allocateCollectionAmount({
            amount: entered,
            penalty: item.penaltiesDue,
            fees: item.feesDue,
            arrearInterest: item.arrearInterest,
            arrearPrincipal: item.arrearPrincipal,
            currentDemandInterest: item.currentDemandInterest,
            currentDemandPrincipal: item.currentDemandPrincipal,
        });

        return {
            // Remaining arrears after partial coverage
            arrearPrincipal: Math.max(0, item.arrearPrincipal - alloc.appliedArrearPrincipal),
            arrearInterest: Math.max(0, item.arrearInterest - alloc.appliedArrearInterest),
            // Remaining current demand (scheduled for selected collection date) after allocation
            currentDemandPrincipal: Math.max(0, item.currentDemandPrincipal - alloc.appliedCurrentPrincipal),
            currentDemandInterest: Math.max(0, item.currentDemandInterest - alloc.appliedCurrentInterest),
        };
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-brand-green-darker to-sidebar-accent dark:from-slate-50 dark:to-slate-300 bg-clip-text text-transparent">
                    Demand Collection
                </h1>
                <p className="text-muted-foreground">
                    Collect scheduled loan repayments from clients during center meetings
                </p>
            </div>

            {/* Centers/working-date loading indicator */}
            {isLoadingCenters && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-green-50 px-4 py-2.5 text-sm text-sidebar-accent dark:border-brand-green-darker/50 dark:bg-green-950/30 dark:text-green-200">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                    <span>Loading centers and business date…</span>
                </div>
            )}

            {/* PENDING_LEVEL2 restriction banner — AM has not yet approved disbursement */}
            {pendingLevel2Count > 0 && (
                <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                        <p className="font-semibold text-sm">
                            AM Approval Pending — {pendingLevel2Count} client loan(s) not yet disbursed
                        </p>
                        <p className="text-xs mt-0.5 text-amber-800 dark:text-amber-200">
                            These loans are awaiting Area Manager (Level 2) approval before disbursement is
                            complete. They will <strong>not appear</strong> in the collection list below until
                            the AM approves them. Ask the Area Manager to approve from the Disbursement page.
                        </p>
                    </div>
                </div>
            )}

            {/* Selection Card */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />

                <CardHeader className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                            <Receipt className="h-5 w-5 text-primary dark:text-primary" />
                        </div>
                        <div>
                            <CardTitle className="text-xl">Collection Details</CardTitle>
                            <CardDescription>
                                Select center and date to view pending collections
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {/* Branch Selection — visible only for Admin / Area Manager */}
                        {!mounted ? (
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Branch</Label>
                                <div className="flex h-11 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground" />
                            </div>
                        ) : isAdminOrAM ? (
                            <div className="space-y-2">
                                <Label htmlFor="branch" className="text-sm font-medium">
                                    Branch
                                </Label>
                                <Select
                                    value={selectedBranchId}
                                    onValueChange={setSelectedBranchId}
                                    disabled={isLoadingBranches || branches.length === 0}
                                >
                                    <SelectTrigger id="branch" className="h-11">
                                        <SelectValue placeholder="-- SELECT BRANCH --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
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

                        {/* Center Selection */}
                        <div className="space-y-2">
                            <Label htmlFor="center" className="text-sm font-medium">
                                Center Name
                            </Label>
                            <Select
                                value={selectedCenterId}
                                onValueChange={setSelectedCenterId}
                                disabled={isLoadingCenters || centers.length === 0 || !selectedBranchId}
                            >
                                <SelectTrigger id="center" className="h-11">
                                    <SelectValue placeholder="-- SELECT CENTER --" />
                                </SelectTrigger>
                                <SelectContent>
                                    {centers.map((center) => (
                                        <SelectItem key={center.id} value={center.id}>
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{center.name}</span>
                                                <span className="text-muted-foreground">({center.code})</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!isLoadingCenters && centers.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    No centers have pending collections for today&apos;s meeting day.
                                </p>
                            )}
                        </div>

                        {/* Collection Date */}
                        <div className="space-y-2">
                            <Label htmlFor="date" className="text-sm font-medium">
                                Collection Date
                            </Label>
                            <div className="relative">
                                <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <DateInput
                                    id="date"
                                    value={collectionDate}
                                    readOnly
                                    disabled
                                    className="bg-muted cursor-not-allowed h-11 pr-9"
                                />
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-end gap-2">
                            <Button
                                onClick={fetchDemandData}
                                disabled={!selectedCenterId || !collectionDate || isLoadingDemand}
                                className="flex-1 h-11"
                            >
                                {isLoadingDemand ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Loading...
                                    </>
                                ) : (
                                    <>
                                        <TrendingUp className="mr-2 h-4 w-4" />
                                        Load Data
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Cards */}
            {demandData && (
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Total Clients</p>
                                        <p className="text-2xl font-bold">{demandData.summary.totalClients}</p>
                                    </div>
                                    <Users className="h-8 w-8 text-primary" />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="pt-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Total Demand</p>
                                        <p className="text-2xl font-bold">{formatCurrency(demandData.summary.totalDemand)}</p>
                                    </div>
                                    <IndianRupee className="h-8 w-8 text-green-500" />
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
                                        <p className="text-sm font-medium text-muted-foreground">Collection %</p>
                                        <p className="text-2xl font-bold">{collectionPercentage.toFixed(1)}%</p>
                                    </div>
                                    <TrendingUp className="h-8 w-8 text-purple-500" />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Arrear / Current Demand Breakdown */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="border-rose-200/60 dark:border-rose-800/40">
                            <CardContent className="pt-4 pb-4">
                                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Arrear Principal</p>
                                <p className="text-lg font-semibold">{formatCurrency(demandData.summary.totalArrearPrincipal)}</p>
                            </CardContent>
                        </Card>
                        <Card className="border-rose-200/60 dark:border-rose-800/40">
                            <CardContent className="pt-4 pb-4">
                                <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Arrear Interest</p>
                                <p className="text-lg font-semibold">{formatCurrency(demandData.summary.totalArrearInterest)}</p>
                            </CardContent>
                        </Card>
                        <Card className="border-primary/30/60 dark:border-sidebar-accent/40">
                            <CardContent className="pt-4 pb-4">
                                <p className="text-xs font-medium text-primary dark:text-primary">Cur. Demand Principal</p>
                                <p className="text-lg font-semibold">{formatCurrency(demandData.summary.totalCurrentDemandPrincipal)}</p>
                            </CardContent>
                        </Card>
                        <Card className="border-primary/30/60 dark:border-sidebar-accent/40">
                            <CardContent className="pt-4 pb-4">
                                <p className="text-xs font-medium text-primary dark:text-primary">Cur. Demand Interest</p>
                                <p className="text-lg font-semibold">{formatCurrency(demandData.summary.totalCurrentDemandInterest)}</p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            )}
{/* Collection Already Submitted Banner */}
{isCollectionSubmitted && (
    <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100">
        <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <div>
            <p className="font-semibold">
                A collection batch has already been submitted for this center on this date.
            </p>
            <p className="text-xs mt-1 text-amber-700 dark:text-amber-200">
                Uncollected clients below can still be submitted for additional collection.
            </p>
        </div>
    </div>
)}

{/* Collections Table */}
{step === 'collect' && demandData && demandData.collections.length > 0 && (
    <Card>
        <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <CardTitle>Client Collections</CardTitle>
                    <CardDescription className="flex items-center gap-4 flex-wrap mt-1">
                        Enter collection amounts and mark attendance
                        {/* Legend */}
                        <span className="flex items-center gap-1.5 text-xs">
                            <span className="inline-block h-3 w-4 rounded-sm border border-amber-400 bg-amber-100 dark:bg-amber-900/50" />
                            <span className="text-amber-700 dark:text-amber-300 font-medium">Gold Loan</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-xs">
                            <span className="inline-block h-3 w-4 rounded-sm border border-rose-300 bg-rose-50 dark:bg-rose-950/30" />
                            <span className="text-rose-600 dark:text-rose-400 font-medium">Overdue</span>
                        </span>
                    </CardDescription>
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                    <TableSearchInput
                        value={tableSearchQuery}
                        onChange={setTableSearchQuery}
                        placeholder="Search collections..."
                    />
                    <div className="flex items-center gap-2">
                        <Switch
                            id="present-100"
                            checked={is100Attendance}
                            onCheckedChange={handleToggle100Attendance}
                            disabled={isSubmitting}
                        />
                        <Label htmlFor="present-100" className="text-sm font-medium cursor-pointer">
                            100% Present
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="collect-100"
                            checked={is100Collection}
                            onCheckedChange={handleToggle100Collection}
                            disabled={isSubmitting}
                        />
                        <Label htmlFor="collect-100" className="text-sm font-medium cursor-pointer">
                            100% Collection
                        </Label>
                    </div>
                    {loanAdvanceEnabled && (
                        <div className="flex items-center gap-2">
                            <Switch
                                id="loan-advance-100"
                                checked={is100LoanAdvance}
                                onCheckedChange={handleToggle100LoanAdvance}
                                disabled={isSubmitting}
                            />
                            <Label htmlFor="loan-advance-100" className="text-sm font-medium cursor-pointer">
                                100% Loan Advance
                            </Label>
                        </div>
                    )}
                </div>
            </div>
        </CardHeader>
        <CardContent>
            <TooltipProvider delayDuration={200}>
                <div className="rounded-md border overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {/* Select All Checkbox Column */}
                                <TableHead className="w-[48px] min-w-[48px] sticky left-0 bg-background z-20">
                                    <Checkbox
                                        checked={
                                            demandData.collections.length > 0 &&
                                            demandData.collections
                                                .filter(i => i.remainingDue > 0)
                                                .every(i => selectedClients[i.loanId])
                                        }
                                        onCheckedChange={(checked) => {
                                            const update: Record<string, boolean> = {};
                                            demandData.collections.forEach(i => {
                                                if (i.remainingDue > 0) {
                                                    update[i.loanId] = !!checked;
                                                }
                                            });
                                            setSelectedClients(prev => ({ ...prev, ...update }));
                                            if (!checked) {
                                                setCollectionAmounts(prev => {
                                                    const next = { ...prev };
                                                    demandData.collections.forEach(i => {
                                                        if (i.remainingDue > 0) {
                                                            next[i.loanId] = '0';
                                                        }
                                                    });
                                                    return next;
                                                });
                                                setSavingsAmounts(prev => {
                                                    const next = { ...prev };
                                                    demandData.collections.forEach(i => {
                                                        if (i.remainingDue > 0) {
                                                            next[i.loanId] = '0';
                                                        }
                                                    });
                                                    return next;
                                                });
                                            } else {
                                                setCollectionAmounts(prev => {
                                                    const next = { ...prev };
                                                    demandData.collections.forEach(i => {
                                                        if (i.remainingDue > 0) {
                                                            next[i.loanId] = String(Number(i.totalDemand.toFixed(2)));
                                                        }
                                                    });
                                                    return next;
                                                });
                                                setSavingsAmounts(prev => {
                                                    const next = { ...prev };
                                                    demandData.collections.forEach(i => {
                                                        if (i.remainingDue > 0) {
                                                            next[i.loanId] = String(i.savingsCurrentDemand || 0);
                                                        }
                                                    });
                                                    return next;
                                                });
                                            }
                                        }}
                                        disabled={isSubmitting}
                                    />
                                </TableHead>

                                {/* Serial Number Column - Fixed width 60px */}
                                <TableHead className="w-[60px] min-w-[60px] max-w-[60px] sticky left-[48px] bg-background z-20">
                                    #
                                </TableHead>
                                
                                {/* Client Name Column - Fixed min-width 220px, starts after checkbox + serial */}
                                <TableHead className="min-w-[220px] w-[220px] sticky left-[108px] bg-background z-20">
                                    Client Name
                                </TableHead>
                                <TableHead className="min-w-[110px]">Mobile</TableHead>
                                
                                <TableHead className="min-w-[100px]">Loan No.</TableHead>
                                <TableHead className="text-center min-w-[60px]">Inst.</TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">OS Pri</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Outstanding Principal (Loan Level)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">OS Int</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Outstanding Interest (Loan Level)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Due Pri</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Due Principal — original amount due today, before any of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Due Int</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Due Interest — original amount due today, before any of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground text-rose-600 dark:text-rose-400">Arr Pri</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Arrears Principal (Past Unpaid Installments) — net of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[100px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground text-rose-600 dark:text-rose-400">Arr Int</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Arrears Interest (Past Unpaid Installments) — net of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground text-primary dark:text-primary">Cur Dmd Pri</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Current Demand Principal (Scheduled for selected date) — net of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground text-primary dark:text-primary">Cur Dmd Int</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Current Demand Interest (Scheduled for selected date) — net of today&apos;s collections</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px] font-semibold">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Total Due</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Total Remaining Due — net of today&apos;s already-collected amounts</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Already Collected</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Amount already collected today for this due (pending BM approval or approved)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Rem Principal</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Principal (Arrear + Current, net of today&apos;s collections)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                <TableHead className="text-right min-w-[110px]">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="cursor-help border-b border-dotted border-muted-foreground">Rem Interest</span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Remaining Interest (Arrear + Current, net of today&apos;s collections)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TableHead>
                                {loanAdvanceEnabled && (
                                    <>
                                        <TableHead className="text-right min-w-[120px]">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="cursor-help border-b border-dotted border-muted-foreground text-emerald-600 dark:text-emerald-400">Loan Advance</span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Loan Advance (Current Installment) — remaining, net of today&apos;s collections</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TableHead>
                                        <TableHead className="text-right min-w-[120px]">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="cursor-help border-b border-dotted border-muted-foreground text-emerald-600 dark:text-emerald-400">Loan Adv Adjusted</span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Loan Advance already collected today (pending BM approval or approved)</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TableHead>
                                        <TableHead className="text-right min-w-[120px]">Loan Adv Collect</TableHead>
                                    </>
                                )}
                                <TableHead className="text-center min-w-[100px]">Attend.</TableHead>
                                <TableHead className="text-right min-w-[140px]">Collect Amt</TableHead>
                                <TableHead className="min-w-[100px]">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {searchedRows.map((item, index) => {
                                const breakdown = getCollectionBreakdown(item);
                                const isGold = isGoldLoanType(item.loanProductTypeName);
                                return (
                                    <TableRow
                                        key={item.loanId}
                                        className={cn(
                                            isGold
                                                ? 'bg-amber-50 dark:bg-amber-950/30 border-l-2 border-l-amber-400 dark:border-l-amber-600'
                                                : item.isOverdue
                                                    ? 'bg-rose-50/40 dark:bg-rose-950/20'
                                                    : '',
                                            'hover:bg-muted/50 transition-colors'
                                        )}
                                    >
                                        {/* Checkbox Cell */}
                                        <TableCell className="w-[48px] min-w-[48px] sticky left-0 bg-background z-10">
                                            <Checkbox
                                                checked={selectedClients[item.loanId] ?? false}
                                                onCheckedChange={(checked) => {
                                                    setSelectedClients(prev => ({ ...prev, [item.loanId]: !!checked }));
                                                    if (!checked) {
                                                        setCollectionAmounts(prev => ({ ...prev, [item.loanId]: '0' }));
                                                        setSavingsAmounts(prev => ({ ...prev, [item.loanId]: '0' }));
                                                    } else {
                                                        setCollectionAmounts(prev => ({ ...prev, [item.loanId]: String(Number(item.totalDemand.toFixed(2))) }));
                                                        setSavingsAmounts(prev => ({ ...prev, [item.loanId]: String(item.savingsCurrentDemand || 0) }));
                                                    }
                                                }}
                                                disabled={item.remainingDue === 0 || isSubmitting}
                                            />
                                        </TableCell>

                                        {/* Serial Number Cell - Fixed width 60px */}
                                        <TableCell className="w-[60px] min-w-[60px] max-w-[60px] sticky left-[48px] bg-background z-10 font-medium">
                                            {index + 1}
                                        </TableCell>

                                        {/* Client Name Cell - Fixed min-width 220px with proper text wrapping */}
                                        <TableCell className="min-w-[220px] w-[220px] sticky left-[108px] bg-background z-10">
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
                                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.duePrincipal)}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.dueInterest)}</TableCell>
                                        <TableCell className={cn("text-right text-xs tabular-nums whitespace-nowrap", item.arrearPrincipal > 0 && "text-rose-600 dark:text-rose-400 font-medium")}>{formatCurrency(item.arrearPrincipal)}</TableCell>
                                        <TableCell className={cn("text-right text-xs tabular-nums whitespace-nowrap", item.arrearInterest > 0 && "text-rose-600 dark:text-rose-400 font-medium")}>{formatCurrency(item.arrearInterest)}</TableCell>
                                        <TableCell className={cn("text-right text-xs tabular-nums whitespace-nowrap", item.currentDemandPrincipal > 0 && "text-primary dark:text-primary font-medium")}>{formatCurrency(item.currentDemandPrincipal)}</TableCell>
                                        <TableCell className={cn("text-right text-xs tabular-nums whitespace-nowrap", item.currentDemandInterest > 0 && "text-primary dark:text-primary font-medium")}>{formatCurrency(item.currentDemandInterest)}</TableCell>
                                        <TableCell className="text-right font-semibold text-sm tabular-nums whitespace-nowrap">{formatCurrency(item.totalDemand)}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.collectedAmount)}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.remainingPrincipal)}</TableCell>
                                        <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.remainingInterest)}</TableCell>
                                        {loanAdvanceEnabled && (
                                            <>
                                                <TableCell className={cn("text-right text-xs tabular-nums whitespace-nowrap", (item.savingsCurrentDemand || 0) > 0 && "text-emerald-600 dark:text-emerald-400 font-medium")}>{formatCurrency(item.savingsCurrentDemand || 0)}</TableCell>
                                                <TableCell className="text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(item.loanAdvanceCollectedToday || 0)}</TableCell>
                                                <TableCell className="whitespace-nowrap">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        min="0"
                                                        max={item.totalSavingsDue || 0}
                                                        value={savingsAmounts[item.loanId] ?? String(item.savingsCurrentDemand || 0)}
                                                        onChange={(e) => setSavingsAmounts(prev => ({ ...prev, [item.loanId]: e.target.value }))}
                                                        className="w-28 text-right text-sm"
                                                        disabled={isSubmitting || (item.totalSavingsDue || 0) === 0 || is100LoanAdvance}
                                                    />
                                                </TableCell>
                                            </>
                                        )}
                                        <TableCell className="text-center whitespace-nowrap">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleAttendanceChange(item.clientId, !clientAttendance[item.clientId])}
                                                disabled={isSubmitting || is100Attendance}
                                                className={cn(
                                                    "h-8 px-2",
                                                    clientAttendance[item.clientId] ? "text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100" : "text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100"
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
                                                onChange={(e) => handleCollectionAmountChange(item.loanId, e.target.value)}
                                                className="w-32 text-right text-sm"
                                                disabled={isSubmitting || is100Collection || item.remainingDue === 0}
                                            />
                                        </TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {item.status === 'COLLECTED' ? (
                                                <Badge className="bg-emerald-600 hover:bg-emerald-600 whitespace-nowrap">Collected</Badge>
                                            ) : item.status === 'PARTIAL' ? (
                                                <Badge className="bg-amber-600 hover:bg-amber-600 whitespace-nowrap">Partial</Badge>
                                            ) : item.isOverdue ? (
                                                <Badge variant="destructive" className="gap-1 whitespace-nowrap">
                                                    <Clock className="h-3 w-3" />
                                                    Overdue
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="whitespace-nowrap">Pending</Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </TooltipProvider>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-6">
                <div className="flex-1 flex flex-col gap-2">
                    <Button
                        onClick={handleContinueToPhoto}
                        disabled={!canCreateCollection || isSubmitting || totalCollected === 0}
                        className="flex-1 bg-primary hover:bg-primary"
                        size="lg"
                    >
                        <ArrowRight className="mr-2 h-4 w-4" />
                        {loanAdvanceEnabled
                            ? `Continue (${formatCurrency(totalCollected)} + Loan Adv ${formatCurrency(totalSavings)} = ${formatCurrency(totalCollected + totalSavings)})`
                            : `Continue (${formatCurrency(totalCollected)})`}
                    </Button>
                </div>

                <Button
                    onClick={handleReset}
                    disabled={isSubmitting}
                    variant="destructive"
                    size="lg"
                >
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
                            Submit for BM Approval
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
    label="Center Meeting"
/>

            {/* Empty State */}
            {!isLoadingDemand && demandData && demandData.collections.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <AlertCircle className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">No Pending Collections</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            There are no pending collections for this center on the selected date.
                            All installments may be paid or no loans are due.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* No Center Selected State */}
            {!selectedCenterId && !isLoadingCenters && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                        <div className="rounded-full bg-muted p-4 mb-4">
                            <Receipt className="h-8 w-8 text-muted-foreground" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Select a Center</h3>
                        <p className="text-sm text-muted-foreground text-center max-w-md">
                            Please select a center and collection date to view pending collections.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* TEMPORARILY DISABLED (July 2026) - receipt generation commented out per request, needed again in future
            <Dialog open={showReceiptModal} onOpenChange={setShowReceiptModal}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Collection Receipt</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col items-center py-4 max-h-[70vh] overflow-y-auto">
                        {savedBatchData && (
                            <CollectionReceipt
                                ref={receiptRef}
                                batchData={savedBatchData}
                            />
                        )}
                    </div>
                    <DialogFooter className="flex-row gap-2 sm:justify-end">
                        <Button
                            variant="outline"
                            onClick={() => setShowReceiptModal(false)}
                            className="flex-1 sm:flex-none"
                        >
                            Close
                        </Button>
                        <Button
                            onClick={() => handleDownloadPDF()}
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