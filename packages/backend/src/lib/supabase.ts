import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
// Accept either env var name — chaos-sim's recorder accepts both
// SUPABASE_SERVICE_ROLE_KEY and SUPABASE_SERVICE_KEY; mirror that here so a
// single env-var rename can't break only one side of the read/write split.
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "SUPABASE_URL or SUPABASE_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY not set — Supabase client unavailable"
  );
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;
