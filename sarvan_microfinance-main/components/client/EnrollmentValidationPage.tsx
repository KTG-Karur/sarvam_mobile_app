'use client';

import { useState, useMemo, useCallback } from 'react';
import { Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';
import { useEnrollmentValidation, type EnrollmentFieldConfig } from '@/hooks/useEnrollmentValidation';
import { Label } from '@/components/ui/label';

export function EnrollmentValidationPage() {
  const { toast } = useToast();
  const { config, configArray, isLoading, error } = useEnrollmentValidation();
  const [localConfig, setLocalConfig] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize local config when data loads
  const initialized = useMemo(() => {
    if (configArray.length > 0 && Object.keys(localConfig).length === 0) {
      const initial: Record<string, boolean> = {};
      configArray.forEach((field) => {
        initial[field.fieldKey] = field.isRequired;
      });
      setLocalConfig(initial);
      return true;
    }
    return true;
  }, [configArray, localConfig]);

  // Group fields by page
  const fieldsByPage = useMemo(() => {
    const grouped: Record<string, EnrollmentFieldConfig[]> = {
      client_details: [],
      client_other: [],
      co_applicant: [],
      loan_details: [],
      kyc: [],
    };

    configArray.forEach((field) => {
      const page = field.page as keyof typeof grouped;
      if (grouped[page]) {
        grouped[page].push(field);
      } else {
        grouped['client_details'].push(field);
      }
    });

    return grouped;
  }, [configArray]);

  const handleToggle = useCallback((fieldKey: string, isRequired: boolean) => {
    setLocalConfig((prev) => ({
      ...prev,
      [fieldKey]: isRequired,
    }));
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    try {
      setIsSaving(true);

      // Prepare updates - only include fields that changed
      const updates = configArray
        .filter((field) => localConfig[field.fieldKey] !== field.isRequired)
        .map((field) => ({
          fieldKey: field.fieldKey,
          isRequired: localConfig[field.fieldKey],
        }));

      if (updates.length === 0) {
        toast({
          title: 'No Changes',
          description: 'No configuration changes were made.',
        });
        setIsSaving(false);
        return;
      }

      const response = await apiClient.post('/enrollment-validation', {
        updates,
      });

      if (!response || !response.success) {
        throw new Error(response?.message || 'Failed to save configuration');
      }

      toast({
        title: 'Success',
        description: `Saved configuration for ${updates.length} field(s).`,
      });

      setHasChanges(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save configuration';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      console.error('Error saving enrollment validation config:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground dark:text-white">
            Client Enrollment Validation
          </h1>
          <p className="mt-2 text-sm text-sidebar-accent dark:text-slate-400">
            Loading configuration...
          </p>
        </div>
        <Card>
          <CardContent className="py-12">
            <p className="text-center text-slate-500">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground dark:text-white">
            Client Enrollment Validation
          </h1>
        </div>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error Loading Configuration</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground dark:text-white">
          Client Enrollment Validation
        </h1>
        <p className="mt-2 text-sm text-sidebar-accent dark:text-slate-400">
          Configure which fields are required or optional during the client enrollment process. Fields marked with a red asterisk (*) are always required.
        </p>
      </div>

      {/* Change Summary */}
      {hasChanges && (
        <Alert className="border-primary/30 bg-green-50 dark:border-brand-green-darker dark:bg-green-950">
          <AlertCircle className="h-4 w-4 text-primary dark:text-primary" />
          <AlertTitle className="text-foreground dark:text-green-100">Unsaved Changes</AlertTitle>
          <AlertDescription className="text-sidebar-accent dark:text-green-200">
            You have made changes to the field configuration. Click "Save Configuration" to apply them.
          </AlertDescription>
        </Alert>
      )}

      {/* 5-Tab Layout */}
      <Tabs defaultValue="client_details">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="client_details">Member Details</TabsTrigger>
          <TabsTrigger value="client_other">Other Details</TabsTrigger>
          <TabsTrigger value="co_applicant">Co-Applicant</TabsTrigger>
          <TabsTrigger value="loan_details">Loan Details</TabsTrigger>
          <TabsTrigger value="kyc">KYC Details</TabsTrigger>
        </TabsList>

        <TabsContent value="client_details">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Member Detail Validation</CardTitle>
              <CardDescription>Configure fields for the client details step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fieldsByPage.client_details.map((field) => (
                  <FieldToggleRow
                    key={field.fieldKey}
                    field={field}
                    isRequired={localConfig[field.fieldKey] ?? field.isRequired}
                    onToggle={() => handleToggle(field.fieldKey, !(localConfig[field.fieldKey] ?? field.isRequired))}
                    disabled={field.isAlwaysRequired}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="client_other">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Member Other Details Validation</CardTitle>
              <CardDescription>Configure fields for the client other details step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fieldsByPage.client_other.map((field) => (
                  <FieldToggleRow
                    key={field.fieldKey}
                    field={field}
                    isRequired={localConfig[field.fieldKey] ?? field.isRequired}
                    onToggle={() => handleToggle(field.fieldKey, !(localConfig[field.fieldKey] ?? field.isRequired))}
                    disabled={field.isAlwaysRequired}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="co_applicant">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Co-Applicant Validation</CardTitle>
              <CardDescription>Configure fields for the co-applicant step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fieldsByPage.co_applicant.map((field) => (
                  <FieldToggleRow
                    key={field.fieldKey}
                    field={field}
                    isRequired={localConfig[field.fieldKey] ?? field.isRequired}
                    onToggle={() => handleToggle(field.fieldKey, !(localConfig[field.fieldKey] ?? field.isRequired))}
                    disabled={field.isAlwaysRequired}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loan_details">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Loan Details Validation</CardTitle>
              <CardDescription>Configure fields for the loan product and group request step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fieldsByPage.loan_details.map((field) => (
                  <FieldToggleRow
                    key={field.fieldKey}
                    field={field}
                    isRequired={localConfig[field.fieldKey] ?? field.isRequired}
                    onToggle={() => handleToggle(field.fieldKey, !(localConfig[field.fieldKey] ?? field.isRequired))}
                    disabled={field.isAlwaysRequired}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="kyc">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">KYC Details Validation</CardTitle>
              <CardDescription>Configure fields for the KYC details step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fieldsByPage.kyc.map((field) => (
                  <FieldToggleRow
                    key={field.fieldKey}
                    field={field}
                    isRequired={localConfig[field.fieldKey] ?? field.isRequired}
                    onToggle={() => handleToggle(field.fieldKey, !(localConfig[field.fieldKey] ?? field.isRequired))}
                    disabled={field.isAlwaysRequired}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      <div className="flex justify-end gap-2">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          size="lg"
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}

/**
 * Row component for each field with toggle
 */
interface FieldToggleRowProps {
  field: EnrollmentFieldConfig;
  isRequired: boolean;
  onToggle: () => void;
  disabled: boolean;
}

function FieldToggleRow({ field, isRequired, onToggle, disabled }: FieldToggleRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/20 p-4 dark:border-sidebar-accent">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium text-foreground dark:text-white cursor-pointer">
            {field.fieldName}
          </Label>
          {disabled && (
            <span className="inline-block px-2 py-1 text-xs font-semibold text-red-600 bg-red-50 rounded dark:text-red-400 dark:bg-red-950">
              Always Required
            </span>
          )}
          {isRequired && !disabled && (
            <span className="inline-block text-red-500">*</span>
          )}
          {!isRequired && !disabled && (
            <span className="inline-block px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
              Optional
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {field.fieldKey}
        </p>
      </div>

      <Switch
        checked={isRequired}
        onCheckedChange={onToggle}
        disabled={disabled}
        aria-label={`Toggle ${field.fieldName} requirement`}
      />
    </div>
  );
}
