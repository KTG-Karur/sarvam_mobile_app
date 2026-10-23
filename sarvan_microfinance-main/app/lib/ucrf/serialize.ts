import { UCRF_FILE_NAME_TAG, UCRF_LAYOUT_VERSION, UCRF_ORG_STRUCTURE_JLG } from './codes';
import { UCRF_FIELDS } from './field-map';
import { padRight, ymdToDdmmyyyy } from './format';
import type { UcrfConfig, UcrfFilters, UcrfRecord } from './types';

/** Physical line terminator of the reference sample (LF, trailing newline after TRL). */
export const CDF_EOL = '\n';

/**
 * HDR segment — fixed length, 190 chars (spec "Header Segment" fields 1-13):
 * HDR(3) HMMFI(5) 3.3(3) MemberId(10) Name(30) BranchId(30) ReportedDate(8) CreationDate(8)
 * JLG(3) OldMemberId(30) Reserved(30) Frequency(10) Reserved(20). Blank fields are space padded.
 */
export function buildCdfHeader(config: UcrfConfig, reportYmd: string, createdYmd: string): string {
    return (
        'HDR' +
        UCRF_FILE_NAME_TAG +
        UCRF_LAYOUT_VERSION +
        padRight(config.memberId, 10) +
        padRight(config.institutionName, 30) +
        padRight(config.submittingBranchId, 30) +
        ymdToDdmmyyyy(reportYmd) +
        ymdToDdmmyyyy(createdYmd) +
        UCRF_ORG_STRUCTURE_JLG +
        padRight(config.oldMemberId, 30) +
        ' '.repeat(30) +
        padRight(config.fileFrequency, 10) +
        ' '.repeat(20)
    );
}

/** TRL segment — fixed length, 36 chars: TRL(3) 3.3(3) MemberId(10) Reserved(20). */
export function buildCdfTrailer(config: UcrfConfig): string {
    return 'TRL' + UCRF_LAYOUT_VERSION + padRight(config.memberId, 10) + ' '.repeat(20);
}

/** CNSCRD|…|ADRCRD|…|ACTCRD|… on a single physical line, 100 pipe-separated fields, trailing pipe. */
export function buildCdfRecordLine(fields: string[]): string {
    return fields.join('|') + '|';
}

/** Lines of the official file. Only valid records are ever written. */
export function* cdfLines(
    records: Iterable<UcrfRecord>,
    config: UcrfConfig,
    reportYmd: string,
    createdYmd: string
): Generator<string> {
    yield buildCdfHeader(config, reportYmd, createdYmd) + CDF_EOL;
    for (const r of records) {
        if (!r.isValid) continue;
        yield buildCdfRecordLine(r.fields) + CDF_EOL;
    }
    yield buildCdfTrailer(config) + CDF_EOL;
}

export function buildCdf(records: UcrfRecord[], config: UcrfConfig, reportYmd: string, createdYmd: string): string {
    return Array.from(cdfLines(records, config, reportYmd, createdYmd)).join('');
}

// ── Tabular schema shared by CSV / XLSX / JSON ─────────────────────────────────────────

export type ColumnKind = 'text' | 'integer' | 'amount' | 'date';

export interface ReportColumn {
    key: string;
    header: string;
    kind: ColumnKind;
    value: (r: UcrfRecord) => string | number | null;
}

/**
 * CSV / Excel / JSON carry exactly what the CDF carries: the 100 official UCRF fields, in the
 * same order, for the same records (valid only). Rupee amounts, DPD and counts are numeric;
 * identifiers, codes, names and DDMMYYYY dates stay text so leading zeros and exact values survive.
 */
const AMOUNT_FIELDS = new Set([49, 50, 81, 82, 83, 86, 87, 88, 90, 97, 99]);
const INTEGER_FIELDS = new Set([11, 73, 84, 89]);

const camel = (name: string) =>
    name
        .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))
        .replace(/^./, (c) => c.toLowerCase());

export const REPORT_COLUMNS: ReportColumn[] = UCRF_FIELDS.map((f) => {
    const kind: ColumnKind = AMOUNT_FIELDS.has(f.no) ? 'amount' : INTEGER_FIELDS.has(f.no) ? 'integer' : 'text';
    return {
        key: `f${String(f.no).padStart(3, '0')}_${camel(f.name)}`,
        header: `${f.no}. ${f.segment} - ${f.name}`,
        kind,
        value: (r: UcrfRecord) => {
            const v = r.fields[f.no - 1] ?? '';
            if (v === '') return null;
            if (kind === 'text') return v;
            const n = Number(v);
            return Number.isFinite(n) ? n : v;
        },
    };
});

export const ERROR_COLUMNS = ['Loan / Account Number', 'Member ID', 'Severity', 'Field No', 'Field', 'Value (masked)', 'Reason', 'Suggested correction'] as const;

export function errorRows(records: UcrfRecord[]): Array<Array<string | number>> {
    const rows: Array<Array<string | number>> = [];
    for (const r of records) {
        for (const i of r.issues) {
            rows.push([i.loanNumber, i.memberId, i.severity, i.fieldNo, i.field, i.value, i.reason, i.suggestion ?? '']);
        }
    }
    return rows;
}

// ── CSV ────────────────────────────────────────────────────────────────────────────────

/** RFC 4180 quoting: text is always quoted (quotes doubled); numbers are bare, unformatted. */
function csvCell(v: string | number | null, kind: ColumnKind | 'text'): string {
    if (v === null || v === undefined || v === '') return kind === 'text' ? '""' : '';
    if (typeof v === 'number') return String(v);
    return `"${v.replace(/"/g, '""')}"`;
}

export function* csvLines(records: Iterable<UcrfRecord>): Generator<string> {
    yield REPORT_COLUMNS.map((c) => `"${c.header}"`).join(',') + '\r\n';
    for (const r of records) {
        yield REPORT_COLUMNS.map((c) => csvCell(c.value(r), c.kind)).join(',') + '\r\n';
    }
}

export function* errorCsvLines(records: UcrfRecord[]): Generator<string> {
    yield ERROR_COLUMNS.map((h) => `"${h}"`).join(',') + '\r\n';
    for (const row of errorRows(records)) {
        yield row.map((v) => csvCell(v, 'text')).join(',') + '\r\n';
    }
}

// ── JSON ───────────────────────────────────────────────────────────────────────────────

export interface JsonMeta {
    reportDate: string;
    generatedAt: string;
    filters: UcrfFilters;
    totals: { eligible: number; valid: number; invalid: number };
    institution: { memberId: string; name: string } | null;
}

/** Streams a valid JSON document: metadata then one record object per line. */
export function* jsonChunks(records: Iterable<UcrfRecord>, meta: JsonMeta): Generator<string> {
    yield `{"metadata":${JSON.stringify({ ...meta, layoutVersion: UCRF_LAYOUT_VERSION })},"records":[`;
    let first = true;
    for (const r of records) {
        const obj: Record<string, unknown> = {};
        for (const c of REPORT_COLUMNS) obj[c.key] = c.value(r);
        yield (first ? '\n' : ',\n') + JSON.stringify(obj);
        first = false;
    }
    yield '\n]}\n';
}
