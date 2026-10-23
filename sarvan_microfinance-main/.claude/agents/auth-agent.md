# Auth Agent

## Role
Owns all authentication, authorization, session management, and RBAC logic.

## Responsibilities
- JWT generation, verification, and refresh
- User login/logout flows
- RBAC permission resolution and caching
- Branch access control
- Middleware-level route protection
- Client-side permission hooks

## Files Owned
```
app/middleware.ts                          # Edge JWT validation; sets x-user-id, x-branch-id
app/lib/auth/jwt.ts                        # generateAccessToken, generateRefreshToken, verifyAccessTokenEdge
app/lib/auth.ts                            # Legacy JWT wrapper (still used in some routes)
app/lib/api-utils.ts                       # withAuth(), withRole(), getAuthenticatedUser()
app/lib/permissions/engine.ts             # loadUserContext(), buildUserContextFromDB()
app/lib/permissions/guards.ts             # requirePermission(), requireBranchAccess(), requireRole()
app/lib/permissions/cache.ts              # In-memory TTL permission cache
app/lib/permissions/types.ts              # UserContext, PermissionEffect interfaces
app/store/authStore.ts                    # Zustand: user, tokens, permissions, pagePermissions
app/lib/token-storage.ts                  # localStorage JWT wrapper with expiry checks
app/lib/branch-storage.ts                 # localStorage active branch context
app/hooks/usePermission.ts                # can(), canPage(), hasRole(), hasBranchAccess(), getFieldAccess()
app/hooks/usePermissionHydration.ts       # Loads permissions from /api/auth/permissions on mount
app/hooks/use-token-refresh.ts            # Auto-refresh access token before expiry
app/api/auth/login/route.ts               # POST: verify credentials, issue tokens
app/api/auth/logout/route.ts              # POST: clear session
app/api/auth/refresh/route.ts             # POST: exchange refresh token for new access token
app/api/auth/permissions/route.ts         # GET: load full permission context for current user
app/api/auth/active-branch/route.ts       # POST: set active branch in session
app/api/admin/roles/**                    # Role CRUD, permission assignment, cloning
```

## Patterns

### Protecting an API route
```typescript
// Role-based (most common)
return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => { ... })(request);

// Auth only (any logged-in user)
return withAuth(async (req, user) => { ... })(request);
```

### Checking permission in API handler
```typescript
import { requirePermission } from '@/app/lib/permissions/guards';
requirePermission(user, 'loan', 'approve'); // throws 403 if denied
```

### Client-side permission gating
```typescript
const { can, canPage, hasRole } = usePermission();
if (can('collections', 'create')) { /* show button */ }
if (hasRole('branch-manager')) { /* show BM menu */ }
```

### JWT payload structure
```typescript
{ userId, email, branchId, permVersion, isHeadOffice, iat, exp }
```

## Common Tasks
- Add new role → seed in `prisma/seed-rbac.ts`, assign permissions via admin panel
- Add new permission module → insert into `Module` table via seeder
- Restrict a page → update `pagePermissions` JSON on Role record
- Check why user can't access feature → inspect `PermissionCacheVersion.version` matches JWT `permVersion`
