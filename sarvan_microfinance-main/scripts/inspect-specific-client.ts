
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const clientId = 'cml17ojyv000sdwholk2ann6i';
    console.log(`Inspecting Client ID: ${clientId}`);

    const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: {
            loanApplications: {
                where: {
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                },
                include: {
                    loanProduct: true,
                    schedules: {
                        orderBy: { installmentNo: 'asc' }
                    }
                }
            }
        }
    });

    if (!client) {
        console.log('Client not found');
        return;
    }

    if (client.loanApplications.length === 0) {
        console.log('No active loans found');
        return;
    }

    const loan = client.loanApplications[0];
    console.log(`Loan ID: ${loan.id}`);
    console.log(`Loan Amount: ${loan.amount}`);
    console.log(`Loan InterestRate: ${loan.interestRate}`);
    console.log(`Loan Summary Identity - PrincipalPaid: ${loan.principalPaid}, InterestPaid: ${loan.interestPaid}`);

    console.log('\n--- Schedules ---');
    let calculatedTotalInterestDue = 0;
    let calculatedTotalInterestPaid = 0;

    loan.schedules.forEach(s => {
        const iDue = Number(s.interestDue);
        const iPaid = Number(s.interestPaid);
        calculatedTotalInterestDue += iDue;
        calculatedTotalInterestPaid += iPaid;
        console.log(`Inst ${s.installmentNo}: DueDate=${s.dueDate.toISOString().split('T')[0]}, InterestDue=${iDue}, InterestPaid=${iPaid}, Status=${s.status}`);
    });

    console.log('\n--- Calculation Check ---');
    console.log(`Sum of Schedule Interest Due: ${calculatedTotalInterestDue}`);
    console.log(`Sum of Schedule Interest Paid: ${calculatedTotalInterestPaid}`);
    console.log(`Loan Model Summary Interest Paid: ${loan.interestPaid}`);

    console.log(`\nAPI Logic Check:`);
    console.log(`Interest Balance (Schedule Sum Due - Loan Summary Paid): ${calculatedTotalInterestDue - Number(loan.interestPaid)}`);
    console.log(`Interest Balance (Schedule Sum Due - Schedule Sum Paid): ${calculatedTotalInterestDue - calculatedTotalInterestPaid}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
