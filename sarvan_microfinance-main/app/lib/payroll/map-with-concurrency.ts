/**
 * Like Promise.all(items.map(fn)) but with at most `limit` calls in flight, and the results in the input order.
 * Used by read-only company-wide payroll work so hundreds of employees are not computed strictly one after another
 * (slow) nor all at once (exhausts the database pool).
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}
