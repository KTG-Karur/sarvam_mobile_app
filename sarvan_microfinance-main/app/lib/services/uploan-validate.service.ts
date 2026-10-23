import type { Prisma, PrismaClient } from '@prisma/client';
import {
    validateMobile,
    validatePAN,
    validateAadhaar,
    validateIFSC,
    validatePincode,
    validateBankAccount,
    validateAge,
    validateVoterID,
    validateEmail,
} from '@/app/lib/validations/field-validations';
import { buildLoanHistoryForLoan, type BranchRepaymentRow } from '@/app/lib/services/uploan-branch-repayment.service';
import type { GoldDetailsRow } from '@/app/lib/services/uploan-gold-details.service';
import { isGoldLoanProduct } from '@/app/lib/gl-config';
import {
    extractUploanLoanId,
    extractUploanMemberId,
    parseUploanMemberId,
    stripLegacyCodePrefix,
    resolveOfficerName,
    nameTokenKey,
    buildMemberNameKey,
    normalizeMemberId,
    namesLooselyOverlap,
    parseFlexibleDate,
    resolveOptionalDate,
    splitName,
    toNumber,
    toYmd,
    type UploanRow,
    type ValidatedUploanRow,
    type CenterOverrides,
    type CenterSummary,
    type GroupSummary,
    type UploanPreviewResult,
} from '@/app/lib/services/uploan-import.service';

/**
 * Server-only half of the uploan "Member upload" import — validateUploanRows does real DB
 * lookups (Prisma) and calls buildLoanHistoryForLoan (which itself pulls in
 * backup-loan.service.ts's Prisma runtime imports). Kept OUT of uploan-import.service.ts
 * on purpose: that file is imported by components/masters/MemberUploanClient.tsx
 * ('use client'), and any Prisma-touching code reachable from its import graph breaks the
 * client bundle. Only API routes (preview/import-start) and the import worker should
 * import from this file.
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

const centerKeyOf = (branchId: string, name: string) => `${branchId}::${name.trim().toLowerCase()}`;
const groupKeyOf = (centerKey: string, groupName: string) => `${centerKey}::${groupName.trim().toLowerCase()}`;

/**
 * Validates + resolves every row against the DB. Shared by preview (read-only,
 * pass the plain prisma client) and import (pass the transaction client, so
 * rows resolve against records earlier rows in the same import already created).
 */
export async function validateUploanRows(
    db: DbClient,
    rows: UploanRow[],
    branchId: string,
    centerOverrides: CenterOverrides = {},
    branchRepaymentByLoanId: Map<string, BranchRepaymentRow[]> = new Map(),
    /** Centers/groups already resolved in a prior preview call — kept alive (rowCount 0)
     * even if every member row referencing them was since deleted, so an admin can delete
     * bad member rows and still import the Center/Group on its own. */
    keepCenters: CenterSummary[] = [],
    keepGroups: GroupSummary[] = [],
    /** Keyed by buildMemberNameKey(MemberID, Name) — sum of "Balance Loan Advance O/S"
     * across every one of that member's loan cycles. Empty map (default, no file uploaded
     * this run) means every row falls back to the legacy Thrift1+Thrift2 sum instead — see
     * resolved.loanAdvanceOutstanding's doc comment. */
    thriftOutstandingByMemberKey: Map<string, number> = new Map(),
    /** Keyed by buildMemberNameKey(MemberID, Name). */
    goldDetailsByMemberKey: Map<string, GoldDetailsRow> = new Map()
): Promise<UploanPreviewResult> {
    const centerSummaries = new Map<string, CenterSummary>();
    const groupSummaries = new Map<string, GroupSummary>();

    // Batch-resolve mobiles/Aadhaars against the DB once, plus in-file duplicate tracking.
    const mobiles = [...new Set(rows.map((r) => String(r.mobileNumber || '').trim()).filter(Boolean))];
    const aadhaars = [
        ...new Set(rows.map((r) => String(r.otherIdNo || '').replace(/\s/g, '')).filter((v) => /^\d{12}$/.test(v))),
    ];

    const clientLookupClauses: Prisma.ClientWhereInput[] = [];
    if (mobiles.length) clientLookupClauses.push({ mobileNumber: { in: mobiles } });
    if (aadhaars.length) clientLookupClauses.push({ otherIdNo: { in: aadhaars } });

    const existingClients =
        clientLookupClauses.length > 0
            ? await db.client.findMany({
                  where: { OR: clientLookupClauses },
                  select: { id: true, mobileNumber: true, otherIdNo: true },
              })
            : [];
    const clientByMobile = new Map(existingClients.filter((c) => c.mobileNumber).map((c) => [c.mobileNumber as string, c.id]));
    const clientByAadhaar = new Map(existingClients.filter((c) => c.otherIdNo).map((c) => [c.otherIdNo as string, c.id]));

    // Legacy MemberID -> Client.clientId (this route's source of truth for the new client's
    // own clientId) and Loan MemberID -> Loan.loanNumber batch-checked up front, so a row
    // whose legacy ID already belongs to a DIFFERENT client/loan is caught here as a clear
    // validation error instead of surfacing as a raw unique-constraint failure at Import
    // time — see normalizeMemberId's doc comment on why the same MemberID slot code can
    // legitimately have been reused for a different person over time.
    const memberIds = [...new Set(rows.map((r) => extractUploanMemberId(r.raw)).filter(Boolean))];
    const loanMemberIds = [...new Set(rows.map((r) => extractUploanLoanId(r.raw)).filter(Boolean))];
    const existingClientsByMemberId = memberIds.length
        ? await db.client.findMany({ where: { clientId: { in: memberIds } }, select: { id: true, clientId: true } })
        : [];
    const clientIdByMemberId = new Map(existingClientsByMemberId.map((c) => [c.clientId, c.id]));
    const existingLoansByNumber = loanMemberIds.length
        ? await db.loan.findMany({ where: { loanNumber: { in: loanMemberIds } }, select: { loanNumber: true } })
        : [];
    const existingLoanNumberSet = new Set(existingLoansByNumber.map((l) => l.loanNumber));

    // Branch employees, once — Loan Card Report "Loan Officer" is matched against this
    // set below (branchId is the multi-tenancy boundary; not filtered by role since
    // dynamic RBAC roles are DB-managed, and not by isActive since migrated history can
    // legitimately name an officer who has since left).
    const branchEmployees = await db.user.findMany({
        where: { branchId },
        select: { id: true, firstName: true, lastName: true },
    });
    const employeeIdsByNameKey = new Map<string, string[]>();
    for (const emp of branchEmployees) {
        const key = nameTokenKey(`${emp.firstName} ${emp.lastName}`);
        if (!key) continue;
        const ids = employeeIdsByNameKey.get(key) ?? [];
        ids.push(emp.id);
        employeeIdsByNameKey.set(key, ids);
    }

    // Loan products / purposes / funders — fetched once, matched in-memory per row (same
    // "small masters table, safe to load whole" strategy as branchEmployees above), not
    // one findFirst per row for each. A 650-row file previously meant ~2000 sequential DB
    // round-trips here alone — the direct cause of Cloudflare 524 timeouts on large uploan
    // imports (the whole preview/validate request has to finish inside one HTTP response,
    // unlike the actual import worker, which was already split into background job rows
    // for exactly this reason).
    // Full row + scheduleTemplates (same shape backup-loan.service.ts's fetchLoanProduct
    // returns) so the migrated-schedule build below can reuse this instead of re-fetching
    // by id per row too.
    const allLoanProducts = await db.loanProduct.findMany({
        include: {
            scheduleTemplates: { orderBy: { installmentNo: 'asc' } },
            loanProductType: true,
        },
    });
    const productById = new Map(allLoanProducts.map((p) => [p.id, p]));
    const productByNameAndType = new Map<string, (typeof allLoanProducts)[number]>();
    const productByNameOnly = new Map<string, (typeof allLoanProducts)[number]>();
    for (const p of allLoanProducts) {
        const nameKey = p.productName.trim().toLowerCase();
        productByNameOnly.set(nameKey, p);
        const typeName = p.loanProductType?.name;
        if (typeName) productByNameAndType.set(`${nameKey}::${typeName.trim().toLowerCase()}`, p);
    }

    const allLoanPurposes = await db.loanPurpose.findMany({ select: { id: true, name: true } });
    const purposeIdByName = new Map(allLoanPurposes.map((p) => [p.name.trim().toLowerCase(), p.id]));

    const allFunders = await db.funder.findMany({ select: { id: true, funderName: true } });
    const funderIdByName = new Map(allFunders.map((f) => [f.funderName.trim().toLowerCase(), f.id]));

    const seenMobilesInFile = new Set<string>();
    const seenMemberIdsInFile = new Set<string>();
    const seenLoanIdsInFile = new Set<string>();

    const validatedRows: ValidatedUploanRow[] = [];

    for (const row of rows) {
        const errors: string[] = [];
        const warnings: string[] = [];
        const { firstName, lastName } = splitName(String(row.name || ''));

        // ── Legacy MemberID (this route's source of truth for Center/Group/Client IDs) ──
        // Parsed once, up front, so Center/Group resolution below can key off its
        // centerCode/groupCode instead of the free-text Center/Group columns.
        const memberIdRaw = extractUploanMemberId(row.raw);
        if (!memberIdRaw) errors.push('Member ID is required');
        const parsedMemberId = memberIdRaw ? parseUploanMemberId(memberIdRaw) : null;
        if (memberIdRaw && !parsedMemberId) {
            errors.push(
                `Member ID "${memberIdRaw}" is not in the expected <branch>-<center>-<group>-<member> format`
            );
        }
        if (memberIdRaw) {
            // Duplicate Member IDs are allowed for this import (the legacy system itself
            // sometimes reused the same ID for two different people) — informational only,
            // never blocks the row. See the Client resolution section below for the
            // matching warning against already-existing clients.
            if (seenMemberIdsInFile.has(memberIdRaw)) {
                warnings.push(`Member ID "${memberIdRaw}" appears more than once in this file — duplicate ID, allowed for this import`);
            }
            seenMemberIdsInFile.add(memberIdRaw);
        }

        // ── Client field validation (identical rules to manual enrollment) ──
        const mobile = String(row.mobileNumber || '').trim();
        if (!firstName) errors.push('Name is required');
        const mobileCheck = validateMobile(mobile, true);
        if (!mobileCheck.isValid) errors.push(mobileCheck.error || 'Invalid mobile number');

        const aadhaar = String(row.otherIdNo || '').replace(/\s/g, '');
        if (aadhaar) {
            const aadhaarCheck = validateAadhaar(aadhaar, false);
            if (!aadhaarCheck.isValid) errors.push(aadhaarCheck.error || 'Invalid Aadhaar number');
        }

        const email = String(row.email || '').trim();
        if (email) {
            const emailCheck = validateEmail(email, false);
            if (!emailCheck.isValid) errors.push(emailCheck.error || 'Invalid email address');
        }

        const pan = String(row.pancardNo || '').trim();
        if (pan) {
            const panCheck = validatePAN(pan, false);
            if (!panCheck.isValid) errors.push(panCheck.error || 'Invalid PAN');
        }

        const voterId = String(row.idProofType || '').toLowerCase().includes('voter') ? String(row.idProofNo || '').trim() : '';
        if (voterId) {
            const voterCheck = validateVoterID(voterId, false);
            if (!voterCheck.isValid) errors.push(voterCheck.error || 'Invalid Voter ID');
        }

        const ifsc = String(row.ifscCode || '').trim();
        if (ifsc) {
            const ifscCheck = validateIFSC(ifsc, false);
            if (!ifscCheck.isValid) errors.push(ifscCheck.error || 'Invalid IFSC code');
        }

        const bankAcNo = String(row.bankAcNo || '').trim();
        if (bankAcNo) {
            const bankCheck = validateBankAccount(bankAcNo, false);
            if (!bankCheck.isValid) errors.push(bankCheck.error || 'Invalid bank account number');
        }

        const pincode = String(row.pincode || '').trim();
        if (pincode) {
            const pincodeCheck = validatePincode(pincode, false);
            if (!pincodeCheck.isValid) errors.push(pincodeCheck.error || 'Invalid pincode');
        }

        const age = String(row.age || '').trim();
        if (age) {
            const ageCheck = validateAge(age);
            if (!ageCheck.isValid) errors.push(ageCheck.error || 'Invalid age');
        }

        // In-file duplicate mobile
        if (mobile) {
            if (seenMobilesInFile.has(mobile)) {
                errors.push(`Duplicate mobile number in file: ${mobile}`);
            }
            seenMobilesInFile.add(mobile);
        }

        // Out-of-scope statuses
        if (String(row.isPreClosed || '').trim().toLowerCase() === 'yes') {
            errors.push('Pre-closed loans are out of scope for this import — use the existing loan closure tools');
        }
        if (['yes', 'true', '1'].includes(String(row.deadMember || '').trim().toLowerCase())) {
            errors.push('Deceased members must go through Loan Death Marking, not bulk import');
        }

        // ── Center resolution — keyed/matched by the legacy MemberID's Center code (this
        // route's source of truth) when parsing succeeded, falling back to the old
        // name-based key only for a row that already failed MemberID parsing above (so the
        // preview grid still has something to show; the row is ERROR either way). ──
        const centerName = String(row.centerName || '').trim();
        if (!centerName) errors.push('Center is required');
        const centerCode = parsedMemberId?.centerCode;
        // Legacy export center names bake the same leading code into the text itself
        // (e.g. "154-ARANMANAIPUDHUR" for code "154") — stored verbatim, that code ends up
        // doubled everywhere the app displays "<code> - <name>" (e.g. "154-154-
        // ARANMANAIPUDHUR"). Strip it before storing, since Center.code already carries it.
        const centerDisplayName = centerCode ? stripLegacyCodePrefix(centerName, centerCode) : centerName;
        const centerKey = centerCode
            ? centerKeyOf(branchId, centerCode)
            : centerName
            ? centerKeyOf(branchId, centerName)
            : '';
        let centerSummary = centerKey ? centerSummaries.get(centerKey) : undefined;
        if (centerName && !centerSummary) {
            const existingCenter = centerCode
                ? await db.center.findFirst({
                      where: { branchId, code: centerCode },
                      select: { id: true, name: true, meetingDay: true, address: true },
                  })
                : await db.center.findFirst({
                      where: { branchId, name: { equals: centerName, mode: 'insensitive' } },
                      select: { id: true, name: true, meetingDay: true, address: true },
                  });
            if (existingCenter) {
                centerSummary = {
                    key: centerKey,
                    name: existingCenter.name,
                    status: 'MATCHED',
                    id: existingCenter.id,
                    code: centerCode,
                    meetingDay: existingCenter.meetingDay,
                    address: existingCenter.address,
                    rowCount: 0,
                };
                if (centerCode && existingCenter.name.trim().toLowerCase() !== centerDisplayName.toLowerCase()) {
                    warnings.push(
                        `Center code "${centerCode}" already exists as "${existingCenter.name}", but this row's Center column says "${centerName}" — verify these are the same center`
                    );
                }
            } else {
                // Seed from the file's own columns, then let any admin-supplied
                // correction (from the editable Centers grid) win.
                const override = centerOverrides[centerKey];
                centerSummary = {
                    key: centerKey,
                    name: centerDisplayName,
                    status: 'NEW',
                    code: centerCode,
                    meetingDay: (override?.meetingDay ?? String(row.meetingDay || '')).trim() || null,
                    meetingTime: (override?.meetingTime ?? String(row.meetingTime || '')).trim() || null,
                    address: (override?.address ?? String(row.address || row.permanentAddress || '')).trim() || null,
                    localArea: (override?.localArea ?? String(row.localArea || '')).trim() || null,
                    rowCount: 0,
                };
            }
            centerSummaries.set(centerKey, centerSummary);
        }
        if (centerSummary) centerSummary.rowCount++;

        // ── Group resolution — keyed/matched by the legacy MemberID's Group code (this
        // route's source of truth) when parsing succeeded, falling back to the old
        // legacySourceName-based key for a row that already failed MemberID parsing. ──
        const legacyGroupName = String(row.groupName || '').trim();
        if (!legacyGroupName) errors.push('Group is required');
        const groupCode = parsedMemberId?.groupCode;
        const groupKey = centerKey && groupCode
            ? `${centerKey}::${groupCode}`
            : centerKey && legacyGroupName
            ? groupKeyOf(centerKey, legacyGroupName)
            : '';
        let groupSummary = groupKey ? groupSummaries.get(groupKey) : undefined;
        if (legacyGroupName && centerSummary && !groupSummary) {
            let existingGroupId: string | undefined;
            if (centerSummary.status === 'MATCHED' && centerSummary.id) {
                // Group.legacySourceName durably records the source file's group
                // name, so a later, separate import batch against this same center
                // can still recognize "this legacy group already exists" — without
                // it, every re-run would create a duplicate Group (see legacySourceName
                // doc comment on the Group model).
                const existingGroup = groupCode
                    ? await db.group.findFirst({
                          where: { centerId: centerSummary.id, code: groupCode },
                          select: { id: true, legacySourceName: true },
                      })
                    : await db.group.findFirst({
                          where: { centerId: centerSummary.id, legacySourceName: { equals: legacyGroupName, mode: 'insensitive' } },
                          select: { id: true, legacySourceName: true },
                      });
                existingGroupId = existingGroup?.id;
                if (
                    existingGroup &&
                    groupCode &&
                    existingGroup.legacySourceName &&
                    existingGroup.legacySourceName.trim().toLowerCase() !== legacyGroupName.toLowerCase()
                ) {
                    warnings.push(
                        `Group code "${groupCode}" already exists as "${existingGroup.legacySourceName}", but this row's Group column says "${legacyGroupName}" — verify these are the same group`
                    );
                }
            }
            groupSummary = {
                key: groupKey,
                centerKey,
                centerName: centerName,
                legacyGroupName,
                status: existingGroupId ? 'MATCHED' : 'NEW',
                id: existingGroupId,
                code: groupCode,
                groupNumber: parsedMemberId?.groupNumber,
                rowCount: 0,
            };
            groupSummaries.set(groupKey, groupSummary);
        }
        if (groupSummary) groupSummary.rowCount++;

        // ── Client resolution ──
        // Aadhaar takes priority over mobile: it's the authoritative government
        // ID and far less likely to change/be recycled than a phone number, so
        // it's the more reliable duplicate-client signal. If the two point at
        // DIFFERENT existing clients, that's a genuine data conflict — flag it
        // as an error instead of silently picking one (which could merge this
        // row into the wrong client's record).
        let clientStatus: 'MATCHED_EXISTING' | 'NEW' = 'NEW';
        let clientId: string | undefined;
        const aadhaarMatch = aadhaar ? clientByAadhaar.get(aadhaar) : undefined;
        const mobileMatch = mobile ? clientByMobile.get(mobile) : undefined;
        if (aadhaarMatch && mobileMatch && aadhaarMatch !== mobileMatch) {
            errors.push(
                'Aadhaar and Mobile Number match two different existing clients — resolve this conflict before importing'
            );
        } else if (aadhaarMatch) {
            clientStatus = 'MATCHED_EXISTING';
            clientId = aadhaarMatch;
        } else if (mobileMatch) {
            clientStatus = 'MATCHED_EXISTING';
            clientId = mobileMatch;
        }

        // The imported MemberID becomes Client.clientId verbatim for a NEW client. The
        // legacy system itself sometimes reused the same ID for two different people
        // (see normalizeMemberId's doc comment above) — this import intentionally
        // preserves that as-is rather than renaming/rejecting it, so a match here is
        // informational only (surfaced as a warning, never blocks the row) when it
        // belongs to a DIFFERENT existing client than the one just matched above by
        // mobile/Aadhaar (or to any existing client at all, when this row didn't match).
        // Client.clientId is deliberately NOT database-unique for exactly this reason.
        if (memberIdRaw) {
            const clientIdOwner = clientIdByMemberId.get(memberIdRaw);
            if (clientIdOwner && clientIdOwner !== clientId) {
                warnings.push(
                    `Member ID "${memberIdRaw}" is already used by another existing client — this is a duplicate ID, allowed for this import, but double-check it's intentional`
                );
            }
        }

        // ── Loan product / purpose / funder resolution — matched in-memory against the
        // batch-fetched maps above, never a per-row query (see their own doc comment). ──
        const productTypeName = String(row.productTypeName || '').trim();
        const productName = String(row.productName || '').trim();
        let loanProductId: string | undefined;
        let resolvedLoanProductTypeName: string | null | undefined;
        let resolvedProduct: (typeof allLoanProducts)[number] | undefined;
        if (!productName) {
            errors.push('Product Name is required');
        } else {
            const nameKey = productName.toLowerCase();
            resolvedProduct = productTypeName
                ? productByNameAndType.get(`${nameKey}::${productTypeName.toLowerCase()}`)
                : productByNameOnly.get(nameKey);
            if (!resolvedProduct) {
                errors.push(`Loan product not found: "${productName}"${productTypeName ? ` (${productTypeName})` : ''} — create it in Masters first`);
            } else {
                loanProductId = resolvedProduct.id;
                resolvedLoanProductTypeName = resolvedProduct.loanProductType?.name;
            }
        }

        const loanPurposeName = String(row.loanPurposeName || '').trim();
        let loanPurposeId: string | undefined;
        if (!loanPurposeName) {
            errors.push('Purpose of Loan is required');
        } else {
            loanPurposeId = purposeIdByName.get(loanPurposeName.toLowerCase());
            if (!loanPurposeId) {
                errors.push(`Loan purpose not found: "${loanPurposeName}" — create it in Masters first`);
            }
        }

        // Funder is optional (blank = self-funded, no error). Any non-blank name —
        // including "Own Fund" — is matched against the Funder master by name
        // (case-insensitive), same as Product/Purpose above; an unmatched name resolves
        // to null (no funder linked). Not filtered by isActive: migrated history can
        // legitimately name a funder that's since been deactivated, same reasoning as
        // the branch-employee match above.
        const funderName = String(row.funderName || '').trim();
        let funderId: string | null | undefined = undefined;
        if (funderName) {
            funderId = funderIdByName.get(funderName.toLowerCase()) ?? null;
        } else {
            funderId = null;
        }

        // ── Dates ──
        const disbursementDate = parseFlexibleDate(row.disbursementDate);
        const scheduleStartDate = parseFlexibleDate(row.scheduleStartDate) ?? disbursementDate;
        if (!disbursementDate) errors.push('Loan Disbursement Date is required and must be a valid date');
        if (!scheduleStartDate) errors.push('Loan Start Date is required and must be a valid date');
        // Optional DOB/repay-date fields — same "blank is fine, garbage is an error" rule
        // as above. Import route consumes the *Resolved fields below, never the raw
        // string, so an unparseable value can never reach `new Date()` as an Invalid Date.
        const lastRepayDateResolved = resolveOptionalDate(row.lastRepayDate, 'Last RepayDate', errors);
        const dateOfBirthResolved = resolveOptionalDate(row.dateOfBirth, 'DOB', errors);
        const spouseDobResolved = resolveOptionalDate(row.spouseDob, 'Spouse DOB', errors);
        const nomineeDateOfBirthResolved = resolveOptionalDate(row.nomineeDateOfBirth, 'Nominee DOB', errors);

        // ── Financials ──
        const loanPrincipal = toNumber(row.loanPrincipal) ?? 0;
        const loanInterest = toNumber(row.loanInterest) ?? 0;
        const outstandingPrincipal = toNumber(row.outstandingPrincipal) ?? loanPrincipal;
        const outstandingInterest = toNumber(row.outstandingInterest) ?? loanInterest;

        if (outstandingPrincipal > loanPrincipal || outstandingInterest > loanInterest) {
            errors.push('Outstanding amount cannot exceed the original loan principal/interest — check the source data');
        }

        const paidPrincipal = Math.max(0, Number((loanPrincipal - outstandingPrincipal).toFixed(2)));
        const paidInterest = Math.max(0, Number((loanInterest - outstandingInterest).toFixed(2)));

        // ── Loan history resolution — joined by "Loan MemberID" (this row) against the
        // Branch Wise Repayment file's "Loan ID" column, NOT either file's "Member ID"
        // (a reused branch/center/group/seat slot code, not a stable identifier — see
        // uploan-branch-repayment.service.ts). Mandatory: every row's schedule + event
        // ledger is now built entirely from this file, there is no generic-schedule
        // fallback in this flow. ──
        const loanId = extractUploanLoanId(row.raw);
        // Loan MemberID becomes Loan.loanNumber verbatim on Import — Loan creation in this
        // flow is always-fresh (never matched/reused), so a collision must block here with
        // a clear message rather than surface as a raw unique-constraint failure mid-import.
        if (loanId) {
            if (existingLoanNumberSet.has(loanId)) {
                errors.push(`Loan MemberID "${loanId}" is already used by an existing loan — cannot import as a new loan`);
            } else if (seenLoanIdsInFile.has(loanId)) {
                errors.push(`Duplicate Loan MemberID in file: ${loanId}`);
            } else {
                seenLoanIdsInFile.add(loanId);
            }
        }
        let loanOfficerId: string | undefined;
        // True as soon as the Loan MemberID -> Loan ID join found matching installments —
        // this is what the preview grid's "History" badge reflects. Deliberately NOT
        // downgraded by a later officer-name/product/schedule failure below: those are
        // separate, already-surfaced-in-`errors` problems, and conflating them here would
        // make the badge lie about whether the join itself succeeded (a row can genuinely
        // have its history found in the file yet still be ERROR for an unrelated reason).
        let hasLoanHistory = false;
        let isNewUncollectedLoan = false;

        if (!loanId) {
            errors.push('Loan MemberID is required to match this row to the Branch Wise Repayment file');
        } else {
            const repaymentRows = branchRepaymentByLoanId.get(loanId);
            const hasRepaymentRows = !!repaymentRows && repaymentRows.length > 0;
            // A brand-new loan with nothing collected yet legitimately has no rows in the
            // Branch Wise Repayment file — not a join/data problem. paidPrincipal/
            // paidInterest (computed above, purely from this row's own Loan Amount /
            // Outstanding Principal/Interest columns — independent of the repayment
            // file) are the cross-check: if the Member Details Report ALSO says nothing
            // has been collected, a missing entry here is consistent, not a mismatch. If
            // it says something WAS collected yet this file has no rows for the loan,
            // that's a genuine discrepancy worth blocking on — silently treating it as
            // "new" would lose real collected amounts.
            isNewUncollectedLoan = !hasRepaymentRows && paidPrincipal === 0 && paidInterest === 0;

            if (!hasRepaymentRows && !isNewUncollectedLoan) {
                errors.push(
                    `No collected installments found in the Branch Wise Repayment file for Loan ID "${loanId}", but this row's own Outstanding Principal/Interest indicate ₹${paidPrincipal} principal and ₹${paidInterest} interest were already collected — check the Branch Wise Repayment file or the Outstanding columns`
                );
            } else {
                hasLoanHistory = hasRepaymentRows;
                const officerName = resolveOfficerName(row.raw);
                if (!officerName) {
                    errors.push(
                        'Loan Officer name could not be resolved — checked Officer Name, Collection Staff and Collected By columns'
                    );
                } else {
                    const matches = employeeIdsByNameKey.get(nameTokenKey(officerName)) ?? [];
                    if (matches.length === 0) {
                        errors.push(
                            `Loan Officer "${officerName}" is not an employee of this branch — add them in Employee Master first, or check the spelling`
                        );
                    } else if (matches.length > 1) {
                        errors.push(
                            `Loan Officer "${officerName}" matches more than one employee of this branch — cannot determine which one collected this loan`
                        );
                    } else if (!loanProductId) {
                        // Product Name error already pushed above — nothing further to resolve.
                    } else if (!scheduleStartDate) {
                        // Loan Start Date error already pushed above — nothing further to resolve.
                    } else {
                        loanOfficerId = matches[0];
                        // A new, never-collected loan has nothing to replay — it takes the
                        // aggregate/schedule-only path automatically in
                        // createBackupLoanFromReports (loanCardReport/repaymentReport stay
                        // unset below), driven purely by paidPrincipal/paidInterest (both 0
                        // here) and the product's own schedule templates.
                        if (hasRepaymentRows) {
                            // Reuse the batch-fetched product (with scheduleTemplates) from
                            // above instead of re-querying by id for every row — see that
                            // block's own doc comment.
                            const loanProductWithTemplates = productById.get(loanProductId);
                            if (!loanProductWithTemplates) {
                                errors.push('Loan product could not be re-fetched to build the migrated schedule');
                            } else {
                                // Prefer the product's own due count over the raw repayment-row
                                // count — a legacy file with re-amortised arrears carries more
                                // lines than the loan's real tenure (buildLoanHistoryForLoan
                                // hard-caps at the product tenure regardless; this just keeps the
                                // hint sane).
                                const totalInstallments =
                                    toNumber(row.installmentsRef) ??
                                    loanProductWithTemplates.numberOfDues ??
                                    repaymentRows!.length;
                                const built = buildLoanHistoryForLoan({
                                    loanId,
                                    rows: repaymentRows!,
                                    loanProduct: loanProductWithTemplates,
                                    officerName,
                                    totalInstallments,
                                    scheduleStartDate: toYmd(scheduleStartDate),
                                    frequency: loanProductWithTemplates.frequency,
                                });
                                errors.push(...built.errors);
                                warnings.push(...built.warnings);
                            }
                        }
                    }
                }
            }
        }

        // ── Loan-Advance outstanding (keyed by MemberID+Name, strict — see
        // buildMemberNameKey's doc comment) + Gold pledge resolution (keyed by MemberID
        // alone, with a loose name-overlap safety check — see normalizeMemberId's and
        // namesLooselyOverlap's doc comments; the two joins deliberately use different
        // strictness because a wrong Thrift match merges balances, a wrong Gold match only
        // mis-tags pledge metadata, and Gold's export uses shortened/informal names that a
        // strict composite key was found to silently drop real matches for).
        //
        // Both are editable in the preview grid, and every edit round-trips back here on
        // Re-validate/Import as this same row's OWN already-resolved values (`incomingResolved`
        // below) — an admin's correction must win over recomputing from the file every time,
        // the same "seed from file, then let an admin correction win" contract centerOverrides
        // already uses for NEW centers. Without this, editing the karat dropdown or the Loan
        // Advance O/S figure would be silently discarded on the very next Re-validate click. ──
        const memberName = String(row.name || '');
        const memberNameKey = memberIdRaw && firstName ? buildMemberNameKey(memberIdRaw, memberName) : '';
        const incomingResolved = (row as Partial<ValidatedUploanRow>).resolved;

        let loanAdvanceOutstanding: number | undefined;
        if (incomingResolved?.loanAdvanceOutstanding !== undefined) {
            loanAdvanceOutstanding = incomingResolved.loanAdvanceOutstanding;
        } else if (thriftOutstandingByMemberKey.size > 0) {
            loanAdvanceOutstanding = memberNameKey ? thriftOutstandingByMemberKey.get(memberNameKey) ?? 0 : 0;
        }

        let goldLoanDetails: ValidatedUploanRow['resolved']['goldLoanDetails'];
        if (incomingResolved?.goldLoanDetails) {
            goldLoanDetails = incomingResolved.goldLoanDetails;
        } else {
            const goldRow = memberIdRaw ? goldDetailsByMemberKey.get(normalizeMemberId(memberIdRaw)) : undefined;
            if (goldRow) {
                if (!namesLooselyOverlap(goldRow.memberName, memberName)) {
                    warnings.push(
                        `A gold pledge record was found for Member ID "${memberIdRaw}", but the name on file ("${goldRow.memberName}") doesn't resemble this row's name ("${memberName}") closely enough to safely apply it — verify manually`
                    );
                } else {
                    // Applied by Member ID alone, independent of the current loan's
                    // product type — the gold pledge belongs to the person, not
                    // necessarily to whichever loan cycle this import happens to be
                    // migrating. A member can be mid-way through a non-gold loan while
                    // still holding unreturned gold from a previous gold-loan cycle;
                    // dropping it here would lose real, outstanding pledge data.
                    goldLoanDetails = {
                        karatType: '22K',
                        gramCount: goldRow.weight,
                        goldTakenValue: goldRow.goldAmt,
                        cashGiven: goldRow.goldAmt,
                        goldTokenNo: goldRow.tokenNo || undefined,
                        itemDescription: goldRow.item || undefined,
                    };
                    if (!isGoldLoanProduct(resolvedLoanProductTypeName)) {
                        warnings.push(
                            'Gold pledge details were found and applied for this member even though the current loan product isn\'t classified as Gold — likely unreturned gold from a previous loan cycle'
                        );
                    }
                }
            }
        }

        validatedRows.push({
            ...row,
            firstName,
            lastName,
            disbursementDateResolved: disbursementDate ? toYmd(disbursementDate) : '',
            scheduleStartDateResolved: scheduleStartDate ? toYmd(scheduleStartDate) : '',
            lastRepayDateResolved,
            dateOfBirthResolved,
            spouseDobResolved,
            nomineeDateOfBirthResolved,
            status: errors.length > 0 ? 'ERROR' : 'VALID',
            errors,
            warnings,
            resolved: {
                centerKey,
                centerStatus: centerSummary?.status ?? 'NEW',
                centerId: centerSummary?.id,
                groupKey,
                groupStatus: groupSummary?.status ?? 'NEW',
                groupId: groupSummary?.id,
                clientStatus,
                clientId,
                loanProductId,
                loanPurposeId,
                funderId,
                paidPrincipal,
                paidInterest,
                hasLoanHistory,
                isNewUncollectedLoan,
                loanOfficerId,
                loanAdvanceOutstanding,
                goldLoanDetails,
            },
        } as ValidatedUploanRow);
    }

    // Re-add any previously-known Center/Group that no longer has a referencing row —
    // deleting the last member row under a Center/Group must not silently drop it from
    // what gets created on Import.
    for (const kept of keepCenters) {
        if (!centerSummaries.has(kept.key)) {
            centerSummaries.set(kept.key, { ...kept, rowCount: 0 });
        }
    }
    for (const kept of keepGroups) {
        if (!groupSummaries.has(kept.key) && centerSummaries.has(kept.centerKey)) {
            groupSummaries.set(kept.key, { ...kept, rowCount: 0 });
        }
    }

    const rowsOut = validatedRows;
    return {
        centers: [...centerSummaries.values()],
        groups: [...groupSummaries.values()],
        rows: rowsOut,
        totalRows: rowsOut.length,
        validRows: rowsOut.filter((r) => r.status === 'VALID').length,
        errorRows: rowsOut.filter((r) => r.status === 'ERROR').length,
    };
}
