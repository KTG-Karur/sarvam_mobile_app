import { prisma } from '@/app/lib/db';
import { cache } from 'react';

/**
 * True when the branch is Head Office (code HO or name "head office").
 * Shared by server route protection and API role checks.
 */
export const isHeadOfficeBranch = cache(async (branchId: string): Promise<boolean> => {
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { code: true, name: true },
  });

  if (!branch) return false;
  if (branch.code === 'HO') return true;
  if (branch.name.toLowerCase() === 'head office') return true;
  return false;
});
