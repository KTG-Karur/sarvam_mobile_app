import { prisma } from '@/app/lib/prisma';

export interface EnrollmentFieldConfig {
  fieldKey: string;
  fieldName: string;
  page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details';
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

/**
 * Service for handling enrollment validation configuration
 */
export class EnrollmentValidationService {
  /**
   * Get all enrollment validation configurations
   */
  async getConfig(): Promise<EnrollmentFieldConfig[]> {
    try {
      const configs = await prisma.enrollmentValidationConfig.findMany({
        orderBy: [{ page: 'asc' }, { fieldKey: 'asc' }],
      });

      return configs.map((config) => ({
        fieldKey: config.fieldKey,
        fieldName: config.fieldName,
        page: config.page as 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details',
        isRequired: config.isRequired,
        isAlwaysRequired: config.isAlwaysRequired,
      }));
    } catch (error) {
      console.error('Error fetching enrollment validation config:', error);
      throw new Error('Failed to fetch enrollment validation config');
    }
  }

  /**
   * Get configuration for a specific page
   */
  async getConfigByPage(page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details'): Promise<EnrollmentFieldConfig[]> {
    try {
      const configs = await prisma.enrollmentValidationConfig.findMany({
        where: { page },
        orderBy: { fieldKey: 'asc' },
      });

      return configs.map((config) => ({
        fieldKey: config.fieldKey,
        fieldName: config.fieldName,
        page: config.page as 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details',
        isRequired: config.isRequired,
        isAlwaysRequired: config.isAlwaysRequired,
      }));
    } catch (error) {
      console.error(`Error fetching enrollment validation config for page ${page}:`, error);
      throw new Error(`Failed to fetch enrollment validation config for page ${page}`);
    }
  }

  /**
   * Check if a specific field is required
   */
  async isFieldRequired(fieldKey: string): Promise<boolean> {
    try {
      const config = await prisma.enrollmentValidationConfig.findUnique({
        where: { fieldKey },
        select: { isRequired: true },
      });

      return config?.isRequired ?? false;
    } catch (error) {
      console.error(`Error checking if field ${fieldKey} is required:`, error);
      throw new Error(`Failed to check if field ${fieldKey} is required`);
    }
  }

  /**
   * Batch upsert configurations
   * Updates isRequired flag for multiple fields at once
   */
  async upsertConfigs(updates: Array<{ fieldKey: string; isRequired: boolean }>): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        for (const update of updates) {
          await tx.enrollmentValidationConfig.update({
            where: { fieldKey: update.fieldKey },
            data: { isRequired: update.isRequired },
          });
        }
      });
    } catch (error) {
      console.error('Error updating enrollment validation config:', error);
      throw new Error('Failed to update enrollment validation config');
    }
  }

  /**
   * Server-side counterpart to the client-side `configErrors` gates already present
   * in every enrollment/client-update form. Checks a flat list of {configKey, value}
   * pairs against which fieldKeys are currently `isRequired: true`, and reports any
   * that are empty. Callers decide what "present in this request" means (e.g. the
   * Client Update PATCH route only passes fields actually present in the request body,
   * since that route is shared by several forms that each PATCH only their own slice
   * of the client record).
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

  /**
   * Reset configuration for a specific page to defaults
   */
  async resetPageDefaults(page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details'): Promise<void> {
    try {
      // For now, this is a placeholder. In the future, you can define default configs per page
      console.log(`Reset defaults for page: ${page}`);
    } catch (error) {
      console.error(`Error resetting defaults for page ${page}:`, error);
      throw new Error(`Failed to reset defaults for page ${page}`);
    }
  }
}

export const enrollmentValidationService = new EnrollmentValidationService();
