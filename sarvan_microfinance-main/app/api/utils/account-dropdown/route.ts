import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/db';

export async function GET(req: NextRequest) {
    try {
        // Fetch all Ledger Accounts
        const ledgers = await prisma.accountLedger.findMany({
            where: { isActive: true },
            select: { id: true, ledgerName: true },
            orderBy: { ledgerName: 'asc' }
        });

        // Fetch all Self Accounts
        const selfAccounts = await prisma.selfAccount.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' }
        });

        // Combine
        const options = [
            ...selfAccounts.map(s => ({ id: s.id, name: s.name })),
            ...ledgers.map(l => ({ id: l.id, name: l.ledgerName }))
        ];

        return NextResponse.json(options);

    } catch (error: any) {
        console.error("Error fetching account dropdown:", error);
        return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
    }
}
