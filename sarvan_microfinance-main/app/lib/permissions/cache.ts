// ============================================================
// PERMISSION CACHE — Redis-backed, shared across all pm2 workers
// app/lib/permissions/cache.ts
//
// Strategy:
//   - Cache key: perm:<userId>
//   - Cache value: JSON-serialized { version, context }, TTL 10 minutes
//   - Invalidation: bump PermissionCacheVersion in DB when roles change,
//     AND delete the Redis key — visible to every pm2 worker immediately
//     (an in-memory-per-process cache can't do this: invalidating on the
//     worker that handled the request leaves the other cluster workers
//     serving stale permissions until TTL expiry, since payload.permVersion
//     from the JWT is only re-checked against whatever that worker cached)
//   - Redis unreachable: fail soft — treat as a cache miss / no-op so auth
//     still works (just always rebuilds from DB) rather than erroring out
// ============================================================

import redis from '@/app/lib/redis';
import type {
  UserContext,
  PermissionSet,
  PermissionConditions,
  FieldPermissionMap,
  FieldAccessResult,
  ReportPermissionMap,
  ReportAccessResult,
} from './types';

const CACHE_TTL_SECONDS = 10 * 60; // 10 minutes

// UserContext holds THREE Maps (permissions.conditions, fieldPermissions,
// reportPermissions) plus two Sets inside permissions — none of which
// JSON.stringify round-trips (a Map serializes as "{}", silently dropping
// every entry) — serialize each to array-of-entries for storage, rebuild on read.
interface SerializedPermissionSet {
  granted: string[];
  denied: string[];
  conditions: [string, PermissionConditions][];
}

type SerializedContext = Omit<UserContext, 'permissions' | 'fieldPermissions' | 'reportPermissions'> & {
  permissions: SerializedPermissionSet;
  fieldPermissions: [string, FieldAccessResult][];
  reportPermissions: [string, ReportAccessResult][];
};

interface CacheEnvelope {
  version: number;
  context: SerializedContext;
}

function toSerializedContext(context: UserContext): SerializedContext {
  const { permissions, fieldPermissions, reportPermissions, ...rest } = context;
  return {
    ...rest,
    permissions: {
      granted: Array.from(permissions.granted),
      denied: Array.from(permissions.denied),
      conditions: Array.from(permissions.conditions.entries()),
    },
    fieldPermissions: Array.from(fieldPermissions.entries()),
    reportPermissions: Array.from(reportPermissions.entries()),
  };
}

function fromSerializedContext(serialized: SerializedContext): UserContext {
  const { permissions, fieldPermissions, reportPermissions, ...rest } = serialized;
  return {
    ...rest,
    permissions: {
      granted: new Set(permissions.granted),
      denied: new Set(permissions.denied),
      conditions: new Map(permissions.conditions),
    },
    fieldPermissions: new Map(fieldPermissions) as FieldPermissionMap,
    reportPermissions: new Map(reportPermissions) as ReportPermissionMap,
  };
}

class PermissionCache {
  private key(userId: string): string {
    return cacheKeys.userPermissions(userId);
  }

  async get(userId: string): Promise<UserContext | null> {
    const result = await this.getWithVersion(userId);
    return result?.context ?? null;
  }

  async getWithVersion(
    userId: string
  ): Promise<{ context: UserContext; version: number } | null> {
    try {
      const raw = await redis.get(this.key(userId));
      if (!raw) return null;

      const envelope: CacheEnvelope = JSON.parse(raw);
      return { context: fromSerializedContext(envelope.context), version: envelope.version };
    } catch (err) {
      console.error('[permissionCache] get failed, falling back to DB:', (err as Error).message);
      return null;
    }
  }

  async set(userId: string, context: UserContext, version: number): Promise<void> {
    try {
      const envelope: CacheEnvelope = { version, context: toSerializedContext(context) };
      await redis.set(this.key(userId), JSON.stringify(envelope), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      console.error('[permissionCache] set failed (non-fatal):', (err as Error).message);
    }
  }

  async invalidate(userId: string): Promise<void> {
    try {
      await redis.del(this.key(userId));
    } catch (err) {
      console.error('[permissionCache] invalidate failed:', (err as Error).message);
    }
  }

  async invalidateAll(): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', 'perm:*', 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) await redis.unlink(...keys);
      } while (cursor !== '0');
    } catch (err) {
      console.error('[permissionCache] invalidateAll failed:', (err as Error).message);
    }
  }

  // Build PermissionSet from flat granted/denied arrays
  static buildPermissionSet(
    granted: string[],
    denied: string[],
    conditions: Record<string, unknown> = {}
  ): PermissionSet {
    return {
      granted: new Set(granted),
      denied: new Set(denied),
      conditions: new Map(Object.entries(conditions)) as Map<string, PermissionConditions>,
    };
  }

  // Serialize PermissionSet for JWT/response (Sets are not JSON-serializable)
  static serialize(set: PermissionSet): {
    granted: string[];
    denied: string[];
  } {
    return {
      granted: Array.from(set.granted),
      denied: Array.from(set.denied),
    };
  }
}

// Stateless wrapper around the shared Redis client — safe as a plain singleton,
// no per-process state to guard with the global-object trick anymore.
export const permissionCache = new PermissionCache();

// ─────────────────────────────────────────────
// Cache key helpers
// ─────────────────────────────────────────────
export const cacheKeys = {
  userPermissions: (userId: string) => `perm:${userId}`,
  rolePermissions: (roleId: string) => `role:${roleId}`,
  moduleList: () => 'modules:active',
  sidebarMenu: (userId: string) => `menu:${userId}`,
} as const;
