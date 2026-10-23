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
import type { GoldDetailsRow } from '@/app/lib/services/uploan-gold-details.service';
import {
    extractUploanLoanId,
    extractUploanMemberId,
    parseUploanMemberId,
    stripLegacyCodePrefix,
    buildMemberNameKey,
    normalizeMemberId,
    namesLooselyOverlap,
    parseFlexibleDate,
    resolveOptionalDate,
    splitName,
    toNumber,
    toYmd,
    type CenterOverrides,
    type CenterSummary,
    type GroupSummary,
} from '@/app/lib/services/uploan-import.service';
import {
    type ClosedMemberRow,
    type ValidatedClosedMemberRow,
    type ClosedMemberPreviewResult,
} from '@/app/lib/services/closed-member-import.service';

/**
 * Server-only half of the "Closed Loan Member Upload" import — same split rationale as
 * uploan-validate.service.ts (kept out of closed-member-import.service.ts, which the
 * 'use client' ClosedMemberUploanClient.tsx imports from).
 *
 * Center/Group resolution and Client identity-matching below are intentionally a close,
 * independent adaptation of validateUploanRows' own blocks (uploan-validate.service.ts)
 * rather than a shared extracted helper — the two importers' loop bodies differ enough
 * (no repayment-file join here, a global createLoan toggle instead) that a shared
 * abstraction would need as many branches as it saves, and this codebase's own worker
 * layer (uploan-import-worker.ts's header comment) already establishes near-duplication
 * over a risky shared abstraction as the precedent for this exact kind of parallel-import
 * pattern. Center/Group resolution semantics (code/name matching, legacySourceName) must
 * still behave identically so re-running either importer against the same branch matches
 * instead of duplicating — verify both together when changing one.
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

const centerKeyOf = (branchId: string, name: string) => `${branchId}::${name.trim().toLowerCase()}`;
const groupKeyOf = (centerKey: string, groupName: string) => `${centerKey}::${groupName.trim().toLowerCase()}`;

const CLOSURE_REASON_VALUES = ['DEAD', 'WRITEOFF', 'OTHERS'] as const;

export async function validateClosedMemberRows(
    db: DbClient,
    rows: ClosedMemberRow[],
    branchId: string,
    /** The job's one global toggle — Product/Purpose are only required when true (needed
     *  to resolve a loanProductId for the full-history Loan path). */
    createLoan: boolean,
    centerOverrides: CenterOverrides = {},
    keepCenters: CenterSummary[] = [],
    keepGroups: GroupSummary[] = [],
    /** Keyed by buildMemberNameKey(MemberID, Name) — same optional Loan-Advance
     *  Outstanding Report as the ongoing-loan importer. */
    thriftOutstandingByMemberKey: Map<string, number> = new Map(),
    goldDetailsByMemberKey: Map<string, GoldDetailsRow> = new Map()
): Promise<ClosedMemberPreviewResult> {
    const centerSummaries = new Map<string, CenterSummary>();
    const groupSummaries = new Map<string, GroupSummary>();

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

    const memberIds = [...new Set(rows.map((r) => extractUploanMemberId(r.raw)).filter(Boolean))];
    const loanIds = [...new Set(rows.map((r) => extractUploanLoanId(r.raw)).filter(Boolean))];
    const existingClientsByMemberId = memberIds.length
        ? await db.client.findMany({ where: { clientId: { in: memberIds } }, select: { id: true, clientId: true } })
        : [];
    const clientIdByMemberId = new Map(existingClientsByMemberId.map((c) => [c.clientId, c.id]));
    const existingLoansByNumber = loanIds.length
        ? await db.loan.findMany({ where: { loanNumber: { in: loanIds } }, select: { loanNumber: true } })
        : [];
    const existingLoanNumberSet = new Set(existingLoansByNumber.map((l) => l.loanNumber));

    const allLoanProducts = await db.loanProduct.findMany({ include: { loanProductType: true } });
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

    const validatedRows: ValidatedClosedMemberRow[] = [];

    for (const row of rows) {
        const errors: string[] = [];
        const warnings: string[] = [];
        const { firstName, lastName } = splitName(String(row.name || ''));

        const memberIdRaw = extractUploanMemberId(row.raw);
        if (!memberIdRaw) errors.push('Member ID is required');
        const parsedMemberId = memberIdRaw ? parseUploanMemberId(memberIdRaw) : null;
        if (memberIdRaw && !parsedMemberId) {
            errors.push(`Member ID "${memberIdRaw}" is not in the expected <branch>-<center>-<group>-<member> format`);
        }
        if (memberIdRaw) {
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

        if (mobile) {
            if (seenMobilesInFile.has(mobile)) {
                errors.push(`Duplicate mobile number in file: ${mobile}`);
            }
            seenMobilesInFile.add(mobile);
        }

        // ── Center resolution — same code/name matching contract as the ongoing-loan
        // importer, so re-running either against the same branch matches instead of
        // duplicating. ──
        const centerName = String(row.centerName || '').trim();
        if (!centerName) errors.push('Center is required');
        const centerCode = parsedMemberId?.centerCode;
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

        // ── Group resolution ──
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
                centerName,
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

        // ── Client resolution — identical Aadhaar-priority-over-mobile contract. ──
        let clientStatus: 'MATCHED_EXISTING' | 'NEW' = 'NEW';
        let clientId: string | undefined;
        const aadhaarMatch = aadhaar ? clientByAadhaar.get(aadhaar) : undefined;
        const mobileMatch = mobile ? clientByMobile.get(mobile) : undefined;
        if (aadhaarMatch && mobileMatch && aadhaarMatch !== mobileMatch) {
            errors.push('Aadhaar and Mobile Number match two different existing clients — resolve this conflict before importing');
        } else if (aadhaarMatch) {
            clientStatus = 'MATCHED_EXISTING';
            clientId = aadhaarMatch;
        } else if (mobileMatch) {
            clientStatus = 'MATCHED_EXISTING';
            clientId = mobileMatch;
        }

        if (memberIdRaw) {
            const clientIdOwner = clientIdByMemberId.get(memberIdRaw);
            if (clientIdOwner && clientIdOwner !== clientId) {
                warnings.push(
                    `Member ID "${memberIdRaw}" is already used by another existing client — this is a duplicate ID, allowed for this import, but double-check it's intentional`
                );
            }
        }

        // ── Loan product / purpose / funder — required only when this import's global
        // createLoan toggle is on (a bare-shell closed Loan never needs a product). ──
        const productTypeName = String(row.productTypeName || '').trim();
        const productName = String(row.productName || '').trim();
        let loanProductId: string | undefined;
        if (createLoan) {
            if (!productName) {
                errors.push('Product Name is required to create a full historical Loan record — or switch this import to "no loan record"');
            } else {
                const nameKey = productName.toLowerCase();
                const resolvedProduct = productTypeName
                    ? productByNameAndType.get(`${nameKey}::${productTypeName.toLowerCase()}`)
                    : productByNameOnly.get(nameKey);
                if (!resolvedProduct) {
                    errors.push(`Loan product not found: "${productName}"${productTypeName ? ` (${productTypeName})` : ''} — create it in Masters first`);
                } else {
                    loanProductId = resolvedProduct.id;
                }
            }
        }

        const loanPurposeName = String(row.loanPurposeName || '').trim();
        let loanPurposeId: string | undefined;
        if (createLoan) {
            if (!loanPurposeName) {
                errors.push('Purpose of Loan is required to create a full historical Loan record — or switch this import to "no loan record"');
            } else {
                loanPurposeId = purposeIdByName.get(loanPurposeName.toLowerCase());
                if (!loanPurposeId) {
                    errors.push(`Loan purpose not found: "${loanPurposeName}" — create it in Masters first`);
                }
            }
        } else if (loanPurposeName) {
            // Optional even in shell mode — apply it if it resolves, but never block on it.
            loanPurposeId = purposeIdByName.get(loanPurposeName.toLowerCase());
        }

        // Any non-blank Funding Line — including "Own Fund" — is matched against the
        // Funder master by name (case-insensitive); an unmatched name resolves to null.
        const funderName = String(row.funderName || '').trim();
        let funderId: string | null | undefined = null;
        if (funderName) {
            funderId = funderIdByName.get(funderName.toLowerCase()) ?? null;
        }

        // ── Dates ──
        const disbursementDate = parseFlexibleDate(row.disbursementDate);
        const closedDate = parseFlexibleDate(row.closedDate);
        if (!closedDate) errors.push('Loan Closed Date is required and must be a valid date');
        const dateOfBirthResolved = resolveOptionalDate(row.dateOfBirth, 'DOB', errors);
        const spouseDobResolved = resolveOptionalDate(row.spouseDob, 'Spouse DOB', errors);
        const nomineeDateOfBirthResolved = resolveOptionalDate(row.nomineeDateOfBirth, 'Nominee DOB', errors);

        // Loan Principal/Interest (row.loanPrincipal/row.loanInterest raw fields) are read
        // directly by closed-member-import-row.service.ts as "fully accounted for"
        // aggregates (principalPaid = loanPrincipal, interestPaid = loanInterest) — no
        // paid-vs-outstanding split to validate here, unlike the ongoing-loan importer.

        // ── Legacy Loan ID (optional, becomes Loan.loanNumber verbatim if present) ──
        const loanIdRaw = extractUploanLoanId(row.raw);
        if (loanIdRaw) {
            if (existingLoanNumberSet.has(loanIdRaw)) {
                errors.push(`Loan ID "${loanIdRaw}" is already used by an existing loan — cannot import as a new loan`);
            } else if (seenLoanIdsInFile.has(loanIdRaw)) {
                errors.push(`Duplicate Loan ID in file: ${loanIdRaw}`);
            } else {
                seenLoanIdsInFile.add(loanIdRaw);
            }
        }

        // ── Closure reason ──
        const deadMember = ['yes', 'true', '1'].includes(String(row.deadMember || '').trim().toLowerCase());
        const closureReasonRaw = String(row.closureReasonRef || '').trim().toUpperCase();
        let closureReason: ValidatedClosedMemberRow['resolved']['closureReason'];
        if (deadMember) {
            closureReason = 'DEAD';
        } else if ((CLOSURE_REASON_VALUES as readonly string[]).includes(closureReasonRaw)) {
            closureReason = closureReasonRaw as ValidatedClosedMemberRow['resolved']['closureReason'];
        }

        // ── Unreturned Savings + Gold — same "seed from file, admin edit wins" contract as
        // the ongoing-loan importer's loanAdvanceOutstanding/goldLoanDetails. ──
        const memberName = String(row.name || '');
        const memberNameKey = memberIdRaw && firstName ? buildMemberNameKey(memberIdRaw, memberName) : '';
        const incomingResolved = (row as Partial<ValidatedClosedMemberRow>).resolved;

        let unreturnedSavings: number;
        if (incomingResolved?.unreturnedSavings !== undefined) {
            unreturnedSavings = incomingResolved.unreturnedSavings;
        } else if (thriftOutstandingByMemberKey.size > 0 && memberNameKey) {
            unreturnedSavings = thriftOutstandingByMemberKey.get(memberNameKey) ?? 0;
        } else {
            unreturnedSavings = toNumber(row.unreturnedSavingsRef) ?? 0;
        }

        let goldLoanDetails: ValidatedClosedMemberRow['resolved']['goldLoanDetails'];
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
                    goldLoanDetails = {
                        karatType: '22K',
                        gramCount: goldRow.weight,
                        goldTakenValue: goldRow.goldAmt,
                        cashGiven: goldRow.goldAmt,
                        goldTokenNo: goldRow.tokenNo || undefined,
                        itemDescription: goldRow.item || undefined,
                    };
                }
            }
        }

        validatedRows.push({
            ...row,
            firstName,
            lastName,
            disbursementDateResolved: disbursementDate ? toYmd(disbursementDate) : '',
            closedDateResolved: closedDate ? toYmd(closedDate) : '',
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
                closureReason,
                unreturnedSavings,
                goldLoanDetails,
            },
        } as unknown as ValidatedClosedMemberRow);
    }

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
