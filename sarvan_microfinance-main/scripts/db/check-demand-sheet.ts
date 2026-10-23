import { PrismaClient } from '@prisma/client';
import { format } from 'date-fns';

const prisma = new PrismaClient();

async function check() {
    const today = new Date();
    console.log('Today:', today);

    // Any schedule due <= today that is pending
    const schedules = await prisma.loanSchedule.findMany({
        where: {
            dueDate: { lte: today },
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            loan: {
                isActive: true,
                disbursementStatus: 'DISBURSED',
            }
        },
        include: {
            loan: {
                include: { client: true }
            }
        }
    });

    const centersWithDues = new Set(schedules.map(s => s.loan.centerId));
    console.log('Centers with schedules <= today:', centersWithDues.size);

    const centers = await prisma.center.findMany({
        where: { id: { in: Array.from(centersWithDues) as string[] } },
        select: { id: true, name: true, meetingDay: true }
    });

    for (const c of centers) {
        console.log(`Center: ${c.name}, MeetingDay: ${c.meetingDay}`);
    }
}

check().catch(console.error).finally(() => prisma.$disconnect());
