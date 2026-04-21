import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

// Railway injects DATABASE_URL automatically when a Postgres service
// is connected to this service via a reference variable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("railway") ? { rejectUnauthorized: false } : false,
});

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = (body.email ?? "").toLowerCase().trim();

  if (!email || !email.includes("@") || email.length > 254) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  if (!process.env.DATABASE_URL) {
    // Degrade gracefully during local dev / before DB is wired
    console.warn("DATABASE_URL not set, waitlist signup not stored");
    return NextResponse.json({ ok: true });
  }

  try {
    await ensureTable();
    await pool.query("INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [email]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
