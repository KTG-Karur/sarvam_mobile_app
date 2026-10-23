import { PrismaClient } from '@prisma/client';

async function main() {
    const prisma = new PrismaClient();
    try {
        console.log('Testing LeaveType model...');
        const count = await (prisma as any).leaveType.count();
        console.log('Count:', count);
    } catch (error: any) {
        console.error('Test failed:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

main();
