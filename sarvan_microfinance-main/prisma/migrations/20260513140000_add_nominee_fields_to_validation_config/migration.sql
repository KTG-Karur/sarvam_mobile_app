-- Add Nominee/Co-Applicant fields to validation config (May 13, 2026)
-- These fields are used in Step 3 but were missing from the config

INSERT INTO "enrollment_validation_configs" ("id", "fieldKey", "fieldName", "page", "isRequired", "isAlwaysRequired", "updatedAt") VALUES
('config_72', 'nomineeName', 'Nominee / Co-Applicant Name', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_73', 'nomineePhoneNumber', 'Nominee Phone Number', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_74', 'nomineeGender', 'Nominee Gender', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_75', 'nomineeDateOfBirth', 'Nominee Date of Birth', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_76', 'nomineeAge', 'Nominee Age', 'nominee', false, false, CURRENT_TIMESTAMP),
('config_77', 'nomineeRelation', 'Nominee Relation With Client', 'nominee', true, false, CURRENT_TIMESTAMP),
('config_78', 'requestedAmount', 'Requested Loan Amount', 'nominee', true, false, CURRENT_TIMESTAMP)
ON CONFLICT ("fieldKey") DO NOTHING;
