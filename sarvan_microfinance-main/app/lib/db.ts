// This module used to construct its own PrismaClient, independent of
// app/lib/prisma.ts — two singletons racing to claim the same global cache
// key, so which one "won" (and whether its connection_limit cap applied)
// depended on module load order. Consolidated onto the one real singleton so
// there is exactly one bounded connection pool per process, always.
export { prisma, default } from '@/app/lib/prisma';
