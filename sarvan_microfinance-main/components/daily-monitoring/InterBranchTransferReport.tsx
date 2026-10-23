'use client';

import { useState } from 'react';
import { InterBranchTransferFilter } from './InterBranchTransferFilter';
import { InterBranchTransferTable, InterBranchTransferRow } from './InterBranchTransferTable';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

function getMockInterBranchTransferRows(): InterBranchTransferRow[] {
    return [
        {
            id: '1',
            slNo: 1,
            date: '10/11/2025',
            transferFrom: 'PANDALUR BRANCH',
            transferTo: 'HEAD OFFICE',
            amount: 7600.0,
            toAmount: 0.0,
            narration: 'Being Amount From 006 - PANDALUR',
        },
        {
            id: '2',
            slNo: 2,
            date: '10/11/2025',
            transferFrom: 'HEAD OFFICE',
            transferTo: 'PANDALUR BRANCH',
            amount: 0.0,
            toAmount: 150000.0,
            narration: 'Being Amount Given To 006 - PANDALUR',
        },
        {
            id: '3',
            slNo: 3,
            date: '10/11/2025',
            transferFrom: 'GUDALUR BRANCH',
            transferTo: 'HEAD OFFICE',
            amount: 150000.0,
            toAmount: 0.0,
            narration: 'Being Amount From 001 - GUDALUR',
        },
        {
            id: '4',
            slNo: 4,
            date: '10/11/2025',
            transferFrom: 'HEAD OFFICE',
            transferTo: 'PANDALUR BRANCH',
            amount: 0.0,
            toAmount: 230000.0,
            narration: 'Being Amount Given To 006 - PANDALUR',
        },
    ];
}

export function InterBranchTransferReport() {
    const [rows, setRows] = useState<InterBranchTransferRow[]>([]);
    const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

    const handleSearch = (date: string) => {
        // Simulate API call - replace with actual API integration
        const mockData = getMockInterBranchTransferRows();
        setRows(mockData);
    };

    return (
        <div className="flex min-h-screen flex-col">
            <div className="flex-1 px-3 sm:px-6 py-4 sm:py-8">
                <div className="mx-auto max-w-7xl">
                    {/* Background Glow Effect */}
                    <div className="absolute inset-0 -z-10 overflow-hidden">
                        <div className="absolute left-1/4 top-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                        <div className="absolute right-1/4 bottom-1/4 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
                    </div>

                    {/* Filter Section */}
                    <InterBranchTransferFilter onSearch={handleSearch} />

                    {/* Search */}
                    {rows.length > 0 && (
                        <div className="mt-4 flex justify-end">
                            <TableSearchInput
                                value={tableSearchQuery}
                                onChange={setTableSearchQuery}
                                placeholder="Search inter-branch transfers..."
                            />
                        </div>
                    )}

                    {/* Table Section */}
                    {rows.length > 0 && <InterBranchTransferTable rows={searchedRows} />}
                </div>
            </div>
        </div>
    );
}

