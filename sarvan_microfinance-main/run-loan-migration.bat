@echo off
echo ========================================
echo Loan Application Database Migration
echo ========================================
echo.
echo This script will:
echo 1. Generate Prisma client with new fields
echo 2. Create database migration
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo Step 1: Generating Prisma Client...
echo ========================================
call npx prisma generate
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Prisma generate failed!
    echo Please close any running applications and try again.
    pause
    exit /b 1
)

echo.
echo Step 2: Creating Database Migration...
echo ========================================
echo WARNING: This will modify your database!
echo.
call npx prisma migrate dev --name add_loan_fields
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Migration failed!
    echo You may need to run the migration manually.
    echo See: prisma/migrations/manual_add_loan_fields.sql
    pause
    exit /b 1
)

echo.
echo ========================================
echo Migration completed successfully!
echo ========================================
echo.
echo Next steps:
echo 1. Test the loan application screen
echo 2. Verify all dropdowns work correctly
echo 3. Create a test loan application
echo.
pause
