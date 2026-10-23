// Sarvam Charitable Trust — Postman Collection Generator
//
// Scans all app/api/[...]/route.ts files, extracts HTTP methods + Zod/Swagger
// body schemas, and writes a Postman Collection v2.1 JSON to:
//   postman-collection.json  (project root)
//
// Run:  npx tsx scripts/generate-postman-collection.ts

import fs from 'fs';
import path from 'path';

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, 'app', 'api');
const OUT_FILE = path.join(ROOT, 'postman-collection.json');

/** Recursively collect all route.ts files */
function collectRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectRouteFiles(full));
    else if (entry.name === 'route.ts') results.push(full);
  }
  return results;
}

/** Convert a file path to an API path string  e.g.  /api/auth/login */
function filePathToApiPath(filePath: string): string {
  const rel = path.relative(API_DIR, path.dirname(filePath));
  const segments = rel.split(path.sep).map((s) => {
    // Next.js [param] → :param  and  [[param]] → :param?
    return s.replace(/^\[\[(.+?)\]\]$/, ':$1?').replace(/^\[(.+?)\]$/, ':$1');
  });
  return '/api/' + segments.join('/');
}

/** Extract which HTTP methods are exported from a route file */
function extractMethods(content: string): string[] {
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return methods.filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(content));
}

// ────────────────────────────────────────────────────────────────────────────
//  Zod schema extraction — best-effort regex
// ────────────────────────────────────────────────────────────────────────────

interface ZodField {
  name: string;
  type: string;
  example: unknown;
  optional: boolean;
}

/**
 * Very lightweight regex-based Zod field extractor.
 * Handles common patterns:  z.string(), z.number(), z.boolean(), z.enum([...])
 * Falls back gracefully for complex/nested schemas.
 */
function extractZodFields(content: string): ZodField[] {
  const fields: ZodField[] = [];

  // Find the first z.object({ ... }) block — capture everything between the outer braces
  const objMatch = content.match(/z\.object\(\{([\s\S]*?)\}\)/);
  if (!objMatch) return fields;

  const body = objMatch[1];

  // Line-by-line scan for  fieldName: z.xxx(...)
  const lineRe = /^\s*(\w+)\s*:\s*(z\.[\s\S]+?)(?:,|\n)/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body)) !== null) {
    const name = m[1];
    const def = m[2].trim();
    const optional = def.includes('.optional()') || def.includes('.nullable()');

    let type = 'string';
    let example: unknown = '';

    if (/z\.number\b/.test(def)) { type = 'number'; example = 1; }
    else if (/z\.boolean\b/.test(def)) { type = 'boolean'; example = true; }
    else if (/z\.date\b/.test(def)) { type = 'string'; example = '2026-06-22'; }
    else if (/z\.enum\b/.test(def)) {
      type = 'string';
      const em = def.match(/z\.enum\(\[([^\]]+)\]/);
      if (em) {
        const vals = em[1].match(/'([^']+)'|"([^"]+)"/g);
        example = vals ? vals[0].replace(/['"]/g, '') : '';
      }
    } else if (/z\.array\b/.test(def)) { type = 'array'; example = []; }
    else if (/z\.object\b/.test(def)) { type = 'object'; example = {}; }
    else { type = 'string'; example = ''; }

    fields.push({ name, type, example, optional });
  }

  return fields;
}

// ────────────────────────────────────────────────────────────────────────────
//  Swagger JSDoc body extraction (for richer examples where present)
// ────────────────────────────────────────────────────────────────────────────

interface SwaggerBodyField {
  name: string;
  type: string;
  example: unknown;
  required: boolean;
}

function extractSwaggerBody(content: string): SwaggerBodyField[] | null {
  // Detect a requestBody block in the JSDoc
  if (!content.includes('requestBody:')) return null;

  const fields: SwaggerBodyField[] = [];

  // Extract the properties block
  const propSection = content.match(/properties:\s*\n([\s\S]*?)(?:\*\s*responses:|$)/);
  if (!propSection) return null;

  const propLines = propSection[1];

  // Match   *           fieldName:
  //         *             type: xxx
  //         *             example: xxx
  const fieldRe = /\*\s{2,}(\w+):\s*\n([\s\S]*?)(?=\*\s{2,}\w+:|$)/g;
  let fm: RegExpExecArray | null;
  while ((fm = fieldRe.exec(propLines)) !== null) {
    const name = fm[1];
    const block = fm[2];

    const typeM = block.match(/type:\s*(\w+)/);
    const exampleM = block.match(/example:\s*(.+)/);

    let rawExample: unknown = '';
    if (exampleM) {
      const raw = exampleM[1].trim();
      if (raw === 'true' || raw === 'false') rawExample = raw === 'true';
      else if (!isNaN(Number(raw))) rawExample = Number(raw);
      else rawExample = raw.replace(/^['"]|['"]$/g, '');
    }

    fields.push({
      name,
      type: typeM ? typeM[1] : 'string',
      example: rawExample,
      required: false, // we'll enrich below
    });
  }

  // Mark required fields
  const reqMatch = content.match(/required:\s*\n([\s\S]*?)(?:properties:|$)/);
  if (reqMatch) {
    const reqLines = reqMatch[1];
    const reqFields = [...reqLines.matchAll(/- (\w+)/g)].map((r) => r[1]);
    for (const f of fields) {
      if (reqFields.includes(f.name)) f.required = true;
    }
  }

  return fields.length ? fields : null;
}

// ────────────────────────────────────────────────────────────────────────────
//  Build a JSON example body from extracted fields
// ────────────────────────────────────────────────────────────────────────────

function buildBodyExample(fields: Array<{ name: string; type: string; example: unknown }>): string {
  if (!fields.length) return '{}';
  const obj: Record<string, unknown> = {};
  for (const f of fields) {
    obj[f.name] = f.example !== '' ? f.example : (f.type === 'number' ? 0 : f.type === 'boolean' ? false : f.type === 'array' ? [] : f.type === 'object' ? {} : '');
  }
  return JSON.stringify(obj, null, 2);
}

// ────────────────────────────────────────────────────────────────────────────
//  Postman collection builder
// ────────────────────────────────────────────────────────────────────────────

interface PostmanItem {
  name: string;
  request: {
    method: string;
    header: { key: string; value: string; type?: string }[];
    body?: { mode: string; raw: string; options: { raw: { language: string } } };
    url: { raw: string; host: string[]; path: string[]; variable?: { key: string; value: string; description: string }[] };
    description?: string;
  };
  response: unknown[];
}

interface PostmanFolder {
  name: string;
  item: (PostmanItem | PostmanFolder)[];
}

function getOrCreateFolder(root: PostmanFolder[], folderName: string): PostmanFolder {
  let folder = root.find((f) => f.name === folderName) as PostmanFolder | undefined;
  if (!folder) {
    folder = { name: folderName, item: [] };
    root.push(folder);
  }
  return folder;
}

/** Convert API path to a human-readable folder name */
function pathToFolderName(apiPath: string): string {
  // e.g. /api/auth/login → Auth
  //      /api/admin/roles → Admin / Roles
  const parts = apiPath.split('/').filter(Boolean).slice(1); // remove 'api'
  if (!parts.length) return 'Root';

  // Use first two meaningful segments (skip dynamic :id segments for folder naming)
  const meaningful = parts.filter((p) => !p.startsWith(':'));
  if (!meaningful.length) return parts[0] || 'Root';

  return meaningful
    .slice(0, 2)
    .map((p) =>
      p
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    )
    .join(' / ');
}

/** Build request URL object for Postman */
function buildUrl(apiPath: string): PostmanItem['request']['url'] {
  const segments = apiPath.split('/').filter(Boolean); // ['api', 'auth', 'login']
  const pathVars: { key: string; value: string; description: string }[] = [];

  const finalSegments = segments.map((seg) => {
    if (seg.startsWith(':')) {
      const key = seg.slice(1).replace('?', '');
      pathVars.push({ key, value: '', description: `Path parameter: ${key}` });
      return `:${key}`;
    }
    return seg;
  });

  const raw = `{{baseUrl}}/${finalSegments.join('/')}`;

  return {
    raw,
    host: ['{{baseUrl}}'],
    path: finalSegments,
    ...(pathVars.length ? { variable: pathVars } : {}),
  };
}

// ────────────────────────────────────────────────────────────────────────────
//  Main
// ────────────────────────────────────────────────────────────────────────────

function main() {
  const routeFiles = collectRouteFiles(API_DIR);
  console.log(`Found ${routeFiles.length} route files`);

  const folders: PostmanFolder[] = [];
  let totalRequests = 0;

  for (const filePath of routeFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const apiPath = filePathToApiPath(filePath);
    const methods = extractMethods(content);

    if (!methods.length) continue;

    const folderName = pathToFolderName(apiPath);
    const folder = getOrCreateFolder(folders, folderName);

    // Try swagger-doc body first, then Zod inline
    const swaggerFields = extractSwaggerBody(content);
    const zodFields = extractZodFields(content);

    for (const method of methods) {
      const needsBody = ['POST', 'PUT', 'PATCH'].includes(method);
      let bodyRaw = '{}';

      if (needsBody) {
        if (swaggerFields && swaggerFields.length) {
          bodyRaw = buildBodyExample(swaggerFields);
        } else if (zodFields.length) {
          bodyRaw = buildBodyExample(zodFields);
        }
      }

      // Build a readable request name  e.g. "POST /api/auth/login"
      const requestName = `${method} ${apiPath}`;

      const item: PostmanItem = {
        name: requestName,
        request: {
          method,
          header: [
            { key: 'Content-Type', value: 'application/json', type: 'text' },
            { key: 'Authorization', value: 'Bearer {{accessToken}}', type: 'text' },
          ],
          url: buildUrl(apiPath),
        },
        response: [],
      };

      if (needsBody) {
        item.request.body = {
          mode: 'raw',
          raw: bodyRaw,
          options: { raw: { language: 'json' } },
        };
      }

      (folder.item as PostmanItem[]).push(item);
      totalRequests++;
    }
  }

  // Sort folders alphabetically
  folders.sort((a, b) => a.name.localeCompare(b.name));

  const collection = {
    info: {
      name: 'Sarvam Charitable Trust API',
      description:
        'Auto-generated Postman collection for Sarvam Charitable Trust. All protected endpoints require a Bearer token — set the {{accessToken}} variable after logging in via POST /api/auth/login.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: folders,
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3320', description: 'API base URL (change for production)' },
      { key: 'accessToken', value: '', description: 'JWT access token — copy from POST /api/auth/login response' },
      { key: 'branchId', value: '', description: 'Active branch ID' },
    ],
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(collection, null, 2), 'utf-8');
  console.log(`\n✅  Generated: ${OUT_FILE}`);
  console.log(`   Folders : ${folders.length}`);
  console.log(`   Requests: ${totalRequests}`);
  console.log('\nHow to import:');
  console.log('  1. Open Postman → Import → Upload File → select postman-collection.json');
  console.log('  2. Create/select an Environment with variable  baseUrl = http://localhost:3320');
  console.log('  3. Run POST /api/auth/login, copy the accessToken, set it in the environment');
}

main();
