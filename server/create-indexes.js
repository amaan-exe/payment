require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function createIndexes() {
    try {
        await client.connect();
        console.log('✅ Connected to Supabase');

        // Create index on status for fast filtering (/api/stats, /api/donations)
        await client.query('CREATE INDEX IF NOT EXISTS "Donation_status_idx" ON "Donation"("status");');
        console.log('✅ Index created on Donation.status');

        // Create index on created_at for fast sorting and cron job filtering
        await client.query('CREATE INDEX IF NOT EXISTS "Donation_created_at_idx" ON "Donation"("created_at" DESC);');
        console.log('✅ Index created on Donation.created_at');

        // Create index on email for the groupBy in /api/stats
        await client.query('CREATE INDEX IF NOT EXISTS "Donation_email_idx" ON "Donation"("email");');
        console.log('✅ Index created on Donation.email');

        await client.end();
        console.log('🎉 Supabase performance indexes created successfully!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

createIndexes();
