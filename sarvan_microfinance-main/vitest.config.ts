import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['app/**/*.test.ts'],
        env: {
            // Modules like app/lib/auth.ts throw at import time if these are
            // unset. Tests never sign/verify real tokens with these values.
            JWT_SECRET: 'test-jwt-secret',
            JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, '.'),
        },
    },
});