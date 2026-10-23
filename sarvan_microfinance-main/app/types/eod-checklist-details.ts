export type EodDetailColumn = {
    key: string;
    label: string;
    align?: 'left' | 'right';
};

/** Reserved row metadata for `EodChecklistDetailPanel` (not mapped to a column). */
export type EodRowAccent =
    | 'pending-collection'
    | 'indexed-pending-disburse'
    | 'unindexed-pending-index'
    | 'center-meeting-pending';

export type EodDetailRow = Record<string, string | number> & {
    _rowAccent?: EodRowAccent;
};

export type EodDetailSection = {
    code: number;
    title: string;
    columns: EodDetailColumn[];
    rows: EodDetailRow[];
    emptyMessage: string;
};

export type EodChecklistDetailsPayload = {
    workingDateYmd: string;
    branchCalendarTimeZone: string;
    sections: EodDetailSection[];
};
