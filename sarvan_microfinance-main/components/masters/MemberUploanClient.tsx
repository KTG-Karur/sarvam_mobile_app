'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useToast } from '@/app/hooks/use-toast';
import { Upload, Download, Loader2, FileText, X, CheckCircle2, RefreshCw, FileSpreadsheet, Plus, Trash2, Bug, Clock } from 'lucide-react';
import { UPLOAN_TEMPLATE_HEADERS } from '@/app/lib/services/uploan-import.service';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

interface Branch {
    id: string;
    name: string;
    code: string;
}

type RowStatus = 'VALID' | 'ERROR';

interface GoldLoanDetailsResolved {
    karatType: '24K' | '22K' | '20K' | '18K' | '16K';
    gramCount: number;
    goldTakenValue: number;
    cashGiven: number;
    goldTokenNo?: string;
    itemDescription?: string;
}

interface UploanGridRow {
    rowId: string;
    status: RowStatus;
    errors: string[];
    warnings?: string[];
    resolved?: {
        clientStatus?: 'MATCHED_EXISTING' | 'NEW';
        clientId?: string;
        hasLoanHistory?: boolean;
        isNewUncollectedLoan?: boolean;
        loanAdvanceOutstanding?: number;
        goldLoanDetails?: GoldLoanDetailsResolved;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

const KARAT_TYPES: GoldLoanDetailsResolved['karatType'][] = ['24K', '22K', '20K', '18K', '16K'];

interface CenterSummary {
    key: string;
    name: string;
    status: 'MATCHED' | 'NEW';
    id?: string;
    meetingDay?: string | null;
    meetingTime?: string | null;
    address?: string | null;
    localArea?: string | null;
    rowCount: number;
}

type CenterEditableField = 'meetingDay' | 'meetingTime' | 'address' | 'localArea';

interface GroupSummary {
    key: string;
    centerKey: string;
    centerName: string;
    legacyGroupName: string;
    status: 'MATCHED' | 'NEW';
    id?: string;
    rowCount: number;
}

interface PreviewResult {
    centers: CenterSummary[];
    groups: GroupSummary[];
    rows: UploanGridRow[];
    totalRows: number;
    validRows: number;
    errorRows: number;
}

interface ImportRowResult {
    rowId: string;
    name: string;
    mobileNumber: string;
    status: 'PENDING' | 'CREATED' | 'FAILED';
    reason?: string;
    clientId?: string;
    loanNumber?: string;
}

interface ImportJobStatus {
    jobId: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    totalRows: number;
    createdCount: number;
    failedCount: number;
    pendingCount: number;
    rows: ImportRowResult[];
}

/**
 * Every field the uploan Excel actually carries, grouped for readability —
 * NOT just the handful needed to make a row VALID. Some validation errors
 * (bank account, email, ...) reference fields that must be editable here too,
 * or there's no way to fix them without leaving the grid and re-uploading.
 */
const EDITABLE_FIELD_GROUPS: { label: string; fields: { field: string; label: string }[] }[] = [
    {
        label: 'Identity',
        fields: [
            { field: 'name', label: 'Name' },
            { field: 'mobileNumber', label: 'Mobile' },
            { field: 'email', label: 'Email' },
            { field: 'dateOfBirth', label: 'DOB' },
            { field: 'age', label: 'Age' },
            { field: 'gender', label: 'Gender' },
        ],
    },
    {
        label: 'KYC',
        fields: [
            { field: 'otherIdNo', label: 'Aadhaar' },
            { field: 'pancardNo', label: 'PAN' },
            { field: 'idProofType', label: 'ID Proof' },
            { field: 'idProofNo', label: 'ID Proof No.' },
        ],
    },
    {
        label: 'Family',
        fields: [
            { field: 'caste', label: 'Caste' },
            { field: 'occupation', label: 'Economic Activity' },
            { field: 'spouseName', label: 'Spouse Name' },
            { field: 'spouseDob', label: 'Spouse DOB' },
        ],
    },
    {
        label: 'Nominee',
        fields: [
            { field: 'nomineeName', label: 'Nominee Name' },
            { field: 'nomineeDateOfBirth', label: 'Nominee DOB' },
            { field: 'nomineeAge', label: 'Nominee Age' },
            { field: 'nomineeRelation', label: 'Nominee Relation' },
            { field: 'nomineePhone', label: 'Nominee Phone' },
        ],
    },
    {
        label: 'Address',
        fields: [
            { field: 'address', label: 'Address' },
            { field: 'permanentAddress', label: 'Permanent Address' },
            { field: 'district', label: 'District' },
            { field: 'state', label: 'State' },
            { field: 'country', label: 'Country' },
            { field: 'pincode', label: 'Pincode' },
            { field: 'latitude', label: 'Latitude' },
            { field: 'longitude', label: 'Longitude' },
        ],
    },
    {
        label: 'Center / Group',
        fields: [
            { field: 'branchNameRef', label: 'Branch (file)' },
            { field: 'centerName', label: 'Center' },
            { field: 'groupName', label: 'Group' },
            { field: 'localArea', label: 'Local Area' },
            { field: 'meetingDay', label: 'Meeting Day' },
            { field: 'meetingTime', label: 'Meeting Time' },
            { field: 'fdoName', label: 'Officer Name' },
            { field: 'collectionDay', label: 'Collection Day' },
        ],
    },
    {
        label: 'Status',
        fields: [
            { field: 'memberStatus', label: 'Member Status' },
            { field: 'memberVerified', label: 'Verified' },
        ],
    },
    {
        label: 'Loan',
        fields: [
            { field: 'productTypeName', label: 'Product Type' },
            { field: 'productName', label: 'Product Name' },
            { field: 'productAmountRef', label: 'Product Amount (file)' },
            { field: 'interestRateRef', label: 'Interest Rate (file)' },
            { field: 'installmentsRef', label: 'No. Installments (file)' },
            { field: 'loanPurposeName', label: 'Purpose' },
            { field: 'funderName', label: 'Funding Line' },
            { field: 'disbursementDate', label: 'Disbursed On' },
            { field: 'scheduleStartDate', label: 'Start Date' },
            { field: 'lastRepayDate', label: 'Last Repay Date' },
        ],
    },
    {
        label: 'Loan Financials',
        fields: [
            { field: 'loanPrincipal', label: 'Loan Principal' },
            { field: 'loanInterest', label: 'Loan Interest' },
            { field: 'outstandingPrincipal', label: 'Outstanding Principal' },
            { field: 'outstandingInterest', label: 'Outstanding Interest' },
            { field: 'thrift1', label: 'Thrift 1' },
            { field: 'thrift2', label: 'Thrift 2' },
            { field: 'annualIncome', label: 'Annual Income' },
        ],
    },
    {
        label: 'Bank',
        fields: [
            { field: 'bankAcNo', label: 'Account Number' },
            { field: 'ifscCode', label: 'IFSC Code' },
            { field: 'bankName', label: 'Bank Name' },
            { field: 'bankBranch', label: 'Bank Branch' },
            { field: 'bankAccountType', label: 'Account Type' },
        ],
    },
    {
        label: 'Flags',
        fields: [
            { field: 'isPreClosed', label: 'Is PreClosed' },
            { field: 'assetType', label: 'Asset Type' },
            { field: 'deadMember', label: 'Dead Member' },
        ],
    },
];

const EDITABLE_FIELDS: { field: string; label: string }[] = EDITABLE_FIELD_GROUPS.flatMap((g) => g.fields);

export function MemberUploanClient() {
    const { toast } = useToast();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');

    const [file, setFile] = useState<File | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Branch Wise Repayment — one xlsx covering every collected installment for every
    // loan in the branch. Uploaded once alongside the member file on first Preview;
    // the server stores it in GCS and hands back historyFileKey, which every
    // subsequent re-validate/import call references instead of re-uploading it.
    const [repaymentFile, setRepaymentFile] = useState<File | null>(null);
    const repaymentFileInputRef = useRef<HTMLInputElement>(null);
    const [historyFileKey, setHistoryFileKey] = useState<string | null>(null);

    // Both optional — a branch with no gold loans, or no separate loan-advance outstanding
    // report handy, must still be able to import. Same upload-once-reference-by-key pattern
    // as repaymentFile/historyFileKey above.
    const [thriftFile, setThriftFile] = useState<File | null>(null);
    const thriftFileInputRef = useRef<HTMLInputElement>(null);
    const [thriftFileKey, setThriftFileKey] = useState<string | null>(null);

    const [goldDetailsFile, setGoldDetailsFile] = useState<File | null>(null);
    const goldDetailsFileInputRef = useRef<HTMLInputElement>(null);
    const [goldFileKey, setGoldFileKey] = useState<string | null>(null);

    const [validating, setValidating] = useState(false);
    const [starting, setStarting] = useState(false);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [job, setJob] = useState<ImportJobStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(preview?.rows ?? []);

    useEffect(() => {
        fetch('/api/branches')
            .then((r) => r.json())
            .then((data) => {
                if (data.success && Array.isArray(data.data)) setBranches(data.data);
            })
            .catch(() => {});
    }, []);

    const downloadTemplate = () => {
        const sample = UPLOAN_TEMPLATE_HEADERS.map(() => '');
        const worksheet = XLSX.utils.aoa_to_sheet([UPLOAN_TEMPLATE_HEADERS, sample]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
        XLSX.writeFile(workbook, 'member-uploan-template.xlsx');
    };

    const handleFileSelected = (f: File) => {
        setFile(f);
        setError(null);
        setPreview(null);
        setJob(null);
    };

    const handleRepaymentFileSelected = (f: File) => {
        setRepaymentFile(f);
        setError(null);
    };

    const handleThriftFileSelected = (f: File) => {
        setThriftFile(f);
        setError(null);
    };

    const handleGoldDetailsFileSelected = (f: File) => {
        setGoldDetailsFile(f);
        setError(null);
    };

    const handlePreview = async () => {
        if (!file || !repaymentFile || !selectedBranchId) return;
        setValidating(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('repaymentFile', repaymentFile);
            if (thriftFile) formData.append('thriftFile', thriftFile);
            if (goldDetailsFile) formData.append('goldDetailsFile', goldDetailsFile);
            formData.append('branchId', selectedBranchId);
            const res = await fetch('/api/uploan/member/preview', { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Failed to validate file');
                return;
            }
            setPreview(data.data);
            setHistoryFileKey(data.data.historyFileKey ?? null);
            setThriftFileKey(data.data.thriftFileKey || null);
            setGoldFileKey(data.data.goldFileKey || null);
        } catch {
            setError('Failed to validate file');
        } finally {
            setValidating(false);
        }
    };

    const handleRevalidate = async () => {
        if (!preview || !selectedBranchId || !historyFileKey) return;
        setValidating(true);
        setError(null);
        try {
            const res = await fetch('/api/uploan/member/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    branchId: selectedBranchId,
                    rows: preview.rows,
                    centerOverrides: buildCenterOverrides(preview),
                    historyFileKey,
                    thriftFileKey,
                    goldFileKey,
                    // Carry forward every Center/Group already resolved in this preview —
                    // if the rows that used to reference one were deleted, it must not
                    // silently drop off the list; it should still get imported.
                    keepCenters: preview.centers,
                    keepGroups: preview.groups,
                }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Failed to re-validate');
                return;
            }
            setPreview(data.data);
            toast({ title: 'Re-validated', description: `${data.data.validRows} of ${data.data.totalRows} rows are valid.` });
        } catch {
            setError('Failed to re-validate');
        } finally {
            setValidating(false);
        }
    };

    const updateCell = (rowId: string, field: string, value: string) => {
        if (!preview) return;
        setPreview({
            ...preview,
            rows: preview.rows.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)),
        });
    };

    const updateLoanAdvanceOutstanding = (rowId: string, value: string) => {
        if (!preview) return;
        const num = value.trim() === '' ? undefined : Number(value);
        setPreview({
            ...preview,
            rows: preview.rows.map((r) =>
                r.rowId === rowId ? { ...r, resolved: { ...r.resolved, loanAdvanceOutstanding: num } } : r
            ),
        });
    };

    const updateGoldDetailField = (rowId: string, field: keyof GoldLoanDetailsResolved, value: string) => {
        if (!preview) return;
        setPreview({
            ...preview,
            rows: preview.rows.map((r) => {
                if (r.rowId !== rowId || !r.resolved?.goldLoanDetails) return r;
                const current = r.resolved.goldLoanDetails;
                const updated: GoldLoanDetailsResolved =
                    field === 'karatType'
                        ? { ...current, karatType: value as GoldLoanDetailsResolved['karatType'] }
                        : { ...current, [field]: Number(value) || 0 };
                return { ...r, resolved: { ...r.resolved, goldLoanDetails: updated } };
            }),
        });
    };

    const removeRow = (rowId: string) => {
        if (!preview) return;
        const rows = preview.rows.filter((r) => r.rowId !== rowId);
        setPreview({
            ...preview,
            rows,
            totalRows: rows.length,
            validRows: rows.filter((r) => r.status === 'VALID').length,
            errorRows: rows.filter((r) => r.status === 'ERROR').length,
        });
    };

    const updateCenterField = (key: string, field: CenterEditableField, value: string) => {
        if (!preview) return;
        setPreview({
            ...preview,
            centers: preview.centers.map((c) => (c.key === key ? { ...c, [field]: value } : c)),
        });
    };

    // Only meaningful when rowCount is 0 — a Center/Group with rows still referencing it
    // gets re-derived from those rows on the next Re-validate regardless.
    const removeCenter = (key: string) => {
        if (!preview) return;
        setPreview({
            ...preview,
            centers: preview.centers.filter((c) => c.key !== key),
            groups: preview.groups.filter((g) => g.centerKey !== key),
        });
    };

    const removeGroup = (key: string) => {
        if (!preview) return;
        setPreview({
            ...preview,
            groups: preview.groups.filter((g) => g.key !== key),
        });
    };

    const buildCenterOverrides = (p: PreviewResult) => {
        const overrides: Record<string, Partial<Record<CenterEditableField, string>>> = {};
        for (const c of p.centers) {
            if (c.status === 'NEW') {
                overrides[c.key] = {
                    meetingDay: c.meetingDay ?? '',
                    meetingTime: c.meetingTime ?? '',
                    address: c.address ?? '',
                    localArea: c.localArea ?? '',
                };
            }
        }
        return overrides;
    };

    // Renaming a group's legacy label is really a bulk edit of every Member row
    // currently clustered under it (the "Group" column drives clustering — the
    // actual Group row is auto-named/auto-numbered, so there's nothing else on
    // the Group itself to make editable). Re-validate re-derives the Groups
    // table from the renamed rows, merging or splitting clusters as needed.
    const renameGroup = (group: GroupSummary, newName: string) => {
        if (!preview) return;
        const centerNameLower = group.centerName.trim().toLowerCase();
        const oldNameLower = group.legacyGroupName.trim().toLowerCase();
        const rows = preview.rows.map((r) => {
            const rowCenterName = String(r.centerName ?? '').trim().toLowerCase();
            const rowGroupName = String(r.groupName ?? '').trim().toLowerCase();
            return rowCenterName === centerNameLower && rowGroupName === oldNameLower
                ? { ...r, groupName: newName }
                : r;
        });
        const groups = preview.groups.map((g) => (g.key === group.key ? { ...g, legacyGroupName: newName } : g));
        setPreview({ ...preview, rows, groups });
    };

    const addRow = () => {
        if (!preview) return;
        const blankRow: UploanGridRow = {
            rowId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            status: 'ERROR',
            errors: ['New row — fill in the required fields and click Re-validate'],
            raw: {},
        };
        for (const f of EDITABLE_FIELDS) blankRow[f.field] = '';
        const rows = [...preview.rows, blankRow];
        setPreview({
            ...preview,
            rows,
            totalRows: rows.length,
            validRows: rows.filter((r) => r.status === 'VALID').length,
            errorRows: rows.filter((r) => r.status === 'ERROR').length,
        });
    };

    const fetchJobStatus = useCallback(
        async (jobId: string, silent = false) => {
            try {
                const res = await fetch(`/api/uploan/member/import/status?jobId=${jobId}`);
                const data = await res.json();
                if (!data.success) {
                    if (!silent) setError(data.error || 'Failed to fetch import status');
                    return;
                }
                setJob(data.data);
                if (data.data.status === 'COMPLETED') {
                    downloadImportReport(data.data);
                    if (!silent) {
                        toast({
                            title: 'Import complete',
                            description: `${data.data.createdCount} created, ${data.data.failedCount} failed.`,
                        });
                    }
                }
            } catch {
                if (!silent) setError('Failed to fetch import status');
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    // Poll quietly while the job is still running, mirroring RequestReportClient.tsx's
    // background-refresh pattern — stops on its own once the job reaches a terminal status.
    useEffect(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (job && (job.status === 'PENDING' || job.status === 'PROCESSING')) {
            pollRef.current = setInterval(() => fetchJobStatus(job.jobId, true), 3000);
        }
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [job, fetchJobStatus]);

    const handleImport = async () => {
        if (!preview || !selectedBranchId || !historyFileKey) return;
        setStarting(true);
        setError(null);
        try {
            const res = await fetch('/api/uploan/member/import/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    branchId: selectedBranchId,
                    rows: preview.rows,
                    centerOverrides: buildCenterOverrides(preview),
                    historyFileKey,
                    thriftFileKey,
                    goldFileKey,
                    keepCenters: preview.centers,
                    keepGroups: preview.groups,
                }),
            });
            const data = await res.json();
            if (!data.success) {
                setError(data.error || 'Failed to start import');
                return;
            }
            toast({ title: 'Import started', description: `Processing ${data.data.totalRows} row(s) in the background.` });
            await fetchJobStatus(data.data.jobId);
        } catch {
            setError('Failed to start import');
        } finally {
            setStarting(false);
        }
    };

    const downloadImportReport = (result: ImportJobStatus) => {
        // Mirrors the on-screen Preview & Validate grid exactly — every column visible
        // there (Status, Client Match, History, Loan Advance O/S, Gold, every
        // EDITABLE_FIELDS raw column, and the Errors/Warnings popovers) plus the
        // job-outcome columns (Result/Message/Client ID/Loan Number), joined by rowId
        // against `preview.rows` the same way the on-screen table does.
        const headers = [
            'Row', 'Result', 'Message', 'Client Match', 'Client ID', 'Loan Number',
            'Preview Status', 'History', 'Loan Advance O/S',
            'Gold Karat', 'Gold Gram Count', 'Gold Taken Value', 'Gold Cash Given', 'Gold Token No', 'Gold Item',
            ...EDITABLE_FIELDS.map((f) => f.label),
            'Validation Errors', 'Validation Warnings',
        ];
        const data = result.rows.map((r) => {
            const submittedRow = preview?.rows.find((pr) => pr.rowId === r.rowId);
            const message =
                r.status === 'CREATED'
                    ? 'Client and Loan created successfully, with migrated repayment history.'
                    : r.reason || 'Failed — no reason recorded';
            const resolved = submittedRow?.resolved;
            const clientMatch = resolved?.clientStatus === 'MATCHED_EXISTING' ? 'Existing' : 'New';
            const gold = resolved?.goldLoanDetails;
            return [
                r.rowId,
                r.status,
                message,
                clientMatch,
                r.clientId || '',
                r.loanNumber || '',
                submittedRow?.status || '',
                resolved?.hasLoanHistory ? 'Matched' : resolved?.isNewUncollectedLoan ? 'New loan (no collections yet)' : 'Not found',
                resolved?.loanAdvanceOutstanding ?? '',
                gold?.karatType ?? '',
                gold?.gramCount ?? '',
                gold?.goldTakenValue ?? '',
                gold?.cashGiven ?? '',
                gold?.goldTokenNo ?? '',
                gold?.itemDescription ?? '',
                ...EDITABLE_FIELDS.map((f) => String(submittedRow?.[f.field] ?? '')),
                (submittedRow?.errors ?? []).join('; '),
                (submittedRow?.warnings ?? []).join('; '),
            ];
        });
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Import Report');
        XLSX.writeFile(workbook, `member-uploan-import-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const reset = () => {
        setFile(null);
        setRepaymentFile(null);
        setHistoryFileKey(null);
        setThriftFile(null);
        setThriftFileKey(null);
        setGoldDetailsFile(null);
        setGoldFileKey(null);
        setPreview(null);
        setJob(null);
        setError(null);
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (repaymentFileInputRef.current) repaymentFileInputRef.current.value = '';
        if (thriftFileInputRef.current) thriftFileInputRef.current.value = '';
        if (goldDetailsFileInputRef.current) goldDetailsFileInputRef.current.value = '';
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Member upload</h1>
                <p className="mt-2 text-gray-600">
                    Bulk-migrate legacy members and their ongoing loans — resolves/creates Center &amp; Group,
                    creates or reuses the Client, and creates the Loan with a real repayment transaction.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>1. Select Branch</CardTitle>
                    <CardDescription>All new Centers/Groups/Clients in this file will be created under this branch.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="branch-select">Branch *</Label>
                        <Select
                            value={selectedBranchId}
                            onValueChange={(v) => {
                                setSelectedBranchId(v);
                                reset();
                            }}
                        >
                            <SelectTrigger id="branch-select">
                                <SelectValue placeholder="-- SELECT BRANCH --" />
                            </SelectTrigger>
                            <SelectContent>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                        [{b.code}] {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {selectedBranchId && !preview && (
                <Card>
                    <CardHeader>
                        <CardTitle>2. Upload Excel files</CardTitle>
                        <CardDescription>
                            Both files, branch-wide: the Member Details Report (one row per member + their ongoing
                            loan) and the Branch Wise Repayment (every collected installment, every loan, for the
                            branch) — joined by that loan&apos;s Loan MemberID.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Member Details Report *</Label>
                                <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2">
                                    <Download className="h-4 w-4" />
                                    Download Template
                                </Button>
                            </div>

                            {!file ? (
                                <div
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        setIsDragging(true);
                                    }}
                                    onDragLeave={(e) => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files.length > 0) handleFileSelected(e.dataTransfer.files[0]);
                                    }}
                                    onClick={() => fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                                        isDragging ? 'border-primary bg-green-50' : 'border-gray-300 hover:border-gray-400'
                                    }`}
                                >
                                    <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-700">Drop the Member Details Report here or click to browse</p>
                                    <p className="text-xs text-gray-500 mt-1">Accepts .xlsx, .xls</p>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={(e) => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
                                        className="hidden"
                                    />
                                </div>
                            ) : (
                                <div className="border rounded-lg p-3 bg-white flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3">
                                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-medium text-gray-900">{file.name}</p>
                                            <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setFile(null);
                                            if (fileInputRef.current) fileInputRef.current.value = '';
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <Label>Branch Wise Repayment *</Label>

                            {!repaymentFile ? (
                                <div
                                    onClick={() => repaymentFileInputRef.current?.click()}
                                    className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors border-gray-300 hover:border-gray-400"
                                >
                                    <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-700">Click to browse for the Branch Wise Repayment file</p>
                                    <p className="text-xs text-gray-500 mt-1">Accepts .xlsx, .xls — one file covers the whole branch</p>
                                    <input
                                        ref={repaymentFileInputRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={(e) => e.target.files?.[0] && handleRepaymentFileSelected(e.target.files[0])}
                                        className="hidden"
                                    />
                                </div>
                            ) : (
                                <div className="border rounded-lg p-3 bg-white flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3">
                                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-medium text-gray-900">{repaymentFile.name}</p>
                                            <p className="text-sm text-gray-500">{(repaymentFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setRepaymentFile(null);
                                            if (repaymentFileInputRef.current) repaymentFileInputRef.current.value = '';
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <Label>Loan-Advance Outstanding Report (optional)</Label>
                            <p className="text-xs text-gray-500">
                                Member-wise loan-advance/thrift outstanding, summed across every one of a member&apos;s
                                loan cycles — replaces the Member Details Report&apos;s own current-loan-only Thrift 1/2
                                figures when uploaded.
                            </p>

                            {!thriftFile ? (
                                <div
                                    onClick={() => thriftFileInputRef.current?.click()}
                                    className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors border-gray-300 hover:border-gray-400"
                                >
                                    <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-700">Click to browse for the Loan-Advance Outstanding Report</p>
                                    <p className="text-xs text-gray-500 mt-1">Accepts .xlsx, .xls</p>
                                    <input
                                        ref={thriftFileInputRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={(e) => e.target.files?.[0] && handleThriftFileSelected(e.target.files[0])}
                                        className="hidden"
                                    />
                                </div>
                            ) : (
                                <div className="border rounded-lg p-3 bg-white flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3">
                                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-medium text-gray-900">{thriftFile.name}</p>
                                            <p className="text-sm text-gray-500">{(thriftFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setThriftFile(null);
                                            if (thriftFileInputRef.current) thriftFileInputRef.current.value = '';
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <Label>Gold Loan Details (optional)</Label>
                            <p className="text-xs text-gray-500">
                                Pledge details (karat, weight, value) for members whose current loan is a gold loan —
                                only applied when the matched loan product is a gold product.
                            </p>

                            {!goldDetailsFile ? (
                                <div
                                    onClick={() => goldDetailsFileInputRef.current?.click()}
                                    className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors border-gray-300 hover:border-gray-400"
                                >
                                    <Upload className="h-10 w-10 mx-auto text-gray-400 mb-2" />
                                    <p className="text-sm font-medium text-gray-700">Click to browse for the Gold Loan Details file</p>
                                    <p className="text-xs text-gray-500 mt-1">Accepts .xlsx, .xls</p>
                                    <input
                                        ref={goldDetailsFileInputRef}
                                        type="file"
                                        accept=".xlsx,.xls"
                                        onChange={(e) => e.target.files?.[0] && handleGoldDetailsFileSelected(e.target.files[0])}
                                        className="hidden"
                                    />
                                </div>
                            ) : (
                                <div className="border rounded-lg p-3 bg-white flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-3">
                                        <FileText className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
                                        <div>
                                            <p className="font-medium text-gray-900">{goldDetailsFile.name}</p>
                                            <p className="text-sm text-gray-500">{(goldDetailsFile.size / 1024).toFixed(1)} KB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            setGoldDetailsFile(null);
                                            if (goldDetailsFileInputRef.current) goldDetailsFileInputRef.current.value = '';
                                        }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}
                        </div>

                        <Button
                            onClick={handlePreview}
                            disabled={validating || !file || !repaymentFile}
                            className="w-full bg-primary hover:bg-sidebar-accent text-white gap-2"
                        >
                            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                            Preview &amp; Validate
                        </Button>

                        {error && (
                            <Alert variant="destructive">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}

            {preview && !job && (
                <>
                    <Card>
                        <CardHeader>
                            <CardTitle>Centers</CardTitle>
                            <CardDescription>
                                Resolved from the &quot;Center&quot; column against this branch. NEW centers are editable here —
                                fill in what the file didn&apos;t provide before importing.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Address</TableHead>
                                            <TableHead>Local Area</TableHead>
                                            <TableHead>Meeting Day</TableHead>
                                            <TableHead>Meeting Time</TableHead>
                                            <TableHead>Rows</TableHead>
                                            <TableHead>Remove</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {preview.centers.map((c) => (
                                            <TableRow key={c.key}>
                                                <TableCell className="font-medium">{c.name}</TableCell>
                                                <TableCell>
                                                    <Badge className={c.status === 'MATCHED' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}>
                                                        {c.status}
                                                    </Badge>
                                                </TableCell>
                                                {c.status === 'NEW' ? (
                                                    <>
                                                        <TableCell>
                                                            <Input
                                                                className="h-8 min-w-[160px] text-sm"
                                                                value={c.address ?? ''}
                                                                onChange={(e) => updateCenterField(c.key, 'address', e.target.value)}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input
                                                                className="h-8 min-w-[140px] text-sm"
                                                                value={c.localArea ?? ''}
                                                                onChange={(e) => updateCenterField(c.key, 'localArea', e.target.value)}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input
                                                                className="h-8 min-w-[120px] text-sm"
                                                                value={c.meetingDay ?? ''}
                                                                onChange={(e) => updateCenterField(c.key, 'meetingDay', e.target.value)}
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Input
                                                                className="h-8 min-w-[110px] text-sm"
                                                                value={c.meetingTime ?? ''}
                                                                onChange={(e) => updateCenterField(c.key, 'meetingTime', e.target.value)}
                                                            />
                                                        </TableCell>
                                                    </>
                                                ) : (
                                                    <>
                                                        <TableCell>{c.address || '—'}</TableCell>
                                                        <TableCell>{c.localArea || '—'}</TableCell>
                                                        <TableCell>{c.meetingDay || '—'}</TableCell>
                                                        <TableCell>{c.meetingTime || '—'}</TableCell>
                                                    </>
                                                )}
                                                <TableCell>{c.rowCount}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        disabled={c.rowCount > 0}
                                                        title={
                                                            c.rowCount > 0
                                                                ? `Still referenced by ${c.rowCount} row(s) — remove those rows first`
                                                                : 'Remove this center'
                                                        }
                                                        onClick={() => removeCenter(c.key)}
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-100 disabled:opacity-30"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Centers stay listed (and will still be created on Import) even after every member row
                                under them is removed — use Remove above to drop one you don&apos;t want created.
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Groups</CardTitle>
                            <CardDescription>
                                The legacy &quot;Group&quot; column only clusters rows — the actual Group is created with this
                                system&apos;s own auto-numbering (&quot;Center Name - N&quot;). Renaming a NEW group here
                                re-clusters every member row under it — click Re-validate after editing.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Center</TableHead>
                                        <TableHead>Legacy Group Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Rows</TableHead>
                                        <TableHead>Remove</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {preview.groups.map((g) => (
                                        <TableRow key={g.key}>
                                            <TableCell>{g.centerName}</TableCell>
                                            <TableCell className="font-medium">
                                                {g.status === 'NEW' ? (
                                                    <Input
                                                        className="h-8 min-w-[200px] text-sm"
                                                        defaultValue={g.legacyGroupName}
                                                        onBlur={(e) => {
                                                            if (e.target.value.trim() && e.target.value !== g.legacyGroupName) {
                                                                renameGroup(g, e.target.value.trim());
                                                            }
                                                        }}
                                                    />
                                                ) : (
                                                    g.legacyGroupName
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <Badge className={g.status === 'MATCHED' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}>
                                                    {g.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{g.rowCount}</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={g.rowCount > 0}
                                                    title={
                                                        g.rowCount > 0
                                                            ? `Still referenced by ${g.rowCount} row(s) — remove those rows first`
                                                            : 'Remove this group'
                                                    }
                                                    onClick={() => removeGroup(g.key)}
                                                    className="text-red-600 hover:text-red-700 hover:bg-red-100 disabled:opacity-30"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                            <div>
                                <CardTitle>Members</CardTitle>
                                <CardDescription>
                                    {preview.totalRows} rows — {preview.validRows} valid, {preview.errorRows} with errors. Edit a cell
                                    and click Re-validate.
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <TableSearchInput
                                    value={tableSearchQuery}
                                    onChange={setTableSearchQuery}
                                    placeholder="Search members..."
                                />
                                <Button variant="outline" onClick={addRow} className="gap-2">
                                    <Plus className="h-4 w-4" />
                                    Add Row
                                </Button>
                                <Button variant="outline" onClick={handleRevalidate} disabled={validating} className="gap-2">
                                    {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                    Re-validate
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead rowSpan={2} className="align-bottom">Status</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Errors</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Client</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">History</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Loan Advance O/S</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Gold</TableHead>
                                            {EDITABLE_FIELD_GROUPS.map((g) => (
                                                <TableHead
                                                    key={g.label}
                                                    colSpan={g.fields.length}
                                                    className="border-l bg-muted/40 text-center"
                                                >
                                                    {g.label}
                                                </TableHead>
                                            ))}
                                            <TableHead rowSpan={2} className="align-bottom">Remove</TableHead>
                                        </TableRow>
                                        <TableRow>
                                            {EDITABLE_FIELDS.map((f, i) => {
                                                const isGroupStart = EDITABLE_FIELD_GROUPS.some(
                                                    (g) => g.fields[0]?.field === f.field
                                                );
                                                return (
                                                    <TableHead
                                                        key={f.field}
                                                        className={isGroupStart && i > 0 ? 'border-l' : undefined}
                                                    >
                                                        {f.label}
                                                    </TableHead>
                                                );
                                            })}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {searchedRows.map((row) => (
                                            <TableRow key={row.rowId} className={row.status === 'ERROR' ? 'bg-red-50' : undefined}>
                                                <TableCell>
                                                    <Badge className={row.status === 'VALID' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                                                        {row.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <div className="flex items-center gap-1">
                                                        {row.errors.length > 0 && (
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        title={`${row.errors.length} error${row.errors.length > 1 ? 's' : ''} — click to view`}
                                                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-red-600 hover:bg-red-100"
                                                                    >
                                                                        <Bug className="h-4 w-4" />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-80 max-h-64 overflow-y-auto" align="start">
                                                                    <ol className="list-decimal list-inside space-y-1.5 text-xs text-red-700">
                                                                        {row.errors.map((err, i) => (
                                                                            <li key={i}>{err}</li>
                                                                        ))}
                                                                    </ol>
                                                                </PopoverContent>
                                                            </Popover>
                                                        )}
                                                        {!!row.warnings?.length && (
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        title={`${row.warnings.length} notice${row.warnings.length > 1 ? 's' : ''} — click to view`}
                                                                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-amber-600 hover:bg-amber-100"
                                                                    >
                                                                        <Bug className="h-4 w-4" />
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-80 max-h-64 overflow-y-auto" align="start">
                                                                    <ol className="list-decimal list-inside space-y-1.5 text-xs text-amber-700">
                                                                        {row.warnings.map((w, i) => (
                                                                            <li key={i}>{w}</li>
                                                                        ))}
                                                                    </ol>
                                                                </PopoverContent>
                                                            </Popover>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {(() => {
                                                        const resolved = row.resolved as
                                                            | { clientStatus?: 'MATCHED_EXISTING' | 'NEW'; clientId?: string }
                                                            | undefined;
                                                        if (resolved?.clientStatus === 'MATCHED_EXISTING') {
                                                            return (
                                                                <Badge
                                                                    className="bg-amber-100 text-amber-800 w-fit"
                                                                    title={`Matches an existing client (mobile/Aadhaar) — this row updates client ${resolved.clientId}, no new client will be created`}
                                                                >
                                                                    Existing
                                                                </Badge>
                                                            );
                                                        }
                                                        return (
                                                            <Badge className="bg-slate-100 text-slate-700 w-fit" title="No existing client matches this row's mobile/Aadhaar — a new client will be created">
                                                                New
                                                            </Badge>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell>
                                                    {(() => {
                                                        const resolved = row.resolved as
                                                            | { hasLoanHistory?: boolean; isNewUncollectedLoan?: boolean }
                                                            | undefined;
                                                        if (resolved?.hasLoanHistory) {
                                                            return (
                                                                <Badge
                                                                    className="bg-green-100 text-green-800 w-fit"
                                                                    title="This loan's installments were found in the Branch Wise Repayment file"
                                                                >
                                                                    Matched
                                                                </Badge>
                                                            );
                                                        }
                                                        if (resolved?.isNewUncollectedLoan) {
                                                            return (
                                                                <Badge
                                                                    className="bg-blue-100 text-blue-800 w-fit"
                                                                    title="No installments found in the Branch Wise Repayment file, but this row's own Outstanding Principal/Interest also show nothing collected yet — treated as a brand-new loan, not an error"
                                                                >
                                                                    New loan
                                                                </Badge>
                                                            );
                                                        }
                                                        return (
                                                            <Badge
                                                                className="bg-red-100 text-red-800 w-fit"
                                                                title="No collected installments found in the Branch Wise Repayment file for this row's Loan MemberID, but this row's own Outstanding Principal/Interest indicate some amount was already collected — required"
                                                            >
                                                                Not found
                                                            </Badge>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        className="h-8 min-w-[110px] text-sm"
                                                        value={row.resolved?.loanAdvanceOutstanding ?? ''}
                                                        onChange={(e) => updateLoanAdvanceOutstanding(row.rowId, e.target.value)}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    {row.resolved?.goldLoanDetails ? (
                                                        <div className="flex flex-col gap-1 min-w-[140px]">
                                                            <Select
                                                                value={row.resolved.goldLoanDetails.karatType}
                                                                onValueChange={(v) => updateGoldDetailField(row.rowId, 'karatType', v)}
                                                            >
                                                                <SelectTrigger className="h-7 text-xs">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {KARAT_TYPES.map((k) => (
                                                                        <SelectItem key={k} value={k}>{k}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                            <Input
                                                                type="number"
                                                                title="Gram Count"
                                                                placeholder="Grams"
                                                                className="h-7 text-xs"
                                                                value={row.resolved.goldLoanDetails.gramCount}
                                                                onChange={(e) => updateGoldDetailField(row.rowId, 'gramCount', e.target.value)}
                                                            />
                                                            <Input
                                                                type="number"
                                                                title="Cash Given"
                                                                placeholder="Cash Given"
                                                                className="h-7 text-xs"
                                                                value={row.resolved.goldLoanDetails.cashGiven}
                                                                onChange={(e) => updateGoldDetailField(row.rowId, 'cashGiven', e.target.value)}
                                                            />
                                                            {row.resolved.goldLoanDetails.goldTokenNo && (
                                                                <p className="text-[10px] text-gray-500" title="Gold Token No (read-only)">
                                                                    Token: {row.resolved.goldLoanDetails.goldTokenNo}
                                                                </p>
                                                            )}
                                                            {row.resolved.goldLoanDetails.itemDescription && (
                                                                <p className="text-[10px] text-gray-500" title="Item (read-only)">
                                                                    {row.resolved.goldLoanDetails.itemDescription}
                                                                </p>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs">—</span>
                                                    )}
                                                </TableCell>
                                                {EDITABLE_FIELDS.map((f, i) => {
                                                    const isGroupStart = EDITABLE_FIELD_GROUPS.some(
                                                        (g) => g.fields[0]?.field === f.field
                                                    );
                                                    return (
                                                        <TableCell key={f.field} className={isGroupStart && i > 0 ? 'border-l' : undefined}>
                                                            <Input
                                                                className="h-8 min-w-[110px] text-sm"
                                                                value={String(row[f.field] ?? '')}
                                                                onChange={(e) => updateCell(row.rowId, f.field, e.target.value)}
                                                            />
                                                        </TableCell>
                                                    );
                                                })}
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        title="Remove this row"
                                                        onClick={() => removeRow(row.rowId)}
                                                        className="text-red-600 hover:text-red-700 hover:bg-red-100"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            <Button variant="outline" onClick={addRow} className="mt-3 gap-2">
                                <Plus className="h-4 w-4" />
                                Add Row
                            </Button>

                            {error && (
                                <Alert variant="destructive" className="mt-4">
                                    <AlertDescription>{error}</AlertDescription>
                                </Alert>
                            )}

                            <Separator className="my-4" />

                            <p className="text-xs text-gray-500 mt-3">
                                Centers and Groups above are created either way — they don&apos;t depend on the Members grid
                                being error-free. Only rows still marked ERROR are skipped for Client/Loan creation.
                            </p>

                            <div className="flex items-center justify-between mt-2">
                                <Button variant="outline" onClick={reset}>
                                    Start Over
                                </Button>
                                <Button
                                    onClick={handleImport}
                                    disabled={starting || preview.rows.length === 0}
                                    className="bg-primary hover:bg-sidebar-accent text-white gap-2"
                                >
                                    {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                    {preview.validRows > 0
                                        ? `Import (${preview.validRows} of ${preview.totalRows} rows will create a Client/Loan)`
                                        : `Import Centers & Groups (0 of ${preview.totalRows} rows are error-free yet)`}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}

            {job && (
                <>
                    <Card
                        className={
                            job.status === 'COMPLETED' ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'
                        }
                    >
                        <CardHeader>
                            <CardTitle className={job.status === 'COMPLETED' ? 'text-green-900' : 'text-blue-900'}>
                                {job.status === 'COMPLETED' ? 'Import Complete' : 'Import Running'}
                            </CardTitle>
                            <CardDescription>
                                {job.status === 'COMPLETED'
                                    ? 'An import report has also been downloaded automatically.'
                                    : 'Running in the background — this page updates automatically every few seconds.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-4">
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-gray-600">Total Rows</p>
                                    <p className="text-2xl font-bold">{job.totalRows}</p>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-blue-700 flex items-center gap-1">
                                        {job.status !== 'COMPLETED' && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Pending
                                    </p>
                                    <p className="text-2xl font-bold text-blue-700">{job.pendingCount}</p>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-green-700">Created</p>
                                    <p className="text-2xl font-bold text-green-700">{job.createdCount}</p>
                                </div>
                                <div className="space-y-2">
                                    <p className="text-sm font-medium text-orange-700">Failed</p>
                                    <p className="text-2xl font-bold text-orange-700">{job.failedCount}</p>
                                </div>
                            </div>
                            {job.status !== 'COMPLETED' && (
                                <Badge className="bg-blue-100 text-blue-800 gap-1">
                                    <Clock className="h-3 w-3" />
                                    {job.status === 'PENDING' ? 'Queued' : 'Processing'}
                                </Badge>
                            )}
                            <Button variant="outline" onClick={reset} disabled={job.status !== 'COMPLETED'}>
                                Import Another File
                            </Button>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Import Report</CardTitle>
                            <CardDescription>Every field submitted for each row, plus what happened to it — updates live while running.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead rowSpan={2} className="align-bottom">Result</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Message</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Client Match</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Client ID</TableHead>
                                            <TableHead rowSpan={2} className="align-bottom">Loan Number</TableHead>
                                            {EDITABLE_FIELD_GROUPS.map((g) => (
                                                <TableHead
                                                    key={g.label}
                                                    colSpan={g.fields.length}
                                                    className="border-l bg-muted/40 text-center"
                                                >
                                                    {g.label}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                        <TableRow>
                                            {EDITABLE_FIELDS.map((f, i) => {
                                                const isGroupStart = EDITABLE_FIELD_GROUPS.some(
                                                    (g) => g.fields[0]?.field === f.field
                                                );
                                                return (
                                                    <TableHead
                                                        key={f.field}
                                                        className={isGroupStart && i > 0 ? 'border-l' : undefined}
                                                    >
                                                        {f.label}
                                                    </TableHead>
                                                );
                                            })}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {job.rows.map((r) => {
                                            const submittedRow = preview?.rows.find((pr) => pr.rowId === r.rowId);
                                            const resolved = submittedRow?.resolved as
                                                | { clientStatus?: 'MATCHED_EXISTING' | 'NEW' }
                                                | undefined;
                                            const rowClass =
                                                r.status === 'FAILED' ? 'bg-red-50' : r.status === 'PENDING' ? 'bg-gray-50' : 'bg-green-50/40';
                                            const badgeClass =
                                                r.status === 'CREATED'
                                                    ? 'bg-green-100 text-green-800'
                                                    : r.status === 'PENDING'
                                                      ? 'bg-gray-100 text-gray-700'
                                                      : 'bg-red-100 text-red-800';
                                            return (
                                                <TableRow key={r.rowId} className={rowClass}>
                                                    <TableCell>
                                                        <Badge className={badgeClass}>{r.status}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        {r.status === 'PENDING' ? (
                                                            <Clock className="h-4 w-4 text-gray-500" />
                                                        ) : (
                                                            <Popover>
                                                                <PopoverTrigger asChild>
                                                                    <button
                                                                        type="button"
                                                                        title="View message"
                                                                        className={
                                                                            r.status === 'CREATED'
                                                                                ? 'inline-flex h-7 w-7 items-center justify-center rounded-full text-green-700 hover:bg-green-100'
                                                                                : 'inline-flex h-7 w-7 items-center justify-center rounded-full text-red-600 hover:bg-red-100'
                                                                        }
                                                                    >
                                                                        {r.status === 'CREATED' ? (
                                                                            <CheckCircle2 className="h-4 w-4" />
                                                                        ) : (
                                                                            <Bug className="h-4 w-4" />
                                                                        )}
                                                                    </button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-80 max-h-64 overflow-y-auto" align="start">
                                                                    <p
                                                                        className={
                                                                            r.status === 'CREATED'
                                                                                ? 'text-xs text-green-700 whitespace-pre-wrap'
                                                                                : 'text-xs text-red-700 whitespace-pre-wrap'
                                                                        }
                                                                    >
                                                                        {r.status === 'CREATED'
                                                                            ? 'Client and Loan created successfully, with migrated repayment history.'
                                                                            : r.reason || 'Failed — no reason recorded'}
                                                                    </p>
                                                                </PopoverContent>
                                                            </Popover>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-xs">
                                                        <Badge
                                                            className={
                                                                resolved?.clientStatus === 'MATCHED_EXISTING'
                                                                    ? 'bg-amber-100 text-amber-800'
                                                                    : 'bg-slate-100 text-slate-700'
                                                            }
                                                        >
                                                            {resolved?.clientStatus === 'MATCHED_EXISTING' ? 'Existing' : 'New'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-xs">{r.clientId || '—'}</TableCell>
                                                    <TableCell className="text-xs">{r.loanNumber || '—'}</TableCell>
                                                    {EDITABLE_FIELDS.map((f, i) => {
                                                        const isGroupStart = EDITABLE_FIELD_GROUPS.some(
                                                            (g) => g.fields[0]?.field === f.field
                                                        );
                                                        return (
                                                            <TableCell
                                                                key={f.field}
                                                                className={`text-xs ${isGroupStart && i > 0 ? 'border-l' : ''}`}
                                                            >
                                                                {String(submittedRow?.[f.field] ?? '') || '—'}
                                                            </TableCell>
                                                        );
                                                    })}
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
