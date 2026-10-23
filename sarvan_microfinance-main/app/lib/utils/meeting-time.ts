/**
 * Normalizes a center meeting-time string to 24-hour "HH:MM", tolerating the
 * several shapes this free-text column has accumulated in practice:
 * "HH:MM", "HH:MM:SS", "H:MM AM/PM", "H:MM:SS AM/PM", and the "HH:MM:SS.0"
 * fraction artifact used as an empty-value fallback in some reports.
 * Returns the trimmed input unchanged if it matches none of these.
 */
export function normalizeMeetingTime(value: string): string {
    let val = value.trim();

    // Strip a trailing decimal fraction, e.g. "00:00:00.0" -> "00:00:00"
    val = val.replace(/\.\d+$/, '');

    // "HH:MM" or "HH:MM:SS" (24-hour) — keep just HH:MM, zero-padded
    const plain = val.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (plain) {
        return `${plain[1].padStart(2, '0')}:${plain[2]}`;
    }

    // "H:MM AM/PM" or "H:MM:SS AM/PM" — convert to 24-hour HH:MM
    const ampm = val.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)$/);
    if (ampm) {
        let hour = parseInt(ampm[1]);
        const minute = ampm[2];
        const period = ampm[3].toUpperCase();
        if (period === 'PM' && hour !== 12) hour += 12;
        if (period === 'AM' && hour === 12) hour = 0;
        return `${String(hour).padStart(2, '0')}:${minute}`;
    }

    return val;
}
