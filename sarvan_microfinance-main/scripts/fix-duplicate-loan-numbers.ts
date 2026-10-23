/**
 * Script to fix duplicate loan numbers by regenerating them
 * Run this with: npx tsx scripts/fix-duplicate-loan-numbers.ts
 * 
 * WARNING: This will modify loan numbers in the database!
 * Make sure to backup your database before running this script.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixDuplicateLoanNumbers() {
    try {
        console.log('🔍 Finding duplicate loan numbers...\n');

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

        // Find duplicates
        const loanNumberMap = new Map<string, Array<{ id: string; createdAt: Date }>>();

        for (const loan of loans) {
            const existing = loanNumberMap.get(loan.loanNumber) || [];
            existing.push({ id: loan.id, createdAt: loan.createdAt });
            loanNumberMap.set(loan.loanNumber, existing);
        }

        const duplicates = Array.from(loanNumberMap.entries())
            .filter(([_, loans]) => loans.length > 1);

        if (duplicates.length === 0) {
            console.log('✅ No duplicate loan numbers found!\n');
            return;
        }

        console.log(`❌ Found ${duplicates.length} duplicate loan numbers\n`);

        // Fix duplicates
        let fixedCount = 0;

        for (const [loanNumber, duplicateLoans] of duplicates) {
            console.log(`\n📝 Fixing duplicates for ${loanNumber}:`);

            // Keep the first one (oldest), rename the others
            const [first, ...rest] = duplicateLoans.sort((a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime()
            );

            console.log(`   ✓ Keeping original: ${first.id} (${first.createdAt.toISOString()})`);

            for (const duplicate of rest) {
                // Generate new loan number
                const year = duplicate.createdAt.getFullYear();
                const yearSuffix = year.toString().slice(-2);
                const prefix = `LN${yearSuffix}`;

                // Find next available number
                let newLoanNumber = '';
                let attempt = 0;
                const maxAttempts = 100;

                while (attempt < maxAttempts) {
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
                        },
                    });

                    let sequentialNumber = 1;
                    if (lastLoan) {
                        const lastSequential = lastLoan.loanNumber.substring(prefix.length);
                        sequentialNumber = parseInt(lastSequential, 10) + 1;
                    }

                    const paddedNumber = sequentialNumber.toString().padStart(6, '0');
                    newLoanNumber = `${prefix}${paddedNumber}`;

                    // Check if this number is available
                    const exists = await prisma.loan.findUnique({
                        where: { loanNumber: newLoanNumber },
                    });

                    if (!exists) {
                        break;
                    }

                    attempt++;
                }

                if (attempt >= maxAttempts) {
                    console.error(`   ❌ Failed to generate unique loan number for ${duplicate.id}`);
                    continue;
                }

                // Update the loan number
                await prisma.loan.update({
                    where: { id: duplicate.id },
                    data: { loanNumber: newLoanNumber },
                });

                console.log(`   ✓ Updated ${duplicate.id}: ${loanNumber} → ${newLoanNumber}`);
                fixedCount++;
            }
        }

        console.log(`\n✨ Fixed ${fixedCount} duplicate loan numbers!\n`);
    } catch (error) {
        console.error('❌ Error fixing loan numbers:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Confirm before running
console.log('⚠️  WARNING: This script will modify loan numbers in the database!');
console.log('⚠️  Make sure you have a backup before proceeding.\n');

fixDuplicateLoanNumbers();
