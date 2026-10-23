import { PIN_PREFIX_RANGE } from './codes';
import { digitsOnly } from './format';

// Verhoeff tables (UIDAI check digit — "the 12th numeric character is a check digit").
const D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(num: string): boolean {
    let c = 0;
    const digits = num.split('').reverse().map(Number);
    for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
    return c === 0;
}

const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Check digit to append to an 11-digit payload (used by tests to build synthetic valid UIDs). */
export function verhoeffCheckDigit(payload: string): number {
    let c = 0;
    const digits = payload.split('').reverse().map(Number);
    for (let i = 0; i < digits.length; i++) c = D[c][P[(i + 1) % 8][digits[i]]];
    return INV[c];
}

/** UID: 12 digits, all numeric, valid check digit. */
export function isValidAadhaar(v: string): boolean {
    return /^\d{12}$/.test(v) && verhoeffValid(v);
}

/** PAN: 10 chars, first 5 + last alphabets, 4th P or H, 6th-9th numerals. */
export function isValidPan(v: string): boolean {
    return /^[A-Z]{3}[PH][A-Z]\d{4}[A-Z]$/.test(v);
}

/** Voter ID: 8-16 chars after stripping specials, first 2/3 alphabets, remainder alphanumeric. */
export function isValidVoterId(v: string): boolean {
    return v.length >= 8 && v.length <= 16 && /^[A-Z]{2,3}[A-Z0-9]+$/.test(v);
}

/** Strip non-digits and an ISD/trunk prefix (+91 / 91 / 0) so only the subscriber number remains. */
export function normalizePhone(raw: string | null | undefined): string {
    let d = digitsOnly(raw);
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d;
}

/**
 * Indian mobile: ≥10 digits starting 5-9; not a repeated digit (222222…) nor a straight
 * ascending/descending run (876543 / 234567).
 */
export function isValidIndianPhone(d: string): boolean {
    if (!/^[5-9]\d{9,14}$/.test(d)) return false;
    if (/^(\d)\1+$/.test(d)) return false;
    let asc = true;
    let desc = true;
    for (let i = 1; i < d.length; i++) {
        const diff = Number(d[i]) - Number(d[i - 1]);
        if (diff !== 1) asc = false;
        if (diff !== -1) desc = false;
    }
    return !asc && !desc;
}

/** PIN: exactly 6 digits, last three not "000", and first two digits within the state's Appendix C range. */
export function isValidPin(pin: string, stateCode?: string): { ok: boolean; reason?: string } {
    if (!/^\d{6}$/.test(pin)) return { ok: false, reason: 'PIN code must be exactly 6 digits' };
    if (pin.slice(3) === '000') return { ok: false, reason: 'PIN code last three digits cannot be 000' };
    if (stateCode) {
        const range = PIN_PREFIX_RANGE[stateCode];
        const prefix = Number(pin.slice(0, 2));
        if (range && (prefix < range[0] || prefix > range[1])) {
            return { ok: false, reason: `PIN prefix ${pin.slice(0, 2)} does not belong to state ${stateCode} (allowed ${range[0]}-${range[1]})` };
        }
    }
    return { ok: true };
}
