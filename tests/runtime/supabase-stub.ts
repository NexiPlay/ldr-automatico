// Test-only import-map target. Production imports the real Supabase SDK.
let client: unknown;
export function setClient(value: unknown) { client = value; }
// deno-lint-ignore no-explicit-any
export function createClient(..._args: unknown[]): any {
  if (!client) throw new Error("Test client not configured");
  return client;
}
