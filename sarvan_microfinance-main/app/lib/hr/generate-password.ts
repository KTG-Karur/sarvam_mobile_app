// ============================================================
// TEMPORARY PASSWORD GENERATION
// app/lib/hr/generate-password.ts
//
// No password generator existed anywhere in this codebase before HR
// Onboarding — every prior user-creation/reset flow has the admin type a
// password by hand. This is the first auto-generated one: shown once in the
// approval-response payload for the Admin to copy and share with the new
// employee (there's no email/SMS delivery integration in this app), then
// immediately hashed via hashPassword() before it ever touches the DB.
// ============================================================

import { randomBytes } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) so a password read off
// a screen or shared over WhatsApp doesn't get mistyped.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateRandomPassword(length = 10): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += CHARSET[bytes[i] % CHARSET.length];
    }
    return out;
}
