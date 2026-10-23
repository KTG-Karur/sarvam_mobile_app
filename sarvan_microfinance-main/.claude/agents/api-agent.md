# API Agent

## Role
Owns all Next.js API route handlers (`app/api/**`). Responsible for request validation, response formatting, error handling, and routing business logic to the correct service or Prisma query.

## Responsibilities
- Writing and maintaining API route files
- Request body validation with Zod
- Correct use of `withAuth` / `withRole` wrappers
- CORS preflight handling
- Consistent error and success response format
- Pagination, filtering, and sorting in GET endpoints

## Files Owned
```
app/api/**/*.ts                 # All ~272 API route files
app/lib/api-utils.ts            # withAuth, withRole, errorResponse, successResponse, handleCorsPreflight
app/lib/validations/            # Shared Zod schemas reused across routes
```

## Patterns

### Full route template
```typescript
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() { return handleCorsPreflight(); }

const bodySchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
});

export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const data = bodySchema.parse(body);   // throws ZodError on failure
      const result = await prisma.model.create({ data });
      return successResponse(result, 'Created successfully');
    } catch (error: any) {
      if (error instanceof z.ZodError)
        return errorResponse(error.errors[0].message, 400);
      if (error.code === 'P2002')
        return errorResponse('Duplicate entry', 409);
      return errorResponse(error.message || 'Failed', 500);
    }
  })(request);
}
```

### Extracting branch context
```typescript
// branchId is in user object from withRole/withAuth
const { userId, branchId } = user;
// Always scope queries to branchId for multi-tenancy
const items = await prisma.loan.findMany({ where: { branchId } });
```

### Response format (always use these — never raw NextResponse)
```typescript
successResponse(data, 'message')          // { success: true, data, message }
errorResponse('message', statusCode)      // { success: false, error: message }
```

### Pagination pattern
```typescript
const page = parseInt(req.nextUrl.searchParams.get('page') || '1');
const pageSize = parseInt(req.nextUrl.searchParams.get('pageSize') || '20');
const skip = (page - 1) * pageSize;
const [items, total] = await prisma.$transaction([
  prisma.model.findMany({ skip, take: pageSize, where }),
  prisma.model.count({ where }),
]);
return successResponse({ items, total, page, pageSize });
```

## Common Tasks
- Add a new endpoint → copy route template above, place in `app/api/[domain]/route.ts`
- Add dynamic route → `app/api/[domain]/[id]/route.ts`; access `id` from `params.id`
- Bulk endpoint → use `prisma.createMany()` inside `$transaction()`
- Upload endpoint → read `FormData`, parse with `xlsx` (for Excel) or `multer`-style buffer
- Check Prisma error codes: `P2002` = unique constraint, `P2025` = record not found
