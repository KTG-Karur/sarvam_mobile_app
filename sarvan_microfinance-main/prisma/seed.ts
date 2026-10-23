import { companyNameShort } from '@/hooks/use-toast';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seedEnrollmentValidationConfigs } from './seeders/enrollment-validation-config.seeder';
import { seedIncentiveConfigs } from './seeders/incentive-config.seeder';

// Limit connections to 1 for the seed script to avoid exhausting DB connections during build
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL + (process.env.DATABASE_URL?.includes('?') ? '&' : '?') + 'connection_limit=1&pool_timeout=0'
    },
  },
});

async function main() {
  console.log('⏳ Waiting for database connections to stabilize...');
  await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

  console.log('🌱 Starting database seed...');

  // Create Home Branch if it doesn't exist
  const homeBranchCode = 'HO';
  let homeBranch = null;
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    try {
      homeBranch = await prisma.branch.findUnique({
        where: { code: homeBranchCode },
      });
      break; // Success
    } catch (error: any) {
      if (error.message.includes('Too many database connections') || error.message.includes('remaining connection slots')) {
        retryCount++;
        console.log(`⚠️  Connection limit reached. Retrying (${retryCount}/${maxRetries}) in 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        throw error; // Other error
      }
    }
  }

  if (retryCount === maxRetries && !homeBranch) {
    throw new Error('Could not establish database connection after multiple retries.');
  }

  if (!homeBranch) {
    console.log('🏗️  Creating Home Branch...');
    homeBranch = await prisma.branch.create({
      data: {
        name: 'Head Office',
        code: homeBranchCode,
        address: 'Main Headquarters',
        isActive: true,
      },
    });
    console.log('✅ Home Branch created.');
  } else {
    console.log('✅ Home Branch already exists.');
  }

  // Default HO admin credentials — login is by employeeId, not email
  const adminEmployeeId = 'Admin';
  const adminEmail = `admin@${companyNameShort}microfinance.com`;
  const adminPassword = '12345678'; // Change this in production!
  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  // Check if admin user already exists
  const existingAdmin = await prisma.user.findUnique({
    where: { employeeId: adminEmployeeId },
  });

  if (existingAdmin) {
    // Ensure existing admin is linked to home branch if not already.
    // Password is intentionally left untouched here — it may have been
    // changed since this seed last ran, and re-running the seed shouldn't
    // silently reset a real admin's credentials.
    if (!existingAdmin.branchId) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { branchId: homeBranch.id },
      });
      console.log('✅ Updated existing Admin user with Home Branch.');
    } else {
      console.log('✅ Admin user already exists and linked to a branch.');
    }
  } else {
    // Create admin user linked to home branch
    await prisma.user.create({
      data: {
        employeeId: adminEmployeeId,
        email: adminEmail,
        password: hashedPassword,
        firstName: 'System',
        lastName: 'Administrator',
        role: 'ADMIN',
        isActive: true,
        branchId: homeBranch.id,
      },
    });
    console.log('✅ Admin user created successfully!');
  }

  // Seed Accounting Data
  await seedAccounting();

  // Seed Enrollment Validation Configuration
  await seedEnrollmentValidationConfigs(false);

  // Seed Incentive Report Configuration
  await seedIncentiveConfigs();

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Default Admin Credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🆔 Employee ID: ${adminEmployeeId}`);
  console.log(`🔑 Password:    ${adminPassword}`);
  console.log(`📧 Email:       ${adminEmail}`);
  console.log(`🏢 Branch:      ${homeBranch.name} (${homeBranch.code})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  IMPORTANT: Change the default password after first login!');
  console.log('');
}

async function seedAccounting() {
  console.log('📊 Seeding Accounting Hierarchy...');

  // 1. Create Primary Groups
  const primaryGroups = [
    { id: 'G-ASSET', name: 'Assets', isPrimary: true },
    { id: 'G-LIAB', name: 'Liabilities', isPrimary: true },
    { id: 'G-INC', name: 'Income', isPrimary: true },
    { id: 'G-EXP', name: 'Expenses', isPrimary: true },
  ];

  for (const group of primaryGroups) {
    await prisma.accountGroup.upsert({
      where: { groupId: group.id },
      update: { groupId: group.id, isPrimary: true, isSystemGroup: true },
      create: { 
        groupId: group.id, 
        groupName: group.name, 
        isPrimary: true, 
        isSystemGroup: true,
        allowSubGroups: true
      },
    });
  }

  // 2. Create System Sub-Groups
  const subGroups = [
    { id: 'G-INC-IND', name: 'Indirect Income', parent: 'G-INC' },
    { id: 'G-LIAB-CUR', name: 'Current Liabilities', parent: 'G-LIAB' },
    { id: 'G-ASSET-CUR', name: 'Current Assets', parent: 'G-ASSET' },
  ];

  for (const group of subGroups) {
    await prisma.accountGroup.upsert({
      where: { groupId: group.id },
      update: { groupId: group.id, parentGroupId: group.parent, isSystemGroup: true },
      create: { 
        groupId: group.id, 
        groupName: group.name, 
        parentGroupId: group.parent, 
        isSystemGroup: true 
      },
    });
  }

  // 3. Create System Ledgers
  const systemLedgers = [
    { id: '1', name: 'Document Charge Income', groupId: 'G-INC-IND' },
    { id: '2', name: 'Member Insurance Payable', groupId: 'G-LIAB-CUR' },
    { id: '5', name: 'Cash in Hand', groupId: 'G-ASSET-CUR' },
    { id: '3', name: 'HO Borrow', groupId: 'G-LIAB-CUR' },
    { id: '4', name: 'HO Remittance', groupId: 'G-LIAB-CUR' },
  ];

  for (const ledger of systemLedgers) {
    await prisma.accountLedger.upsert({
      where: { ledgerId: ledger.id },
      update: { ledgerName: ledger.name, groupId: ledger.groupId },
      create: { 
        ledgerId: ledger.id, 
        ledgerName: ledger.name, 
        groupId: ledger.groupId,
        allowAccessTo: ['B.O'],
        isActive: true
      },
    });
  }

  console.log('✅ Accounting Hierarchy seeded.');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

