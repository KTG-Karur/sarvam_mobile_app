import { z } from 'zod';
import { validateVoterID } from '@/app/lib/validations/field-validations';
import { valuesMatchAfterNormalization } from '@/app/lib/identity-normalization';

const requiredText = (fieldLabel: string) =>
    z.string().trim().min(1, `${fieldLabel} is required`);

const optionalText = () =>
    z.string().trim().optional().default('');

const optionalMobile = () =>
    z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^(?:\+91|91|0)?[6-9]\d{9}$/.test(val), {
            message: 'Please enter a valid 10-digit phone number',
        });

const optionalEmail = () =>
    z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), {
            message: 'Please enter a valid email address',
        });

const requiredIntegerFromString = (fieldLabel: string) =>
    z
        .union([z.number(), z.string()])
        .transform((val) => {
            if (typeof val === 'number') return val;
            const parsed = parseInt(val, 10);
            return Number.isNaN(parsed) ? undefined : parsed;
        })
        .refine((val) => val !== undefined, {
            message: `${fieldLabel} is required`,
        });

const requiredDecimalFromString = (fieldLabel: string) =>
    z
        .union([z.number(), z.string()])
        .transform((val) => {
            if (typeof val === 'number') return val;
            const parsed = parseFloat(val);
            return Number.isNaN(parsed) ? undefined : parsed;
        })
        .refine((val) => val !== undefined, {
            message: `${fieldLabel} is required`,
        });

const optionalIntegerFromString = () =>
    z
        .union([z.number(), z.string()])
        .optional()
        .transform((val) => {
            if (val === undefined || val === '') return undefined;
            if (typeof val === 'number') return val;
            const parsed = parseInt(val, 10);
            return Number.isNaN(parsed) ? undefined : parsed;
        });

const optionalDecimalFromString = () =>
    z
        .union([z.number(), z.string()])
        .optional()
        .transform((val) => {
            if (val === undefined || val === '') return undefined;
            if (typeof val === 'number') return val;
            const parsed = parseFloat(val);
            return Number.isNaN(parsed) ? undefined : parsed;
        });

/**
 * KYC Verification Schema - All fields optional, validation via config
 */
export const kycVerificationSchema = z.object({
    mobileNumber: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^(?:\+91|91|0)?[6-9]\d{9}$/.test(val), {
            message: 'Please enter a valid 10-digit mobile number',
        }),
    caVoterIdNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || validateVoterID(val, false).isValid, {
            message: 'CA Voter ID must be in standard format: ABC1234567 or Tamil Nadu format',
        }),
    votersIdNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || validateVoterID(val, false).isValid, {
            message: 'Voter ID must be in standard format: ABC1234567 or Tamil Nadu format',
        }),
    caOtherIdNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^\d{12}$/.test(val), {
            message: 'CA Aadhaar number must be 12 digits',
        }),
    otherIdNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^\d{12}$/.test(val), {
            message: 'Aadhaar number must be 12 digits',
        }),
    pancardNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(val.toUpperCase()), {
            message: 'PAN card must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
        }),
    caPancardNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(val.toUpperCase()), {
            message: 'CA PAN card must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
        }),
    smartCardNo: optionalText(),
    aadhaarFrontFileUrl: optionalText(),
    aadhaarFrontFileName: optionalText(),
    aadhaarFrontFileSize: z.number().int().optional(),
    aadhaarFrontMimeType: optionalText(),
    aadhaarBackFileUrl: optionalText(),
    aadhaarBackFileName: optionalText(),
    aadhaarBackFileSize: z.number().int().optional(),
    aadhaarBackMimeType: optionalText(),
});

/**
 * Client Details Schema - All fields optional, validation via config
 */
export const clientDetailsSchema = z.object({
    // Center & Group
    centerId: optionalText(),
    groupId: optionalText(),

    // Group Request (FDO's preference; BM finalizes in Group Assign) — hardcoded mandatory
    memberGroupStatus: z.enum(['NEW_CENTER_NEW_MEMBER', 'EXISTING_CENTER_NEW_MEMBER'], {
        errorMap: () => ({ message: 'Group status is required' }),
    }),
    requestedCenterId: z.string().trim().min(1, 'Center is required'),
    requestedGroupId: z.string().trim().min(1, 'Requested group is required'),

    // Basic Information
    firstName: optionalText(),
    lastName: optionalText(),
    phone: optionalMobile(),
    email: optionalEmail(),

    // Address Information
    permanentAddress: optionalText(),
    pincode: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^[1-9][0-9]{5}$/.test(val), {
            message: 'Pincode must be a valid 6-digit number',
        }),
    postOffice: optionalText(),
    district: optionalText(),
    state: optionalText(),
    country: optionalText(),

    // Personal Details
    dateOfBirth: optionalText(),
    age: optionalIntegerFromString().refine((val) => val === undefined || (val >= 18 && val <= 100), {
        message: 'Client must be at least 18 years old and not more than 100',
    }),
    gender: optionalText(),
    caste: optionalText(),
    community: optionalText(),
    religion: optionalText(),
    economicActivityTypeId: optionalText(),
    economicActivityId: optionalText(),
    qualification: optionalText(),

    // Marital & Family Information
    maritalStatus: optionalText(),
    spouseName: optionalText(),
    spouseDob: optionalText(),
    spouseMobileNumber: optionalMobile(),
    spouseGender: optionalText(),
    spouseEconomicActivityTypeId: optionalText(),
    spouseEconomicActivityId: optionalText(),
    fatherName: optionalText(),
    motherName: optionalText(),
    noOfChildren: optionalIntegerFromString().refine((val) => val === undefined || val >= 0, {
        message: 'Number of children must be 0 or greater',
    }),

    // Financial Information
    monthlyFamilyIncome: optionalDecimalFromString()
        .refine((val) => val === undefined || val >= 0, {
            message: 'Monthly family income must be 0 or greater',
        }),
    monthlyFamilyExpense: optionalDecimalFromString().refine((val) => val === undefined || val >= 0, {
        message: 'Monthly family expense must be 0 or greater',
    }),

    // Banking Details
    ifscCode: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(val.toUpperCase()), {
            message: 'IFSC code must be in format: SBIN0001234 (4 letters, 0, 6 alphanumeric)',
        }),
    bankAcNo: z
        .string()
        .trim()
        .optional()
        .default('')
        .refine((val) => val === '' || /^\d{9,18}$/.test(val), {
            message: 'Bank account number must be 9-18 digits',
        }),
    bankName: optionalText(),
    bankBranch: optionalText(),
    bankAccountType: optionalText(),

    // Other Details
    houseStatus: optionalText(),

    // Location
    latitude: optionalText(),
    longitude: optionalText(),
});

/**
 * Nominee Details Schema - All fields optional, validation via config
 */
export const nomineeDetailsSchema = z.object({
    nomineeName: optionalText(),
    nomineePhoneNumber: optionalMobile(),
    nomineeGender: optionalText(),
    nomineeDateOfBirth: optionalText(),
    nomineeAge: optionalIntegerFromString().refine((val) => val === undefined || (val >= 0 && val <= 150), {
        message: 'Nominee age must be between 0 and 150',
    }),
    nomineeRelation: optionalText(),
    // Loan product selection (replaces manual requestedAmount entry)
    requestedLoanProductTypeId: optionalText(),
    requestedLoanFrequency: optionalText(),
    requestedLoanProductId: optionalText(),
    requestedLoanPurposeTypeId: optionalText(),
    requestedLoanPurposeId: optionalText(),
    admissionFees: optionalDecimalFromString().refine((val) => val === undefined || val >= 0, {
        message: 'Admission fees must be 0 or greater',
    }),
    coApplicantEconomicActivityTypeId: optionalText(),
    coApplicantEconomicActivityId: optionalText(),
});

/**
 * Complete Client Enrollment Schema
 */
export const clientEnrollmentSchema = z
    .object({
        kyc: kycVerificationSchema,
        client: clientDetailsSchema,
        nominee: nomineeDetailsSchema,
        nomineeIsCoApplicant: z.boolean().optional().default(true),
        isExistingClient: z.boolean().optional().default(false),
    })
    .superRefine((data, ctx) => {
        const pairs: Array<{
            field: 'MOBILE' | 'AADHAAR' | 'PAN' | 'VOTER_ID';
            a?: string;
            b?: string;
            path: (string | number)[];
            label: string;
        }> = [
            {
                field: 'MOBILE',
                a: data.kyc.mobileNumber,
                b: data.nominee.nomineePhoneNumber,
                path: ['nominee', 'nomineePhoneNumber'],
                label: 'Mobile Number',
            },
            {
                field: 'AADHAAR',
                a: data.kyc.otherIdNo,
                b: data.kyc.caOtherIdNo,
                path: ['kyc', 'caOtherIdNo'],
                label: 'Aadhaar Number',
            },
            {
                field: 'PAN',
                a: data.kyc.pancardNo,
                b: data.kyc.caPancardNo,
                path: ['kyc', 'caPancardNo'],
                label: 'PAN Card Number',
            },
            {
                field: 'VOTER_ID',
                a: data.kyc.votersIdNo,
                b: data.kyc.caVoterIdNo,
                path: ['kyc', 'caVoterIdNo'],
                label: 'Voter ID Number',
            },
        ];

        for (const pair of pairs) {
            if (valuesMatchAfterNormalization(pair.field, pair.a, pair.b)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: pair.path,
                    message: `Client and Co-Applicant cannot use the same ${pair.label}.`,
                });
            }
        }
    });

/**
 * Type exports for TypeScript
 */
export type KYCVerificationData = z.infer<typeof kycVerificationSchema>;
export type ClientDetailsData = z.infer<typeof clientDetailsSchema>;
export type NomineeDetailsData = z.infer<typeof nomineeDetailsSchema>;
export type ClientEnrollmentData = z.infer<typeof clientEnrollmentSchema>;
