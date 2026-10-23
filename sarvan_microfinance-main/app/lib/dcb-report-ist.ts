import { addCalendarDaysToYmd } from '@/app/lib/branch-financial-day';
import {
    getKolkataCalendarYmd,
    getUtcBoundsForBranchCalendarDay,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';

const ISO_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function assertDcbReportIsoYmd(ymd: string, fieldLabel: string): string {
    const trimmed = ymd.trim();
    if (!ISO_YMD_REGEX.test(trimmed)) {
        throw new Error(`Invalid ${fieldLabel}: expected YYYY-MM-DD`);
    }
    return trimmed;
}

export type DcbIstReportWindow = {
    fromYmd: string;
    tillYmd: string;
    rangeStartUtc: Date;
    rangeEndExclusiveUtc: Date;
    /** Upper inclusive bound for fetching schedules that can affect opening/demand through till date (IST). */
    scheduleFetchDueLteUtc: Date;
};

/**
 * Inclusive IST calendar range [fromYmd, tillYmd] as half-open UTC instants for DB filters.
 * HTML date inputs are business calendar days in Asia/Kolkata, not server-local midnight.
 */
export function buildDcbIstReportWindow(fromYmdRaw: string, tillYmdRaw: string): DcbIstReportWindow {
    const fromYmd = assertDcbReportIsoYmd(fromYmdRaw, 'from date');
    const tillYmd = assertDcbReportIsoYmd(tillYmdRaw, 'till date');
    if (fromYmd > tillYmd) {
        throw new Error('From date cannot be after till date');
    }

    const rangeStartUtc = parseKolkataAttendanceDateYmd(fromYmd);
    const rangeEndExclusiveUtc = parseKolkataAttendanceDateYmd(addCalendarDaysToYmd(tillYmd, 1));
    const { dayEndUtc } = getUtcBoundsForBranchCalendarDay(parseKolkataAttendanceDateYmd(tillYmd));

    return {
        fromYmd,
        tillYmd,
        rangeStartUtc,
        rangeEndExclusiveUtc,
        scheduleFetchDueLteUtc: dayEndUtc,
    };
}

export function scheduleDueKolkataYmd(due: Date): string {
    return getKolkataCalendarYmd(due);
}

export function formatDcbReportPeriodIst(fromYmd: string, tillYmd: string): string {
    const toDdMmYyyy = (y: string): string => {
        const [yy, mo, da] = y.split('-');
        return `${da}/${mo}/${yy}`;
    };
    if (fromYmd === tillYmd) {
        return `${toDdMmYyyy(fromYmd)} (IST)`;
    }
    return `${toDdMmYyyy(fromYmd)} – ${toDdMmYyyy(tillYmd)} (IST)`;
}
