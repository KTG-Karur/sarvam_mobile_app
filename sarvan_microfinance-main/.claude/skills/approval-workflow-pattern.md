# Skill: Approval Workflow Pattern

## What It Does
Implements a multi-level approval flow (PENDING → approved/rejected) consistently across the project. Used for: loan disbursement, financial transactions, foreclosures, gold returns, client enrollment, collections.

## When To Use
Adding a new feature that requires a maker-checker or multi-stage approval before becoming effective.

## Standard 2-Level Pattern (BM initiates → AM approves)

### Schema fields to add to the model
```prisma
model MyRecord {
  id            String    @id @default(cuid())
  // ... domain fields
  status        MyStatus  @default(PENDING)
  initiatedById String
  initiatedAt   DateTime  @default(now())
  approvedById  String?
  approvedAt    DateTime?
  rejectedById  String?
  rejectedAt    DateTime?
  rejectionReason String?
  remarks       String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  initiatedBy User  @relation("MyRecordInitiated", fields: [initiatedById], references: [id])
  approvedBy  User? @relation("MyRecordApproved",  fields: [approvedById],  references: [id])
  rejectedBy  User? @relation("MyRecordRejected",  fields: [rejectedById],  references: [id])
}

enum MyStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### Initiation endpoint (BM/FDO creates the record)
```typescript
// POST /api/my-records
export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER'], async (req, user) => {
    try {
      const body = await req.json();
      const data = createSchema.parse(body);

      // Check no existing pending record for same resource
      const existing = await prisma.myRecord.findFirst({
        where: { resourceId: data.resourceId, status: 'PENDING' },
      });
      if (existing) return errorResponse('A pending record already exists', 409);

      const record = await prisma.myRecord.create({
        data: {
          ...data,
          status: 'PENDING',
          initiatedById: user.userId,
        },
      });
      return successResponse(record, 'Submitted for approval');
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error.message || 'Failed', 500);
    }
  })(request);
}
```

### Approval endpoint (AM approves or rejects)
```typescript
// PATCH /api/my-records/[id]/approve
const approveSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const { action, rejectionReason } = approveSchema.parse(body);

      const record = await prisma.myRecord.findUnique({ where: { id: params.id } });
      if (!record) return errorResponse('Record not found', 404);
      if (record.status !== 'PENDING') return errorResponse('Record is not pending approval', 400);

      if (action === 'REJECT' && !rejectionReason?.trim())
        return errorResponse('Rejection reason is required', 400);

      const now = new Date();
      const updated = await prisma.myRecord.update({
        where: { id: params.id },
        data: action === 'APPROVE'
          ? { status: 'APPROVED', approvedById: user.userId, approvedAt: now }
          : { status: 'REJECTED', rejectedById: user.userId, rejectedAt: now, rejectionReason },
      });

      return successResponse(updated, `Record ${action.toLowerCase()}d`);
    } catch (error: any) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      return errorResponse(error.message || 'Failed', 500);
    }
  })(request);
}
```

### UI — Pending list with approve/reject buttons
```typescript
const [pendingItems, setPendingItems] = useState<Record[]>([]);
const [isSubmitting, setIsSubmitting] = useState(false);
const { toast } = useToast();

const handleAction = async (id: string, action: 'APPROVE' | 'REJECT', rejectionReason?: string) => {
  setIsSubmitting(true);
  const result = await apiClient.patch(`/api/my-records/${id}/approve`, { action, rejectionReason });
  if (result.success) {
    toast({ title: 'Success', description: `Record ${action.toLowerCase()}d.` });
    fetchPendingItems(); // refresh list
  } else {
    toast({ title: 'Error', description: result.error, variant: 'destructive' });
  }
  setIsSubmitting(false);
};
```

## 3-Level Pattern (financial transactions)
Financial transactions use `FinancialTransaction.approvalStatus`:
```
PENDING_APPROVAL → (AM) PENDING_AM_APPROVAL → (Admin) APPROVED
                       ↘ AM_REJECTED             ↘ ADMIN_REJECTED
```
See `app/api/transactions/approval/route.ts` for reference implementation.

## Rules
- Always check `status === 'PENDING'` before allowing approval action
- Always require `rejectionReason` when action is REJECT
- Keep initiation and approval in separate endpoints
- Use `withRole` to enforce who can initiate vs. who can approve
- For financial side effects (GL posting), trigger them only on APPROVE in a `$transaction`
