'use client';

import { useState, useEffect } from 'react';
import { Search, RotateCcw, UserSearch } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { getKycDocumentTypeLabel } from '@/app/lib/kyc-document-types';
import {
    ClientSearchResult,
    ClientSearchResultsTable,
} from '@/components/client/ClientSearchResultsTable';
import {
    KycDocument,
    KycPreviewDialog,
} from '@/components/client/KycPreviewDialog';
import { LoanInfo, LoanInfoDialog } from '@/components/client/LoanInfoDialog';
import { AdvanceInfoDialog, AdvanceRow } from '@/components/client/AdvanceInfoDialog';

type ClientSearchType =
    | 'clientId'
    | 'clientName'
    | 'phone'
    | 'aadhaar'
    | 'centerCode';

interface SearchOption {
    value: ClientSearchType;
    label: string;
}

const searchOptions: SearchOption[] = [
    { value: 'clientId', label: 'ID' },
    { value: 'clientName', label: 'Name' },
    { value: 'phone', label: 'Mobile Number' },
    { value: 'aadhaar', label: 'Aadhaar Number' },
    { value: 'centerCode', label: 'Center Code' },
];

export function ClientSearchForm() {
    const [searchType, setSearchType] = useState<ClientSearchType | ''>('');
    const [searchValue, setSearchValue] = useState('');
    const [isMounted, setIsMounted] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [results, setResults] = useState<ClientSearchResult[]>([]);
    const [selectedClientForKyc, setSelectedClientForKyc] =
        useState<ClientSearchResult | null>(null);
    const [isKycDialogOpen, setIsKycDialogOpen] = useState(false);
    const [kycDocuments, setKycDocuments] = useState<KycDocument[]>([]);
    const [isLoadingKycDocuments, setIsLoadingKycDocuments] = useState(false);
    const [selectedClientForLoan, setSelectedClientForLoan] =
        useState<ClientSearchResult | null>(null);
    const [isLoanDialogOpen, setIsLoanDialogOpen] = useState(false);
    const [selectedClientForAdvance, setSelectedClientForAdvance] =
        useState<ClientSearchResult | null>(null);
    const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
    const [loanData, setLoanData] = useState<LoanInfo[]>([]);
    const [isLoadingLoans, setIsLoadingLoans] = useState(false);
    const [advanceData, setAdvanceData] = useState<AdvanceRow[]>([]);
    const [isLoadingAdvance, setIsLoadingAdvance] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!searchType || !searchValue.trim()) {
            toast({
                title: 'Search criteria required',
                description: 'Please choose a search type and enter a search value.',
                variant: 'destructive',
            });
            return;
        }

        setIsSearching(true);

        try {
            const params = new URLSearchParams({
                searchType,
                searchValue: searchValue.trim(),
            });

            const result = await apiClient.get<{
                clients: ClientSearchResult[];
                pagination: { currentPage: number; pageSize: number; totalItems: number; totalPages: number };
            }>(`/clients/search?${params.toString()}`);

            if (result.success && result.data) {
                const clients = result.data.clients ?? [];
                setResults(clients);
                if (clients.length === 0) {
                    toast({
                        title: 'No Results',
                        description: 'No clients found matching your search criteria.',
                    });
                } else {
                    toast({
                        title: 'Search Complete',
                        description: `Found ${result.data.pagination.totalItems} client(s).`,
                    });
                }
            } else {
                setResults([]);
                toast({
                    title: 'Search Failed',
                    description: 'Unable to retrieve client records. Please try again.',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Client search error:', error);
            setResults([]);
            toast({
                title: 'Error',
                description: 'An error occurred while searching. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSearching(false);
        }
    };

    const handleReset = () => {
        setSearchType('');
        setSearchValue('');
        setResults([]);
        setSelectedClientForKyc(null);
        setIsKycDialogOpen(false);
        setKycDocuments([]);
        setSelectedClientForLoan(null);
        setIsLoanDialogOpen(false);
        setLoanData([]);
        setSelectedClientForAdvance(null);
        setIsAdvanceDialogOpen(false);
        setAdvanceData([]);
    };

    const fetchLoanData = async (clientId: string): Promise<LoanInfo[]> => {
        setIsLoadingLoans(true);
        try {
            const result = await apiClient.get<{ clientId: string; loans: LoanInfo[] }>(
                `/clients/${clientId}/loans`
            );
            if (result.success && result.data) {
                return result.data.loans ?? [];
            }
            return [];
        } catch (error) {
            console.error('Error fetching loan data:', error);
            toast({
                title: 'Error',
                description: 'Failed to load loan information. Please try again.',
                variant: 'destructive',
            });
            return [];
        } finally {
            setIsLoadingLoans(false);
        }
    };

    const fetchAdvanceData = async (clientId: string): Promise<AdvanceRow[]> => {
        setIsLoadingAdvance(true);
        try {
            const result = await apiClient.get<{ clientId: string; advanceRows: AdvanceRow[] }>(
                `/clients/${clientId}/advance`
            );
            if (result.success && result.data) {
                return result.data.advanceRows ?? [];
            }
            return [];
        } catch (error) {
            console.error('Error fetching advance data:', error);
            toast({
                title: 'Error',
                description: 'Failed to load advance information. Please try again.',
                variant: 'destructive',
            });
            return [];
        } finally {
            setIsLoadingAdvance(false);
        }
    };

    const fetchKycDocuments = async (clientId: string): Promise<KycDocument[]> => {
        setIsLoadingKycDocuments(true);
        try {
            const result = await apiClient.get<{
                clientId: string;
                documents: Array<{
                    id: string;
                    documentType: string;
                    fileUrl: string | null;
                    fileName: string | null;
                    fileSize: number | null;
                    mimeType: string | null;
                    uploadedAt: Date;
                }>;
            }>(`/clients/${clientId}/kyc-documents`);

            if (result.success && result.data) {
                // Transform API response to KycDocument format
                const documents: KycDocument[] = result.data.documents
                    .filter((doc) => doc.fileUrl) // Only include documents with URLs
                    .map((doc) => {
                        return {
                            id: doc.id,
                            name: getKycDocumentTypeLabel(doc.documentType),
                            imageUrl: doc.fileUrl!,
                            value: doc.fileName || getKycDocumentTypeLabel(doc.documentType),
                        };
                    });

                return documents;
            }

            return [];
        } catch (error) {
            console.error('Error fetching KYC documents:', error);
            toast({
                title: 'Error',
                description: 'Failed to load KYC documents. Please try again.',
                variant: 'destructive',
            });
            return [];
        } finally {
            setIsLoadingKycDocuments(false);
        }
    };

    const handleShowKyc = async (client: ClientSearchResult) => {
        setSelectedClientForKyc(client);
        setIsKycDialogOpen(true);

        // Fetch KYC documents for this client
        const documents = await fetchKycDocuments(client.accountId);
        setKycDocuments(documents);
    };

    return (
            <div className="relative w-full max-w-6xl">
            {/* Background Accent */}
            <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-r from-primary/15 via-primary/10 to-primary/15 blur-2xl" />

            {/* Main Card */}
            <div
                className={cn(
                    'relative overflow-hidden rounded-3xl border border-primary/20/80 bg-white/95 shadow-2xl transition-all duration-700 dark:border-sidebar-accent/60 dark:bg-brand-green-darker/95',
                    isMounted && 'animate-in fade-in slide-in-from-bottom-4 duration-700'
                )}
            >
                {/* Top Accent Bar */}
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-primary bg-[length:200%_100%] animate-shimmer" />

                {/* Header */}
                <div className="bg-gradient-to-r from-slate-50 via-green-50/60 to-green-50/60 px-4 sm:px-8 py-6 dark:from-brand-green-darker dark:via-brand-green-darker/80 dark:to-brand-green-darker">
                    <div className="flex items-center gap-4">
                        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary shadow-lg shadow-primary/30">
                            <UserSearch className="h-6 w-6 text-white" />
                            <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/15 to-transparent" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                            <h1 className="text-xl font-semibold tracking-tight text-foreground dark:text-white">
                                Client Enhanced Search
                            </h1>
                            <p className="text-xs text-sidebar-accent dark:text-slate-400">
                                Quickly locate clients using flexible search criteria.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Form */}
                <div className="px-4 sm:px-8 py-6">
                    <form
                        onSubmit={handleSubmit}
                        className="flex flex-col gap-6"
                        aria-label="Member / client search form"
                    >
                        <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                            {/* Search Type */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="searchType"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Search Type
                                </Label>
                                <Select
                                    value={searchType}
                                    onValueChange={(value: ClientSearchType) =>
                                        setSearchType(value)
                                    }
                                >
                                    <SelectTrigger
                                        id="searchType"
                                        className={cn(
                                            'h-11 w-full border border-primary/30 text-sm font-medium',
                                            'bg-green-50 hover:border-primary focus:border-primary focus:ring-2 focus:ring-primary/20',
                                            'dark:bg-brand-green-darker dark:border-sidebar-accent'
                                        )}
                                    >
                                        <SelectValue placeholder="-- SELECT --" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {searchOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                                className="cursor-pointer text-sm"
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Search Value */}
                            <div className="space-y-2">
                                <Label
                                    htmlFor="searchValue"
                                    className="text-sm font-semibold text-sidebar-accent dark:text-slate-200"
                                >
                                    Search Value
                                </Label>
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        id="searchValue"
                                        value={searchValue}
                                        onChange={(event) => setSearchValue(event.target.value)}
                                        placeholder="Enter value to search"
                                        className="h-11 pl-9 text-sm bg-green-50 border border-primary/30 focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-brand-green-darker dark:border-sidebar-accent"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 pt-2">
                            <Button
                                type="submit"
                                disabled={isSearching}
                                className="h-10 px-6 text-sm font-semibold bg-primary hover:bg-primary text-white shadow-sm"
                            >
                                {isSearching ? (
                                    <span className="flex items-center gap-2">
                                        <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        Searching...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <Search className="h-4 w-4" />
                                        Search
                                    </span>
                                )}
                            </Button>

                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleReset}
                                disabled={isSearching}
                                className="h-10 px-5 text-sm font-semibold border-primary/30 text-sidebar-accent hover:border-red-300 hover:text-red-600 hover:bg-red-50 dark:border-sidebar-accent dark:text-slate-200 dark:hover:border-red-600 dark:hover:text-red-400 dark:hover:bg-red-950/30"
                            >
                                <span className="flex items-center gap-2">
                                    <RotateCcw className="h-4 w-4" />
                                    Reset
                                </span>
                            </Button>
                        </div>
                    </form>
                </div>

                {/* Results Table */}
                <div className="px-4 pb-6 pt-1">
                    <ClientSearchResultsTable
                        results={results}
                        onShowKyc={(result) => {
                            void handleShowKyc(result);
                        }}
                        onShowLoan={(result) => {
                            setSelectedClientForLoan(result);
                            setIsLoanDialogOpen(true);
                            fetchLoanData(result.accountId).then(setLoanData);
                        }}
                        onShowAdvance={(result) => {
                            setSelectedClientForAdvance(result);
                            setIsAdvanceDialogOpen(true);
                            fetchAdvanceData(result.accountId).then(setAdvanceData);
                        }}
                    />
                </div>
            </div>

            {/* KYC Preview */}
            <KycPreviewDialog
                isOpen={isKycDialogOpen}
                onOpenChange={(open) => {
                    setIsKycDialogOpen(open);
                    if (!open) {
                        setSelectedClientForKyc(null);
                        setKycDocuments([]);
                    }
                }}
                client={selectedClientForKyc}
                documents={kycDocuments}
                isLoading={isLoadingKycDocuments}
            />

            {/* Loan Info */}
            <LoanInfoDialog
                isOpen={isLoanDialogOpen}
                onOpenChange={(open) => {
                    setIsLoanDialogOpen(open);
                    if (!open) {
                        setSelectedClientForLoan(null);
                        setLoanData([]);
                    }
                }}
                clientName={selectedClientForLoan?.clientName ?? null}
                centerName={selectedClientForLoan?.centerName ?? null}
                loans={loanData}
                isLoading={isLoadingLoans}
            />

            {/* Advance Info */}
            <AdvanceInfoDialog
                isOpen={isAdvanceDialogOpen}
                onOpenChange={(open) => {
                    setIsAdvanceDialogOpen(open);
                    if (!open) {
                        setSelectedClientForAdvance(null);
                        setAdvanceData([]);
                    }
                }}
                clientName={selectedClientForAdvance?.clientName ?? null}
                centerName={selectedClientForAdvance?.centerName ?? null}
                rows={advanceData}
                isLoading={isLoadingAdvance}
            />
        </div>
    );
}



