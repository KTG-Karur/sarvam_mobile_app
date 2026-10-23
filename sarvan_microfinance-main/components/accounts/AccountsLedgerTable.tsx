'use client';

import { useState, useMemo } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    BookOpen,
    Search,
    X,
    MoreVertical,
    Edit,
    Trash2,
    Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AccountsLedgerRow {
    id: string;
    ledgerId: string;
    ledgerName: string;
    groupId: string;
    parentGroup: string;
    primaryGroup: string;
    allowTo: ('H.O' | 'B.O')[];
    hasTransactions: boolean;
}

interface AccountsLedgerTableProps {
    rows: AccountsLedgerRow[];
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
    onCreateNew?: () => void;
}

export function AccountsLedgerTable({
    rows,
    onEdit,
    onDelete,
    onCreateNew,
}: AccountsLedgerTableProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterPrimaryGroup, setFilterPrimaryGroup] = useState<string>('all');
    const [filterAllowTo, setFilterAllowTo] = useState<string>('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);

    // Filter rows
    const filteredRows = useMemo(() => {
        let filtered = rows;

        // Search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (row) =>
                    row.ledgerId.toLowerCase().includes(query) ||
                    row.ledgerName.toLowerCase().includes(query) ||
                    row.parentGroup.toLowerCase().includes(query) ||
                    row.primaryGroup.toLowerCase().includes(query)
            );
        }

        // Primary group filter
        if (filterPrimaryGroup !== 'all') {
            filtered = filtered.filter((row) => row.primaryGroup === filterPrimaryGroup);
        }

        // Allow To filter
        if (filterAllowTo !== 'all') {
            filtered = filtered.filter((row) => row.allowTo.includes(filterAllowTo as 'H.O' | 'B.O'));
        }

        return filtered;
    }, [rows, searchQuery, filterPrimaryGroup, filterAllowTo]);

    // Get unique primary groups for filter
    const uniquePrimaryGroups = useMemo(() => {
        const groups = Array.from(new Set(rows.map((row) => row.primaryGroup)));
        return groups.sort();
    }, [rows]);

    // Pagination
    const totalPages = Math.ceil(filteredRows.length / itemsPerPage);
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        return filteredRows.slice(start, end);
    }, [filteredRows, currentPage, itemsPerPage]);

    const clearFilters = () => {
        setSearchQuery('');
        setFilterPrimaryGroup('all');
        setFilterAllowTo('all');
        setCurrentPage(1);
    };

    const hasActiveFilters =
        searchQuery || filterPrimaryGroup !== 'all' || filterAllowTo !== 'all';

    if (rows.length === 0) {
        return (
            <div className="rounded-2xl border border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <BookOpen className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                    No ledgers found. Create a new ledger using the button above.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Search and Filters */}
            <div className="flex flex-col gap-4 rounded-2xl border border-primary/20 bg-white p-4 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <div className="flex items-center justify-between gap-4">
                    <h3 className="text-lg font-semibold text-foreground dark:text-white">
                        Accounts Ledger
                    </h3>
                    {onCreateNew && (
                        <Button
                            type="button"
                            onClick={onCreateNew}
                            className="h-9 gap-2 bg-primary hover:bg-primary text-white"
                        >
                            <Plus className="h-4 w-4" />
                            Create New
                        </Button>
                    )}
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            type="text"
                            placeholder="Search by Ledger ID, Name, Group..."
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
                        <Select value={filterPrimaryGroup} onValueChange={setFilterPrimaryGroup}>
                            <SelectTrigger className="h-10 w-[180px]">
                                <SelectValue placeholder="Primary Group" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Groups</SelectItem>
                                {uniquePrimaryGroups.map((group) => (
                                    <SelectItem key={group} value={group}>
                                        {group}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={filterAllowTo} onValueChange={setFilterAllowTo}>
                            <SelectTrigger className="h-10 w-[180px]">
                                <SelectValue placeholder="Allow To" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All</SelectItem>
                                <SelectItem value="H.O">H.O</SelectItem>
                                <SelectItem value="B.O">B.O</SelectItem>
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

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                    <Table className="min-w-full text-xs">
                        <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-primary via-primary to-primary text-white">
                            <TableRow className="hover:bg-primary/80">
                                <TableHead className="px-4 py-3 font-semibold text-white">
                                    Ledger Id
                                </TableHead>
                                <TableHead className="px-4 py-3 font-semibold text-white">
                                    Ledger Name
                                </TableHead>
                                <TableHead className="px-4 py-3 font-semibold text-white">
                                    Parent Group
                                </TableHead>
                                <TableHead className="px-4 py-3 font-semibold text-white">
                                    Primary Group
                                </TableHead>
                                <TableHead className="px-4 py-3 text-center font-semibold text-white">
                                    Allow To
                                </TableHead>
                                <TableHead className="px-4 py-3 text-center font-semibold text-white">
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="bg-white dark:bg-green-950/30">
                            {paginatedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="px-4 py-8 text-center">
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                            No ledgers found matching your filters.
                                        </p>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedRows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        className={cn(
                                            'bg-white odd:bg-green-50/70 hover:bg-green-50/60 transition-colors',
                                            'dark:bg-brand-green-darker dark:odd:bg-brand-green-darker/80 dark:hover:bg-sidebar-accent/80'
                                        )}
                                    >
                                        <TableCell className="px-4 py-3 font-medium text-foreground dark:text-slate-100">
                                            {row.ledgerId}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                            {row.ledgerName}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-400">
                                            {row.parentGroup}
                                        </TableCell>
                                        <TableCell className="px-4 py-3">
                                            <Badge variant="outline" className="text-xs">
                                                {row.primaryGroup}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                {row.allowTo.map((v) => (
                                                    <Badge
                                                        key={v}
                                                        variant="secondary"
                                                        className="text-xs font-medium"
                                                    >
                                                        {v}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="px-4 py-3">
                                            <div className="flex items-center justify-center gap-2">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0"
                                                        >
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem
                                                            onClick={() => onEdit && onEdit(row.id)}
                                                        >
                                                            <Edit className="mr-2 h-4 w-4" />
                                                            Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            disabled={row.hasTransactions}
                                                            title={row.hasTransactions ? 'Cannot delete a ledger with recorded transactions' : undefined}
                                                            onClick={() =>
                                                                !row.hasTransactions && onDelete && onDelete(row.id)
                                                            }
                                                        >
                                                            <Trash2 className="mr-2 h-4 w-4" />
                                                            Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
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
                                    {Math.min(currentPage * itemsPerPage, filteredRows.length)}
                                </span>{' '}
                                of <span className="font-medium">{filteredRows.length}</span> entries
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
                                    ««
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                                    disabled={currentPage === 1}
                                    className="h-8 w-8 p-0"
                                >
                                    «
                                </Button>
                                <div className="flex items-center gap-1">
                                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                        let pageNum: number;
                                        if (totalPages <= 5) {
                                            pageNum = i + 1;
                                        } else if (currentPage <= 3) {
                                            pageNum = i + 1;
                                        } else if (currentPage >= totalPages - 2) {
                                            pageNum = totalPages - 4 + i;
                                        } else {
                                            pageNum = currentPage - 2 + i;
                                        }
                                        return (
                                            <Button
                                                key={pageNum}
                                                type="button"
                                                variant={currentPage === pageNum ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => setCurrentPage(pageNum)}
                                                className={cn(
                                                    'h-8 w-8 p-0',
                                                    currentPage === pageNum &&
                                                        'bg-primary text-white hover:bg-primary'
                                                )}
                                            >
                                                {pageNum}
                                            </Button>
                                        );
                                    })}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                                    }
                                    disabled={currentPage === totalPages}
                                    className="h-8 w-8 p-0"
                                >
                                    »
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={currentPage === totalPages}
                                    className="h-8 w-8 p-0"
                                >
                                    »»
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

