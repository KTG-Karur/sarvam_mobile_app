# Plugin: Next.js Edge Middleware

## Purpose
JWT-based route protection at the Edge layer before any API route or page handler runs. Sets auth headers used by all downstream handlers.

## File
`app/middleware.ts`

## What It Does
1. Skips public routes: `/login`, `/_next`, `/api/auth/*`, static files
2. Extracts JWT from `Authorization: Bearer <token>` header or `accessToken` cookie
3. Edge-safe decodes JWT (no crypto libs — just base64 parse)
4. If expired or missing → redirects to `/login` (pages) or returns 401 (API routes)
5. Sets request headers for downstream use:
   - `x-user-id` — userId from JWT
   - `x-branch-id` — branchId from JWT
   - `x-perm-version` — permVersion for cache invalidation
   - `x-is-head-office` — `"true"` or `"false"`

## Config
```typescript
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
```

## Usage
Downstream API handlers read user context via `getAuthenticatedUser(request)` in `api-utils.ts`, which decodes the JWT from the headers set by middleware.

## Constraints
- **Edge runtime only** — no Node.js APIs, no Prisma, no bcrypt
- Uses `verifyAccessTokenEdge()` from `app/lib/auth/jwt.ts` (base64 decode only, no signature verification in middleware — that happens in handlers via `getAuthenticatedUser`)
- Cannot call the DB — permission checks happen in API handlers

## Adding New Public Routes
Edit the skip logic in `middleware.ts`:
```typescript
const PUBLIC_PATHS = ['/login', '/api/auth/', '/_next', '/favicon.ico'];
if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return NextResponse.next();
```

---

# Plugin: Custom JWT Auth (not next-auth)

## Purpose
Custom HS256 JWT authentication system (replacing next-auth). Provides access tokens (15 min) and refresh tokens (7 days) with RBAC payload.

## Files
```
app/lib/auth/jwt.ts          # Token generation + verification (Node.js safe)
app/lib/auth.ts              # Legacy wrapper (still used in some routes)
app/lib/api-utils.ts         # withAuth(), withRole() middleware wrappers
app/api/auth/login/route.ts  # Login endpoint
app/api/auth/refresh/route.ts # Token refresh endpoint
```

## Token Structure
```typescript
{
  userId: string,
  email: string,
  branchId: string | null,
  permVersion: number,         // Increment to invalidate cached permissions
  isHeadOffice: boolean,
  iat: number,
  exp: number
}
```

## Refresh Flow
1. Access token expires (15 min)
2. Frontend `use-token-refresh.ts` hook detects expiry (5-min buffer)
3. `POST /api/auth/refresh` with refresh token
4. Returns new access token
5. `tokenStorage.setAccessToken()` stores new token
6. Next request uses new token automatically via `apiClient`

## Config
```env
JWT_SECRET="..."              # Used for access tokens
JWT_REFRESH_SECRET="..."      # Used for refresh tokens
```

---

# Plugin: Prisma ORM

## Purpose
Type-safe PostgreSQL ORM. Single instance via singleton pattern prevents connection pool exhaustion in Next.js hot reload.

## Files
```
prisma/schema.prisma         # Data model
app/lib/prisma.ts            # Singleton instance (always import from here)
```

## Singleton Pattern
```typescript
// app/lib/prisma.ts
import { PrismaClient } from '@prisma/client';
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

## Important Notes
- **Schema changes:** `npx prisma db push` (NOT `migrate dev` — shadow DB has drift issue)
- **Client regen:** `npx prisma generate` (stop dev server first on Windows — DLL lock)
- **Migrations:** Migration files in `prisma/migrations/` — 25 files, 2025-12 to 2026-05
- **Seeds:** Run with `npm run db:seed`

---

# Plugin: Supabase S3 Storage

## Purpose
File storage for KYC documents, audit photos, and insurance records. Uses Supabase's S3-compatible API.

## Files
```
app/lib/storage/kyc-storage.ts         # KYC document uploads
app/lib/storage/insurance-storage.ts   # Insurance record uploads
app/lib/storage/audit-storage.ts       # Audit photo uploads
```

## Config
```env
STORAGE_ENDPOINT="https://xxxx.supabase.co/storage/v1/s3"
STORAGE_REGION="ap-south-1"
STORAGE_BUCKET="microfinance"
STORAGE_ACCESS_KEY_ID="..."
STORAGE_SECRET_ACCESS_KEY="..."
```

## Usage Pattern
```typescript
import { uploadKycDocument } from '@/app/lib/storage/kyc-storage';
const { fileUrl, fileKey } = await uploadKycDocument(file, clientId, documentType);
// fileUrl: public URL for display
// fileKey: S3 key for deletion/replacement
```

## Image Sources (configured in next.config.ts)
- Cloudflare R2
- Supabase Storage
- AWS S3
