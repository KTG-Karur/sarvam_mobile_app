'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/app/lib/api-client';

export interface HrOnboardingFieldConfig {
  fieldKey: string;
  fieldLabel: string;
  section: 'personal' | 'address' | 'organization' | 'identity' | 'bank' | 'insurance' | 'family' | 'documents';
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

export interface UseHrOnboardingValidationReturn {
  config: Record<string, HrOnboardingFieldConfig>;
  configArray: HrOnboardingFieldConfig[];
  isLoading: boolean;
  error: string | null;
  isRequired: (fieldKey: string, defaultValue?: boolean) => boolean;
  /** Re-fetch the config — callers that write to it (e.g. the admin save
   * screen) need this to resync afterward, otherwise their local diff base
   * goes stale and a second save compares against pre-save values. */
  refetch: () => Promise<void>;
}

/**
 * Mirrors useEnrollmentValidation, scoped to the New Employee Onboarding
 * form's own field set (app/api/hr/onboarding-field-config).
 */
export function useHrOnboardingValidation(): UseHrOnboardingValidationReturn {
  const [config, setConfig] = useState<Record<string, HrOnboardingFieldConfig>>({});
  const [configArray, setConfigArray] = useState<HrOnboardingFieldConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await apiClient.get<HrOnboardingFieldConfig[]>('/hr/onboarding-field-config');

      if (!response || !response.success) {
        // Previously only console.warn'd here — a clean API-level failure
        // (e.g. a 403/500 JSON response, as opposed to a thrown network
        // error) left `error` null forever, so the page rendered with zero
        // fields and no indication why. This is the actual failure mode the
        // page's own `{error && <Alert>...}` block was meant to catch.
        const reason = response?.error ?? 'API returned a failure response';
        setError(reason);
        console.warn('[useHrOnboardingValidation] Config fetch failed — using field defaults.', reason);
        setConfig({});
        setConfigArray([]);
        return;
      }

      if (!response.data || !Array.isArray(response.data)) {
        console.warn('[useHrOnboardingValidation] Empty or invalid config received, using defaults');
        setConfig({});
        setConfigArray([]);
        return;
      }

      const configArray = response.data;
      const configMap: Record<string, HrOnboardingFieldConfig> = {};
      configArray.forEach((field) => {
        configMap[field.fieldKey] = field;
      });

      setConfig(configMap);
      setConfigArray(configArray);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch config';
      setError(errorMessage);
      console.error('[useHrOnboardingValidation] Unexpected error:', errorMessage, err);
      setConfig({});
      setConfigArray([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const isRequired = (fieldKey: string, defaultValue: boolean = false): boolean => {
    if (!config[fieldKey]) return defaultValue;
    return config[fieldKey].isRequired;
  };

  return {
    config,
    configArray,
    isLoading,
    error,
    isRequired,
    refetch: fetchConfig,
  };
}
