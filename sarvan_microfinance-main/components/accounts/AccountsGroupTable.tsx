'use client';

import { useMemo, useState } from 'react';
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
import { Edit, Trash2, FolderTree, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';

export interface AccountsGroupRow {
    id: string; // CUID
    groupId: string; // Custom ID
    groupName: string;
    parentGroupId: string | null;
    parentGroupName: string | null;
    allowSubGroups: boolean;
    isPrimary: boolean;
    isSystemGroup: boolean;
    subGroupsCount: number;
    ledgersCount: number;
}

interface AccountsGroupTableProps {
    rows: AccountsGroupRow[];
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
    onCreateNew: () => void;
}

export function AccountsGroupTable({
    rows,
    onEdit,
    onDelete,
    onCreateNew,
}: AccountsGroupTableProps) {
    const [searchQuery, setSearchQuery] = useState('');

    const filteredRows = useMemo(() => {
        if (!searchQuery) return rows;
        const query = searchQuery.toLowerCase();
        return rows.filter(
            (row) =>
                row.groupId.toLowerCase().includes(query) ||
                row.groupName.toLowerCase().includes(query) ||
                (row.parentGroupName || '').toLowerCase().includes(query)
        );
    }, [rows, searchQuery]);

    return (
        <Card className="border border-primary/20 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div className="space-y-1">
                    <CardTitle className="text-xl font-bold">Account Groups</CardTitle>
                    <CardDescription>
                        Manage your chart of accounts hierarchy.
                    </CardDescription>
                </div>
                <Button onClick={onCreateNew} className="bg-primary hover:bg-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Group
                </Button>
            </CardHeader>
            <CardContent className="p-0">
                <div className="border-t border-primary/20 p-4 dark:border-sidebar-accent">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            type="text"
                            placeholder="Search by Group ID, Name, Parent..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
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
                <div className="rounded-md border-t border-primary/20 dark:border-sidebar-accent overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-green-50 dark:bg-brand-green-darker/50">
                                <TableHead className="w-[100px]">Group ID</TableHead>
                                <TableHead>Group Name</TableHead>
                                <TableHead>Parent Group</TableHead>
                                <TableHead className="text-center">Sub-groups Allowed</TableHead>
                                <TableHead className="text-center">Child Groups</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredRows.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={6}
                                        className="h-24 text-center text-slate-500"
                                    >
                                        {searchQuery
                                            ? 'No groups match your search.'
                                            : 'No account groups found. Create one to get started.'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredRows.map((row) => (
                                    <TableRow key={row.id} className="hover:bg-green-50 dark:hover:bg-brand-green-darker/50">
                                        <TableCell className="font-medium">
                                            <span className="font-mono text-xs">{row.groupId}</span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-sidebar-accent dark:text-slate-200">
                                                    {row.groupName}
                                                </span>
                                                {row.isPrimary && (
                                                    <span className="text-[10px] text-primary dark:text-primary font-medium">
                                                        PRIMARY
                                                    </span>
                                                )}
                                                {row.isSystemGroup && (
                                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                                        SYSTEM
                                                    </span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                {row.parentGroupName ? (
                                                    <span className="text-sm font-medium">{row.parentGroupName}</span>
                                                ) : (
                                                    <span className="text-xs text-slate-400 italic">None (Root)</span>
                                                )}
                                                {row.parentGroupId && (
                                                    <span className="text-[10px] text-slate-500">ID: {row.parentGroupId}</span>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {row.allowSubGroups ? (
                                                <Badge
                                                    variant="outline"
                                                    className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                                                >
                                                    Yes
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="text-slate-500">
                                                    No
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            {row.subGroupsCount > 0 ? (
                                                <Badge variant="secondary" className="font-mono">
                                                    {row.subGroupsCount}
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-400">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-primary hover:bg-green-50 hover:text-sidebar-accent dark:text-primary dark:hover:bg-green-950/30"
                                                    onClick={() => onEdit(row.id)}
                                                    title="Edit Group"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>

                                                {!row.isSystemGroup && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className={cn(
                                                            "h-8 w-8",
                                                            (row.subGroupsCount > 0 || row.ledgersCount > 0)
                                                                ? "text-slate-300 cursor-not-allowed hover:bg-transparent"
                                                                : "text-red-500 hover:bg-red-50 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-950/30"
                                                        )}
                                                        onClick={() => {
                                                            if (row.subGroupsCount === 0 && row.ledgersCount === 0) onDelete(row.id);
                                                        }}
                                                        disabled={row.subGroupsCount > 0 || row.ledgersCount > 0}
                                                        title={
                                                            row.subGroupsCount > 0 && row.ledgersCount > 0
                                                                ? "Delete the sub-groups and the ledgers/transactions under this group first"
                                                                : row.subGroupsCount > 0
                                                                ? "Cannot delete group with subgroups"
                                                                : row.ledgersCount > 0
                                                                ? "Cannot delete group with ledgers or transactions linked"
                                                                : "Delete Group"
                                                        }
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
