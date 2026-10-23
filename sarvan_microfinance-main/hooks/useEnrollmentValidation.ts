'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/app/lib/api-client';

export interface EnrollmentFieldConfig {
  fieldKey: string;
  fieldName: string;
  page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details';
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

export interface UseEnrollmentValidationReturn {
  config: Record<string, EnrollmentFieldConfig>;
  configArray: EnrollmentFieldConfig[];
  isLoading: boolean;
  error: string | null;
  isRequired: (fieldKey: string, defaultValue?: boolean) => boolean;
}

/**
 * Hook to fetch and cache enrollment validation configuration
 * Returns a map of field keys to their configuration for easy lookup
 */
export function useEnrollmentValidation(): UseEnrollmentValidationReturn {
  const [config, setConfig] = useState<Record<string, EnrollmentFieldConfig>>({});
  const [configArray, setConfigArray] = useState<EnrollmentFieldConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await apiClient.get<EnrollmentFieldConfig[]>('/enrollment-validation');

        if (!response || !response.success) {
          // Log with explicit message so it's readable in all terminal/overlay renderers
          const reason = response?.error ?? 'API returned a failure response';
          console.warn(
            '[useEnrollmentValidation] Config fetch failed — using field defaults.',
            reason
          );
          setConfig({});
          setConfigArray([]);
          return;
        }

        if (!response.data || !Array.isArray(response.data)) {
          console.warn('[useEnrollmentValidation] Empty or invalid config received, using defaults');
          setConfig({});
          setConfigArray([]);
          return;
        }

        const configArray = response.data;
        const configMap: Record<string, EnrollmentFieldConfig> = {};
        configArray.forEach((field) => {
          configMap[field.fieldKey] = field;
        });

        setConfig(configMap);
        setConfigArray(configArray);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch config';
        setError(errorMessage);
        // Log message + error separately so both are readable in all terminal renderers
        console.error('[useEnrollmentValidation] Unexpected error:', errorMessage, err);
        // Set empty config as fallback so form doesn't break
        setConfig({});
        setConfigArray([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConfig();
  }, []);

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
  };
}
