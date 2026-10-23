import { z } from 'zod';

// Single field config update
export const enrollmentFieldConfigSchema = z.object({
  fieldKey: z.string().min(1, 'Field key is required'),
  isRequired: z.boolean(),
});

// Batch update schema
export const enrollmentValidationUpdateSchema = z.object({
  updates: z.array(enrollmentFieldConfigSchema).min(1, 'At least one field update is required'),
});

export type EnrollmentFieldConfigUpdate = z.infer<typeof enrollmentFieldConfigSchema>;
export type EnrollmentValidationUpdate = z.infer<typeof enrollmentValidationUpdateSchema>;
