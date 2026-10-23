import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { downloadObject } from '../app/lib/storage/gcs-client';

/**
 * Repairs member canonical KYC rows (loanId: null) left pointing at a deleted
 * pending/ key by the renewal final-approval flow: finalizeRenewalApproval
 * copied the renewal's residence docs with the same fileUrl, then
 * moveRenewalKycToVerified moved the file to verified/ but only repointed the
 * loan-scoped row. A row is repointed only when its verified/ twin exists.
 *
 *   npx tsx scripts/fix-renewal-promoted-kyc-urls.ts           # dry-run
 *   npx tsx scripts/fix-renewal-promoted-kyc-urls.ts --apply
 */
const prisma = new PrismaClient();

async function main() {
    const apply = process.argv.includes('--apply');

    const rows = await prisma.$queryRaw<Array<{ id: string; clientCode: string; fileUrl: string; verifiedUrl: string }>>`
        SELECT DISTINCT c.id, cl."clientId" AS "clientCode", c."fileUrl", r."fileUrl" AS "verifiedUrl"
        FROM kyc_documents c
        JOIN kyc_documents r
          ON r."clientId" = c."clientId"
         AND r."loanId" IS NOT NULL
         AND r."isDeleted" = false
         AND r."documentType" = c."documentType"
         AND r."fileUrl" = replace(c."fileUrl", '/pending/', '/verified/')
        JOIN clients cl ON cl.id = c."clientId"
        WHERE c."loanId" IS NULL
          AND c."isDeleted" = false
          AND c."fileUrl" LIKE '%/pending/%'`;

    const fixable: typeof rows = [];
    const verifiedMissing: string[] = [];
    for (const row of rows) {
        // Only repoint when the verified copy really exists — otherwise the
        // image is lost either way and needs a re-upload.
        const file = await downloadObject(row.verifiedUrl);
        if (!file) {
            verifiedMissing.push(`${row.clientCode}: ${row.verifiedUrl}`);
            continue;
        }
        fixable.push(row);
    }

    // One set-based UPDATE after all the (slow) storage checks, instead of a
    // round-trip per row — the remote managed DB/pooler drops long-idle or
    // long-running chatty connections mid-loop.
    let fixed = fixable.length;
    if (apply && fixable.length > 0) {
        const ids = fixable.map((r) => r.id);
        const urls = fixable.map((r) => r.verifiedUrl);
        fixed = await prisma.$executeRaw`
            UPDATE kyc_documents AS k
            SET "fileUrl" = v.url, "updatedAt" = NOW()
            FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${urls}::text[]) AS url) AS v
            WHERE k.id = v.id AND k."fileUrl" LIKE '%/pending/%'`;
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        brokenRows: rows.length,
        repointed: fixed,
        verifiedFileAlsoMissing: verifiedMissing.length,
        missing: verifiedMissing,
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
