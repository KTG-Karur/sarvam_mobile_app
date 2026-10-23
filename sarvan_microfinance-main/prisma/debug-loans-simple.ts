
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Fetching all centers...')
    const centers = await prisma.center.findMany({
        include: {
            loans: true
        }
    })

    for (const center of centers) {
        console.log(`Center: ${center.name} (${center.code}) - ID: ${center.id}`)
        console.log(`Total Loans: ${center.loans.length}`)
        center.loans.forEach(loan => {
            console.log(` - Loan: ${loan.loanNumber}, Status: ${loan.disbursementStatus}, Active: ${loan.isActive}`)
        })
    }

    // Also check loans without center valid link if any
    const orphanedLoans = await prisma.loan.findMany({
        where: {
            centerId: { notIn: centers.map(c => c.id) }
        }
    })
    console.log(`Orphaned Loans: ${orphanedLoans.length}`)
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
