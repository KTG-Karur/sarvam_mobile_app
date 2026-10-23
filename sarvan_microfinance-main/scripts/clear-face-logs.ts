import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Clearing face verification logs and attendance records...');
    const logsResult = await prisma.faceVerificationLog.deleteMany({});
    console.log(`Successfully deleted ${logsResult.count} face verification log records.`);

    const attendanceResult = await prisma.attendance.deleteMany({});
    console.log(`Successfully deleted ${attendanceResult.count} attendance records.`);
}

main()
    .catch((e) => {
        console.error('Error clearing data:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
