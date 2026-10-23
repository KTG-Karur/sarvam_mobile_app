/**
 * Natural comparator for member IDs like "29-96-1-1", "29-96-1-2", "29-96-1-10".
 * Splits on non-digit runs and compares each part numerically, so 1-2 sorts before 1-10
 * and 29-96-2-1 sorts after 29-96-1-9. Plain localeCompare / numeric-suffix-only sorts
 * both get this wrong. Falls back to a string compare when parts are equal or non-numeric.
 */
export function compareMemberIds(a: string | null | undefined, b: string | null | undefined): number {
    const sa = a ?? '';
    const sb = b ?? '';
    const pa = sa.split(/[^0-9]+/).filter(Boolean).map(Number);
    const pb = sb.split(/[^0-9]+/).filter(Boolean).map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i];
        const y = pb[i];
        if (x === undefined) return -1;
        if (y === undefined) return 1;
        if (x !== y) return x - y;
    }
    return sa.localeCompare(sb);
}
