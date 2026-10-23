'use server';

import { prisma } from '@/app/lib/prisma';
import { getServerActionUser } from '@/app/lib/permissions/server-action-auth';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { downloadObject } from '@/app/lib/storage/gcs-client';

export type GoldRecordPhotoMeta = { id: string; photoUrl: string; photoKey: string | null };

async function assertLoanAccess(loanId: string): Promise<void> {
    const user = await getServerActionUser();
    if (!user) throw new Error('Authentication required');

    const loan = await prisma.loan.findUnique({ where: { id: loanId }, select: { branchId: true } });
    if (!loan) throw new Error('Loan not found');

    const branchIds = await getPermittedBranchIds(user);
    if (branchIds !== null && !branchIds.includes(loan.branchId)) {
        throw new Error('You do not have access to this loan');
    }
}

/** All gold-pledge (TAKE side) photos for a loan — used by the Gold Taken report's detail modal. */
export async function getGoldTakenPhotos(loanId: string): Promise<GoldRecordPhotoMeta[]> {
    await assertLoanAccess(loanId);
    return prisma.goldLoanDetailPhoto.findMany({
        where: { loanId },
        select: { id: true, photoUrl: true, photoKey: true },
        orderBy: { createdAt: 'asc' },
    });
}

/**
 * Downloads storage objects server-side and returns them as base64 data URLs,
 * for embedding into a client-generated jsPDF document via doc.addImage() —
 * the private bucket has no public CORS policy, so a browser-side <img>/fetch
 * against a signed URL can't be read into a canvas. Fetching the bytes here
 * (server-to-server) sidesteps that entirely.
 */
export async function getGoldPhotoDataUrls(keys: string[]): Promise<{ key: string; dataUrl: string }[]> {
    const user = await getServerActionUser();
    if (!user) throw new Error('Authentication required');

    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const results = await Promise.all(
        uniqueKeys.map(async (key) => {
            const obj = await downloadObject(key);
            if (!obj) return null;
            return { key, dataUrl: `data:${obj.contentType};base64,${obj.buffer.toString('base64')}` };
        })
    );
    return results.filter((r): r is { key: string; dataUrl: string } => r !== null);
}
