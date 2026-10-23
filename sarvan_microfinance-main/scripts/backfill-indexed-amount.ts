import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const apply = process.argv.includes('--apply');

    const loans = await prisma.loan.findMany({
        where: { indexId: { not: null }, indexedAmount: null },
        select: { id: true, loanNumber: true, amount: true },
    });

    if (apply && loans.length > 0) {
        await prisma.$executeRaw`UPDATE loans SET "indexedAmount" = amount WHERE "indexId" IS NOT NULL AND "indexedAmount" IS NULL`;
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        loansMissingIndexedAmount: loans.length,
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
