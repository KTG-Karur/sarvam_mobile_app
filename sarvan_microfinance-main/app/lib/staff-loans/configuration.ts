import { z } from 'zod';

export const SCHEME_PAGE = '/dashboard/masters/staff-loan-schemes';
export const WORKFLOW_PAGE = '/dashboard/masters/staff-loan-approval-workflow';
export type MasterCapabilities = { view: boolean; add: boolean; edit: boolean };
export type MasterOption = { id: string; name: string; isActive: boolean };

const requiredText = z.string().trim().min(1, 'Required');
const integer = z.number().int('Enter a whole number').nonnegative().max(2147483647);
const money = z.number().finite().nonnegative().max(9999999999999.99)
    .refine(n => /^\d+(\.\d{1,2})?$/.test(String(n)), 'Use at most two decimal places');
const fourDecimals = z.number().finite().nonnegative()
    .refine(n => /^\d+(\.\d{1,4})?$/.test(String(n)), 'Use at most four decimal places');
const ids = z.array(requiredText).refine(values => new Set(values).size === values.length, 'Remove duplicate selections');

export const schemeSchema = z.object({
    code: requiredText,
    name: requiredText,
    description: z.string().trim(),
    minimumServiceMonths: integer,
    // 0 = no minimum salary requirement.
    minimumSalaryPerMonth: money,
    amountBasis: z.enum(['FIXED_AMOUNT', 'SALARY_MULTIPLE']),
    maximumAmount: money.refine(n => n > 0, 'Maximum amount must be positive').nullable(),
    salaryMultiplier: fourDecimals.refine(n => n > 0 && n < 1000000, 'Enter a positive multiplier below 1000000').nullable(),
    maximumTenureMonths: integer.refine(n => n > 0, 'Tenure must be positive'),
    maximumActiveLoans: integer.refine(n => n > 0, 'Active-loan limit must be positive'),
    interestType: z.enum(['INTEREST_FREE', 'FLAT', 'MONTHLY']),
    annualInterestRate: fourDecimals.refine(n => n < 1000, 'Rate must be below 1000'),
    isActive: z.boolean(),
    branchIds: ids,
    departmentIds: ids,
    roleIds: ids,
    salaryBasisComponentIds: ids,
}).strict().superRefine((data, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (data.amountBasis === 'FIXED_AMOUNT' && (data.maximumAmount === null || data.salaryMultiplier !== null)) {
        issue('maximumAmount', 'Fixed amount requires a maximum amount and no salary multiplier');
    }
    if (data.amountBasis === 'SALARY_MULTIPLE') {
        if (data.salaryMultiplier === null || data.maximumAmount !== null) issue('salaryMultiplier', 'Select a salary multiplier and clear the fixed amount');
        if (!data.salaryBasisComponentIds.length) issue('salaryBasisComponentIds', 'Select earnings components for the salary basis');
    } else if (data.salaryBasisComponentIds.length) {
        issue('salaryBasisComponentIds', 'Salary basis components apply only to salary-multiple schemes');
    }
    if (data.interestType === 'INTEREST_FREE' && data.annualInterestRate !== 0) issue('annualInterestRate', 'Interest-free schemes must have a zero rate');
    if (data.interestType === 'FLAT' && data.annualInterestRate <= 0) issue('annualInterestRate', 'Flat-interest schemes require a positive annual rate');
    if (data.interestType === 'MONTHLY' && data.annualInterestRate <= 0) issue('annualInterestRate', 'Monthly-interest schemes require a positive monthly rate');
});
export type SchemeInput = z.infer<typeof schemeSchema>;
export type SchemeRecord = SchemeInput & { id: string; version: number };
export type SchemeOptions = { branches: MasterOption[]; departments: MasterOption[]; roles: MasterOption[]; salaryComponents: MasterOption[] };
export type SchemesResponse = { schemes: SchemeRecord[]; options: SchemeOptions; capabilities: MasterCapabilities };
export const schemeCreateSchema = z.object({ scheme: schemeSchema }).strict();
export const schemeUpdateSchema = z.object({ id: requiredText, expectedVersion: integer.refine(n => n > 0), scheme: schemeSchema }).strict();

const workflowBaseShape = {
    expectedConfigId: requiredText.nullable(),
    name: requiredText,
    isActive: z.boolean(),
    // Day of the month salaries are paid; installments fall due on it (the day before if a Sunday).
    salaryDay: z.number({ required_error: 'Enter the salary date (1 to 31)', invalid_type_error: 'Enter the salary date (1 to 31)' }).int('Enter a whole day of the month').min(1, 'Salary date must be between 1 and 31').max(31, 'Salary date must be between 1 and 31'),
    stages: z.array(z.object({
        levelOrder: integer.refine(n => n > 0),
        stageName: requiredText,
        roleId: requiredText,
    }).strict()).min(1, 'Add at least one approval stage'),
};
const requireConsecutiveStages = (data: { stages: { levelOrder: number }[] }, ctx: z.RefinementCtx) => {
    data.stages.forEach((stage, i) => {
        if (stage.levelOrder !== i + 1) ctx.addIssue({ code: 'custom', path: ['stages', i, 'levelOrder'], message: 'Stages must be ordered consecutively from 1' });
    });
};

const disbursementRoleIdsShape = ids.refine(v => v.length > 0, 'Select at least one disbursement role');

export const workflowSchema = z.object({
    ...workflowBaseShape,
    disbursementRoleIds: disbursementRoleIdsShape,
}).strict().superRefine(requireConsecutiveStages);
export type WorkflowInput = z.infer<typeof workflowSchema>;

/**
 * The Staff Advance workflow: approval stages and a disbursement authority, exactly like the loan one, but no
 * salary date (an advance's installments follow its own disbursement date).
 */
const { salaryDay: _loanOnlySalaryDay, ...advanceWorkflowBaseShape } = workflowBaseShape;
void _loanOnlySalaryDay;
export const advanceWorkflowSchema = z.object({
    ...advanceWorkflowBaseShape,
    disbursementRoleIds: disbursementRoleIdsShape,
}).strict().superRefine(requireConsecutiveStages);
export type AdvanceWorkflowInput = z.infer<typeof advanceWorkflowSchema>;
export type WorkflowKind = 'LOAN' | 'ADVANCE';
// salaryDay is null only for configurations saved before the setting existed.
export type WorkflowRecord = Omit<WorkflowInput, 'expectedConfigId' | 'salaryDay'> & { id: string; salaryDay: number | null };
export type WorkflowResponse = { config: WorkflowRecord | null; roles: MasterOption[]; capabilities: MasterCapabilities };

// Page grants use the same union semantics as the existing role-permission UI.
// No grant means no access; a legacy boolean grants view only.
export function resolveMasterCapabilities(isAdmin: boolean, permissions: unknown[], page: string): MasterCapabilities {
    const result = { view: isAdmin, add: isAdmin, edit: isAdmin };
    for (const value of permissions) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const grant = (value as Record<string, unknown>)[page];
        if (grant === true) result.view = true;
        if (grant && typeof grant === 'object' && !Array.isArray(grant)) {
            for (const key of ['view', 'add', 'edit'] as const) {
                if ((grant as Record<string, unknown>)[key] === true) result[key] = true;
            }
        }
    }
    result.add = result.view && result.add;
    result.edit = result.view && result.edit;
    return result;
}
