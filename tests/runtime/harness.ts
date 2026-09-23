import { setClient } from "./supabase-stub.ts";

export type Query = {
  table: string; action: "select" | "update" | "upsert"; columns?: string;
  values?: Record<string, unknown>; limit?: number;
  filters: Array<[string, string, unknown]>; orders: Array<[string, unknown]>;
};
export type Result = { data?: unknown; error: unknown };
export type Handler = (req: Request) => Promise<Response>;

export function clientFor(execute: (q: Query) => Result | Promise<Result>) {
  return {
    from(table: string) {
      const q: Query = { table, action: "select", filters: [], orders: [] };
      const builder = {
        select(columns: string) { q.columns = columns; return builder; },
        update(values: Record<string, unknown>) { q.action = "update"; q.values = values; return builder; },
        upsert(values: Record<string, unknown>, _options: unknown) { q.action = "upsert"; q.values = values; return builder; },
        eq(key: string, value: unknown) { q.filters.push(["eq", key, value]); return builder; },
        is(key: string, value: unknown) { q.filters.push(["is", key, value]); return builder; },
        order(key: string, value: unknown) { q.orders.push([key, value]); return builder; },
        limit(value: number) { q.limit = value; return builder; },
        maybeSingle() { return Promise.resolve(execute(structuredClone(q))); },
        then(resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(execute(structuredClone(q))).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

let serial = 0;
export async function withEdge(
  name: "ldr-automatico-orquestrador" | "ldr-automatico-webhook",
  options: { db: (q: Query) => Result | Promise<Result>; fetch: typeof fetch; noApiKey?: boolean },
  run: (handler: Handler, pauses: number[]) => Promise<void>,
) {
  const originalServe = Object.getOwnPropertyDescriptor(Deno, "serve")!;
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  const values: Record<string, string> = {
    SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    ELEVENLABS_API_KEY: "test-eleven-key", ELEVENLABS_AGENT_ID: "agent_3501m1c2yxmye1q99p9nh7r7ndkg",
    ELEVENLABS_AGENT_PHONE_NUMBER_ID: "test-phone", ELEVENLABS_WEBHOOK_SECRET: "test-signing-key",
    ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
  };
  const oldEnv = Object.fromEntries(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  let captured: Handler | undefined;
  const pauses: number[] = [];
  try {
    for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
    if (options.noApiKey) Deno.env.delete("ELEVENLABS_API_KEY");
    setClient(clientFor(options.db));
    Object.defineProperty(Deno, "serve", { configurable: true, value: (handler: Handler) => { captured = handler; return {}; } });
    globalThis.fetch = options.fetch;
    globalThis.setTimeout = ((callback: () => void, delay = 0) => {
      pauses.push(delay); queueMicrotask(callback); return 0;
    }) as unknown as typeof setTimeout;
    // Load the actual production entrypoint, without editing/exporting its handlers.
    await import(new URL(`../../backend/edge-functions/${name}/index.ts?test=${++serial}`, import.meta.url).href);
    if (!captured) throw new Error("Entrypoint did not register a handler");
    await run(captured, pauses);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimeout;
    Object.defineProperty(Deno, "serve", originalServe);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
    setClient(undefined);
  }
}

export function unexpectedFetch(): never { throw new Error("Unexpected external request in test"); }
