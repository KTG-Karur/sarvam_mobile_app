import { prisma } from '@/app/lib/prisma';
import { compareOnboardingFields, type HrOnboardingSection } from '@/app/lib/hr/onboarding-field-definitions';
import { ID_CARD_LOCKED_ONBOARDING_KEYS } from '@/app/lib/hr/id-card-eligibility';

export type { HrOnboardingSection };

export interface HrOnboardingFieldConfigDto {
  fieldKey: string;
  fieldLabel: string;
  section: HrOnboardingSection;
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

// This table is read on every onboarding-form page load (the useHrOnboardingValidation
// hook), every submit-for-approval check, and every action-route approval — all far
// more often than it's written (an admin occasionally toggling a field on the config
// page). A short-TTL, invalidate-on-write cache turns a flood of concurrent requests
// (the "1000 hits" case) into one DB round trip per TTL window instead of one per
// request. Same in-memory, per-process singleton pattern as
// app/lib/permissions/cache.ts and app/lib/rate-limit.ts.
const CACHE_TTL_MS = 60_000;

interface ConfigCache {
  data: HrOnboardingFieldConfigDto[] | null;
  cachedAt: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __hrOnboardingFieldConfigCache: ConfigCache | undefined;
}

const cache: ConfigCache = global.__hrOnboardingFieldConfigCache ?? (global.__hrOnboardingFieldConfigCache = { data: null, cachedAt: 0 });

/**
 * Mirrors EnrollmentValidationService, scoped to the New Employee Onboarding
 * form's own field set (see prisma HrOnboardingFieldConfig for why this is a
 * separate table from EmployeeFieldConfig).
 */
export class HrOnboardingValidationService {
  async getConfig(): Promise<HrOnboardingFieldConfigDto[]> {
    if (cache.data && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
      return cache.data;
    }

    try {
      const configs = await prisma.hrOnboardingFieldConfig.findMany();
      // The table has no sort column; the form's own tab/field order is
      // defined in code so the admin page mirrors the manual-entry form.
      // Fields the printed ID card depends on are locked in code (not just in
      // the DB row), so they're required and un-toggleable everywhere this
      // config is read — intake asterisks, submit-for-approval, final approval
      // and Employee Master — without needing a data migration.
      const dto = configs
        .map((c) => {
          const lockedForIdCard = ID_CARD_LOCKED_ONBOARDING_KEYS.has(c.fieldKey);
          return {
            fieldKey: c.fieldKey,
            fieldLabel: c.fieldLabel,
            section: c.section as HrOnboardingSection,
            isRequired: c.isRequired || lockedForIdCard,
            isAlwaysRequired: c.isAlwaysRequired || lockedForIdCard,
          };
        })
        .sort(compareOnboardingFields);
      cache.data = dto;
      cache.cachedAt = Date.now();
      return dto;
    } catch (error) {
      console.error('Error fetching HR onboarding validation config:', error);
      throw new Error('Failed to fetch HR onboarding validation config');
    }
  }

  async getConfigBySection(section: HrOnboardingSection): Promise<HrOnboardingFieldConfigDto[]> {
    const all = await this.getConfig();
    return all.filter((c) => c.section === section);
  }

  async isFieldRequired(fieldKey: string): Promise<boolean> {
    const all = await this.getConfig();
    return all.find((c) => c.fieldKey === fieldKey)?.isRequired ?? false;
  }

  /**
   * Batch-updates isRequired for multiple fields. Unlike the original
   * EnrollmentValidationService, this rejects any update that targets a
   * locked (isAlwaysRequired) field server-side — that lock exists because
   * the account-provisioning transaction structurally depends on those
   * fields, so it can't be a UI-only guard.
   */
  async upsertConfigs(updates: Array<{ fieldKey: string; isRequired: boolean }>): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        for (const update of updates) {
          const existing = await tx.hrOnboardingFieldConfig.findUnique({ where: { fieldKey: update.fieldKey } });
          if (!existing) continue;
          if (existing.isAlwaysRequired || ID_CARD_LOCKED_ONBOARDING_KEYS.has(existing.fieldKey)) {
            throw new Error(`"${existing.fieldLabel}" is locked and cannot be changed`);
          }
          await tx.hrOnboardingFieldConfig.update({
            where: { fieldKey: update.fieldKey },
            data: { isRequired: update.isRequired },
          });
        }
      });
      cache.data = null; // invalidate — next getConfig() re-reads from the DB
    } catch (error: any) {
      console.error('Error updating HR onboarding validation config:', error);
      throw new Error(error.message || 'Failed to update HR onboarding validation config');
    }
  }

  /**
   * Server-side counterpart to the onboarding form's per-field asterisks —
   * called from submit-for-approval so the real gate can never drift from
   * whatever the admin has configured on the validation page.
   */
  async assertRequiredFieldsPresent(
    fields: Array<{ configKey: string; value: unknown; label?: string }>
  ): Promise<{ ok: true } | { ok: false; missing: string[] }> {
    const allConfigs = await this.getConfig();
    const requiredKeys = new Set(allConfigs.filter((c) => c.isRequired).map((c) => c.fieldKey));

    const isEmpty = (value: unknown): boolean => {
      if (value === null || value === undefined) return true;
      if (typeof value === 'string') return value.trim() === '';
      return false;
    };

    const missing = fields
      .filter((f) => requiredKeys.has(f.configKey) && isEmpty(f.value))
      .map((f) => f.label ?? f.configKey);

    return missing.length > 0 ? { ok: false, missing } : { ok: true };
  }
}

export const hrOnboardingValidationService = new HrOnboardingValidationService();
