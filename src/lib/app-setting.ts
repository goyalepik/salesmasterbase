import "server-only";

import { createClient } from "@supabase/supabase-js";
import { chooseDataSource, readEnv } from "@/lib/env";

// Small settings an admin changes on a page, kept in the database instead of Vercel: the existing
// integration_settings table (key → JSON) on the live site, memory in demo. No new environment variables.

const memory = globalThis as { __epikSettings?: Map<string, unknown> };

function db() {
  const env = readEnv();
  if (chooseDataSource(env) === "demo" || !env.supabaseUrl || !env.serviceRoleKey) return null;
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function readSetting<T>(key: string): Promise<T | null> {
  const client = db();
  if (!client) return (memory.__epikSettings?.get(key) as T | undefined) ?? null;
  const { data, error } = await client.from("integration_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(`Couldn't read the setting ${key}: ${error.message}`);
  return ((data as { value?: T } | null)?.value ?? null) as T | null;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const client = db();
  if (!client) {
    memory.__epikSettings ??= new Map();
    memory.__epikSettings.set(key, value);
    return;
  }
  const { error } = await client.from("integration_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Couldn't save the setting ${key}: ${error.message}`);
}
