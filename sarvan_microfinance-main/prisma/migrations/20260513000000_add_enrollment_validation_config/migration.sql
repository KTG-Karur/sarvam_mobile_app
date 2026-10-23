-- Create enrollment_validation_configs table
CREATE TABLE "enrollment_validation_configs" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isAlwaysRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_validation_configs_pkey" PRIMARY KEY ("id")
);

-- Create unique index on fieldKey
CREATE UNIQUE INDEX "enrollment_validation_configs_fieldKey_key" ON "enrollment_validation_configs"("fieldKey");

-- Create index on page for faster filtering
CREATE INDEX "enrollment_validation_configs_page_idx" ON "enrollment_validation_configs"("page");

-- Seed data: Always-Required Fields (Mandatory, locked toggles)
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_1', 'clientId', 'Client ID', 'kyc', true, true, CURRENT_TIMESTAMP),
('config_2', 'clientName', 'Client Name', 'kyc', true, true, CURRENT_TIMESTAMP),
('config_3', 'mobileNumber', 'Mobile Number', 'kyc', true, true, CURRENT_TIMESTAMP);

-- KYC Page - Optional/Configurable Fields
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_4', 'votersIdNo', 'Voter ID No.', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_5', 'caVoterIdNo', 'CA Voter ID No.', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_6', 'pancardNo', 'PAN Card No.', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_7', 'caPancardNo', 'CA PAN Card No.', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_8', 'smartCardNo', 'Smart Card No.', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_9', 'aadhaarFront', 'Aadhaar Front Upload', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_10', 'aadhaarBack', 'Aadhaar Back Upload', 'kyc', false, false, CURRENT_TIMESTAMP);

-- Client Details Page - Required Fields (Default)
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_11', 'email', 'Email', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_12', 'dateOfBirth', 'Date of Birth', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_13', 'gender', 'Gender', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_14', 'caste', 'Caste', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_15', 'community', 'Community', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_16', 'religion', 'Religion', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_17', 'occupation', 'Occupation', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_18', 'qualification', 'Qualification', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_19', 'maritalStatus', 'Marital Status', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_20', 'spouseName', 'Spouse Name', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_21', 'spouseOccupation', 'Spouse Occupation', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_22', 'noOfChildren', 'No. of Children', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_23', 'monthlyFamilyIncome', 'Monthly Family Income', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_24', 'monthlyFamilyExpense', 'Monthly Family Expense', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_25', 'ifscCode', 'IFSC Code', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_26', 'bankAcNo', 'Bank Account No.', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_27', 'bankName', 'Bank Name', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_28', 'bankBranch', 'Bank Branch', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_29', 'houseStatus', 'House Status', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_30', 'fatherName', 'Father Name', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_31', 'motherName', 'Mother Name', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_32', 'address', 'Address', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_33', 'pincode', 'Pincode', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_34', 'clientPhoto', 'Client Photo Upload', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_35', 'bankPassbook', 'Bank Passbook Upload', 'client_details', false, false, CURRENT_TIMESTAMP);

-- Nominee / Co-Applicant Page
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_36', 'nomineeName', 'Nominee Name', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_37', 'nomineePhone', 'Nominee Phone', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_38', 'nomineeGender', 'Nominee Gender', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_39', 'nomineeDob', 'Nominee Date of Birth', 'nominee', false, false, CURRENT_TIMESTAMP),
('config_40', 'nomineeRelation', 'Relation With Client', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_41', 'requestedAmount', 'Requested Amount', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_42', 'nomineePhoto', 'Nominee Photo Upload', 'nominee', false, false, CURRENT_TIMESTAMP),
('config_43', 'coApplicantAadhaarBack', 'Co-Applicant Aadhaar Back Upload', 'nominee', false, false, CURRENT_TIMESTAMP);
