'use client';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Eye, Trash2, Edit2, Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface GLMasterRow {
    id: string;
    glId: string;
    glName: string;
    glType: 'PRINCIPLE' | 'INTEREST';
    description?: string;
}

interface GLMasterTableProps {
    rows: GLMasterRow[];
    onPreview: (glId: string) => void;
    onDelete?: (glId: string) => void;   // optional — hide delete button if not passed
    onEdit?: (row: GLMasterRow) => void; // optional — hide edit button if not passed
}

export function GLMasterTable({ rows, onPreview, onDelete, onEdit }: GLMasterTableProps) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredRows = rows.filter(
        (row) =>
            row.glName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.glId.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.glType.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="mt-12 space-y-6">
            {/* Table Header & Controls */}
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground dark:text-white">
                        GL Accounts Registry
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                        Showing {filteredRows.length} registered General Ledger accounts.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 transition-colors group-focus-within:text-primary" />
                        <Input
                            placeholder="Search accounts..."
                            className="h-10 w-full md:w-72 pl-10 border-primary/20 bg-white/50 focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all dark:bg-brand-green-darker/50 dark:border-sidebar-accent"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <Button variant="outline" size="icon" className="h-10 w-10 border-primary/20 dark:border-sidebar-accent shrink-0">
                        <Filter className="h-4 w-4 text-slate-500" />
                    </Button>
                </div>
            </div>

            {/* Table Container */}
            <div className="relative overflow-hidden rounded-2xl border border-primary/20/60 bg-white/60 backdrop-blur-sm shadow-xl dark:border-sidebar-accent/60 dark:bg-green-950/40">
                <div className="overflow-x-auto">
                <Table>
                    <TableHeader className="bg-green-50/50 dark:bg-brand-green-darker/30">
                        <TableRow className="hover:bg-transparent border-primary/20/60 dark:border-sidebar-accent/60">
                            <TableHead className="w-[120px] font-bold text-sidebar-accent dark:text-slate-300">GL ID</TableHead>
                            <TableHead className="font-bold text-sidebar-accent dark:text-slate-300">Account Name</TableHead>
                            <TableHead className="w-[180px] font-bold text-sidebar-accent dark:text-slate-300 text-center">GL Type</TableHead>
                            <TableHead className="hidden lg:table-cell font-bold text-sidebar-accent dark:text-slate-300">Description</TableHead>
                            <TableHead className="w-[150px] text-right font-bold text-sidebar-accent dark:text-slate-300 pr-8">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredRows.length > 0 ? (
                            filteredRows.map((row) => (
                                <TableRow
                                    key={row.glId}
                                    className="group hover:bg-green-50/30 border-slate-100 dark:border-sidebar-accent transition-colors"
                                >
                                    <TableCell className="font-bold text-primary dark:text-primary">
                                        {row.glId}
                                    </TableCell>
                                    <TableCell className="font-semibold text-foreground dark:text-slate-100 italic group-hover:not-italic transition-all">
                                        {row.glName}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "px-2.5 py-0.5 font-bold border-none",
                                                row.glType === 'PRINCIPLE'
                                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                                                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                                            )}
                                        >
                                            <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                                            {row.glType}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-slate-500 dark:text-slate-400 text-sm max-w-[250px] truncate">
                                        {row.description || '--'}
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                        <div className="flex items-center justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-primary hover:bg-primary/10 dark:hover:bg-brand-green-darker/30"
                                                onClick={() => onPreview(row.glId)}
                                            >
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            {onEdit && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-primary hover:bg-brand-green-tint dark:hover:bg-brand-green-darker/30"
                                                    onClick={() => onEdit(row)}
                                                >
                                                    <Edit2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {onDelete && (
                                                <>
                                                <div className="w-px h-4 bg-brand-green-tint dark:bg-sidebar-accent mx-0.5" />
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                                                    onClick={() => onDelete(row.glId)}
                                                >
                                                <Trash2 className="h-4 w-4" />
                                                </Button>
                                                </>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={5} className="h-32 text-center">
                                    <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                                        <Filter className="h-8 w-8 opacity-20" />
                                        <p className="text-sm font-medium italic">No matching GL accounts found.</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                </div>
            </div>
        </div>
    );
}
