import { NextRequest, NextResponse } from 'next/server';
import pako from 'pako';

/**
 * Aadhaar Secure QR Decoder
 * Handles decompression, base64 decoding, and XML parsing of Aadhaar Secure QR codes
 *
 * Aadhaar Secure QR Format:
 * 1. Raw bytes from QR scanner
 * 2. Optionally base64 encoded
 * 3. Compressed using zlib/deflate
 * 4. Contains XML with citizen information
 * 5. May have signature data at the end
 */

interface AadhaarQRData {
  uid: string; // Aadhaar number (masked like 1234-5678-9012)
  name: string;
  gender: string;
  dob: string; // DD/MM/YYYY
  address: string;
  photo?: string; // Base64 encoded photo if present
  email?: string;
  phone?: string;
  rawData?: string; // For debugging
}

/**
 * Parse XML data from decompressed Aadhaar QR payload
 */
function parseAadhaarXML(xmlData: string): Partial<AadhaarQRData> {
  try {
    // Remove BOM if present
    const cleanXml = xmlData.replace(/^\xEF\xBB\xBF/, '');

    const parsed: Partial<AadhaarQRData> = {};

    // Extract UID (Aadhaar number) - multiple possible formats
    let uidMatch = cleanXml.match(/uid=['"]([^'"]+)['"]/i);
    if (uidMatch) {
      parsed.uid = formatAadhaar(uidMatch[1]);
    } else {
      uidMatch = cleanXml.match(/<uid>([^<]+)<\/uid>/i);
      if (uidMatch) {
        parsed.uid = formatAadhaar(uidMatch[1]);
      }
    }

    // Extract Name
    let nameMatch = cleanXml.match(/name=['"]([^'"]+)['"]/i);
    if (nameMatch) {
      parsed.name = decodeURIComponent(nameMatch[1]);
    } else {
      nameMatch = cleanXml.match(/<name>([^<]+)<\/name>/i);
      if (nameMatch) {
        parsed.name = decodeURIComponent(nameMatch[1]);
      }
    }

    // Extract Gender
    let genderMatch = cleanXml.match(/gender=['"]([^'"]+)['"]/i);
    if (genderMatch) {
      const genderVal = genderMatch[1].toUpperCase();
      parsed.gender = genderVal === 'M' ? 'Male' : genderVal === 'F' ? 'Female' : 'Other';
    } else {
      genderMatch = cleanXml.match(/<gender>([^<]+)<\/gender>/i);
      if (genderMatch) {
        const genderVal = genderMatch[1].toUpperCase();
        parsed.gender = genderVal === 'M' ? 'Male' : genderVal === 'F' ? 'Female' : 'Other';
      }
    }

    // Extract DOB (DD/MM/YYYY format)
    let dobMatch = cleanXml.match(/dob=['"](\d{2}\/\d{2}\/\d{4})['"]/i);
    if (dobMatch) {
      parsed.dob = dobMatch[1];
    } else {
      dobMatch = cleanXml.match(/<dob>(\d{2}\/\d{2}\/\d{4})<\/dob>/i);
      if (dobMatch) {
        parsed.dob = dobMatch[1];
      }
    }

    // Extract Address - may be in co-applicant data
    let addressMatch = cleanXml.match(/address=['"]([^'"]*)['"]/i);
    if (addressMatch) {
      parsed.address = decodeURIComponent(addressMatch[1]);
    } else {
      addressMatch = cleanXml.match(/<address>([^<]*)<\/address>/i);
      if (addressMatch) {
        parsed.address = decodeURIComponent(addressMatch[1]);
      }
    }

    // Extract Email if available
    let emailMatch = cleanXml.match(/email=['"]([^'"]*)['"]/i);
    if (emailMatch) {
      parsed.email = emailMatch[1];
    } else {
      emailMatch = cleanXml.match(/<email>([^<]*)<\/email>/i);
      if (emailMatch) {
        parsed.email = emailMatch[1];
      }
    }

    // Extract Phone if available
    let phoneMatch = cleanXml.match(/phone=['"]([^'"]*)['"]/i);
    if (phoneMatch) {
      parsed.phone = phoneMatch[1];
    } else {
      phoneMatch = cleanXml.match(/<phone>([^<]*)<\/phone>/i);
      if (phoneMatch) {
        parsed.phone = phoneMatch[1];
      }
    }

    // Extract Photo if available (base64 encoded)
    let photoMatch = cleanXml.match(/<photo>([^<]+)<\/photo>/i);
    if (photoMatch) {
      // Photo data might be embedded as base64
      const photoData = photoMatch[1].trim();
      if (photoData && photoData.length > 100) {
        // Valid looking base64 photo
        parsed.photo = `data:image/jpeg;base64,${photoData.substring(0, 200)}...`;
      }
    }

    return parsed;
  } catch (error) {
    console.error('XML parsing error:', error);
    return {};
  }
}

/**
 * Format Aadhaar number to standard format (XXXX-XXXX-XXXX)
 */
function formatAadhaar(aadhaar: string): string {
  // Remove any existing formatting
  const clean = aadhaar.replace(/\D/g, '');

  // Mask to show only last 4 digits
  if (clean.length === 12) {
    const masked = `XXXX-XXXX-${clean.slice(-4)}`;
    return masked;
  }

  return aadhaar;
}

/**
 * Decompress zlib/deflate compressed data
 */
function decompressData(buffer: Uint8Array): string {
  try {
    const decompressed = pako.inflate(buffer, { to: 'string' });
    return decompressed;
  } catch (error) {
    console.error('Decompression error:', error);
    throw new Error('Failed to decompress QR data');
  }
}

/**
 * Convert various input formats to Uint8Array
 */
function toUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (typeof data === 'string') {
    // Try base64 decoding
    try {
      const binaryString = atob(data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    } catch (e) {
      // If base64 fails, treat as UTF-8 string
      const encoder = new TextEncoder();
      return encoder.encode(data);
    }
  }

  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }

  throw new Error('Invalid data format');
}

export async function POST(request: NextRequest) {
  try {
    const { qrData, rawBytes } = await request.json();

    if (!qrData && !rawBytes) {
      return NextResponse.json(
        { success: false, error: 'No QR data provided' },
        { status: 400 }
      );
    }

    let decodedData: string;
    let inputData = qrData || rawBytes;

    console.log('[Aadhaar QR] Input type:', typeof inputData);
    console.log('[Aadhaar QR] Input length:', inputData?.length);

    // Step 1: Convert to Uint8Array
    let byteArray: Uint8Array;
    if (typeof inputData === 'string') {
      // Try base64 first
      try {
        const binaryString = atob(inputData);
        byteArray = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          byteArray[i] = binaryString.charCodeAt(i);
        }
        console.log('[Aadhaar QR] Successfully decoded from base64');
      } catch (e) {
        console.log('[Aadhaar QR] Not base64, treating as text');
        byteArray = new TextEncoder().encode(inputData);
      }
    } else if (Array.isArray(inputData)) {
      byteArray = new Uint8Array(inputData);
    } else {
      byteArray = inputData;
    }

    console.log('[Aadhaar QR] Byte array first 20 bytes:', Array.from(byteArray.slice(0, 20)));

    // Step 2: Check for zlib/deflate header (0x78 0x9C or similar)
    const hasZlibHeader = byteArray[0] === 0x78 && (byteArray[1] === 0x01 || byteArray[1] === 0x5e || byteArray[1] === 0x9c || byteArray[1] === 0xda);

    if (hasZlibHeader) {
      console.log('[Aadhaar QR] Detected zlib compression header');
      try {
        decodedData = decompressData(byteArray);
        console.log('[Aadhaar QR] Successfully decompressed data');
      } catch (error) {
        console.error('[Aadhaar QR] Decompression failed:', error);
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to decompress QR data',
            details: (error as Error).message
          },
          { status: 400 }
        );
      }
    } else {
      console.log('[Aadhaar QR] No compression header detected, treating as plain data');
      // Try to decode as string directly
      try {
        decodedData = new TextDecoder('utf-8').decode(byteArray);
      } catch (e) {
        // Try latin-1 as fallback
        decodedData = String.fromCharCode.apply(null, Array.from(byteArray) as any);
      }
    }

    console.log('[Aadhaar QR] Decoded data (first 500 chars):', decodedData.substring(0, 500));

    // Step 3: Parse the decoded data
    // Check if it's XML
    if (decodedData.includes('<?xml') || decodedData.includes('<')) {
      console.log('[Aadhaar QR] Parsing as XML');
      const parsedData = parseAadhaarXML(decodedData);

      if (!parsedData.uid && !parsedData.name) {
        console.warn('[Aadhaar QR] No valid Aadhaar data extracted from XML');
        return NextResponse.json(
          {
            success: false,
            error: 'Unable to extract Aadhaar information from QR code',
            details: 'QR contains no valid Aadhaar data',
            rawData: decodedData.substring(0, 500),
          },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: parsedData,
        message: 'Aadhaar QR decoded successfully',
      });
    }

    // Step 4: Try to parse as delimited text (fallback)
    console.log('[Aadhaar QR] Attempting to parse as text data');
    const lines = decodedData.split('\n').filter((l) => l.trim());
    const parsed: Partial<AadhaarQRData> = {};

    // Try common delimiters
    for (const line of lines) {
      if (line.includes('=')) {
        const [key, value] = line.split('=').map((s) => s.trim());
        if (key.toLowerCase().includes('uid') || key.toLowerCase().includes('aadhaar')) {
          parsed.uid = formatAadhaar(value);
        } else if (key.toLowerCase().includes('name')) {
          parsed.name = value;
        } else if (key.toLowerCase().includes('gender')) {
          parsed.gender = value === 'M' ? 'Male' : value === 'F' ? 'Female' : value;
        } else if (key.toLowerCase().includes('dob')) {
          parsed.dob = value;
        } else if (key.toLowerCase().includes('address')) {
          parsed.address = value;
        }
      }
    }

    if (!parsed.uid && !parsed.name) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unable to parse QR code data',
          details: 'QR data format not recognized',
          rawData: decodedData.substring(0, 500),
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: parsed,
      message: 'QR data parsed successfully',
    });
  } catch (error) {
    console.error('[Aadhaar QR] Decode error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to decode QR code',
      },
      { status: 500 }
    );
  }
}
