-- Create default admin user
-- Password: Admin@123 (hashed with bcrypt, rounds: 10)
-- IMPORTANT: Change the default password after first login!
-- 
-- Default Credentials:
-- Email: admin@k3microfinance.com
-- Password: Admin@123

INSERT INTO "users" (
  "id",
  "email",
  "password",
  "firstName",
  "lastName",
  "role",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT 
  'admin-user-001',
  'admin@microfinance.com',
  '$2a$10$mXn.YdL1FGp64GPpC5gaQ.KD.ovpKMh4IFEkea4d.vS.DUqyUj2RW', -- bcrypt hash of "Admin@123"
  'System',
  'Administrator',
  'ADMIN',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "users" WHERE "email" = 'admin@k3microfinance.com'
);
