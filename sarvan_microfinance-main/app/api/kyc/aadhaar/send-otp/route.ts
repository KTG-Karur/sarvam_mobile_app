import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export async function POST(req: NextRequest) {
    try {
        const { aadhaarNumber, clientId } = await req.json();
        const normalizedAadhaar = String(aadhaarNumber ?? '').replace(/\D/g, '');

        // Validate input
        if (!normalizedAadhaar || normalizedAadhaar.length !== 12) {
            return NextResponse.json(
                { success: false, message: 'Invalid Aadhaar number' },
                { status: 400 }
            );
        }

        // Validate uniqueness upfront at OTP-send time, so FDO gets immediate feedback.
        // Allow same-client updates (when a concrete client id is provided and matches).
        const existingClient = await prisma.client.findFirst({
            where: { otherIdNo: normalizedAadhaar },
            select: { id: true, clientId: true, firstName: true, lastName: true },
        });

        if (existingClient) {
            const requestedClientId = String(clientId ?? '').trim();
            const isSameClient =
                requestedClientId.length > 0 &&
                (requestedClientId === existingClient.id || requestedClientId === existingClient.clientId);

            if (!isSameClient) {
                return NextResponse.json(
                    {
                        success: false,
                        code: 'AADHAAR_ALREADY_USED',
                        message: 'Aadhaar already used by another client',
                    },
                    { status: 409 },
                );
            }
        }

        // TODO: Call third-party API to send OTP
        // Example integration:
        // const response = await fetch('https://third-party-api.com/aadhaar/send-otp', {
        //     method: 'POST',
        //     headers: {
        //         'Content-Type': 'application/json',
        //         'Authorization': `Bearer ${process.env.KYC_API_KEY}`,
        //     },
        //     body: JSON.stringify({ aadhaarNumber }),
        // });
        // const data = await response.json();

        // Mock response for development
        const mockTransactionId = `TXN${Date.now()}${Math.random().toString(36).substring(7)}`;
        const mockMaskedMobile = `+91-XXXXX-XX${normalizedAadhaar.slice(-3)}`;

        // Log transaction for audit
        console.log('KYC OTP Request:', {
            clientId,
            aadhaarNumber: `XXXX-XXXX-${normalizedAadhaar.slice(-4)}`,
            transactionId: mockTransactionId,
            timestamp: new Date().toISOString(),
        });

        return NextResponse.json({
            success: true,
            transactionId: mockTransactionId,
            maskedMobile: mockMaskedMobile,
            message: 'OTP sent successfully',
        });
    } catch (error) {
        console.error('Error sending OTP:', error);
        return NextResponse.json(
            { success: false, message: 'Internal server error' },
            { status: 500 }
        );
    }
}
