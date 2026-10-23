import { applyValidityFilter } from './dataset.service';
import { ymdToDdmmyyyy } from './format';
import { buildXlsx } from './serialize-xlsx';
import { cdfLines, csvLines, errorCsvLines, jsonChunks } from './serialize';
import { validateFileLevel } from './validate';
import type { UcrfConfig, UcrfFilters, UcrfRecord } from './types';

export type ExportFormat = 'cdf' | 'csv' | 'xlsx' | 'json' | 'errors';

export interface ExportCounts {
    /** All loans eligible for the report period + filters (before the validity filter). */
    eligible: number;
    valid: number;
    invalid: number;
    /** Records actually written to the file. */
    included: number;
    /** Records left out (CDF: invalid records; others: none). */
    excluded: number;
}

export type PreparedExport =
    | { ok: false; status: 422; error: string; counts: ExportCounts }
    | {
          ok: true;
          contentType: string;
          filename: string;
          body: Buffer | ReadableStream<Uint8Array>;
          counts: ExportCounts;
      };

const CONTENT_TYPES: Record<ExportFormat, string> = {
    cdf: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    json: 'application/json; charset=utf-8',
    errors: 'text/csv; charset=utf-8',
};

/** Filenames are built only from the validated report date, config and a fixed whitelist — never user paths. */
export function exportFilename(format: ExportFormat, reportYmd: string, config: Pick<UcrfConfig, 'memberId' | 'fileFrequency'>): string {
    const safe = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
    const ymd = reportYmd.replace(/-/g, '');
    switch (format) {
        // MFI-<freq>-<ddmmyyyy>-<member code>-<reference>, underscore separated like the reference sample.
        case 'cdf': return `MFI_${safe(config.fileFrequency)}_${ymdToDdmmyyyy(reportYmd)}_${safe(config.memberId)}_JLG_DATA.CDF`;
        case 'csv': return `UCRF_JLG_${ymd}.csv`;
        case 'xlsx': return `UCRF_JLG_${ymd}.xlsx`;
        case 'json': return `UCRF_JLG_${ymd}.json`;
        case 'errors': return `UCRF_JLG_${ymd}_validation_errors.csv`;
    }
}

/** Optional pacing for big downloads: fewer rows per chunk and a pause between chunks. Output bytes are unchanged. */
export interface ExportThrottle {
    rowsPerPull: number;
    pauseMs: number;
}

/** Streams a sync generator without materialising the whole file as one string. */
export function streamChunks(gen: Iterator<string>, throttle?: ExportThrottle): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    const rowsPerPull = throttle?.rowsPerPull ?? 200;
    let first = true;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            // Lets other requests use the event loop between chunks.
            if (throttle?.pauseMs && !first) await new Promise((resolve) => setTimeout(resolve, throttle.pauseMs));
            first = false;
            // Batch a few rows per pull to cut per-chunk overhead.
            let buf = '';
            for (let i = 0; i < rowsPerPull; i++) {
                const next = gen.next();
                if (next.done) {
                    if (buf) controller.enqueue(enc.encode(buf));
                    controller.close();
                    return;
                }
                buf += next.value;
            }
            controller.enqueue(enc.encode(buf));
        },
    });
}

export function prepareExport(args: {
    format: ExportFormat;
    allRecords: UcrfRecord[];
    filters: UcrfFilters;
    config: UcrfConfig;
    todayYmd: string;
    createdYmd: string;
    generatedAtIso: string;
    throttle?: ExportThrottle;
}): PreparedExport {
    const { format, allRecords, filters, config } = args;
    const scoped = applyValidityFilter(allRecords, filters.validity);
    const valid = allRecords.filter((r) => r.isValid).length;
    const base = { eligible: allRecords.length, valid, invalid: allRecords.length - valid };
    const filename = exportFilename(format, filters.reportDate, config);
    const contentType = CONTENT_TYPES[format];

    if (format === 'cdf') {
        const fileErrors = validateFileLevel(config, filters.reportDate, args.todayYmd);
        const included = scoped.filter((r) => r.isValid);
        const counts: ExportCounts = { ...base, included: included.length, excluded: scoped.length - included.length };
        if (fileErrors.length) return { ok: false, status: 422, error: `CDF generation blocked: ${fileErrors.join('; ')}`, counts };
        if (included.length === 0) {
            return { ok: false, status: 422, error: 'CDF generation blocked: there are no valid records to include for these filters', counts };
        }
        return {
            ok: true,
            contentType,
            filename,
            body: streamChunks(cdfLines(included, config, filters.reportDate, args.createdYmd), args.throttle),
            counts,
        };
    }

    if (format === 'errors') {
        const withIssues = scoped.filter((r) => r.issues.length > 0);
        const counts: ExportCounts = { ...base, included: withIssues.length, excluded: 0 };
        return { ok: true, contentType, filename, body: streamChunks(errorCsvLines(withIssues), args.throttle), counts };
    }

    // CSV / Excel / JSON mirror the CDF: the same 100 UCRF fields for the same (valid) records.
    const validOnly = scoped.filter((r) => r.isValid);
    const counts: ExportCounts = { ...base, included: validOnly.length, excluded: scoped.length - validOnly.length };
    switch (format) {
        case 'csv':
            return { ok: true, contentType, filename, body: streamChunks(csvLines(validOnly), args.throttle), counts };
        case 'json':
            return {
                ok: true,
                contentType,
                filename,
                body: streamChunks(
                    jsonChunks(validOnly, {
                        reportDate: filters.reportDate,
                        generatedAt: args.generatedAtIso,
                        filters,
                        totals: { eligible: base.eligible, valid: base.valid, invalid: base.invalid },
                        institution: { memberId: config.memberId, name: config.institutionName },
                    }),
                    args.throttle
                ),
                counts,
            };
        case 'xlsx':
            return { ok: true, contentType, filename, body: buildXlsx(validOnly, scoped), counts };
    }
}
