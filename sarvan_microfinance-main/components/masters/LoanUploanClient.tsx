'use client';

import { Fragment, useEffect, useState } from 'react';
import { useLoanAdvanceEnabled } from '@/app/hooks/useLoanAdvanceEnabled';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, ChevronDown, ChevronUp, Save, FileText, X } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
    parseLoanCardReportCsv,
    parseRepaymentReportCsv,
    sniffReportType,
    type ParsedLoanCardReport,
    type ParsedRepaymentReport,
} from '@/app/lib/services/uploan-loan-history.service';
import { LoanCardScheduleTable } from '@/components/masters/uploan/LoanCardScheduleTable';
import { RepaymentEventTable } from '@/components/masters/uploan/RepaymentEventTable';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';
import { DateInput } from '@/components/ui/date-input';

interface Branch {
    id: string;
    name: string;
    code: string;
}

interface Center {
    id: string;
    name: string;
    code: string;
}

interface Group {
    id: string;
    name: string;
}

interface LoanProductType {
    id: string;
    name: string;
}

interface LoanProduct {
    id: string;
    productName: string;
    loanAmount: string;
    interestRate: string;
    numberOfDues: number;
}

interface LoanPurposeType {
    id: string;
    name: string;
}

interface LoanPurpose {
    id: string;
    name: string;
}

interface Funder {
    id: string;
    funderName: string;
}

interface ExistingBackup {
    loanId: string;
    loanProductTypeId?: string;
    loanProductId?: string;
    loanPurposeTypeId?: string;
    loanPurposeId?: string;
    frequency?: string;
    disbursementDate?: string;
    firstDueDate?: string;
    funderId?: string | null;
    principalPaid?: number;
    interestPaid?: number;
    savingsPaid?: number;
    goldDetail?: {
        karatType: string;
        gramCount: number;
        cashGiven: number;
    } | null;
}

interface EligibleClient {
    id: string;
    clientId: string;
    name: string;
    hasBackup: boolean;
    existingBackup: ExistingBackup | null;
    /** Read-only reconstruction of an already-migrated backup loan's Loan Card schedule +
     *  Repayment events, from the real LoanSchedule/LoanTransaction rows. Null when hasBackup is false. */
    history: { loanCard: ParsedLoanCardReport; repayment: ParsedRepaymentReport } | null;
}

interface ClientReports {
    loanCard?: ParsedLoanCardReport;
    repayment?: ParsedRepaymentReport;
}

export function LoanUploanClient() {
    const { enabled: loanAdvanceEnabled } = useLoanAdvanceEnabled();
    // State for filters
    const [branches, setBranches] = useState<Branch[]>([]);
    const [centers, setCenters] = useState<Center[]>([]);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [selectedCenterId, setSelectedCenterId] = useState('');
    const [selectedGroupId, setSelectedGroupId] = useState('');

    // State for clients
    const [clients, setClients] = useState<EligibleClient[]>([]);
    const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(clients);

    // State for master data
    const [loanProductTypes, setLoanProductTypes] = useState<LoanProductType[]>([]);
    const [loanProducts, setLoanProducts] = useState<LoanProduct[]>([]);
    const [loanPurposeTypes, setLoanPurposeTypes] = useState<LoanPurposeType[]>([]);
    const [loanPurposes, setLoanPurposes] = useState<LoanPurpose[]>([]);
    const [funders, setFunders] = useState<Funder[]>([]);

    // State for form data per client — an intentionally untyped bag, since it holds
    // a mix of scalar fields and nested goldLoanDetails keyed dynamically by field name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [formErrors, setFormErrors] = useState<Record<string, Record<string, string>>>({});

    // State for per-client upload reports (Loan Card Report + Repayment Report)
    const [reportsByClientId, setReportsByClientId] = useState<Record<string, ClientReports>>({});
    const [parsingReport, setParsingReport] = useState<Record<string, boolean>>({});

    // Loading states
    const [isLoadingBranches, setIsLoadingBranches] = useState(true);
    const [isFetchingCenters, setIsFetchingCenters] = useState(false);
    const [isFetchingGroups, setIsFetchingGroups] = useState(false);
    const [isLoadingClients, setIsLoadingClients] = useState(false);
    const [isSavingClient, setIsSavingClient] = useState<Record<string, boolean>>({});

    // UI states
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const { toast } = useToast();

    // Load branches on mount
    useEffect(() => {
        fetchBranches();
        fetchMasterData();
    }, []);

    // Load centers when branch changes
    useEffect(() => {
        if (selectedBranchId) {
            fetchCenters(selectedBranchId);
        } else {
            setCenters([]);
        }
    }, [selectedBranchId]);

    // Load groups when center changes
    useEffect(() => {
        if (selectedCenterId) {
            fetchGroups(selectedCenterId);
        } else {
            setGroups([]);
        }
    }, [selectedCenterId]);

    const fetchBranches = async () => {
        setIsLoadingBranches(true);
        try {
            const response = await fetch('/api/branches');
            const data = await response.json();
            if (data.success && Array.isArray(data.data)) {
                setBranches(data.data);
            }
        } catch (err) {
            console.error('Error fetching branches:', err);
            setError('Failed to load branches');
        } finally {
            setIsLoadingBranches(false);
        }
    };

    const fetchCenters = async (branchId: string) => {
        if (!branchId) {
            setCenters([]);
            return;
        }
        setIsFetchingCenters(true);
        try {
            const response = await fetch(`/api/centers?branchId=${branchId}`);
            const data = await response.json();
            if (data.success && Array.isArray(data.data)) {
                setCenters(data.data);
            }
        } catch (err) {
            console.error('Error fetching centers:', err);
            setCenters([]);
        } finally {
            setIsFetchingCenters(false);
        }
    };

    const fetchGroups = async (centerId: string) => {
        if (!centerId) {
            setGroups([]);
            return;
        }
        setIsFetchingGroups(true);
        try {
            const response = await fetch(`/api/groups?centerId=${centerId}`);
            const data = await response.json();
            if (data.success && Array.isArray(data.data)) {
                setGroups(data.data);
            }
        } catch (err) {
            console.error('Error fetching groups:', err);
            setGroups([]);
        } finally {
            setIsFetchingGroups(false);
        }
    };

    const fetchMasterData = async () => {
        try {
            const [typesRes, purposeTypesRes, fundersRes] = await Promise.all([
                fetch('/api/loan-product-types'),
                fetch('/api/loan-purpose-types'),
                fetch('/api/masters/funder'),
            ]);

            const typesData = await typesRes.json();
            const purposeTypesData = await purposeTypesRes.json();
            const fundersData = await fundersRes.json();

            if (typesData.success) setLoanProductTypes(typesData.data);
            if (purposeTypesData.success) setLoanPurposeTypes(purposeTypesData.data);
            if (fundersData.success) setFunders(fundersData.data);
        } catch (err) {
            console.error('Error fetching master data:', err);
        }
    };

    const loadClients = async () => {
        if (!selectedGroupId) {
            setError('Please select a group first');
            return;
        }

        setIsLoadingClients(true);
        setError(null);
        try {
            const response = await fetch(`/api/ongoing-loan-backup/eligible-clients?groupId=${selectedGroupId}`);
            const data = await response.json();

            if (!data.success) {
                setError(data.error || 'Failed to load clients');
                setClients([]);
                return;
            }

            setClients(data.data || []);
            if (data.data.length === 0) {
                setSuccess('No eligible clients found for this group');
            }
        } catch (err) {
            console.error('Error loading clients:', err);
            setError('Failed to load clients');
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    };

    const fetchLoanProducts = async (productTypeId: string) => {
        if (!selectedBranchId || !productTypeId) return;

        try {
            const response = await fetch(
                `/api/products?branchId=${selectedBranchId}&includeTemplates=false`
            );
            const data = await response.json();

            if (data.success) {
                const filtered = data.data.filter(
                    (p: LoanProduct & { loanProductTypeId: string }) => p.loanProductTypeId === productTypeId
                );
                setLoanProducts(filtered);
            }
        } catch (err) {
            console.error('Error fetching loan products:', err);
        }
    };

    const fetchLoanPurposes = async (purposeTypeId: string) => {
        if (!purposeTypeId) return;

        try {
            const response = await fetch(`/api/loan-purposes?purposeTypeId=${purposeTypeId}`);
            const data = await response.json();

            if (data.success) {
                setLoanPurposes(data.data);
            }
        } catch (err) {
            console.error('Error fetching loan purposes:', err);
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleClientFormChange = (clientId: string, field: string, value: any) => {
        setFormData((prev) => ({
            ...prev,
            [clientId]: {
                ...prev[clientId],
                [field]: value,
            },
        }));

        // Clear the direct field error when user changes it
        if (formErrors[clientId]?.[field]) {
            setFormErrors((prev) => ({
                ...prev,
                [clientId]: { ...prev[clientId], [field]: '' },
            }));
        }

        // For goldLoanDetails, clear all three gold sub-errors
        if (field === 'goldLoanDetails') {
            setFormErrors((prev) => ({
                ...prev,
                [clientId]: {
                    ...(prev[clientId] || {}),
                    'goldLoanDetails.karatType': '',
                    'goldLoanDetails.gramCount': '',
                    'goldLoanDetails.cashGiven': '',
                },
            }));
        }

        // Fetch products when product type changes
        if (field === 'loanProductTypeId') {
            fetchLoanProducts(value);
        }

        // Fetch purposes when purpose type changes
        if (field === 'loanPurposeTypeId') {
            fetchLoanPurposes(value);
        }
    };

    /** Matches a Loan Card Report's free-text funder name against the Funder master list. */
    const matchFunderId = (funderName: string): string | undefined => {
        const normalized = funderName.trim().toLowerCase();
        if (!normalized) return undefined;
        const match = funders.find(
            (f) =>
                f.funderName.trim().toLowerCase() === normalized ||
                f.funderName.trim().toLowerCase().includes(normalized) ||
                normalized.includes(f.funderName.trim().toLowerCase())
        );
        return match?.id;
    };

    const handleReportFilesSelected = async (client: EligibleClient, files: FileList | null) => {
        if (!files || files.length === 0) return;

        setParsingReport((prev) => ({ ...prev, [client.id]: true }));
        try {
            const existing = reportsByClientId[client.id] || {};
            const next: ClientReports = { ...existing };
            const added: string[] = [];
            const skipped: string[] = [];

            for (const f of Array.from(files)) {
                const text = await f.text();
                const kind = sniffReportType(text);
                if (kind === 'loanCard') {
                    next.loanCard = parseLoanCardReportCsv(text);
                    added.push(f.name);
                } else if (kind === 'repayment') {
                    next.repayment = parseRepaymentReportCsv(text);
                    added.push(f.name);
                } else {
                    skipped.push(f.name);
                }
            }

            setReportsByClientId((prev) => ({ ...prev, [client.id]: next }));

            // Auto-fill disbursement date + funder from the Loan Card Report, still editable.
            if (next.loanCard) {
                if (next.loanCard.disbursementDate) {
                    handleClientFormChange(
                        client.id,
                        'disbursementDate',
                        new Date(next.loanCard.disbursementDate).toISOString().split('T')[0]
                    );
                }
                const funderId = matchFunderId(next.loanCard.funderName);
                if (funderId) {
                    handleClientFormChange(client.id, 'funderId', funderId);
                }
            }

            toast({
                title: 'Loan history parsed',
                description:
                    `${added.length} file(s) attached` +
                    (skipped.length ? ` — ${skipped.length} file(s) not recognized: ${skipped.join(', ')}` : ''),
            });
        } catch {
            toast({
                title: 'Error',
                description: 'Failed to parse one or more loan history files',
                variant: 'destructive',
            });
        } finally {
            setParsingReport((prev) => ({ ...prev, [client.id]: false }));
        }
    };

    const removeReportFile = (clientId: string, kind: 'loanCard' | 'repayment') => {
        setReportsByClientId((prev) => {
            const existing = prev[clientId];
            if (!existing) return prev;
            const next = { ...existing };
            delete next[kind];
            const copy = { ...prev };
            if (!next.loanCard && !next.repayment) {
                delete copy[clientId];
            } else {
                copy[clientId] = next;
            }
            return copy;
        });
    };

    // Edits made in the attached report tables write straight back to reportsByClientId
    // (the source sent to save/import), same pattern as MemberUploanClient's history dialog.
    const updateLoanCardReport = (clientId: string, updated: ParsedLoanCardReport) => {
        setReportsByClientId((prev) => ({ ...prev, [clientId]: { ...prev[clientId], loanCard: updated } }));
    };

    const updateRepaymentReport = (clientId: string, updated: ParsedRepaymentReport) => {
        setReportsByClientId((prev) => ({ ...prev, [clientId]: { ...prev[clientId], repayment: updated } }));
    };

    const handleExpandClient = async (client: EligibleClient) => {
        if (expandedClientId === client.id) {
            setExpandedClientId(null);
            return;
        }

        setExpandedClientId(client.id);

        // Pre-fill form if backup exists
        const existingBackup = client.existingBackup;
        if (existingBackup) {
            setFormData((prev) => ({
                ...prev,
                [client.id]: {
                    loanProductTypeId: existingBackup.loanProductTypeId,
                    frequency: existingBackup.frequency,
                    loanProductId: existingBackup.loanProductId,
                    loanPurposeTypeId: existingBackup.loanPurposeTypeId,
                    loanPurposeId: existingBackup.loanPurposeId,
                    disbursementDate: existingBackup.disbursementDate
                        ? new Date(existingBackup.disbursementDate).toISOString().split('T')[0]
                        : '',
                    scheduleStartDate: existingBackup.firstDueDate
                        ? new Date(existingBackup.firstDueDate).toISOString().split('T')[0]
                        : '',
                    funderId: existingBackup.funderId || '',
                    principalPaid: existingBackup.principalPaid,
                    interestPaid: existingBackup.interestPaid,
                    savingsPaid: existingBackup.savingsPaid || 0,
                    goldLoanDetails: existingBackup.goldDetail
                        ? {
                              karatType: existingBackup.goldDetail.karatType,
                              gramCount: existingBackup.goldDetail.gramCount,
                              cashGiven: existingBackup.goldDetail.cashGiven,
                          }
                        : null,
                },
            }));

            // Fetch dependent data
            if (existingBackup.loanProductTypeId) {
                await fetchLoanProducts(existingBackup.loanProductTypeId);
            }
            if (existingBackup.loanPurposeTypeId) {
                await fetchLoanPurposes(existingBackup.loanPurposeTypeId);
            }
        }
    };

    const handleSaveClient = async (client: EligibleClient) => {
        const data = formData[client.id] || {};
        const reports = reportsByClientId[client.id];
        const hasReports = !!(reports?.loanCard || reports?.repayment);

        // Build validation errors map
        const errors: Record<string, string> = {};
        if (!data.loanProductTypeId) errors.loanProductTypeId = 'Required';
        if (!data.frequency) errors.frequency = 'Required';
        if (!data.loanProductId) errors.loanProductId = 'Required';
        if (!data.loanPurposeTypeId) errors.loanPurposeTypeId = 'Required';
        if (!data.loanPurposeId) errors.loanPurposeId = 'Required';
        if (!data.disbursementDate) errors.disbursementDate = 'Required';
        if (!data.scheduleStartDate) errors.scheduleStartDate = 'Required';

        // Validate gold loan fields if it's a gold loan
        const isGoldProduct = loanProductTypes.find(t => t.id === data.loanProductTypeId)?.name?.toLowerCase().includes('gold');
        if (isGoldProduct) {
            if (!data.goldLoanDetails?.karatType) errors['goldLoanDetails.karatType'] = 'Required';
            if (!data.goldLoanDetails?.gramCount) errors['goldLoanDetails.gramCount'] = 'Required';
            if (!data.goldLoanDetails?.cashGiven) errors['goldLoanDetails.cashGiven'] = 'Required';
        }

        // If there are errors, set them and show detailed alert
        if (Object.keys(errors).length > 0) {
            setFormErrors((prev) => ({ ...prev, [client.id]: errors }));
            const fieldNames = [
                errors.loanProductTypeId && 'Product Type',
                errors.frequency && 'Frequency',
                errors.loanProductId && 'Loan Product',
                errors.loanPurposeTypeId && 'Purpose Type',
                errors.loanPurposeId && 'Loan Purpose',
                errors.disbursementDate && 'Disbursement Date',
                errors.scheduleStartDate && 'First Due Date',
                errors['goldLoanDetails.karatType'] && 'Karat',
                errors['goldLoanDetails.gramCount'] && 'Gram',
                errors['goldLoanDetails.cashGiven'] && 'Cash Given',
            ]
                .filter(Boolean)
                .join(', ');
            const errorMessage = `Please fill required fields: ${fieldNames}`;
            setError(errorMessage);
            toast({
                title: 'Validation Error',
                description: errorMessage,
                variant: 'destructive',
            });
            return;
        }

        setIsSavingClient((prev) => ({ ...prev, [client.id]: true }));

        try {
            const payload = {
                clientId: client.id,
                centerId: selectedCenterId,
                branchId: selectedBranchId,
                groupId: selectedGroupId,
                loanProductId: data.loanProductId,
                loanProductTypeId: data.loanProductTypeId,
                frequency: data.frequency,
                loanPurposeId: data.loanPurposeId,
                disbursementDate: data.disbursementDate,
                scheduleStartDate: data.scheduleStartDate,
                funderId: data.funderId || undefined,
                principalPaid: hasReports ? 0 : parseFloat(data.principalPaid || 0),
                interestPaid: hasReports ? 0 : parseFloat(data.interestPaid || 0),
                savingsPaid: hasReports ? 0 : parseFloat(data.savingsPaid || 0),
                goldLoanDetails: data.goldLoanDetails ? {
                    karatType: data.goldLoanDetails.karatType,
                    gramCount: parseFloat(data.goldLoanDetails.gramCount),
                    pricePerGram: (() => {
                        const grams = parseFloat(data.goldLoanDetails.gramCount || 0);
                        const goldVal = parseFloat(data.goldLoanDetails.goldTakenValue || 0);
                        return grams > 0 ? parseFloat((goldVal / grams).toFixed(2)) : 0;
                    })(),
                    goldTakenValue: parseFloat(data.goldLoanDetails.goldTakenValue || 0),
                    cashGiven: parseFloat(data.goldLoanDetails.cashGiven || 0),
                } : undefined,
                loanCardReport: reports?.loanCard || undefined,
                repaymentReport: reports?.repayment || undefined,
            };

            const method = client.existingBackup ? 'PUT' : 'POST';
            const url = client.existingBackup
                ? `/api/ongoing-loan-backup/${client.existingBackup.loanId}`
                : '/api/ongoing-loan-backup';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to save backup loan',
                    variant: 'destructive',
                });
                return;
            }

            toast({
                title: 'Success',
                description: client.existingBackup ? 'Loan updated successfully' : 'Loan created successfully',
            });

            // Clear form errors for this client
            setFormErrors((prev) => {
                const updated = { ...prev };
                delete updated[client.id];
                return updated;
            });

            // Reload clients to update UI
            await loadClients();
            setExpandedClientId(null);
        } catch (err) {
            console.error('Error saving client backup:', err);
            toast({
                title: 'Error',
                description: 'Failed to save backup loan',
                variant: 'destructive',
            });
        } finally {
            setIsSavingClient((prev) => ({ ...prev, [client.id]: false }));
        }
    };

    const currentClientFormData = formData[expandedClientId!] || {};
    const currentErrors = formErrors[expandedClientId!] || {};
    const isGoldLoan = loanProductTypes.find(t => t.id === currentClientFormData.loanProductTypeId)?.name?.toLowerCase().includes('gold');
    const currentReports = reportsByClientId[expandedClientId!];
    const hasReports = !!(currentReports?.loanCard || currentReports?.repayment);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">Loan upload</h1>
                <p className="text-muted-foreground">
                    Import a historical loan and its repayment history for an existing, verified client
                </p>
            </div>

            {/* Alerts */}
            {error && (
                <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}
            {success && (
                <Alert>
                    <AlertDescription>{success}</AlertDescription>
                </Alert>
            )}

            {/* Filter Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Select Group</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Branch */}
                        <div className="space-y-2">
                            <Label>Branch *</Label>
                            {isLoadingBranches ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm text-muted-foreground">Loading...</span>
                                </div>
                            ) : (
                                <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select branch" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {branches.map((b) => (
                                            <SelectItem key={b.id} value={b.id}>
                                                {b.name} ({b.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Center */}
                        <div className="space-y-2">
                            <Label>Center *</Label>
                            {isFetchingCenters ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm text-muted-foreground">Loading...</span>
                                </div>
                            ) : (
                                <Select
                                    value={selectedCenterId}
                                    onValueChange={(val) => {
                                        setSelectedCenterId(val);
                                        setSelectedGroupId('');
                                        setClients([]);
                                    }}
                                    disabled={!selectedBranchId}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select center" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {centers.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name} ({c.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Group */}
                        <div className="space-y-2">
                            <Label>Group *</Label>
                            {isFetchingGroups ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm text-muted-foreground">Loading...</span>
                                </div>
                            ) : (
                                <Select
                                    value={selectedGroupId}
                                    onValueChange={(val) => {
                                        setSelectedGroupId(val);
                                        setClients([]);
                                    }}
                                    disabled={!selectedCenterId}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select group" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {groups.map((g) => (
                                            <SelectItem key={g.id} value={g.id}>
                                                {g.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </div>

                    <Button
                        onClick={loadClients}
                        disabled={!selectedGroupId || isLoadingClients}
                        className="w-full"
                    >
                        {isLoadingClients && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Load Clients
                    </Button>
                </CardContent>
            </Card>

            {/* Clients Table */}
            {clients.length > 0 && (
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap space-y-0">
                        <div>
                            <CardTitle>Eligible Clients</CardTitle>
                            <CardDescription>{searchedRows.length} client(s) found</CardDescription>
                        </div>
                        <TableSearchInput
                            value={tableSearchQuery}
                            onChange={setTableSearchQuery}
                            placeholder="Search clients..."
                        />
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-12">#</TableHead>
                                        <TableHead>Client ID</TableHead>
                                        <TableHead>Client Name</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Action</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {searchedRows.map((client, idx) => (
                                        <Fragment key={client.id}>
                                            <TableRow className="cursor-pointer hover:bg-muted/50">
                                                <TableCell>{idx + 1}</TableCell>
                                                <TableCell>{client.clientId}</TableCell>
                                                <TableCell>{client.name}</TableCell>
                                                <TableCell>
                                                    {client.hasBackup ? (
                                                        <Badge>Saved</Badge>
                                                    ) : (
                                                        <Badge variant="outline">Add</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleExpandClient(client)}
                                                    >
                                                        {expandedClientId === client.id ? (
                                                            <ChevronUp className="h-4 w-4" />
                                                        ) : (
                                                            <ChevronDown className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>

                                            {/* Expandable Form Row */}
                                            {expandedClientId === client.id && (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="bg-muted/50 p-4">
                                                        <div className="space-y-4">
                                                            {client.hasBackup && client.history && (
                                                                <div className="space-y-3 border rounded-lg p-3 bg-white">
                                                                    <div className="flex items-center gap-2">
                                                                        <Badge variant="secondary">Already migrated</Badge>
                                                                        <p className="text-xs text-gray-500">
                                                                            Read-only view of this client&apos;s existing backup loan history —
                                                                            editing the fields below updates the loan itself, not this history.
                                                                        </p>
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        <p className="text-xs font-semibold text-gray-600">Loan Card Schedule</p>
                                                                        <LoanCardScheduleTable report={client.history.loanCard} />
                                                                    </div>
                                                                    <div className="space-y-1">
                                                                        <p className="text-xs font-semibold text-gray-600">Repayment History</p>
                                                                        <RepaymentEventTable report={client.history.repayment} />
                                                                    </div>
                                                                </div>
                                                            )}
                                                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                                                {/* Product Type */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Product Type *</Label>
                                                                    <Select
                                                                        value={currentClientFormData.loanProductTypeId || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'loanProductTypeId', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className={`text-xs ${currentErrors.loanProductTypeId ? 'border-red-500' : ''}`}>
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {loanProductTypes.map((t) => (
                                                                                <SelectItem key={t.id} value={t.id}>
                                                                                    {t.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {currentErrors.loanProductTypeId && (
                                                                        <p className="text-xs text-red-500">{currentErrors.loanProductTypeId}</p>
                                                                    )}
                                                                </div>

                                                                {/* Frequency */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Frequency *</Label>
                                                                    <Select
                                                                        value={currentClientFormData.frequency || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'frequency', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className={`text-xs ${currentErrors.frequency ? 'border-red-500' : ''}`}>
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="weekly">Weekly</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {currentErrors.frequency && (
                                                                        <p className="text-xs text-red-500">{currentErrors.frequency}</p>
                                                                    )}
                                                                </div>

                                                                {/* Loan Product */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Loan Product *</Label>
                                                                    <Select
                                                                        value={currentClientFormData.loanProductId || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'loanProductId', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className={`text-xs ${currentErrors.loanProductId ? 'border-red-500' : ''}`}>
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {loanProducts.map((p) => (
                                                                                <SelectItem key={p.id} value={p.id}>
                                                                                    {p.productName}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {currentErrors.loanProductId && (
                                                                        <p className="text-xs text-red-500">{currentErrors.loanProductId}</p>
                                                                    )}
                                                                </div>

                                                                {/* Purpose Type */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Purpose Type *</Label>
                                                                    <Select
                                                                        value={currentClientFormData.loanPurposeTypeId || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'loanPurposeTypeId', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className={`text-xs ${currentErrors.loanPurposeTypeId ? 'border-red-500' : ''}`}>
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {loanPurposeTypes.map((t) => (
                                                                                <SelectItem key={t.id} value={t.id}>
                                                                                    {t.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {currentErrors.loanPurposeTypeId && (
                                                                        <p className="text-xs text-red-500">{currentErrors.loanPurposeTypeId}</p>
                                                                    )}
                                                                </div>

                                                                {/* Loan Purpose */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Loan Purpose *</Label>
                                                                    <Select
                                                                        value={currentClientFormData.loanPurposeId || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'loanPurposeId', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className={`text-xs ${currentErrors.loanPurposeId ? 'border-red-500' : ''}`}>
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {loanPurposes.map((p) => (
                                                                                <SelectItem key={p.id} value={p.id}>
                                                                                    {p.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {currentErrors.loanPurposeId && (
                                                                        <p className="text-xs text-red-500">{currentErrors.loanPurposeId}</p>
                                                                    )}
                                                                </div>

                                                                {/* Date of Disbursement */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Date of Disbursement *</Label>
                                                                    <DateInput
                                                                        value={currentClientFormData.disbursementDate || ''}
                                                                        onChange={(e) =>
                                                                            handleClientFormChange(client.id, 'disbursementDate', e.target.value)
                                                                        }
                                                                        className={`text-xs ${currentErrors.disbursementDate ? 'border-red-500' : ''}`}
                                                                    />
                                                                    {currentErrors.disbursementDate && (
                                                                        <p className="text-xs text-red-500">{currentErrors.disbursementDate}</p>
                                                                    )}
                                                                </div>

                                                                {/* First Due Date */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">First Due Date *</Label>
                                                                    <DateInput
                                                                        value={currentClientFormData.scheduleStartDate || ''}
                                                                        onChange={(e) =>
                                                                            handleClientFormChange(client.id, 'scheduleStartDate', e.target.value)
                                                                        }
                                                                        className={`text-xs ${currentErrors.scheduleStartDate ? 'border-red-500' : ''}`}
                                                                    />
                                                                    {currentErrors.scheduleStartDate && (
                                                                        <p className="text-xs text-red-500">{currentErrors.scheduleStartDate}</p>
                                                                    )}
                                                                </div>

                                                                {/* Funder */}
                                                                <div className="space-y-2">
                                                                    <Label className="text-xs font-semibold">Funder</Label>
                                                                    <Select
                                                                        value={currentClientFormData.funderId || ''}
                                                                        onValueChange={(val) =>
                                                                            handleClientFormChange(client.id, 'funderId', val)
                                                                        }
                                                                    >
                                                                        <SelectTrigger className="text-xs">
                                                                            <SelectValue placeholder="Select" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {funders.map((f) => (
                                                                                <SelectItem key={f.id} value={f.id}>
                                                                                    {f.funderName}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>

                                                                {/* Principal / Interest / Loan Advance Paid — manual entry, hidden when upload reports are attached */}
                                                                {!hasReports && (
                                                                    <>
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Principal Paid (₹)</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.01"
                                                                                value={currentClientFormData.principalPaid || ''}
                                                                                onChange={(e) =>
                                                                                    handleClientFormChange(client.id, 'principalPaid', e.target.value)
                                                                                }
                                                                                className="text-xs"
                                                                                placeholder="0"
                                                                            />
                                                                        </div>

                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Interest Paid (₹)</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.01"
                                                                                value={currentClientFormData.interestPaid || ''}
                                                                                onChange={(e) =>
                                                                                    handleClientFormChange(client.id, 'interestPaid', e.target.value)
                                                                                }
                                                                                className="text-xs"
                                                                                placeholder="0"
                                                                            />
                                                                        </div>

                                                                        {loanAdvanceEnabled && (
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Loan Advance Paid (₹)</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.01"
                                                                                value={currentClientFormData.savingsPaid || ''}
                                                                                onChange={(e) =>
                                                                                    handleClientFormChange(client.id, 'savingsPaid', e.target.value)
                                                                                }
                                                                                className="text-xs"
                                                                                placeholder="0"
                                                                            />
                                                                        </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>

                                                            {/* Gold Loan Fields */}
                                                            {isGoldLoan && (
                                                                <div className="border-t pt-4 mt-4 space-y-4">
                                                                    <div className="font-semibold text-sm">Gold Loan Details</div>
                                                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                                                                        {/* Karat */}
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Karat *</Label>
                                                                            <Select
                                                                                value={currentClientFormData.goldLoanDetails?.karatType || ''}
                                                                                onValueChange={(val) =>
                                                                                    handleClientFormChange(client.id, 'goldLoanDetails', {
                                                                                        ...currentClientFormData.goldLoanDetails,
                                                                                        karatType: val,
                                                                                    })
                                                                                }
                                                                            >
                                                                                <SelectTrigger className={`text-xs ${currentErrors['goldLoanDetails.karatType'] ? 'border-red-500' : ''}`}>
                                                                                    <SelectValue placeholder="Select" />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="24K">24K</SelectItem>
                                                                                    <SelectItem value="22K">22K</SelectItem>
                                                                                    <SelectItem value="20K">20K</SelectItem>
                                                                                    <SelectItem value="18K">18K</SelectItem>
                                                                                    <SelectItem value="16K">16K</SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                            {currentErrors['goldLoanDetails.karatType'] && (
                                                                                <p className="text-xs text-red-500">{currentErrors['goldLoanDetails.karatType']}</p>
                                                                            )}
                                                                        </div>

                                                                        {/* Gram */}
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Gram *</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.001"
                                                                                value={currentClientFormData.goldLoanDetails?.gramCount || ''}
                                                                                onChange={(e) =>
                                                                                    handleClientFormChange(client.id, 'goldLoanDetails', {
                                                                                        ...currentClientFormData.goldLoanDetails,
                                                                                        gramCount: e.target.value,
                                                                                    })
                                                                                }
                                                                                className={`text-xs ${currentErrors['goldLoanDetails.gramCount'] ? 'border-red-500' : ''}`}
                                                                                placeholder="0.000"
                                                                            />
                                                                            {currentErrors['goldLoanDetails.gramCount'] && (
                                                                                <p className="text-xs text-red-500">{currentErrors['goldLoanDetails.gramCount']}</p>
                                                                            )}
                                                                        </div>

                                                                        {/* Gold Value */}
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Gold Value (₹) *</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.01"
                                                                                value={currentClientFormData.goldLoanDetails?.goldTakenValue || ''}
                                                                                onChange={(e) => handleClientFormChange(client.id, 'goldLoanDetails', {
                                                                                    ...currentClientFormData.goldLoanDetails,
                                                                                    goldTakenValue: parseFloat(e.target.value || '0'),
                                                                                })}
                                                                                className="text-xs"
                                                                                placeholder="0.00"
                                                                            />
                                                                        </div>

                                                                        {/* Cash Given */}
                                                                        <div className="space-y-2">
                                                                            <Label className="text-xs font-semibold">Cash Given (₹) *</Label>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                step="0.01"
                                                                                value={currentClientFormData.goldLoanDetails?.cashGiven || ''}
                                                                                onChange={(e) => handleClientFormChange(client.id, 'goldLoanDetails', {
                                                                                    ...currentClientFormData.goldLoanDetails,
                                                                                    cashGiven: parseFloat(e.target.value || '0'),
                                                                                })}
                                                                                className={`text-xs ${currentErrors['goldLoanDetails.cashGiven'] ? 'border-red-500' : ''}`}
                                                                                placeholder="0.00"
                                                                            />
                                                                            {currentErrors['goldLoanDetails.cashGiven'] && (
                                                                                <p className="text-xs text-red-500">{currentErrors['goldLoanDetails.cashGiven']}</p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}

                                                            {/* upload Loan History (optional) */}
                                                            <div className="border-t pt-4 mt-4 space-y-3">
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <div className="font-semibold text-sm">Loan History upload (optional)</div>
                                                                        <p className="text-xs text-muted-foreground">
                                                                            Attach the Loan Card Report + Repayment Report CSVs for an exact
                                                                            schedule and real transaction history, instead of the manual paid amounts above.
                                                                        </p>
                                                                    </div>
                                                                    <div>
                                                                        <input
                                                                            type="file"
                                                                            accept=".csv"
                                                                            multiple
                                                                            className="hidden"
                                                                            id={`report-upload-${client.id}`}
                                                                            onChange={(e) => {
                                                                                handleReportFilesSelected(client, e.target.files);
                                                                                e.target.value = '';
                                                                            }}
                                                                        />
                                                                        <Button
                                                                            type="button"
                                                                            variant="outline"
                                                                            size="sm"
                                                                            disabled={parsingReport[client.id]}
                                                                            onClick={() =>
                                                                                document.getElementById(`report-upload-${client.id}`)?.click()
                                                                            }
                                                                        >
                                                                            {parsingReport[client.id] ? (
                                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                            ) : (
                                                                                <FileText className="mr-2 h-4 w-4" />
                                                                            )}
                                                                            Upload CSV(s)
                                                                        </Button>
                                                                    </div>
                                                                </div>

                                                                {currentReports?.loanCard && (
                                                                    <div className="space-y-2">
                                                                        <div className="flex items-center justify-between">
                                                                            <Badge variant="secondary">Loan Card Report attached</Badge>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                onClick={() => removeReportFile(client.id, 'loanCard')}
                                                                            >
                                                                                <X className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                        <LoanCardScheduleTable
                                                                            report={currentReports.loanCard}
                                                                            onChange={(updated) => updateLoanCardReport(client.id, updated)}
                                                                        />
                                                                    </div>
                                                                )}

                                                                {currentReports?.repayment && (
                                                                    <div className="space-y-2">
                                                                        <div className="flex items-center justify-between">
                                                                            <Badge variant="secondary">Repayment Report attached</Badge>
                                                                            <Button
                                                                                type="button"
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                onClick={() => removeReportFile(client.id, 'repayment')}
                                                                            >
                                                                                <X className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                        <RepaymentEventTable
                                                                            report={currentReports.repayment}
                                                                            onChange={(updated) => updateRepaymentReport(client.id, updated)}
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Action Buttons */}
                                                            <div className="flex gap-2 mt-4 pt-4 border-t">
                                                                <Button
                                                                    onClick={() => handleSaveClient(client)}
                                                                    disabled={isSavingClient[client.id]}
                                                                    className="flex-1"
                                                                    size="sm"
                                                                >
                                                                    {isSavingClient[client.id] && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                                                    <Save className="mr-2 h-4 w-4" />
                                                                    {client.existingBackup ? 'Update' : 'Save'} Loan
                                                                </Button>
                                                                <Button
                                                                    onClick={() => {
                                                                        setExpandedClientId(null);
                                                                        setFormErrors((prev) => {
                                                                            const updated = { ...prev };
                                                                            delete updated[client.id];
                                                                            return updated;
                                                                        });
                                                                    }}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="flex-1"
                                                                >
                                                                    Cancel
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                        </Fragment>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
