import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const apply = process.argv.includes('--apply');

    const loans = await prisma.loan.findMany({
        where: { appliedAmount: null },
        select: { id: true, loanNumber: true, amount: true },
    });

    if (apply && loans.length > 0) {
        await prisma.$executeRaw`UPDATE loans SET "appliedAmount" = amount WHERE "appliedAmount" IS NULL`;
    }

    console.log(JSON.stringify({
        mode: apply ? 'apply' : 'dry-run',
        loansMissingAppliedAmount: loans.length,
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
