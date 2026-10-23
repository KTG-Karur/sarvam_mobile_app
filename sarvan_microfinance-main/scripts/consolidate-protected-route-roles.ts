// One-off codemod: removes the redundant `requiredRoles={[...]}` prop from
// <ProtectedRoute> in page.tsx files whose list is either an exact match for
// navigation.config.ts's allowedRoles for that href, or "cosmetically"
// different only in ADMIN / ADMIN_NON_HO_BRANCH_SWITCH — both of which are
// already handled unconditionally by resolvePageAuthorization (HO Admin
// bypasses everything; ADMIN_NON_HO_BRANCH_SWITCH already falls through to
// BM/AM presence, and `requiredRoles.includes(userRole)` already matches
// plain 'ADMIN' for a non-HO admin too). Removing the prop makes these pages
// derive their allowed roles from navigation.config.ts at runtime instead of
// hand-duplicating it. Files with a genuine role-set difference are left
// untouched — see MISMATCH output from audit-protected-route-roles.ts.
//
// Not wired into package.json — run directly with:
//   npx tsx scripts/consolidate-protected-route-roles.ts [--apply]
import fs from 'fs';
import path from 'path';
import { getAllowedRolesForHref } from '../app/config/navigation.config';

const DASHBOARD_ROOT = path.resolve(__dirname, '../app/dashboard');
const APPLY = process.argv.includes('--apply');

// Pages we've manually confirmed have a genuine role-set difference between
// page.tsx and navigation.config.ts — never touch these here.
const SKIP_HREFS = new Set([
    '/dashboard/admin-reports/account/daybook',
    '/dashboard/admin-reports/account/voucher-print',
    '/dashboard/admin-reports/funders/funder-interest',
    '/dashboard/mis-reports/company-profile',
    '/dashboard/transactions/modification',
    '/dashboard/branch/create', // no navigationConfig entry at all
]);

function walk(dir: string, acc: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name === 'page.tsx') acc.push(full);
    }
}

function hrefFromPageFile(file: string): string {
    const rel = path.relative(path.resolve(__dirname, '../app'), file)
        .replace(/\\/g, '/')
        .replace(/\/page\.tsx$/, '');
    return '/' + rel;
}

function extractRequiredRoles(source: string): string[] | null {
    const rolesMatch = source.match(/requiredRoles=\{\[([^\]]*)\]\}/);
    if (!rolesMatch) return null;
    return Array.from(rolesMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)).map(
        (m) => m[1] ?? m[2]
    );
}

const NOISE_ROLES = new Set(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH']);
function meaningfulSet(roles: string[]): string[] {
    return [...roles].filter((r) => !NOISE_ROLES.has(r)).sort();
}

function sameArray(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

const files: string[] = [];
walk(DASHBOARD_ROOT, files);

let changed = 0;
let skippedNoDiff = 0;

for (const file of files) {
    const href = hrefFromPageFile(file);
    if (SKIP_HREFS.has(href)) continue;

    const source = fs.readFileSync(file, 'utf8');
    if (!/<ProtectedRoute\b/.test(source)) continue;

    const pageRoles = extractRequiredRoles(source);
    if (pageRoles === null) continue; // already has no requiredRoles prop

    const navRoles = getAllowedRolesForHref(href);
    if (navRoles === undefined) continue; // not in navigationConfig — leave alone

    const meaningfulSame = sameArray(meaningfulSet(pageRoles), meaningfulSet(navRoles));
    if (!meaningfulSame) {
        skippedNoDiff++;
        continue;
    }

    const updated = source.replace(
        /<ProtectedRoute requiredRoles=\{\[[^\]]*\]\}(\s*)>/,
        '<ProtectedRoute>'
    );

    if (updated === source) {
        console.warn(`  ! regex did not match for ${href} (${file}) — left untouched`);
        continue;
    }

    changed++;
    console.log(`  ${href}`);
    if (APPLY) fs.writeFileSync(file, updated, 'utf8');
}

console.log(`\n${APPLY ? 'Applied' : 'Would apply (dry run — pass --apply to write)'}: ${changed} files`);
console.log(`Skipped (genuine role-set difference, run audit script for details): ${skippedNoDiff}`);
