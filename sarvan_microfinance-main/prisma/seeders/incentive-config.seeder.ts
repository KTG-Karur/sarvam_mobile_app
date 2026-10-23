import { PrismaClient, IncentiveConfigType } from '@prisma/client';

const prisma = new PrismaClient();

type SlabSeed = {
  slabOrder: number;
  label?: string;
  category?: string;
  minValue?: number;
  maxValue?: number;
  rate: number;
};

/**
 * Default slabs per configType, seeded from the written Incentive Report spec
 * (not from any sample spreadsheet). All values are admin-editable afterward
 * via /dashboard/masters/incentive-config — this seeder only supplies the
 * starting point and never overwrites an existing active config.
 */
export const DEFAULT_INCENTIVE_SLABS: Record<IncentiveConfigType, SlabSeed[]> = {
  CATEGORY_RULE: [
    { slabOrder: 1, label: 'Category C', category: 'C', minValue: 1, maxValue: 150, rate: 0 },
    { slabOrder: 2, label: 'Category B', category: 'B', minValue: 151, maxValue: 249, rate: 0 },
    { slabOrder: 3, label: 'Category A', category: 'A', minValue: 250, rate: 0 },
  ],
  GOLD_TARGET: [
    { slabOrder: 1, label: 'Existing Branch', category: 'EXISTING', rate: 30 },
    { slabOrder: 2, label: 'New Branch', category: 'NEW', rate: 40 },
  ],
  GOLD_ACHIEVEMENT_EXISTING: [
    { slabOrder: 1, label: '1 - 14 members', minValue: 0, maxValue: 14, rate: 0 },
    { slabOrder: 2, label: '15 - 17 members', minValue: 15, maxValue: 17, rate: 2000 },
    { slabOrder: 3, label: '18 - 20 members', minValue: 18, maxValue: 20, rate: 3000 },
    { slabOrder: 4, label: '21 and above', minValue: 21, rate: 5000 },
  ],
  GOLD_ACHIEVEMENT_NEW: [
    { slabOrder: 1, label: '1 - 19 members', minValue: 0, maxValue: 19, rate: 0 },
    { slabOrder: 2, label: '20 - 23 members', minValue: 20, maxValue: 23, rate: 2000 },
    { slabOrder: 3, label: '24 - 27 members', minValue: 24, maxValue: 27, rate: 3000 },
    { slabOrder: 4, label: '28 and above', minValue: 28, rate: 5000 },
  ],
  GOLD_WEIGHT_SLAB: [
    { slabOrder: 1, label: '0.500 - 0.640 g', minValue: 0.5, maxValue: 0.64, rate: 75 },
    { slabOrder: 2, label: '0.990 - 1.030 g', minValue: 0.99, maxValue: 1.03, rate: 100 },
    { slabOrder: 3, label: '1.050 - 2.020 g', minValue: 1.05, maxValue: 2.02, rate: 150 },
  ],
  JLG_INCENTIVE: [
    { slabOrder: 1, label: 'Per Member', rate: 50 },
  ],
  // Official FDO Category Collection Incentive table (CE% = Recovery %), based on
  // Current Active Members not including arrear members:
  //   A Class (min 250 members): 96%->750, 97%->1000, 98%->2000, 99%+->3000
  //   B Class (151-200 members): 96%->500,  97%->750,  98%->1000, 99%+->2000
  //   C Class (1-150 members):   96%->250,  97%->500,  98%->750,  99%+->1000
  // Below 96% recovery earns no Collection Incentive.
  COLLECTION_INCENTIVE: [
    { slabOrder: 1, label: '< 96%', category: 'A', maxValue: 95.999, rate: 0 },
    { slabOrder: 2, label: '96%', category: 'A', minValue: 96, maxValue: 96.999, rate: 750 },
    { slabOrder: 3, label: '97%', category: 'A', minValue: 97, maxValue: 97.999, rate: 1000 },
    { slabOrder: 4, label: '98%', category: 'A', minValue: 98, maxValue: 98.999, rate: 2000 },
    { slabOrder: 5, label: '99% and above', category: 'A', minValue: 99, rate: 3000 },
    { slabOrder: 6, label: '< 96%', category: 'B', maxValue: 95.999, rate: 0 },
    { slabOrder: 7, label: '96%', category: 'B', minValue: 96, maxValue: 96.999, rate: 500 },
    { slabOrder: 8, label: '97%', category: 'B', minValue: 97, maxValue: 97.999, rate: 750 },
    { slabOrder: 9, label: '98%', category: 'B', minValue: 98, maxValue: 98.999, rate: 1000 },
    { slabOrder: 10, label: '99% and above', category: 'B', minValue: 99, rate: 2000 },
    { slabOrder: 11, label: '< 96%', category: 'C', maxValue: 95.999, rate: 0 },
    { slabOrder: 12, label: '96%', category: 'C', minValue: 96, maxValue: 96.999, rate: 250 },
    { slabOrder: 13, label: '97%', category: 'C', minValue: 97, maxValue: 97.999, rate: 500 },
    { slabOrder: 14, label: '98%', category: 'C', minValue: 98, maxValue: 98.999, rate: 750 },
    { slabOrder: 15, label: '99% and above', category: 'C', minValue: 99, rate: 1000 },
  ],
  OD_COLLECTION_RATE: [
    { slabOrder: 1, label: '31 to 60 Days', minValue: 31, maxValue: 60, rate: 2 },
    { slabOrder: 2, label: '61 to 90 Days', minValue: 61, maxValue: 90, rate: 3 },
    { slabOrder: 3, label: '91 to 180 Days', minValue: 91, maxValue: 180, rate: 5 },
    { slabOrder: 4, label: 'Above 180 Days', minValue: 181, rate: 6 },
  ],
};

export async function seedIncentiveConfigs(): Promise<void> {
  console.log('📝 Seeding incentive configs...');

  for (const configType of Object.keys(DEFAULT_INCENTIVE_SLABS) as IncentiveConfigType[]) {
    const existing = await prisma.incentiveConfig.findFirst({
      where: { configType, isActive: true },
    });

    if (existing) {
      console.log(`  ⏭️  ${configType} (active config already exists, skipped)`);
      continue;
    }

    await prisma.incentiveConfig.create({
      data: {
        configType,
        isActive: true,
        slabs: { create: DEFAULT_INCENTIVE_SLABS[configType] },
      },
    });
    console.log(`  ✅ ${configType} (seeded ${DEFAULT_INCENTIVE_SLABS[configType].length} slabs)`);
  }

  console.log('✨ Incentive config seeding complete!');
}

if (require.main === module) {
  seedIncentiveConfigs()
    .then(() => {
      console.log('✨ Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
