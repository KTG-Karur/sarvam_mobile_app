-- Removes the duplicate CLIENT rows left behind by a second, fully-FAILED Uploan import job for branch 10.
--
-- Why they exist: the same 524-row file was submitted twice. Job 2 created each client first, then failed every
-- row at loan creation ("Loan MemberID ... is already used"), and the client rows were not rolled back.
--
-- A row is deleted only if ALL of these are true:
--   * client belongs to branch code 10
--   * it was created inside the time window of a COMPLETED Uploan job in which EVERY row is FAILED
--   * no import-job row points at it and it has no loans
--   * a sibling with the same clientId, first name, Aadhaar and center exists that a CREATED import row points at
--     (that sibling is the real, kept member)
-- Dependent rows: co_applicants and group_members cascade. Any RESTRICT table (kyc_documents, loan_transactions, ...)
-- that references a row makes the DELETE fail and nothing is removed.
-- Safe to run twice: the second run finds 0 rows.

-- ── STEP 1: preview (read-only). Expect one row per extra copy; check the count and a few names. ──────────────
WITH dup AS (
    SELECT c.id
    FROM clients c
    JOIN centers  ce ON ce.id = c."centerId"
    JOIN branches b  ON b.id = ce."branchId" AND b.code = '10'
    WHERE EXISTS (
            SELECT 1 FROM uploan_import_jobs fj
            WHERE fj."branchId" = b.id
              AND fj.status = 'COMPLETED'
              AND c."createdAt" BETWEEN fj."createdAt" AND fj."completedAt"
              AND NOT EXISTS (SELECT 1 FROM uploan_import_job_rows r WHERE r."jobId" = fj.id AND r.status <> 'FAILED')
          )
      AND NOT EXISTS (SELECT 1 FROM uploan_import_job_rows x WHERE x."clientId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM loans l WHERE l."clientId" = c.id)
      AND EXISTS (
            SELECT 1
            FROM clients o
            JOIN uploan_import_job_rows kr ON kr."clientId" = o.id AND kr.status = 'CREATED'
            WHERE o."clientId" = c."clientId"
              AND o.id <> c.id
              AND o."firstName" = c."firstName"
              AND COALESCE(o."otherIdNo", '') = COALESCE(c."otherIdNo", '')
              AND o."centerId" IS NOT DISTINCT FROM c."centerId"
          )
)
SELECT c."clientId", c."firstName", c."createdAt", c.id
FROM clients c JOIN dup ON dup.id = c.id
ORDER BY c."clientId", c."createdAt";

-- ── STEP 2: delete (run STEP 1 first and confirm the count). ────────────────────────────────────────────────
BEGIN;

DELETE FROM clients
WHERE id IN (
    SELECT c.id
    FROM clients c
    JOIN centers  ce ON ce.id = c."centerId"
    JOIN branches b  ON b.id = ce."branchId" AND b.code = '10'
    WHERE EXISTS (
            SELECT 1 FROM uploan_import_jobs fj
            WHERE fj."branchId" = b.id
              AND fj.status = 'COMPLETED'
              AND c."createdAt" BETWEEN fj."createdAt" AND fj."completedAt"
              AND NOT EXISTS (SELECT 1 FROM uploan_import_job_rows r WHERE r."jobId" = fj.id AND r.status <> 'FAILED')
          )
      AND NOT EXISTS (SELECT 1 FROM uploan_import_job_rows x WHERE x."clientId" = c.id)
      AND NOT EXISTS (SELECT 1 FROM loans l WHERE l."clientId" = c.id)
      AND EXISTS (
            SELECT 1
            FROM clients o
            JOIN uploan_import_job_rows kr ON kr."clientId" = o.id AND kr.status = 'CREATED'
            WHERE o."clientId" = c."clientId"
              AND o.id <> c.id
              AND o."firstName" = c."firstName"
              AND COALESCE(o."otherIdNo", '') = COALESCE(c."otherIdNo", '')
              AND o."centerId" IS NOT DISTINCT FROM c."centerId"
          )
);
-- Check the "DELETE n" count equals the STEP 1 count. If yes run COMMIT; otherwise run ROLLBACK;
-- COMMIT;
-- ROLLBACK;

-- ── STEP 3: verify (after COMMIT). Branch 10 should have no client ID used by more than one row. ───────────
-- SELECT c."clientId", COUNT(*) FROM clients c
--   JOIN centers ce ON ce.id = c."centerId" JOIN branches b ON b.id = ce."branchId" AND b.code = '10'
--  GROUP BY c."clientId" HAVING COUNT(*) > 1;
