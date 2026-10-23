/**
 * Regex patterns for form field validation
 */
export const VALIDATION_PATTERNS = {
    // Mobile number: 10 digits, optionally starting with +91 or 0
    MOBILE: /^(?:\+91|91|0)?[6-9]\d{9}$/,

    // PAN Card: 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F)
    PAN_CARD: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,

    // Aadhaar: 12 digits, optionally with spaces after every 4 digits
    AADHAAR: /^\d{4}\s?\d{4}\s?\d{4}$/,

    // Email: Standard email format
    EMAIL: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,

    // Name: Only letters, spaces, dots, and hyphens (2-50 characters)
    NAME: /^[a-zA-Z\s.'-]{2,50}$/,

    // Pincode: 6 digits
    PINCODE: /^[1-9][0-9]{5}$/,

    // IFSC Code: 4 letters, 0, then 6 alphanumeric (e.g., SBIN0001234)
    IFSC: /^[A-Z]{4}0[A-Z0-9]{6}$/,

    // Bank Account Number: 9-18 digits
    BANK_ACCOUNT: /^\d{9,18}$/,

    // Only alphabets and spaces
    ALPHA_SPACE: /^[a-zA-Z\s]+$/,

    // Only numbers
    NUMERIC: /^\d+$/,

    // Decimal numbers (for amounts)
    DECIMAL: /^\d+(\.\d{1,2})?$/,

    // Address: Alphanumeric with common special characters
    ADDRESS: /^[a-zA-Z0-9\s,.\-/#()]+$/,
};

/**
 * Validation error messages
 */
export const VALIDATION_MESSAGES = {
    MOBILE: 'Please enter a valid 10-digit mobile number',
    PAN_CARD: 'PAN card must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)',
    VOTER_ID: 'Voter ID must be in standard format: ABC1234567 (3 letters, 7 digits) or old Tamil Nadu format (e.g., TN/01/123456 or TN/06/033/0384208)',
    AADHAAR: 'Aadhaar must be a valid 12-digit number',
    EMAIL: 'Please enter a valid email address',
    NAME: 'Name should contain only letters, spaces, dots, and hyphens (2-50 characters)',
    PINCODE: 'Pincode must be a valid 6-digit number',
    IFSC: 'IFSC code must be in format: SBIN0001234 (4 letters, 0, 6 alphanumeric)',
    BANK_ACCOUNT: 'Bank account number must be 9-18 digits',
    ALPHA_SPACE: 'This field should contain only letters and spaces',
    NUMERIC: 'This field should contain only numbers',
    DECIMAL: 'Please enter a valid amount (e.g., 1000 or 1000.50)',
    ADDRESS: 'Address contains invalid characters',
    REQUIRED: 'This field is required',
    MIN_AGE: 'Client must be at least 18 years old',
    MAX_LENGTH: 'This field exceeds maximum length',
};

/**
 * Validate a value against a regex pattern
 */
export const validatePattern = (
    value: string,
    pattern: RegExp,
    required: boolean = false
): { isValid: boolean; error?: string } => {
    if (!required && (!value || value.trim() === '')) {
        return { isValid: true };
    }

    if (required && (!value || value.trim() === '')) {
        return { isValid: false, error: VALIDATION_MESSAGES.REQUIRED };
    }

    const isValid = pattern.test(value.trim());
    return { isValid };
};

/**
 * Validate mobile number
 */
export const validateMobile = (mobile: string, required: boolean = true) => {
    const result = validatePattern(mobile, VALIDATION_PATTERNS.MOBILE, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.MOBILE };
    }
    return result;
};

/**
 * Validate PAN card
 */
export const validatePAN = (pan: string, required: boolean = false) => {
    if (!required && !pan) return { isValid: true };

    const upperPan = pan.toUpperCase().trim();
    const result = validatePattern(upperPan, VALIDATION_PATTERNS.PAN_CARD, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.PAN_CARD };
    }
    return result;
};

/**
 * Validate Voter ID - Fixed for Tamil Nadu formats with multiple slashes
 */
export const validateVoterID = (voterId: string, required: boolean = false) => {
    // If not required and empty, it's valid
    if (!required && (!voterId || voterId.trim() === '')) {
        return { isValid: true };
    }
    
    // If required and empty, it's invalid
    if (required && (!voterId || voterId.trim() === '')) {
        return { isValid: false, error: VALIDATION_MESSAGES.REQUIRED };
    }
    
    // Clean the input: remove spaces and convert to uppercase
    const cleaned = voterId.replace(/\s/g, '').toUpperCase().trim();
    
    // Check for standard format: 3 letters followed by 7 digits
    const standardFormat = /^[A-Z]{3}[0-9]{7}$/.test(cleaned);
    
    // Check for Tamil Nadu format with multiple slashes
    // Pattern: Starts with 2 letters, then has one or more segments of slash followed by numbers
    // Examples: TN/01/123456, TN/06/033/0384208, TN/06/033/038420
    const tnFormat = /^[A-Z]{2}(?:\/\d{2,3})+\/\d{6,7}$/.test(cleaned);
    
    // Also allow more flexible TN format (any number of digit segments after the initial 2 letters)
    const flexibleTnFormat = /^[A-Z]{2}(?:\/\d+)+$/.test(cleaned);
    
    const isValid = standardFormat || tnFormat || flexibleTnFormat;
    
    // Debug logging to console
    if (process.env.NODE_ENV === 'development') {
        console.log('Voter ID Validation:', {
            input: voterId,
            cleaned,
            standardFormat,
            tnFormat,
            flexibleTnFormat,
            isValid
        });
    }
    
    if (!isValid) {
        return { isValid: false, error: VALIDATION_MESSAGES.VOTER_ID };
    }
    
    return { isValid: true };
};

/**
 * Validate email
 */
export const validateEmail = (email: string, required: boolean = false) => {
    const result = validatePattern(email, VALIDATION_PATTERNS.EMAIL, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.EMAIL };
    }
    return result;
};

/**
 * Validate name
 */
export const validateName = (name: string, required: boolean = true) => {
    const result = validatePattern(name, VALIDATION_PATTERNS.NAME, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.NAME };
    }
    return result;
};

/**
 * Validate pincode
 */
export const validatePincode = (pincode: string, required: boolean = false) => {
    const result = validatePattern(pincode, VALIDATION_PATTERNS.PINCODE, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.PINCODE };
    }
    return result;
};

/**
 * Validate IFSC code
 */
export const validateIFSC = (ifsc: string, required: boolean = false) => {
    if (!required && !ifsc) return { isValid: true };

    const upperIfsc = ifsc.toUpperCase().trim();
    const result = validatePattern(upperIfsc, VALIDATION_PATTERNS.IFSC, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.IFSC };
    }
    return result;
};

/**
 * Validate bank account number
 */
export const validateBankAccount = (accountNo: string, required: boolean = false) => {
    const result = validatePattern(accountNo, VALIDATION_PATTERNS.BANK_ACCOUNT, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.BANK_ACCOUNT };
    }
    return result;
};

/**
 * Validate decimal amount
 */
export const validateAmount = (amount: string, required: boolean = false) => {
    const result = validatePattern(amount, VALIDATION_PATTERNS.DECIMAL, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.DECIMAL };
    }
    return result;
};

/**
 * Validate age (must be 18 or older)
 */
export const validateAge = (age: number | string): { isValid: boolean; error?: string } => {
    const ageNum = typeof age === 'string' ? parseInt(age) : age;

    if (isNaN(ageNum)) {
        return { isValid: false, error: 'Please enter a valid age' };
    }

    if (ageNum < 18) {
        return { isValid: false, error: VALIDATION_MESSAGES.MIN_AGE };
    }

    if (ageNum > 100) {
        return { isValid: false, error: 'Please enter a valid age' };
    }

    return { isValid: true };
};

/**
 * Sanitize input by removing extra spaces and trimming
 */
export const sanitizeInput = (value: string): string => {
    return value.trim().replace(/\s+/g, ' ');
};

/**
 * Format mobile number for display (adds +91 prefix if not present)
 */
export const formatMobile = (mobile: string): string => {
    const cleaned = mobile.replace(/\D/g, '');
    if (cleaned.length === 10) {
        return `+91 ${cleaned}`;
    }
    return mobile;
};

/**
 * Format PAN card to uppercase
 */
export const formatPAN = (pan: string): string => {
    return pan.toUpperCase().trim();
};

/**
 * Format IFSC code to uppercase
 */
export const formatIFSC = (ifsc: string): string => {
    return ifsc.toUpperCase().trim();
};

/**
 * Validate Aadhaar number
 */
export const validateAadhaar = (aadhaar: string, required: boolean = false): { isValid: boolean; error?: string } => {
    if (!required && !aadhaar) return { isValid: true };

    const cleanedAadhaar = aadhaar.replace(/\s/g, '');

    const result = validatePattern(cleanedAadhaar, VALIDATION_PATTERNS.AADHAAR, required);
    if (!result.isValid && !result.error) {
        return { isValid: false, error: VALIDATION_MESSAGES.AADHAAR };
    }
    return result;
};

/**
 * Format Aadhaar number with spaces (XXXX XXXX XXXX)
 */
export const formatAadhaar = (aadhaar: string): string => {
    const cleaned = aadhaar.replace(/\s/g, '');
    if (cleaned.length <= 4) return cleaned;
    if (cleaned.length <= 8) return `${cleaned.slice(0, 4)} ${cleaned.slice(4)}`;
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 8)} ${cleaned.slice(8, 12)}`;
};

/**
 * Format Voter ID - Preserve slashes, just uppercase and trim
 */
export const formatVoterID = (voterId: string): string => {
    if (!voterId) return '';
    // Remove spaces but preserve slashes, then uppercase
    return voterId.replace(/\s/g, '').toUpperCase();
};