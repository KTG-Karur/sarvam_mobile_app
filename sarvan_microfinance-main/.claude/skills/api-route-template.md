# Skill: API Route Template

## What It Does
Provides the standard boilerplate for a new Next.js API route in this project. Covers: CORS preflight, auth wrapper, Zod validation, Prisma query, consistent response format, and error handling.

## When To Use
Any time you need to create a new `app/api/[domain]/route.ts` file.

## Template

### POST route (create)
```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  // add fields here
});

export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const data = createSchema.parse(body);

      const result = await prisma.model.create({
        data: {
          ...data,
          branchId: user.branchId!,   // always scope to branch
          createdById: user.userId,
        },
      });

      return successResponse(result, 'Created successfully');
    } catch (error: any) {
      if (error instanceof z.ZodError)
        return errorResponse(error.errors[0].message, 400);
      if (error.code === 'P2002')
        return errorResponse('Duplicate entry — record already exists', 409);
      console.error('[POST /api/domain]', error);
      return errorResponse(error.message || 'Failed to create', 500);
    }
  })(request);
}
```

### GET route (list with optional filters)
```typescript
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = req.nextUrl;
      const branchId = searchParams.get('branchId') || user.branchId;
      const page = parseInt(searchParams.get('page') || '1');
      const pageSize = parseInt(searchParams.get('pageSize') || '20');
      const skip = (page - 1) * pageSize;

      const where = { branchId, isActive: true };

      const [items, total] = await prisma.$transaction([
        prisma.model.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
        prisma.model.count({ where }),
      ]);

      return successResponse({ items, total, page, pageSize });
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch', 500);
    }
  })(request);
}
```

### Dynamic route [id] — GET + PATCH + DELETE
```typescript
// app/api/[domain]/[id]/route.ts
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  return withAuth(async (req, user) => {
    const item = await prisma.model.findUnique({ where: { id: params.id } });
    if (!item) return errorResponse('Not found', 404);
    return successResponse(item);
  })(request);
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withRole(['ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const updated = await prisma.model.update({ where: { id: params.id }, data: body });
      return successResponse(updated, 'Updated');
    } catch (error: any) {
      if (error.code === 'P2025') return errorResponse('Record not found', 404);
      return errorResponse(error.message || 'Failed to update', 500);
    }
  })(request);
}
```

## Key Rules
- **Always** call `handleCorsPreflight()` in OPTIONS
- **Always** use `withRole` or `withAuth` — never unprotected routes
- **Always** scope writes to `branchId: user.branchId`
- **Always** use `successResponse` / `errorResponse` — never raw `NextResponse.json()`
- Catch `z.ZodError` separately → return 400 with first error message
- Catch Prisma `P2002` (unique) → 409; `P2025` (not found) → 404
