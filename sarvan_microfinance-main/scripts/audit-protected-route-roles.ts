// One-off audit script: compares each page.tsx's <ProtectedRoute requiredRoles={...}>
// against navigation.config.ts's getAllowedRolesForHref() for the same href.
// Not wired into package.json — run directly with `npx tsx scripts/audit-protected-route-roles.ts`.
import fs from 'fs';
import path from 'path';
import { getAllowedRolesForHref } from '../app/config/navigation.config';

const DASHBOARD_ROOT = path.resolve(__dirname, '../app/dashboard');

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

function extractRequiredRoles(source: string): string[] | null | undefined {
    // undefined = no <ProtectedRoute requiredRoles=...> at all found
    // null = <ProtectedRoute> present but no requiredRoles prop (fully derives already)
    const protectedRouteMatch = source.match(/<ProtectedRoute\b/);
    if (!protectedRouteMatch) return undefined;

    const rolesMatch = source.match(/requiredRoles=\{\[([^\]]*)\]\}/);
    if (!rolesMatch) return null;

    return Array.from(rolesMatch[1].matchAll(/'([^']+)'|"([^"]+)"/g)).map(
        (m) => m[1] ?? m[2]
    );
}

function sameSet(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

const files: string[] = [];
walk(DASHBOARD_ROOT, files);

const noProtectedRoute: string[] = [];
const noRequiredRolesProp: string[] = [];
const exactMatch: { file: string; href: string; roles: string[] }[] = [];
const mismatch: { file: string; href: string; pageRoles: string[]; navRoles: string[] | undefined }[] = [];
const noNavEntry: { file: string; href: string; pageRoles: string[] }[] = [];

for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const href = hrefFromPageFile(file);
    const extracted = extractRequiredRoles(source);

    if (extracted === undefined) {
        noProtectedRoute.push(href);
        continue;
    }
    if (extracted === null) {
        noRequiredRolesProp.push(href);
        continue;
    }

    const navRoles = getAllowedRolesForHref(href);
    if (navRoles === undefined) {
        noNavEntry.push({ file, href, pageRoles: extracted });
    } else if (sameSet(extracted, navRoles)) {
        exactMatch.push({ file, href, roles: extracted });
    } else {
        mismatch.push({ file, href, pageRoles: extracted, navRoles });
    }
}

console.log(`\n=== Total page.tsx files: ${files.length} ===`);
console.log(`No <ProtectedRoute> at all: ${noProtectedRoute.length}`);
console.log(`<ProtectedRoute> with no requiredRoles prop (already auto-derives): ${noRequiredRolesProp.length}`);
console.log(`Exact match (safe to remove hardcoded prop): ${exactMatch.length}`);
console.log(`MISMATCH (needs a decision): ${mismatch.length}`);
console.log(`No navigation.config entry for this href at all: ${noNavEntry.length}`);

console.log('\n--- EXACT MATCH (candidates for auto-removal) ---');
for (const m of exactMatch) console.log(`  ${m.href}  [${m.roles.join(', ')}]`);

console.log('\n--- MISMATCH (page.tsx vs navigation.config differ) ---');
for (const m of mismatch) {
    console.log(`  ${m.href}`);
    console.log(`    page.tsx requiredRoles: [${m.pageRoles.join(', ')}]`);
    console.log(`    nav config allowedRoles: [${(m.navRoles ?? []).join(', ')}]`);
}

console.log('\n--- NO NAV CONFIG ENTRY (page.tsx has requiredRoles but href is not in navigationConfig) ---');
for (const m of noNavEntry) {
    console.log(`  ${m.href}  [${m.pageRoles.join(', ')}]`);
}
