BEGIN;

-- Null out other-branch clients' pending transfer requests pointing at this branch's centers/groups
UPDATE clients
SET "requestedCenterId" = NULL, "requestedGroupId" = NULL
WHERE "requestedCenterId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep')
   OR "requestedGroupId" IN (
        SELECT id FROM groups WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep')
      );

-- GRT sessions (cascades to grt_session_clients / grt_session_answers / grt_session_photos)
DELETE FROM grt_sessions
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Collection meeting records (independent of loans/clients, keyed on centerId directly)
DELETE FROM collection_meeting_records
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Loan indexes (indexing batches recorded per-center, not cascaded from loans)
DELETE FROM loan_indexes
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Client attendance rows (defensive — should already be empty via client cascade)
DELETE FROM client_attendance
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Client transfers where this branch's center was the old/new center for a client from elsewhere
DELETE FROM client_transfers
WHERE "oldCenterId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep')
   OR "newCenterId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Center transfer history (cascades on center delete anyway; explicit for clarity)
DELETE FROM center_transfers
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Group members (defensive — already empty via client cascade)
DELETE FROM group_members
WHERE "groupId" IN (
  SELECT id FROM groups WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep')
);

-- Groups
DELETE FROM groups
WHERE "centerId" IN (SELECT id FROM centers WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep');

-- Defensive: clear any center-leader self-pointer before dropping centers
UPDATE centers SET "centerLeaderId" = NULL WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep';

-- Centers
DELETE FROM centers
WHERE "branchId" = 'cms9z5e1x008as6bgxl041xep';

-- COMMIT once every line above shows DELETE/UPDATE n with no red error
