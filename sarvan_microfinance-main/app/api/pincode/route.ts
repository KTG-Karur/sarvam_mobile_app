import { NextRequest, NextResponse } from 'next/server';
import { cachedLookup } from '@/app/lib/cache/lookup-cache';

// Pincode-to-district/state mappings are effectively permanent — cache for 30 days.
const PINCODE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
};

class PincodeNotFoundError extends Error {}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const pincode = searchParams.get('pincode');

    if (!pincode) {
        return NextResponse.json({ error: 'Pincode is required' }, { status: 400 });
    }

    // Validate pincode format (6 digits)
    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
        return NextResponse.json({ error: 'Invalid pincode format' }, { status: 400 });
    }

    try {
        const data = await cachedLookup('pincode', pincode, () => fetchPincodeDetails(pincode), PINCODE_CACHE_TTL_SECONDS);
        return NextResponse.json(data, { headers: NO_STORE_HEADERS });
    } catch (error) {
        if (error instanceof PincodeNotFoundError) {
            console.log(`No data found for pincode: ${pincode}`);
            return NextResponse.json(
                [{ Status: 'Error', Message: 'No location details found for this pincode' }],
                { status: 404, headers: NO_STORE_HEADERS }
            );
        }
        console.error('Error fetching pincode details:', error);
        return NextResponse.json(
            { error: 'Failed to fetch pincode details' },
            { status: 500, headers: NO_STORE_HEADERS }
        );
    }
}

/** Tries the primary India Post API, then the data.gov.in fallback — only returns on a real Success, throws PincodeNotFoundError otherwise (so a transient failure never gets cached as "not found"). */
async function fetchPincodeDetails(pincode: string) {
    // Primary API: India Post Pincode API
    try {
        const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
            },
            cache: 'no-store',
        });

        if (response.ok) {
            const data = await response.json();
            if (Array.isArray(data) && data.length > 0 && data[0].Status === 'Success') {
                return data;
            }
            if (data[0]?.Status === 'Error') {
                console.log(`Pincode ${pincode} returned error:`, data[0].Message);
            }
        }
    } catch (primaryError) {
        console.error('Primary API failed:', primaryError);
    }

    // Fallback: data.gov.in
    try {
        const response2 = await fetch(`https://api.data.gov.in/resource/5c2f62fe-5afa-4119-a499-fec9d604d5bd?api-key=579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b&format=json&filters[pincode]=${pincode}&limit=1`, {
            cache: 'no-store',
        });

        if (response2.ok) {
            const govData = await response2.json();
            if (govData.records && govData.records.length > 0) {
                const record = govData.records[0];
                return [{
                    Status: 'Success',
                    PostOffice: [{
                        Name: record.officename || 'Unknown',
                        District: record.districtname || 'Unknown',
                        State: record.statename || 'Unknown',
                        Country: 'India',
                        Pincode: pincode,
                    }],
                }];
            }
        }
    } catch (fallbackError) {
        console.error('Fallback API failed:', fallbackError);
    }

    throw new PincodeNotFoundError(`No location details found for pincode ${pincode}`);
}
