# Enterprise RBAC Migration Guide
## From Hardcoded Roles → Dynamic Database-Driven Permission Engine

---

## Phase 0 — Before You Start

### What's changing
| Before | After |
|--------|-------|
| `UserRole` enum in Prisma | `Role` model in database |
| `User.role` scalar field | `UserRole` junction table (user ↔ role) |
| 395 hardcoded route-role arrays in middleware | Middleware only validates JWT |
| `PERMISSIONS` object with role arrays | `Permission` table in database |
| `AreaManagerBranch` (AM-specific) | `UserBranchAccess` (any user, any role) |
| `ADMIN_NON_HO_BRANCH_SWITCH` fake role | Branch context in JWT + permission conditions |
| Single role per user | Multiple roles per user |

---

## Phase 1 — Database Migration (ADDITIVE — No breaking changes)

### Step 1: Add RBAC tables to schema.prisma

Copy the content from `docs/rbac-schema-additions.prisma` into your `prisma/schema.prisma`.

Add these relations to the `User` model:
```prisma
model User {
  // ... existing fields ...
  
  // NEW: Dynamic RBAC
  userRoles         UserRole[]         @relation("UserRoles")
  userBranchAccess  UserBranchAccess[] @relation("UserBranchAccess")
}
```

Add to `Branch` model:
```prisma
model Branch {
  // ... existing fields ...
  
  // NEW
  userBranchAccess  UserBranchAccess[] @relation("UserBranchAccess")
  userRoles         UserRole[]
}
```

### Step 2: Create migration

```bash
npx prisma migrate dev --name add_rbac_engine
```

### Step 3: Seed RBAC data

```bash
npx tsx prisma/seed-rbac.ts
```

This will:
- Create all modules (Loan, Collection, Gold Loan, etc.)
- Create all actions (view, create, approve, disburse, etc.)
- Create system roles (admin, branch-manager, area-manager, fdo)
- Assign permissions to roles (matching current PERMISSIONS object)
- Migrate all existing users to UserRole table
- Migrate AreaManagerBranch to UserBranchAccess
- Create menu items

---

## Phase 2 — Parallel Operation (Both systems run together)

During this phase, the old `User.role` enum field is KEPT. New code uses the dynamic system. Old code still works.

### New middleware (replace app/middleware.ts)
The new middleware only validates JWT presence and expiry. It NO LONGER checks route-role arrays.

### Update JWT generation
When generating tokens, use the new `JWTPayload` from `app/lib/permissions/types.ts`:

```typescript
// OLD
const payload = { userId, email, role: 'ADMIN', branchId };

// NEW
const payload = { userId, email, branchId, permVersion: 1, isHeadOffice: false };
```

### Update API routes one by one
Replace old pattern:
```typescript
// OLD
const { role } = verifyAccessToken(token);
if (!['ADMIN', 'BRANCH_MANAGER'].includes(role)) {
  return 403;
}
```

With new pattern:
```typescript
// NEW
const result = await requirePermission(request, 'loan', 'approve');
if (!isUserContext(result)) return result; // returns 403 automatically
// result is now UserContext with full permissions
```

---

## Phase 3 — Remove Legacy Code

Only after ALL API routes are migrated:

### Remove from schema.prisma
```prisma
// DELETE these:
enum UserRole {
  ADMIN
  BRANCH_MANAGER
  FDO
  AREA_MANAGER
}

// DELETE from User model:
role  UserRole  @default(FDO)
```

### Remove files
- `app/lib/permissions.ts` — hardcoded PERMISSIONS object
- `app/lib/user-role-access.ts` — hardcoded role checks
- `app/lib/route-protection.ts` — static route guards
- Remove role arrays from middleware (already done in Phase 2)

### Remove from types
- `app/types/index.ts` — remove `UserRole` type and interface

### Run final migration
```bash
npx prisma migrate dev --name remove_legacy_role_enum
```

---

## Phase 4 — New Admin Panel Features

Build these new admin pages:

### `/dashboard/admin/roles`
- List all roles with permission counts
- Create new role (name, slug, description, color)
- Clone existing role
- Set parent role (hierarchy)
- Activate/deactivate role

### `/dashboard/admin/roles/[id]/permissions`
- Visual permission matrix (modules × actions)
- Toggle permissions with checkboxes
- Add ABAC conditions per permission
- Bulk update

### `/dashboard/admin/users/[id]/roles`
- Assign/remove roles for a user
- Branch-specific role assignment
- Expiry dates for temporary roles

### `/dashboard/admin/workflows`
- Create/edit approval workflows per module
- Configure stages (role, order, SLA)
- Test workflow with dummy data

---

## API Usage Examples

### 1. Protect an API route (basic)

```typescript
// app/api/loan/approve/route.ts
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function POST(request: NextRequest) {
  // This returns UserContext OR NextResponse(403)
  const ctx = await requirePermission(request, 'loan', 'approve');
  if (!isUserContext(ctx)) return ctx; // Auto-returns 403

  // ctx.userId, ctx.branchId, ctx.roles are all available
  const loan = await approveLoan(loanId, ctx.userId, ctx.branchId);
  
  // Start approval workflow
  const { instanceId } = await startApprovalWorkflow({
    moduleSlug: 'loan',
    recordType: 'LOAN',
    recordId: loan.id,
    branchId: ctx.branchId!,
    submittedByUserId: ctx.userId,
  });

  return NextResponse.json({ success: true, loan, instanceId });
}
```

### 2. Multi-permission check

```typescript
// User must have EITHER loan:approve OR loan:disburse
const ctx = await requireAnyPermission(request, [
  { module: 'loan', action: 'approve' },
  { module: 'loan', action: 'disburse' },
]);
```

### 3. Branch-restricted operation

```typescript
// Filter DB query to only return records from branches user can access
const userBranchIds = ctx.branchAccess.map(ba => ba.branchId);

const loans = await prisma.loan.findMany({
  where: {
    branchId: { in: userBranchIds },  // Automatic branch filtering
  }
});
```

### 4. Field-level permission in API response

```typescript
const loan = await prisma.loan.findUnique({ where: { id: loanId } });

// Hide sensitive fields based on field permissions
const fieldAccess = {
  aadhaar: ctx.fieldPermissions.get('loan:aadhaarNumber')?.access ?? 'VISIBLE',
  salary: ctx.fieldPermissions.get('loan:salary')?.access ?? 'VISIBLE',
};

return NextResponse.json({
  loan: {
    ...loan,
    aadhaarNumber: fieldAccess.aadhaar === 'HIDDEN' ? undefined :
                   fieldAccess.aadhaar === 'MASKED' ? maskAadhaar(loan.aadhaarNumber) :
                   loan.aadhaarNumber,
    salary: fieldAccess.salary === 'HIDDEN' ? undefined : loan.salary,
  }
});
```

---

## React Usage Examples

### 1. Conditionally show button

```tsx
import { PermissionGate } from '@/app/components/rbac/PermissionGate';

function LoanActions({ loan }) {
  return (
    <div>
      {/* Always visible */}
      <ViewButton loanId={loan.id} />
      
      {/* Only for users who can approve */}
      <PermissionGate module="loan" action="approve">
        <ApproveButton loanId={loan.id} />
      </PermissionGate>
      
      {/* Only for users who can delete */}
      <PermissionGate module="loan" action="delete" fallback={
        <button disabled title="No permission">Delete</button>
      }>
        <DeleteButton loanId={loan.id} />
      </PermissionGate>
    </div>
  );
}
```

### 2. Role-specific UI

```tsx
<PermissionGate roles={['branch-manager', 'area-manager']}>
  <BranchSummaryPanel />
</PermissionGate>

<PermissionGate requiresHO>
  <HeadOfficeTransactions />
</PermissionGate>
```

### 3. Field-level permissions in form

```tsx
import { FieldPermission, MaskedValue } from '@/app/components/rbac/FieldPermission';

function ClientForm({ client }) {
  return (
    <form>
      <input name="name" defaultValue={client.name} /> {/* Always editable */}
      
      <FieldPermission module="clients" field="aadhaarNumber">
        {({ access }) => (
          access === 'READONLY' ? <MaskedValue value={client.aadhaar} /> :
          access === 'VISIBLE' ? <input name="aadhaar" defaultValue={client.aadhaar} /> :
          null // HIDDEN — renders nothing
        )}
      </FieldPermission>
      
      <FieldPermission module="clients" field="salary">
        {({ access }) => (
          <input
            name="salary"
            defaultValue={client.salary}
            readOnly={access === 'READONLY'}
          />
        )}
      </FieldPermission>
    </form>
  );
}
```

### 4. Permission hook (imperative)

```tsx
import { usePermission } from '@/app/hooks/usePermission';

function CollectionPage() {
  const { can, hasRole, isHeadOffice, branchAccess } = usePermission();

  return (
    <div>
      <CollectionList />
      
      {can('collection', 'export') && <ExportButton />}
      {can('collection', 'approve') && <ApprovalQueue />}
      
      {hasRole('area-manager') && (
        <MultibranchSummary branches={branchAccess} />
      )}
    </div>
  );
}
```

---

## Performance Notes

### Permission Cache
- In-memory LRU cache: 10-minute TTL, 1000 user max
- Cache is invalidated when: roles change, permissions change, user deactivated
- For production with multiple pods: replace with Redis

### Database Queries
- User login: 1 query (loads user + roles + branch access)
- API request: Cache hit = 0 DB queries, Cache miss = 1 DB query
- Permission check: O(1) — Set lookup, no DB query

### JWT Size
- Old JWT: `{ userId, email, role, branchId }` — ~150 bytes
- New JWT: `{ userId, email, branchId, permVersion, isHeadOffice }` — ~180 bytes
- We do NOT put permissions in JWT (too large)

---

## Security Checklist

- [ ] API routes use `requirePermission()` — not JWT role checking
- [ ] All DB queries filter by `branchId` from `ctx.branchId` (not from request body)
- [ ] Branch switching validated in `/api/auth/active-branch` (only allowed branches)
- [ ] Field permissions applied at API level (not just UI)
- [ ] Export endpoints check `canExport` report permission
- [ ] Approval workflow: actor role verified against stage's `approverRoleSlug`
- [ ] Role audit log captures all changes
- [ ] System roles (`isSystem: true`) cannot be deleted
- [ ] `DENY` effect always beats `ALLOW` in permission evaluation

---

## Creating Custom Roles (Admin Panel Flow)

1. Admin navigates to `/dashboard/admin/roles`
2. Clicks "Create Role"
3. Enters: Name = "Gold Loan Officer", Slug = "gold-loan-officer", Priority = 150
4. System creates role in `roles` table
5. Admin opens permission matrix for new role
6. Checks: `gold-loan:view`, `gold-loan:create`, `gold-loan:approve`
7. System creates `role_permissions` records
8. Admin assigns role to user via `/dashboard/admin/users/[id]/roles`
9. System creates `user_roles` record
10. System invalidates that user's permission cache
11. Next request by that user loads fresh permissions from DB
12. Sidebar automatically shows Gold Loan module for that user

---

## Folder Structure

```
app/
├── middleware.ts                    # Lightweight JWT validation only
├── lib/
│   ├── auth/
│   │   └── jwt.ts                  # JWT generate/verify (no role enum)
│   ├── permissions/
│   │   ├── types.ts                # All RBAC types
│   │   ├── engine.ts               # Core permission resolution
│   │   ├── cache.ts                # LRU permission cache
│   │   └── guards.ts               # requirePermission(), requireAuth()
│   └── approval/
│       └── engine.ts               # Approval workflow engine
├── api/
│   ├── auth/
│   │   ├── login/route.ts          # Updated (no enum)
│   │   ├── logout/route.ts
│   │   ├── refresh/route.ts
│   │   ├── active-branch/route.ts
│   │   └── permissions/route.ts    # NEW — returns user permissions
│   └── admin/
│       ├── roles/
│       │   ├── route.ts            # CRUD roles
│       │   └── [roleId]/
│       │       ├── permissions/route.ts  # Assign permissions to role
│       │       └── clone/route.ts        # Clone role
│       ├── modules/route.ts
│       ├── permissions/route.ts
│       └── workflows/route.ts
├── hooks/
│   └── usePermission.ts            # Permission hook
├── store/
│   └── authStore.ts                # Zustand auth + permission store
└── components/
    ├── rbac/
    │   ├── PermissionGate.tsx       # Conditional render component
    │   └── FieldPermission.tsx      # Field-level permission component
    └── layout/
        └── DynamicSidebar.tsx       # DB-driven sidebar
prisma/
├── schema.prisma                    # Updated (RBAC tables added)
└── seed-rbac.ts                     # Migration seeder
docs/
├── rbac-schema-additions.prisma    # Schema additions (copy to schema.prisma)
└── rbac-migration-guide.md         # This file
```
