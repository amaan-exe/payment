require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL,
});

async function enableRLS() {
    try {
        await client.connect();
        console.log('✅ Connected to Supabase');

        // Enable RLS on Donation table
        await client.query('ALTER TABLE "Donation" ENABLE ROW LEVEL SECURITY;');
        console.log('✅ Row Level Security (RLS) enabled on "Donation" table');

        // Create a policy that DENIES all access to the public API (anon role)
        // The server (using the connection string) connects as the authenticated postgres superuser
        // or as a role that bypasses RLS, so the server will still have full access.

        // We try/catch the policy creation in case it already exists
        try {
            await client.query(`
          CREATE POLICY "Deny all public access" 
          ON "Donation" 
          FOR ALL 
          TO public 
          USING (false);
        `);
            console.log('✅ Strict policy created: Deny all public access');
        } catch (e) {
            if (e.code === '42710') {
                console.log('ℹ️ Policy already exists');
            } else {
                throw e;
            }
        }

        await client.end();
        console.log('🎉 Supabase RLS warning resolved!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

enableRLS();
