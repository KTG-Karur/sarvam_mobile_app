import { NextRequest, NextResponse } from 'next/server';
import { cachedLookup } from '@/app/lib/cache/lookup-cache';

interface RazorpayIfscResponse {
    IFSC?: string;
    BANK?: string;
    BRANCH?: string;
    ADDRESS?: string;
    CONTACT?: string;
    CITY?: string;
    DISTRICT?: string;
    STATE?: string;
    CENTRE?: string;
    MICR?: string;
}

interface IfscDetails {
    ifsc: string;
    bankName: string;
    branchName: string;
    address: string;
    city: string;
    district: string;
    state: string;
    contact: string;
    centre: string;
    micr: string;
}

// IFSC-to-branch mappings essentially never change — cache for 30 days.
const IFSC_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

class IfscNotFoundError extends Error {}
class IfscUpstreamError extends Error {}

/**
 * GET /api/ifsc?code=SBIN0001234
 * Proxies IFSC lookup to Razorpay endpoint, cached in Redis (never mutated
 * anywhere in this codebase, so no invalidation is needed).
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get('code') || '').trim().toUpperCase();

    if (!code) {
        return NextResponse.json({ success: false, error: 'IFSC code is required' }, { status: 400 });
    }

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) {
        return NextResponse.json({ success: false, error: 'Invalid IFSC code format' }, { status: 400 });
    }

    try {
        const data = await cachedLookup('ifsc', code, () => fetchIfscDetails(code), IFSC_CACHE_TTL_SECONDS);
        return NextResponse.json({ success: true, data });
    } catch (error) {
        if (error instanceof IfscNotFoundError) {
            return NextResponse.json({ success: false, error: 'IFSC code not found' }, { status: 404 });
        }
        if (error instanceof IfscUpstreamError) {
            return NextResponse.json(
                { success: false, error: 'Failed to fetch IFSC details' },
                { status: 502 }
            );
        }
        console.error('IFSC lookup failed:', error);
        return NextResponse.json(
            { success: false, error: 'Unable to fetch IFSC details. Please try again.' },
            { status: 500 }
        );
    }
}

async function fetchIfscDetails(code: string): Promise<IfscDetails> {
    const response = await fetch(`https://ifsc.razorpay.com/${code}`, {
        cache: 'no-store',
        headers: {
            'User-Agent': 'K3-Microfinance/1.0',
        },
    });

    if (!response.ok) {
        if (response.status === 404) throw new IfscNotFoundError(code);
        throw new IfscUpstreamError(`IFSC upstream returned ${response.status}`);
    }

    const data = (await response.json()) as RazorpayIfscResponse;

    return {
        ifsc: data.IFSC || code,
        bankName: data.BANK || '',
        branchName: data.BRANCH || '',
        address: data.ADDRESS || '',
        city: data.CITY || '',
        district: data.DISTRICT || '',
        state: data.STATE || '',
        contact: data.CONTACT || '',
        centre: data.CENTRE || '',
        micr: data.MICR || '',
    };
}
