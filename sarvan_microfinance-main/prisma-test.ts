import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const userCount = await prisma.user.count();
    console.log('User count:', userCount);
  } catch (error) {
    console.error('Error connecting to Prisma:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
