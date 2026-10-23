import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const branches = await prisma.branch.findMany({ select: { name: true, code: true } });
    const users = await prisma.user.findMany({ select: { email: true, role: true, branchId: true } });

    console.log('Branches:', JSON.stringify(branches, null, 2));
    console.log('Users:', JSON.stringify(users, null, 2));
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
