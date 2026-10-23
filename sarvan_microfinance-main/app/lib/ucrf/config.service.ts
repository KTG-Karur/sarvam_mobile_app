import { prisma } from '@/app/lib/db';
import type { UcrfConfig } from './types';

const ID = 'singleton';

export interface StoredUcrfConfig extends UcrfConfig {
    updatedAt: Date;
    updatedById: string;
}

export async function getUcrfConfig(): Promise<StoredUcrfConfig | null> {
    const row = await prisma.ucrfInstitutionConfig.findUnique({ where: { id: ID } });
    if (!row) return null;
    return {
        memberId: row.memberId,
        institutionName: row.institutionName,
        submittingBranchId: row.submittingBranchId,
        fileFrequency: row.fileFrequency,
        oldMemberId: row.oldMemberId,
        loanCategory: row.loanCategory,
        updatedAt: row.updatedAt,
        updatedById: row.updatedById,
    };
}

export async function saveUcrfConfig(config: UcrfConfig, userId: string): Promise<StoredUcrfConfig> {
    const data = { ...config, updatedById: userId };
    const row = await prisma.ucrfInstitutionConfig.upsert({
        where: { id: ID },
        create: { id: ID, ...data },
        update: data,
    });
    return { ...config, updatedAt: row.updatedAt, updatedById: row.updatedById };
}

export function configVersion(c: StoredUcrfConfig): string {
    return c.updatedAt.toISOString();
}
