// Temporary script to push schema via Neon's HTTP API (bypasses TCP port blocks)
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function pushSchema() {
    try {
        // Create Status enum
        await sql`
      DO $$ BEGIN
        CREATE TYPE "Status" AS ENUM ('pending', 'success', 'failed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `;
        console.log('✅ Status enum created');

        // Create Donation table
        await sql`
      CREATE TABLE IF NOT EXISTS "Donation" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
        "donor_name" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "amount" DECIMAL(10, 2) NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'INR',
        "razorpay_order_id" TEXT,
        "razorpay_payment_id" TEXT,
        "status" "Status" NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
      );
    `;
        console.log('✅ Donation table created');
        console.log('🎉 Schema pushed successfully!');
    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

pushSchema();
