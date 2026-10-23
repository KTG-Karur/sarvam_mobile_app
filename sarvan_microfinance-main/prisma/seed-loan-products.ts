import { companyNameShort } from '@/hooks/use-toast';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedLoanProducts() {
    console.log('Seeding loan products...');

    // Ensure GENERAL product type exists
    await prisma.loanProductType.upsert({
        where: { typeId: 'GENERAL' },
        update: {},
        create: {
            typeId: 'GENERAL',
            name: 'GENERAL',
            isActive: true,
        },
    });

    const products = [
        {
            productId: '10000',
            productName: '10000 LOAN',
            loanAmount: 10000,
            interestRate: 25,
            frequency: 'weekly',
            interestAmount: 2500,
            numberOfDues: 50,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '20000',
            productName: '20000 product',
            loanAmount: 20000,
            interestRate: 25,
            frequency: 'forthnight',
            interestAmount: 5000,
            numberOfDues: 25,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '20000W',
            productName: '20000W',
            loanAmount: 20000,
            interestRate: 25,
            frequency: 'weekly',
            interestAmount: 5000,
            numberOfDues: 20,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '25000WKS',
            productName: '25000 WKS',
            loanAmount: 25000,
            interestRate: 25,
            frequency: 'weekly',
            interestAmount: 6250,
            numberOfDues: 24,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '25000FNS',
            productName: '25000 FNS',
            loanAmount: 25000,
            interestRate: 25,
            frequency: 'forthnight',
            interestAmount: 6250,
            numberOfDues: 24,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '30000FNS',
            productName: '30000FNS',
            loanAmount: 30000,
            interestRate: 25,
            frequency: 'forthnight',
            interestAmount: 7500,
            numberOfDues: 30,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: '30000',
            productName: '30000',
            loanAmount: 30000,
            interestRate: 8,
            frequency: 'weekly',
            interestAmount: 2400,
            numberOfDues: 35,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN10000',
            productName: 'FN 10000',
            loanAmount: 10000,
            interestRate: 58.5,
            frequency: 'forthnight',
            interestAmount: 5850,
            numberOfDues: 50,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN20000',
            productName: 'FN 20000',
            loanAmount: 20000,
            interestRate: 33.75,
            frequency: 'forthnight',
            interestAmount: 6750,
            numberOfDues: 25,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN30000',
            productName: 'FN 30000',
            loanAmount: 30000,
            interestRate: 28,
            frequency: 'forthnight',
            interestAmount: 8400,
            numberOfDues: 30,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN30000CAMP',
            productName: 'FN 30000 CAMP',
            loanAmount: 30000,
            interestRate: 38.5,
            frequency: 'forthnight',
            interestAmount: 11550,
            numberOfDues: 30,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN40000',
            productName: 'FN 40000',
            loanAmount: 40000,
            interestRate: 21,
            frequency: 'forthnight',
            interestAmount: 8400,
            numberOfDues: 35,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: 'FN10000ALL',
            productName: 'FN 10000 ALL',
            loanAmount: 10000,
            interestRate: 58.5,
            frequency: 'forthnight',
            interestAmount: 5850,
            numberOfDues: 60,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
        {
            productId: `W${companyNameShort}0000CAMP`,
            productName: 'WK 30000 CAMP',
            loanAmount: 30000,
            interestRate: 38.5,
            frequency: 'weekly',
            interestAmount: 11550,
            numberOfDues: 35,
            status: 'enabled',
            loanProductTypeId: 'GENERAL',
        },
    ];

    for (const product of products) {
        try {
            const { loanProductTypeId, ...productData } = product;
            await prisma.loanProduct.upsert({
                where: { productId: product.productId },
                update: {
                    ...productData,
                    loanProductType: {
                        connect: { typeId: loanProductTypeId },
                    },
                },
                create: {
                    ...productData,
                    loanProductType: {
                        connect: { typeId: loanProductTypeId },
                    },
                },
            });
            console.log(`✓ Created/Updated product: ${product.productName}`);
        } catch (error) {
            console.error(`✗ Failed to create product ${product.productName}:`, error);
        }
    }

    console.log('Loan products seeding completed!');
}

async function main() {
    try {
        await seedLoanProducts();
    } catch (error) {
        console.error('Error during seeding:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
