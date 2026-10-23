'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Search,
    X,
    ShieldCheck,
    Edit,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { branchStorage } from '@/app/lib/branch-storage';
import { tokenStorage } from '@/app/lib/token-storage';
import { KYCStatusUpdateModal } from './KYCStatusUpdateModal';
import { PageLoader } from '@/components/ui/page-loader';
import { toDisplayDate } from '@/app/lib/date-format';

import { matchesMemberSearch } from '@/app/lib/reports/member-contact-columns';
type Center = {
    id: string;
    name: string;
    code: string;
};

type Client = {
    id: string;
    clientId: string;
    firstName: string;
    lastName: string;
    otherIdNo?: string | null;
    mobileNumber?: string | null;
    dateOfJoining?: string | null;
    verificationStatus?: string | null;
    center?: {
        id: string;
        name: string;
        code: string;
    } | null;
};

const getStatusBadge = (client: Client) => {
    if (client.verificationStatus === 'VERIFIED') {
        return { label: 'Fully Verified', variant: 'default' as const };
    }

    if (client.verificationStatus === 'REJECTED') {
        return { label: 'Rejected', variant: 'destructive' as const };
    }

    if (client.verificationStatus === 'UNDER_REVIEW') {
        return { label: 'Pending AM Verification', variant: 'outline' as const };
    }

    return { label: 'Pending BM Verification', variant: 'secondary' as const };
};

export function KYCVerificationTable() {
    const { toast } = useToast();
    const [centers, setCenters] = useState<Center[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingClients, setIsLoadingClients] = useState(false);

    // Filters and search
    const [selectedCenterId, setSelectedCenterId] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Modal state
    const [selectedClient, setSelectedClient] = useState<Client | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const currentUser = tokenStorage.getUser();
    const currentUserRole = currentUser?.role;

    // Fetch centers on mount
    useEffect(() => {
        fetchCenters();
    }, []);

    // Fetch clients when center changes
    useEffect(() => {
        if (selectedCenterId && selectedCenterId !== 'all') {
            fetchClients(selectedCenterId);
        } else if (selectedCenterId === 'all') {
            // Fetch all clients for the branch
            fetchAllClients();
        } else {
            setClients([]);
        }
    }, [selectedCenterId]);

    const fetchCenters = async () => {
        setIsLoading(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            const storedUser = tokenStorage.getUser();
            const branchId = activeBranch?.id || storedUser?.branchId;

            if (!branchId) {
                toast({
                    title: 'Error',
                    description: 'No branch found. Please select a branch first.',
                    variant: 'destructive',
                });
                setIsLoading(false);
                return;
            }

            const result = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );

            if (result.success && result.data) {
                setCenters(result.data);
            } else {
                toast({
                    title: 'Error',
                    description: result.error || 'Failed to load centers.',
                    variant: 'destructive',
                });
                setCenters([]);
            }
        } catch (error) {
            console.error('Error fetching centers:', error);
            toast({
                title: 'Error',
                description: 'Failed to load centers. Please try again.',
                variant: 'destructive',
            });
            setCenters([]);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchClients = async (centerId: string) => {
        setIsLoadingClients(true);
        try {
            const result = await apiClient.get<{ clients: Client[]; pagination?: any }>(
                `/clients?centerId=${centerId}&includeInactive=false`
            ).catch(() => {
                return { success: true, data: { clients: [], pagination: {} } };
            });

            if (result.success && result.data) {
                // Handle both response formats: direct array or {clients: []} object
                const clientsData = Array.isArray(result.data)
                    ? result.data
                    : (result.data.clients || []);
                setClients(clientsData);
            } else {
                setClients([]);
            }
        } catch (error) {
            console.error('Error fetching clients:', error);
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    };

    const fetchAllClients = async () => {
        setIsLoadingClients(true);
        try {
            const activeBranch = branchStorage.getActiveBranch();
            const storedUser = tokenStorage.getUser();
            const branchId = activeBranch?.id || storedUser?.branchId;

            if (!branchId) {
                setClients([]);
                setIsLoadingClients(false);
                return;
            }

            // Fetch clients from all centers in the branch
            const centersResult = await apiClient.get<Center[]>(
                `/centers?branchId=${branchId}&includeInactive=false&status=APPROVED`
            );

            if (centersResult.success && centersResult.data) {
                const allClients: Client[] = [];

                // Fetch clients from each center
                for (const center of centersResult.data) {
                    const clientsResult = await apiClient.get<{ clients: Client[]; pagination?: any }>(
                        `/clients?centerId=${center.id}&includeInactive=false`
                    ).catch(() => ({ success: true, data: { clients: [], pagination: {} } }));

                    if (clientsResult.success && clientsResult.data) {
                        // Handle both response formats
                        const clientsData = Array.isArray(clientsResult.data)
                            ? clientsResult.data
                            : (clientsResult.data.clients || []);

                        if (Array.isArray(clientsData)) {
                            // Add center info to each client
                            const clientsWithCenter = clientsData.map(client => ({
                                ...client,
                                center: {
                                    id: center.id,
                                    name: center.name,
                                    code: center.code,
                                },
                            }));
                            allClients.push(...clientsWithCenter);
                        }
                    }
                }

                setClients(allClients);
            } else {
                setClients([]);
            }
        } catch (error) {
            console.error('Error fetching all clients:', error);
            setClients([]);
        } finally {
            setIsLoadingClients(false);
        }
    };

    // Filter clients
    const filteredClients = useMemo(() => {
        // Ensure clients is always an array
        if (!Array.isArray(clients)) {
            return [];
        }

        let filtered = clients;

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter((client) =>
                matchesMemberSearch(
                    searchQuery,
                    { aadhaarNumber: client.otherIdNo, mobileNumber: client.mobileNumber },
                    client.clientId,
                    `${client.firstName} ${client.lastName}`,
                    client.center?.name,
                    client.center?.code,
                )
            );
        }

        // Status filter
        if (selectedStatus !== 'all') {
            filtered = filtered.filter((client) => {
                const selectedLower = selectedStatus.toLowerCase();
                const badge = getStatusBadge(client);
                const badgeLower = badge.label.toLowerCase();

                if (selectedStatus === 'pending') {
                    return badgeLower.includes('pending');
                } else if (selectedStatus === 'verified') {
                    return badgeLower.includes('verified');
                } else if (selectedStatus === 'rejected') {
                    return badgeLower.includes('rejected');
                } else if (selectedStatus === 'under_review') {
                    return badgeLower.includes('am verification') || badgeLower.includes('review');
                }
                return false;
            });
        }

        return filtered;
    }, [clients, searchQuery, selectedStatus]);

    // Pagination
    const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
    const paginatedClients = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        return filteredClients.slice(start, end);
    }, [filteredClients, currentPage, itemsPerPage]);

    const clearFilters = () => {
        setSearchQuery('');
        setSelectedStatus('all');
        setCurrentPage(1);
    };

    const hasActiveFilters = searchQuery || selectedStatus !== 'all';

    const handleUpdateStatus = (client: Client) => {
        setSelectedClient(client);
        setIsModalOpen(true);
    };

    const handleModalSuccess = () => {
        // Refresh clients after successful update
        if (selectedCenterId && selectedCenterId !== 'all') {
            fetchClients(selectedCenterId);
        } else {
            fetchAllClients();
        }
        setSelectedClient(null);
    };

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-4">
                    <PageLoader label="Loading centers..." fullScreen={false} />
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* Search and Filters */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <CardContent className="p-4">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green-tint dark:bg-brand-green-darker/30">
                                    <ShieldCheck className="h-5 w-5 text-primary dark:text-primary" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-foreground dark:text-white">
                                        KYC Verification
                                    </h3>
                                    <p className="text-sm text-muted-foreground">
                                        View and update client verification status
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 md:flex-row md:items-center">
                            {/* Search */}
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    type="text"
                                    placeholder="Search by Member ID, Name, Aadhaar, Mobile or Center..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="h-10 pl-9 pr-9"
                                />
                                {searchQuery && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            {/* Filters */}
                            <div className="flex flex-wrap gap-2">
                                <Select
                                    value={selectedCenterId}
                                    onValueChange={(value) => {
                                        setSelectedCenterId(value);
                                        setCurrentPage(1);
                                    }}
                                    disabled={isLoadingClients}
                                >
                                    <SelectTrigger className="h-10 w-[200px]">
                                        <SelectValue placeholder="Select Center" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Centers</SelectItem>
                                        {centers.map((center) => (
                                            <SelectItem key={center.id} value={center.id}>
                                                {center.name} ({center.code})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Select
                                    value={selectedStatus}
                                    onValueChange={(value) => {
                                        setSelectedStatus(value);
                                        setCurrentPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-10 w-[180px]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Status</SelectItem>
                                        <SelectItem value="pending">Pending</SelectItem>
                                        <SelectItem value="verified">Verified</SelectItem>
                                        <SelectItem value="rejected">Rejected</SelectItem>
                                        <SelectItem value="under_review">Under Review</SelectItem>
                                    </SelectContent>
                                </Select>

                                {hasActiveFilters && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={clearFilters}
                                        className="h-10"
                                    >
                                        <X className="mr-2 h-4 w-4" />
                                        Clear Filters
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary via-primary to-purple-600" />
                <div className="overflow-hidden">
                    <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                        <Table className="min-w-full text-xs">
                            <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-primary via-primary to-primary text-white">
                                <TableRow className="hover:bg-primary/80">
                                    <TableHead className="px-4 py-3 font-semibold text-white">
                                        Client ID
                                    </TableHead>
                                    <TableHead className="px-4 py-3 font-semibold text-white">
                                        Client Name
                                    </TableHead>
                                    <TableHead className="px-4 py-3 font-semibold text-white">
                                        Center
                                    </TableHead>
                                    <TableHead className="px-4 py-3 font-semibold text-white">
                                        Date of Joining
                                    </TableHead>
                                    <TableHead className="px-4 py-3 text-center font-semibold text-white">
                                        Status
                                    </TableHead>
                                    <TableHead className="px-4 py-3 text-center font-semibold text-white">
                                        Actions
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="bg-white dark:bg-green-950/30">
                                {isLoadingClients ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-4">
                                            <PageLoader label="Loading clients..." fullScreen={false} />
                                        </TableCell>
                                    </TableRow>
                                ) : paginatedClients.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="px-4 py-8 text-center">
                                            <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                                {clients.length === 0
                                                    ? 'No clients found. Please select a center.'
                                                    : 'No clients found matching your filters.'}
                                            </p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    paginatedClients.map((client) => {
                                        const statusBadge = getStatusBadge(client);
                                        const canUpdateStatus =
                                            currentUserRole === 'BRANCH_MANAGER'
                                                ? client.verificationStatus !== 'VERIFIED'
                                                : currentUserRole === 'AREA_MANAGER'
                                                    ? client.verificationStatus === 'UNDER_REVIEW'
                                                    : false;
                                        return (
                                            <TableRow
                                                key={client.id}
                                                className={cn(
                                                    'bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors',
                                                    'dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80'
                                                )}
                                            >
                                                <TableCell className="px-4 py-3 font-medium text-foreground dark:text-slate-100">
                                                    {client.clientId}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                                    {client.firstName} {client.lastName}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">
                                                    {client.center ? (
                                                        <div>
                                                            <div className="font-medium">{client.center.name}</div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {client.center.code}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-muted-foreground">—</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">
                                                    {client.dateOfJoining
                                                        ? toDisplayDate(new Date(client.dateOfJoining))
                                                        : '—'}
                                                </TableCell>
                                                <TableCell className="px-4 py-3 text-center">
                                                    <Badge variant={statusBadge.variant} className="text-xs">
                                                        {statusBadge.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="px-4 py-3">
                                                    <div className="flex items-center justify-center">
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleUpdateStatus(client)}
                                                            disabled={!canUpdateStatus}
                                                            className="h-8 gap-2"
                                                        >
                                                            <Edit className="h-3.5 w-3.5" />
                                                            {currentUserRole === 'AREA_MANAGER' ? 'AM Review' : 'BM Review'}
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-primary/20 bg-white px-4 py-3 dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-sidebar-accent dark:text-slate-400">
                                    Showing{' '}
                                    <span className="font-medium">
                                        {(currentPage - 1) * itemsPerPage + 1}
                                    </span>{' '}
                                    to{' '}
                                    <span className="font-medium">
                                        {Math.min(currentPage * itemsPerPage, filteredClients.length)}
                                    </span>{' '}
                                    of <span className="font-medium">{filteredClients.length}</span> entries
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Select
                                    value={itemsPerPage.toString()}
                                    onValueChange={(value) => {
                                        setItemsPerPage(Number(value));
                                        setCurrentPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[100px] text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="25">25</SelectItem>
                                        <SelectItem value="50">50</SelectItem>
                                        <SelectItem value="100">100</SelectItem>
                                    </SelectContent>
                                </Select>
                                <div className="flex items-center gap-1">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(1)}
                                        disabled={currentPage === 1}
                                        className="h-8 w-8 p-0"
                                    >
                                        <ChevronsLeft className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                        disabled={currentPage === 1}
                                        className="h-8 w-8 p-0"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="px-3 text-sm text-sidebar-accent dark:text-slate-400">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                                        disabled={currentPage === totalPages}
                                        className="h-8 w-8 p-0"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setCurrentPage(totalPages)}
                                        disabled={currentPage === totalPages}
                                        className="h-8 w-8 p-0"
                                    >
                                        <ChevronsRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {/* Status Update Modal */}
            <KYCStatusUpdateModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                client={selectedClient}
                onSuccess={handleModalSuccess}
            />
        </div>
    );
}

