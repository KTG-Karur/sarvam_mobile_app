'use client';

import { useState } from 'react';
import { AdvanceCollectionFilter } from '@/components/daily-monitoring/AdvanceCollectionFilter';
import {
  AdvanceCollectionRow,
  AdvanceCollectionTable,
} from '@/components/daily-monitoring/AdvanceCollectionTable';
import { useTableSearch } from '@/hooks/useTableSearch';
import { TableSearchInput } from '@/components/ui/table-search';

export function AdvanceCollectionReport() {
  const [rows, setRows] = useState<AdvanceCollectionRow[]>(() =>
    getMockAdvanceCollectionRows()
  );
  const { query: tableSearchQuery, setQuery: setTableSearchQuery, filtered: searchedRows } = useTableSearch(rows);

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
          <AdvanceCollectionFilter
            onSearch={() => {
              // Replace with API integration later
              setRows(getMockAdvanceCollectionRows());
            }}
          />

          {/* Search */}
          {rows.length > 0 && (
            <div className="mt-4 flex justify-end">
              <TableSearchInput
                value={tableSearchQuery}
                onChange={setTableSearchQuery}
                placeholder="Search advance collections..."
              />
            </div>
          )}

          {/* Table Section */}
          <AdvanceCollectionTable rows={searchedRows} />
        </div>
      </div>
    </div>
  );
}

function getMockAdvanceCollectionRows(): AdvanceCollectionRow[] {
  return [
    {
      id: 'ac-1',
      branchName: '003 - KARUR',
      centerName: '068 - KARUR - VAIYAPURI NAGAR',
      memberName: 'PUSHPAVENI',
      loanId: 'K3003694/1',
      dueAmount: 550,
      collAmount: 0,
      toBeCollected: 550,
      dueDate: '10/11/2025',
      paidDate: '',
      status: 'PENDING',
      arrear: 1300,
      loanOs: 1200,
      meetingDay: 'SATURDAY',
      nextMeetingDate: '29/11/2025 12:00:00 AM',
      fieldOfficer: '034 - MAHESWARI M',
    },
  ];
}


