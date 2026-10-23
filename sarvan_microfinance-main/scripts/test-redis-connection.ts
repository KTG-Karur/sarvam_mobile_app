// Temporary connectivity check for app/lib/redis.ts against REDIS_URL from .env.
// Run: npx tsx scripts/test-redis-connection.ts
// Delete this file after verifying.

import 'dotenv/config'; // tsx does not auto-load .env; must run before importing the redis client
import { redis } from '../app/lib/redis';

async function main() {
    console.log('[test] REDIS_URL:', process.env.REDIS_URL);
    const pong = await redis.ping();
    console.log('[test] PING response:', pong);

    await redis.set('__redis_conn_test__', 'ok', 'EX', 30);
    const value = await redis.get('__redis_conn_test__');
    console.log('[test] SET/GET roundtrip:', value);

    await redis.quit();
    console.log('[test] connection closed cleanly');
}

main().catch((err) => {
    console.error('[test] FAILED:', err);
    process.exit(1);
});
