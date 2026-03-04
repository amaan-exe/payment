// Push schema to Supabase via direct SQL (pg module)
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function pushSchema() {
  try {
    await client.connect();
    console.log('✅ Connected to Supabase');

    // Create Status enum (with 'authorized' value)
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "Status" AS ENUM ('pending', 'authorized', 'success', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✅ Status enum created');

    // Create Donation table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Donation" (
        "id"                  TEXT NOT NULL DEFAULT gen_random_uuid(),
        "donor_name"          TEXT NOT NULL,
        "email"               TEXT NOT NULL,
        "amount"              DECIMAL(10, 2) NOT NULL,
        "currency"            TEXT NOT NULL DEFAULT 'INR',
        "razorpay_order_id"   TEXT,
        "razorpay_payment_id" TEXT,
        "status"              "Status" NOT NULL DEFAULT 'pending',
        "event_log"           JSONB DEFAULT '[]',
        "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('✅ Donation table created');

    // Create unique indexes
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Donation_razorpay_order_id_key" ON "Donation"("razorpay_order_id");`);
    console.log('✅ razorpay_order_id unique index created');

    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS "Donation_razorpay_payment_id_key" ON "Donation"("razorpay_payment_id");`);
    console.log('✅ razorpay_payment_id unique index created');

    await client.end();
    console.log('🎉 Schema pushed to Supabase successfully!');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

pushSchema();
