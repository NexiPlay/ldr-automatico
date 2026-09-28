// Test-only import-map target. Production imports the real Supabase SDK.
let client: unknown;
export function setClient(value: unknown) { client = value; }
let args: unknown[] = [];
/** SON-2.11: com que chave e com que Authorization o cliente foi montado. */
export function ultimosArgs() { return args; }
// deno-lint-ignore no-explicit-any
export function createClient(...recebidos: unknown[]): any {
  if (!client) throw new Error("Test client not configured");
  args = recebidos;
  return client;
}
