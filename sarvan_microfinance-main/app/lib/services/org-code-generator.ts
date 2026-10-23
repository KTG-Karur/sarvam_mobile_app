/**
 * Auto-generates a unique uppercase code from a name for org-hierarchy
 * entities (Division, Area) whose creation forms no longer collect a code
 * from the user. Derives a base from the name's initials/letters, then
 * appends a numeric suffix on collision.
 */
export async function generateUniqueOrgCode(
    name: string,
    codeExists: (code: string) => Promise<boolean>,
    fallbackPrefix: string
): Promise<string> {
    const letters = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const base = letters.slice(0, 6) || fallbackPrefix;

    if (!(await codeExists(base))) return base;

    for (let suffix = 1; suffix < 1000; suffix++) {
        const candidate = `${base}${suffix}`;
        if (!(await codeExists(candidate))) return candidate;
    }

    return `${base}${Date.now()}`;
}
