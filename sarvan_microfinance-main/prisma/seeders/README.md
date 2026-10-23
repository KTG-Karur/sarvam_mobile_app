# Prisma Seeders

This directory contains seeder scripts for populating and resetting database tables with initial or test data.

## Enrollment Validation Config Seeder

**File**: `enrollment-validation-config.seeder.ts`

### Purpose
Populates the `enrollment_validation_configs` table with all enrollment fields used in the client enrollment form, including page assignments and default required/optional status.

### Fields Included
- **KYC Page** (15 fields): Mobile number, Aadhaar, voter ID, PAN card, smart card, and document uploads
- **Client Details Page** (43 fields): Personal info, family, financial, bank, address, housing, and optional uploads
- **Nominee Page** (8 fields): Nominee information and co-applicant details

**Total**: 66 enrollment fields

### Usage

#### Running the Seeder

```bash
# Install ts-node if not already installed
npm install -D ts-node typescript

# Run the seeder (idempotent - only adds missing fields)
npx ts-node prisma/seeders/enrollment-validation-config.seeder.ts

# Reset and re-seed from scratch (caution: deletes all existing configs)
RESET=true npx ts-node prisma/seeders/enrollment-validation-config.seeder.ts
```

#### Programmatic Usage

```typescript
import { seedEnrollmentValidationConfigs } from '@/prisma/seeders/enrollment-validation-config.seeder';

// Add only missing fields (idempotent)
await seedEnrollmentValidationConfigs(false);

// Delete all and re-seed from scratch
await seedEnrollmentValidationConfigs(true);
```

### Field Categories

#### Always-Required Fields (Cannot be toggled by admin)
- `mobileNumber` - Mobile Number (KYC)
- `clientId` - Client ID (Client Details)
- `clientName` - Client Name (Client Details)

#### Configurable Required Fields (Admins can mark optional)
- Identity: `otherIdNo`, `caOtherIdNo`, `votersIdNo`, `caVoterIdNo`, `pancardNo`, `caPancardNo`, `smartCardNo`
- Address: `address`, `pincode`, `postOffice`, `district`, `state`, `country`
- Personal: `dateOfBirth`, `gender`, `occupation`, `maritalStatus`
- Financial: `bankName`, `bankAcNo`, `ifscCode`, `monthlyFamilyIncome`
- Center/Group: `centerId`, `groupId`

#### Configurable Optional Fields
- Documents: `email`, `spouseName`, `bankBranch`, `houseStatus`, `fatherName`, `motherName`, `qualification`, `spouseOccupation`, `noOfChildren`, `monthlyFamilyExpense`
- Uploads: All document upload fields (aadhaarFront, aadhaarBack, clientPhoto, bankPassbook, house images, NOC images, location QR)

### How Admins Use This

1. **Initial Setup**: Run seeder to populate all fields (happens during migration)
2. **Configure**: Go to Dashboard → Client → Client Validation
3. **Toggle**: Enable/disable required/optional for each field
4. **Save**: Changes apply immediately to the enrollment form

### How Developers Use This

1. **Adding New Fields**: Add to `ENROLLMENT_FIELDS` array with appropriate page and required/optional status
2. **Resetting**: Run with `resetExisting = true` to clear and re-seed (development only)
3. **Backup**: Export the current config and keep as reference

---

## Future Seeders

This directory can contain additional seeders for:
- Test data (centers, groups, users)
- Loan products and interest rates
- Document type templates
- User roles and permissions
