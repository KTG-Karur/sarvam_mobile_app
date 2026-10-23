/**
 * Transaction Helper Utilities
 * Provides robust transaction management for Prisma with proper timeout handling and batch processing
 */

import { prisma } from '@/app/lib/prisma';

export interface TransactionOptions {
    maxWait?: number; // milliseconds to wait for connection from pool
    timeout?: number; // milliseconds until transaction times out
    isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
    batchSize?: number; // number of items to process per transaction
}

/**
 * Default transaction configuration for optimal performance
 */
export const DEFAULT_TX_OPTIONS: TransactionOptions = {
    maxWait: 30000, // 30 second server wait
    timeout: 60000, // 60 second transaction timeout
    isolationLevel: 'ReadCommitted', // Prevents phantom reads, allows dirty reads
};

/**
 * Execute a transaction with automatic retry and batch handling
 * Useful for large operations that might timeout
 * 
 * @example
 * const result = await withBatchTransaction(
 *   items,
 *   async (batch, tx) => {
 *     await tx.loan.createMany({ data: batch });
 *   },
 *   { batchSize: 10 }
 * );
 */
export async function withBatchTransaction<T, R>(
    items: T[],
    callback: (batch: T[], tx: any) => Promise<void>,
    options: TransactionOptions = {}
): Promise<number> {
    const config = { ...DEFAULT_TX_OPTIONS, ...options };
    const batchSize = config.batchSize || 10;
    let processedCount = 0;

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, Math.min(i + batchSize, items.length));

        try {
            await prisma.$transaction(
                async (tx) => {
                    await callback(batch, tx);
                },
                {
                    maxWait: config.maxWait,
                    timeout: config.timeout,
                    isolationLevel: config.isolationLevel,
                }
            );
            processedCount += batch.length;
        } catch (error) {
            console.error(
                `Transaction failed for batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}`,
                error
            );
            throw error;
        }
    }

    return processedCount;
}

/**
 * Execute a transaction with connection pooling awareness
 * Handles cases where connections might be exhausted by implementing smart retry logic
 */
export async function withRobustTransaction<T>(
    callback: (tx: any) => Promise<T>,
    options: TransactionOptions = {},
    maxRetries: number = 3
): Promise<T> {
    const config = { ...DEFAULT_TX_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await prisma.$transaction(
                callback,
                {
                    maxWait: config.maxWait,
                    timeout: config.timeout,
                    isolationLevel: config.isolationLevel,
                }
            );
        } catch (error: any) {
            lastError = error;

            const isConnectionError =
                error.message?.includes('Transaction not found') ||
                error.message?.includes('Connection timeout') ||
                error.message?.includes('too many connections') ||
                error.code === 'P2050' || // Transaction API error
                error.code === 'P2024'; // Connection timeout

            if (isConnectionError && attempt < maxRetries) {
                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt - 1) * 1000;
                console.warn(
                    `Connection error on attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`,
                    error.message
                );

                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Process records in a transaction-safe manner with progress tracking
 * Ideal for bulk operations with potential timeout risks
 * 
 * @example
 * const results = await processBulkWithTracking(
 *   loans,
 *   async (loan) => {
 *     return await processLoan(loan);
 *   },
 *   { batchSize: 5, verbose: true }
 * );
 */
export async function processBulkWithTracking<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    options: TransactionOptions & { verbose?: boolean } = {}
): Promise<R[]> {
    const config = { ...DEFAULT_TX_OPTIONS, ...options };
    const batchSize = config.batchSize || 10;
    const results: R[] = [];

    for (let batchIdx = 0; batchIdx < Math.ceil(items.length / batchSize); batchIdx++) {
        const batchStart = batchIdx * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, items.length);
        const batch = items.slice(batchStart, batchEnd);

        try {
            const batchResults = await Promise.all(
                batch.map((item, idx) => processor(item, batchStart + idx))
            );

            results.push(...batchResults);

            if (options.verbose) {
                console.log(
                    `Processed batch ${batchIdx + 1}/${Math.ceil(items.length / batchSize)} (${batchEnd}/${items.length} items)`
                );
            }
        } catch (error) {
            console.error(`Batch ${batchIdx + 1} processing failed:`, error);
            throw error;
        }
    }

    return results;
}

/**
 * Helper to ensure database operations complete within timeout
 * Useful for critical operations that must not be interrupted
 */
export async function withTimeoutProtection<T>(
    promise: Promise<T>,
    timeoutMs: number = 60000,
    operation: string = 'Operation'
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`${operation} exceeded ${timeoutMs}ms timeout`));
        }, timeoutMs);
    });

    try {
        const result = await Promise.race([promise, timeoutPromise]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return result;
    } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        throw error;
    }
}
