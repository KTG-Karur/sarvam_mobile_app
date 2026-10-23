'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';

type ExportMenuButtonProps = {
    onExportExcel: () => void;
    onExportPdf: () => void;
    disabled?: boolean;
    className?: string;
    /** When provided, renders a labeled button ("Export"); omit for an icon-only button. */
    label?: string;
};

/** Small Excel/PDF export dropdown shared by the Daily Monitoring pages — a
 *  lightweight, self-contained client-side export, unlike the report-registry-backed
 *  ExportDropdown used by the Reports section (these pages aren't registered there). */
export function ExportMenuButton({ onExportExcel, onExportPdf, disabled, className, label }: ExportMenuButtonProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button disabled={disabled} className={className}>
                    <Download className={label ? 'mr-2 h-4 w-4' : 'h-4 w-4'} />
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onExportExcel}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onExportPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
