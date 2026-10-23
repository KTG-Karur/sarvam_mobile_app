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

export interface SelfAccountsRow {
    id: string;
    name: string;
    description: string;
    type: 'CASH' | 'BANK' | null;
}

interface SelfAccountsTableProps {
    rows: SelfAccountsRow[];
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
    onCreateNew?: () => void;
}

export function SelfAccountsTable({
    rows,
    onEdit,
    onDelete,
    onCreateNew,
}: SelfAccountsTableProps) {
    const [searchQuery, setSearchQuery] = useState('');
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
                    row.name.toLowerCase().includes(query) ||
                    (row.description && row.description.toLowerCase().includes(query))
            );
        }

        return filtered;
    }, [rows, searchQuery]);

    // Pagination
    const totalPages = Math.ceil(filteredRows.length / itemsPerPage);
    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        return filteredRows.slice(start, end);
    }, [filteredRows, currentPage, itemsPerPage]);

    const clearFilters = () => {
        setSearchQuery('');
        setCurrentPage(1);
    };

    const hasActiveFilters = !!searchQuery;

    if (rows.length === 0) {
        return (
            <div className="rounded-2xl border border-primary/20 bg-green-50/60 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <BookOpen className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" />
                <p className="mt-4 text-sm font-medium text-sidebar-accent dark:text-slate-400">
                    No accounts found. Create a new account using the button above.
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
                        Self Accounts List
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
                            placeholder="Search by Name or Description..."
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
                </div>
            </div>

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-primary/20 bg-green-50/60 shadow-lg dark:border-sidebar-accent dark:bg-brand-green-darker/40">
                <div className="max-h-[600px] overflow-auto scrollbar-thin scrollbar-track-brand-green-darker scrollbar-thumb-sidebar-accent">
                    <Table className="min-w-full text-xs">
                        <TableHeader className="sticky top-0 z-10 bg-gradient-to-r from-primary via-primary to-primary text-white">
                            <TableRow className="hover:bg-primary/80">
                                <TableHead className="px-4 py-3 font-semibold text-white w-1/4">
                                    Account Name
                                </TableHead>
                                <TableHead className="px-4 py-3 font-semibold text-white w-1/2">
                                    Description
                                </TableHead>
                                <TableHead className="px-4 py-3 font-semibold text-white w-1/6">
                                    Type
                                </TableHead>
                                <TableHead className="px-4 py-3 text-center font-semibold text-white w-1/6">
                                    Actions
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody className="bg-white dark:bg-green-950/30">
                            {paginatedRows.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="px-4 py-8 text-center">
                                        <p className="text-sm text-sidebar-accent dark:text-slate-400">
                                            No accounts found matching your filters.
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
                                            {row.name}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                            {row.description || '-'}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-sidebar-accent dark:text-slate-200">
                                            {row.type === 'CASH' ? 'Cash' : row.type === 'BANK' ? 'Bank' : '-'}
                                        </TableCell>
                                        <TableCell className="px-4 py-3 text-center">
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
                                                            onClick={() =>
                                                                onDelete && onDelete(row.id)
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
                                {/** Simplified pagination for brevity, can enhance if needed */}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0 pointer-events-none border-none"
                                >
                                    {currentPage}
                                </Button>
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
