/**
 * Script to check for and fix duplicate loan numbers in the database
 * Run this with: npx tsx scripts/check-loan-numbers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkLoanNumbers() {
    try {
        console.log('🔍 Checking for duplicate loan numbers...\n');

        // Get all loans ordered by creation date
        const loans = await prisma.loan.findMany({
            select: {
                id: true,
                loanNumber: true,
                createdAt: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        console.log(`📊 Total loans in database: ${loans.length}\n`);

        // Check for duplicates
        const loanNumberMap = new Map<string, number>();
        const duplicates: string[] = [];

        for (const loan of loans) {
            const count = loanNumberMap.get(loan.loanNumber) || 0;
            loanNumberMap.set(loan.loanNumber, count + 1);

            if (count > 0 && !duplicates.includes(loan.loanNumber)) {
                duplicates.push(loan.loanNumber);
            }
        }

        if (duplicates.length > 0) {
            console.log(`❌ Found ${duplicates.length} duplicate loan numbers:`);
            for (const loanNumber of duplicates) {
                const count = loanNumberMap.get(loanNumber);
                console.log(`   - ${loanNumber} (appears ${count} times)`);
            }
            console.log('\n⚠️  You need to manually fix these duplicates in the database.\n');
        } else {
            console.log('✅ No duplicate loan numbers found!\n');
        }

        // Show the latest loan number for each year
        const currentYear = new Date().getFullYear();
        const years = [currentYear - 1, currentYear];

        console.log('📋 Latest loan numbers by year:');
        for (const year of years) {
            const yearSuffix = year.toString().slice(-2);
            const prefix = `LN${yearSuffix}`;

            const lastLoan = await prisma.loan.findFirst({
                where: {
                    loanNumber: {
                        startsWith: prefix,
                    },
                },
                orderBy: {
                    loanNumber: 'desc',
                },
                select: {
                    loanNumber: true,
                    createdAt: true,
                },
            });

            if (lastLoan) {
                console.log(`   ${year}: ${lastLoan.loanNumber} (created: ${lastLoan.createdAt.toISOString()})`);
            } else {
                console.log(`   ${year}: No loans found`);
            }
        }

        console.log('\n✨ Check complete!\n');
    } catch (error) {
        console.error('❌ Error checking loan numbers:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkLoanNumbers();
