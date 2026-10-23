import { PrismaClient } from '@prisma/client';
import { HR_ONBOARDING_FIELDS, type HrOnboardingFieldConfigSeed } from '../../app/lib/hr/onboarding-field-definitions';

// The field list (and the order it displays in) lives in
// app/lib/hr/onboarding-field-definitions.ts — re-exported so existing imports
// of it from here keep working.
export { HR_ONBOARDING_FIELDS };
export type { HrOnboardingFieldConfigSeed };

const prisma = new PrismaClient();

export async function seedHrOnboardingFieldConfigs(resetExisting = false): Promise<void> {
  try {
    if (resetExisting) {
      console.log('🗑️  Deleting existing HR onboarding field configs...');
      await prisma.hrOnboardingFieldConfig.deleteMany({});
    }

    console.log('📝 Seeding HR onboarding field configs...');

    const createdCount = { created: 0, updated: 0 };

    for (const field of HR_ONBOARDING_FIELDS) {
      const existing = await prisma.hrOnboardingFieldConfig.findUnique({ where: { fieldKey: field.fieldKey } });
      if (existing) {
        await prisma.hrOnboardingFieldConfig.update({
          where: { fieldKey: field.fieldKey },
          data: {
            fieldLabel: field.fieldLabel,
            section: field.section,
            isRequired: field.isRequired,
            isAlwaysRequired: field.isAlwaysRequired,
          },
        });
        createdCount.updated++;
        console.log(`  ✏️  ${field.fieldKey} (updated)`);
      } else {
        await prisma.hrOnboardingFieldConfig.create({
          data: {
            fieldKey: field.fieldKey,
            fieldLabel: field.fieldLabel,
            section: field.section,
            isRequired: field.isRequired,
            isAlwaysRequired: field.isAlwaysRequired,
          },
        });
        createdCount.created++;
        console.log(`  ✅ ${field.fieldKey} (created)`);
      }
    }

    const validKeys = HR_ONBOARDING_FIELDS.map((f) => f.fieldKey);
    const deleted = await prisma.hrOnboardingFieldConfig.deleteMany({
      where: { fieldKey: { notIn: validKeys } },
    });
    if (deleted.count > 0) {
      console.log(`  🗑️  Removed ${deleted.count} obsolete field(s) from DB`);
    }

    console.log(
      `\n✨ Seeding complete! Created: ${createdCount.created}, Updated: ${createdCount.updated}, Total: ${HR_ONBOARDING_FIELDS.length}`
    );
  } catch (error) {
    console.error('❌ Error seeding HR onboarding field configs:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedHrOnboardingFieldConfigs(false)
    .then(() => {
      console.log('✨ Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
