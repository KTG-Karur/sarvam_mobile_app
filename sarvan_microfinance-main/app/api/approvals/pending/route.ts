// ============================================================
// PENDING APPROVAL QUEUE
// app/api/approvals/pending/route.ts
//
// Returns all approval instances waiting for the current user
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import { getPendingQueue } from '@/app/lib/approval/engine';

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!isUserContext(result)) return result;

  const queue = await getPendingQueue(result);

  return NextResponse.json({
    success: true,
    count: queue.length,
    queue,
  });
}
