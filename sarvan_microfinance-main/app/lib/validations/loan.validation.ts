import { z } from 'zod';

/**
 * Loan application creation schema
 */
export const loanApplicationSchema = z.object({
    clientId: z.string().min(1, 'Client ID is required'),
    centerId: z.string().min(1, 'Center ID is required'),
    loanProductId: z.string().min(1, 'Loan product is required'),
    amount: z
        .string()
        .min(1, 'Amount is required')
        .refine(
            (val) => !isNaN(Number(val)) && Number(val) > 0,
            'Amount must be a valid positive number'
        )
        .refine(
            (val) => Number(val) >= 1000,
            'Amount must be at least ₹1,000'
        ),
    interestRate: z
        .string()
        .min(1, 'Interest rate is required')
        .refine(
            (val) => !isNaN(Number(val)) && Number(val) >= 0 && Number(val) <= 100,
            'Interest rate must be between 0 and 100'
        ),
    tenureMonths: z
        .number()
        .int('Tenure must be a whole number')
        .min(1, 'Tenure must be at least 1 month')
        .max(120, 'Tenure cannot exceed 120 months'),
    frequency: z.enum(['daily', 'weekly', 'forthnight', 'monthly', 'quarterly'], {
        errorMap: () => ({ message: 'Invalid frequency selected' }),
    }),
    loanPurposeId: z.string().min(1, 'Loan purpose is required'), // Changed from 'purpose'
    // Optional — the co-applicant active/approved for this client at the time
    // of loan creation. Frozen onto the loan permanently via LoanCoApplicantSnapshot.
    coApplicantId: z.string().optional(),
});

export type LoanApplicationData = z.infer<typeof loanApplicationSchema>;