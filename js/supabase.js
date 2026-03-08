/**
 * Supabase client initialisation.
 * Phase 0: stub — no connection until env vars are configured.
 */

const SUPABASE_URL = '';  // Set in Phase 1: https://<project>.supabase.co
const SUPABASE_ANON_KEY = '';  // Set in Phase 1: public anon key

let _client = null;

export function isConfigured() {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

export async function getClient() {
  if (!isConfigured()) return null;
  if (_client) return _client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}
