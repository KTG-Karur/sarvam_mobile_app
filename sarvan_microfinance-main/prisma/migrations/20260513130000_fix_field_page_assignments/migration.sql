-- Fix field page assignments (Part 3: May 13, 2026)
-- clientId and clientName should be on client_details page, not kyc
-- They are rendered in Step 2, not Step 1

-- Move clientId and clientName from kyc to client_details
UPDATE "enrollment_validation_configs"
SET "page" = 'client_details'
WHERE "fieldKey" IN ('clientId', 'clientName');

-- Add missing firstName field (used in form but not in config)
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_66', 'firstName', 'First Name', 'client_details', true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("fieldKey") DO NOTHING;

-- Add missing phone field (used in form but not in config)
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_67', 'phone', 'Phone Number', 'client_details', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("fieldKey") DO NOTHING;

-- Add missing document upload fields
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_68', 'client_photo', 'Client Photo', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_69', 'bank_passbook', 'Bank Passbook', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_70', 'co_applicant_photo', 'Co-Applicant Photo', 'nominee', false, false, CURRENT_TIMESTAMP),
('config_71', 'coApplicantAadhaarFront', 'Co-Applicant Aadhaar Front', 'kyc', false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("fieldKey") DO NOTHING;

-- Mark clientId, clientName, and mobileNumber as always required (locked toggles)
UPDATE "enrollment_validation_configs"
SET "isAlwaysRequired" = true
WHERE "fieldKey" IN ('clientId', 'clientName', 'mobileNumber');
