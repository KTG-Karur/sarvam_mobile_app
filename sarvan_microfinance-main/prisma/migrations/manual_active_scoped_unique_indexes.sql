-- Scope name/code/itemName uniqueness on Department, Designation, and
-- EmployeeBelongingItem to ACTIVE rows only, so a deactivated master row no
-- longer permanently blocks a new active replacement from using the same
-- name/code — needed for the deactivate/reactivate flow in
-- DepartmentMasterClient / DesignationMasterClient / BelongingCatalogAdmin.
-- Prisma's schema DSL can't express a partial (filtered) unique index, so
-- this replaces the plain @unique/@@unique constraints (already dropped
-- from schema.prisma) with equivalent partial indexes applied directly.
-- Migration: active_scoped_unique_indexes
-- Created: 2026-09-16

DROP INDEX IF EXISTS "departments_name_key";
DROP INDEX IF EXISTS "departments_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "departments_name_active_key" ON "departments" ("name") WHERE "isActive" = true;
CREATE UNIQUE INDEX IF NOT EXISTS "departments_code_active_key" ON "departments" ("code") WHERE "isActive" = true;

DROP INDEX IF EXISTS "designations_name_key";
DROP INDEX IF EXISTS "designations_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "designations_name_active_key" ON "designations" ("name") WHERE "isActive" = true;
CREATE UNIQUE INDEX IF NOT EXISTS "designations_code_active_key" ON "designations" ("code") WHERE "isActive" = true;

DROP INDEX IF EXISTS "employee_belonging_items_roleSlug_itemName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "employee_belonging_items_roleSlug_itemName_active_key" ON "employee_belonging_items" ("roleSlug", "itemName") WHERE "isActive" = true;
