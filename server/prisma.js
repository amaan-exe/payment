// ========================
// Prisma Client Singleton
// ========================
// Prevents multiple PrismaClient instances (connection exhaustion)
// and adds Neon-compatible connection pool settings.

const { PrismaClient } = require('@prisma/client');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Build a PrismaClient with appropriate logging
 * and Neon-friendly connection pool settings.
 */
function createPrismaClient() {
    const client = new PrismaClient({
        log: isProduction
            ? [{ emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }]
            : [{ emit: 'stdout', level: 'query' }, { emit: 'stdout', level: 'info' }, { emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
        datasources: {
            db: {
                // Append pool params if not already present
                url: appendPoolParams(process.env.DATABASE_URL),
            },
        },
    });

    return client;
}

/**
 * Append connection_limit, pool_timeout, and pgbouncer=true to the DATABASE_URL
 * if they are not already present, for Supabase/Neon pooler compatibility.
 */
function appendPoolParams(url) {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    const params = [];
    if (!url.includes('connection_limit')) params.push('connection_limit=5');
    if (!url.includes('pool_timeout')) params.push('pool_timeout=30');
    // Supabase specific: transaction poolers require pgbouncer=true to prevent prepared statement latency
    if (!url.includes('pgbouncer')) params.push('pgbouncer=true');
    if (params.length === 0) return url;
    return `${url}${separator}${params.join('&')}`;
}

// Singleton pattern — reuse across hot-reloads in development
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma || createPrismaClient();

if (!isProduction) {
    globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
