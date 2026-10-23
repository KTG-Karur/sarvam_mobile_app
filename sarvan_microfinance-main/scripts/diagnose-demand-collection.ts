/**
 * Diagnostic Script: Demand Collection Debugging
 * 
 * This script helps identify why loan schedules are not appearing in the Demand Collection screen.
 * 
 * Run with: npx tsx scripts/diagnose-demand-collection.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnoseDemandCollection() {
    console.log('🔍 Starting Demand Collection Diagnostic...\n');

    try {
        // Step 1: Check if there are any active centers
        console.log('📍 Step 1: Checking Centers...');
        const centers = await prisma.center.findMany({
            where: { isActive: true },
            select: {
                id: true,
                name: true,
                code: true,
                branchId: true,
            }
        });
        console.log(`   Found ${centers.length} active centers`);
        if (centers.length > 0) {
            console.log('   Sample centers:', centers.slice(0, 3).map(c => `${c.code} - ${c.name}`).join(', '));
        }
        console.log('');

        if (centers.length === 0) {
            console.log('❌ No active centers found. Please create centers first.\n');
            return;
        }

        // Step 2: Check for active loans
        console.log('💰 Step 2: Checking Active Loans...');
        const loans = await prisma.loan.findMany({
            where: {
                isActive: true,
            },
            select: {
                id: true,
                loanNumber: true,
                disbursementStatus: true,
                centerId: true,
                clientId: true,
                amount: true,
            }
        });
        console.log(`   Found ${loans.length} active loans`);

        const disbursedLoans = loans.filter(l => l.disbursementStatus === 'DISBURSED');
        console.log(`   ${disbursedLoans.length} loans are DISBURSED`);

        const statusBreakdown = loans.reduce((acc, loan) => {
            acc[loan.disbursementStatus] = (acc[loan.disbursementStatus] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log('   Status breakdown:', statusBreakdown);
        console.log('');

        if (disbursedLoans.length === 0) {
            console.log('❌ No DISBURSED loans found. Loans must be disbursed to appear in demand collection.\n');
            console.log('💡 Next steps:');
            console.log('   1. Create loan applications (FDO)');
            console.log('   2. Create loan index (BM)');
            console.log('   3. Approve loans (AM)');
            console.log('   4. Disburse loans (BM)\n');
            return;
        }

        // Step 3: Check for loan schedules
        console.log('📅 Step 3: Checking Loan Schedules...');
        const schedules = await prisma.loanSchedule.findMany({
            include: {
                loan: {
                    select: {
                        loanNumber: true,
                        disbursementStatus: true,
                        isActive: true,
                        centerId: true,
                        client: {
                            select: {
                                firstName: true,
                                lastName: true,
                            }
                        }
                    }
                }
            }
        });
        console.log(`   Found ${schedules.length} total loan schedules`);

        const pendingSchedules = schedules.filter(s =>
            s.loan.isActive &&
            s.loan.disbursementStatus === 'DISBURSED' &&
            ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(s.status)
        );
        console.log(`   ${pendingSchedules.length} schedules are pending/overdue/partially paid for active disbursed loans`);
        console.log('');

        if (schedules.length === 0) {
            console.log('❌ No loan schedules found. Schedules should be created during disbursement.\n');
            console.log('💡 Check if the disbursement process is creating schedules correctly.\n');
            return;
        }

        // Step 4: Sample schedule details
        if (pendingSchedules.length > 0) {
            console.log('📋 Step 4: Sample Pending Schedules (First 5)...');
            const samples = pendingSchedules.slice(0, 5);

            for (const schedule of samples) {
                const clientName = `${schedule.loan.client.firstName} ${schedule.loan.client.lastName}`;
                console.log(`   Loan: ${schedule.loan.loanNumber} | Client: ${clientName}`);
                console.log(`   Installment #${schedule.installmentNo} | Due: ${schedule.dueDate.toISOString().split('T')[0]}`);
                console.log(`   Status: ${schedule.status} | Total Due: ₹${schedule.totalDue}`);
                console.log(`   Principal: ₹${schedule.principalDue} | Interest: ₹${schedule.interestDue}`);
                console.log(`   Paid: ₹${schedule.totalPaid} | Remaining: ₹${Number(schedule.totalDue) - Number(schedule.totalPaid)}`);
                console.log('');
            }
        }

        // Step 5: Check for a specific date (example: 28/2/2026)
        console.log('🎯 Step 5: Checking Schedules for Specific Date (2026-02-28)...');
        const targetDate = new Date('2026-02-28');
        const schedulesOnDate = await prisma.loanSchedule.findMany({
            where: {
                dueDate: {
                    lte: targetDate
                },
                status: {
                    in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID']
                },
                loan: {
                    isActive: true,
                    disbursementStatus: 'DISBURSED'
                }
            },
            include: {
                loan: {
                    select: {
                        loanNumber: true,
                        centerId: true,
                        center: {
                            select: {
                                code: true,
                                name: true,
                            }
                        },
                        client: {
                            select: {
                                firstName: true,
                                lastName: true,
                            }
                        }
                    }
                }
            }
        });

        console.log(`   Found ${schedulesOnDate.length} schedules due on or before 2026-02-28`);

        if (schedulesOnDate.length > 0) {
            console.log('   Sample schedules:');
            schedulesOnDate.slice(0, 3).forEach(s => {
                console.log(`   - ${s.loan.loanNumber} | ${s.loan.client.firstName} ${s.loan.client.lastName} | Center: ${s.loan.center.name} | Due: ${s.dueDate.toISOString().split('T')[0]}`);
            });
        }
        console.log('');

        // Step 6: Group by center
        console.log('🏢 Step 6: Schedules Grouped by Center...');
        const centerGroups = schedulesOnDate.reduce((acc, schedule) => {
            const centerId = schedule.loan.centerId;
            const centerName = schedule.loan.center.name;
            if (!acc[centerId]) {
                acc[centerId] = { centerName, count: 0, schedules: [] };
            }
            acc[centerId].count++;
            acc[centerId].schedules.push(schedule);
            return acc;
        }, {} as Record<string, { centerName: string; count: number; schedules: any[] }>);

        Object.entries(centerGroups).forEach(([centerId, data]) => {
            console.log(`   Center: ${data.centerName} (ID: ${centerId})`);
            console.log(`   - ${data.count} pending schedules`);
            console.log(`   - Total Due: ₹${data.schedules.reduce((sum, s) => sum + Number(s.totalDue) - Number(s.totalPaid), 0).toFixed(2)}`);
        });
        console.log('');

        // Step 7: Summary and recommendations
        console.log('✅ Diagnostic Summary:');
        console.log(`   - Centers: ${centers.length}`);
        console.log(`   - Active Loans: ${loans.length}`);
        console.log(`   - Disbursed Loans: ${disbursedLoans.length}`);
        console.log(`   - Total Schedules: ${schedules.length}`);
        console.log(`   - Pending Schedules: ${pendingSchedules.length}`);
        console.log(`   - Schedules due by 2026-02-28: ${schedulesOnDate.length}`);
        console.log('');

        if (schedulesOnDate.length === 0) {
            console.log('❌ ISSUE IDENTIFIED: No schedules found for the target date.');
            console.log('');
            console.log('💡 Possible reasons:');
            console.log('   1. Loan schedules have not been created yet (check disbursement process)');
            console.log('   2. All schedules are already PAID');
            console.log('   3. Due dates are set for future dates');
            console.log('   4. Loans are not in DISBURSED status');
            console.log('');
        } else {
            console.log('✅ Data looks good! Schedules exist for the target date.');
            console.log('');
            console.log('🔍 If you still cannot see data in the UI:');
            console.log('   1. Check browser console for API errors');
            console.log('   2. Verify the center ID being passed to the API');
            console.log('   3. Check user permissions (branchId access)');
            console.log('   4. Verify the date format being sent to the API');
            console.log('');
        }

    } catch (error) {
        console.error('❌ Error during diagnostic:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the diagnostic
diagnoseDemandCollection();
