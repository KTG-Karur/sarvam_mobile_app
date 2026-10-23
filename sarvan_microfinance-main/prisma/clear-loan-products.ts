import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearLoanProducts() {
    console.log('Clearing all loan products from database...');

    try {
        const result = await prisma.loanProduct.deleteMany({});
        console.log(`✓ Deleted ${result.count} loan products`);
        console.log('Database is now empty - ready for you to add products via UI!');
    } catch (error) {
        console.error('✗ Failed to clear loan products:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

clearLoanProducts();
