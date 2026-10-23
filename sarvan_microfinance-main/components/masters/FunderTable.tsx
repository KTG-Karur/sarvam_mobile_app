'use client';

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Wallet, MousePointer2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FunderRow {
    id: string;
    funderId: string;
    funderName: string;
    principalGLId?: string;
    interestGLId?: string;
    interestPercent?: number;
    tdsPercent?: number;
}

interface FunderTableProps {
    rows: FunderRow[];
    selectedFunderId?: string;
    onSelect?: (funderId: string) => void;
}

export function FunderTable({ rows, selectedFunderId, onSelect }: FunderTableProps) {
    if (rows.length === 0) {
        return (
            <Card className="mt-12 border-2 border-primary/20 border-dashed bg-green-50/50 p-12 text-center dark:border-sidebar-accent dark:bg-brand-green-darker/20 shadow-sm rounded-xl animate-in fade-in">
                <Wallet className="mx-auto h-16 w-16 text-slate-400 dark:text-slate-500 opacity-50 mb-4" />
                <h3 className="text-xl font-semibold text-sidebar-accent dark:text-slate-300">Registry is Empty</h3>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    No funders have been registered yet. Use the control panel above to add your first funding source.
                </p>
            </Card>
        );
    }

    return (
        <div className="mt-12 transition-all duration-300 animate-in fade-in">
            <div className="flex items-center justify-between mb-4 px-2">
                <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-sidebar-accent dark:text-slate-200">Registered Funders</h2>
                    <Badge variant="secondary" className="bg-brand-green-tint dark:bg-sidebar-accent text-sidebar-accent dark:text-slate-300 font-semibold px-2 py-0.5 rounded-md">
                        {rows.length} Entries
                    </Badge>
                </div>
            </div>

            <Card className="border-2 border-primary/20/80 dark:border-sidebar-accent/60 shadow-xl overflow-hidden rounded-xl">
                <CardContent className="p-0">
                    <div className="overflow-x-auto scrollbar-thin scrollbar-track-slate-100 scrollbar-thumb-slate-300 dark:scrollbar-track-brand-green-darker dark:scrollbar-thumb-sidebar-accent">
                        <Table className="w-full">
                            <TableHeader className="bg-gradient-to-r from-sidebar-accent via-primary to-sidebar-accent">
                                <TableRow className="hover:bg-transparent border-none">
                                    <TableHead className="h-12 px-6 text-white font-semibold text-xs whitespace-nowrap w-[150px]">Reference</TableHead>
                                    <TableHead className="h-12 px-6 text-white font-semibold text-xs whitespace-nowrap">Provider Signature</TableHead>
                                    <TableHead className="h-12 px-6 text-white font-semibold text-xs whitespace-nowrap text-right w-[200px]">Action Workspace</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody className="bg-white dark:bg-green-950/30">
                                {rows.map((row, index) => {
                                    const isSelected = selectedFunderId === row.funderId;
                                    return (
                                        <TableRow
                                            key={row.id}
                                            className={cn(
                                                "transition-all duration-200 ease-in-out hover:shadow-sm border-b border-slate-100 dark:border-sidebar-accent/50",
                                                index % 2 === 0 ? "bg-white dark:bg-brand-green-darker" : "bg-green-50/50 dark:bg-sidebar-accent/30",
                                                isSelected
                                                    ? "bg-green-50/80 dark:bg-green-950/20"
                                                    : "hover:bg-green-50/50 dark:hover:bg-sidebar-accent/80"
                                            )}
                                        >
                                            <TableCell className="px-6 py-4">
                                                <div className={cn(
                                                    "h-8 w-16 rounded-md flex items-center justify-center font-bold text-xs transition-colors border",
                                                    isSelected ? "bg-primary text-white border-primary shadow-sm" : "bg-white dark:bg-brand-green-darker border-primary/20 dark:border-sidebar-accent text-sidebar-accent dark:text-slate-400"
                                                )}>
                                                    #{row.funderId}
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-6 py-4">
                                                <div className="space-y-1">
                                                    <p className={cn(
                                                        "font-bold text-sm transition-colors",
                                                        isSelected ? "text-sidebar-accent dark:text-primary" : "text-sidebar-accent dark:text-slate-200"
                                                    )}>
                                                        {row.funderName}
                                                    </p>
                                                    <div className="flex items-center gap-4">
                                                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 bg-brand-green-tint dark:bg-sidebar-accent px-2 py-0.5 rounded-sm w-fit border border-primary/20 dark:border-sidebar-accent">
                                                            <ExternalLink className="w-3 h-3" />
                                                            GL: {row.principalGLId}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="px-6 py-4 text-right">
                                                <Button
                                                    type="button"
                                                    onClick={() => onSelect && onSelect(row.funderId)}
                                                    variant={isSelected ? 'default' : 'outline'}
                                                    className={cn(
                                                        "h-9 px-4 rounded-lg font-semibold transition-all shadow-sm",
                                                        isSelected
                                                            ? "bg-primary hover:bg-primary text-white shadow-primary/20"
                                                            : "border-primary/30 text-sidebar-accent hover:bg-green-50 dark:border-sidebar-accent dark:text-slate-300 dark:hover:bg-sidebar-accent"
                                                    )}
                                                >
                                                    <MousePointer2 className="w-4 h-4 mr-2" />
                                                    {isSelected ? 'Selected' : 'Select'}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
