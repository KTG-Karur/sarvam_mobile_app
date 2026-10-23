-- Add missing enrollment validation fields (Part 2: May 13, 2026)

-- KYC Page - Missing core identity fields
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_44', 'otherIdNo', 'Aadhaar Number', 'kyc', true, false, CURRENT_TIMESTAMP),
('config_45', 'caOtherIdNo', 'CA Aadhaar ID', 'kyc', true, false, CURRENT_TIMESTAMP),
('config_46', 'smart_card_front', 'Smart Card Front Upload', 'kyc', false, false, CURRENT_TIMESTAMP),
('config_47', 'smart_card_back', 'Smart Card Back Upload', 'kyc', false, false, CURRENT_TIMESTAMP);

-- Client Details Page - Missing location and personal info fields
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_49', 'lastName', 'Last Name', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_50', 'centerId', 'Center', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_51', 'groupId', 'Group', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_52', 'postOffice', 'Post Office', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_53', 'district', 'District', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_54', 'state', 'State', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_55', 'country', 'Country', 'client_details', true, false, CURRENT_TIMESTAMP),
('config_56', 'age', 'Age', 'client_details', false, false, CURRENT_TIMESTAMP);

-- Client Details Page - Optional residence and document uploads
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_57', 'house_image_1', 'House Image (1)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_58', 'house_image_2', 'House Image (2)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_59', 'house_image_3', 'House Image (3)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_60', 'noc_image_1', 'NOC Image (1)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_61', 'noc_image_2', 'NOC Image (2)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_62', 'noc_image_3', 'NOC Image (3)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_63', 'noc_image_4', 'NOC Image (4)', 'client_details', false, false, CURRENT_TIMESTAMP),
('config_64', 'location_qr', 'Location QR Code', 'client_details', false, false, CURRENT_TIMESTAMP);

-- Nominee Page - Missing derived field
INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_65', 'nomineeAge', 'Nominee Age', 'nominee', false, false, CURRENT_TIMESTAMP);

-- Update coApplicantAadhaarBack page from nominee to kyc (it's rendered in KYC step)
UPDATE "enrollment_validation_configs"
SET "page" = 'kyc'
WHERE "fieldKey" = 'coApplicantAadhaarBack';
