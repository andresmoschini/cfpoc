import { describe, expect, it } from "vitest";
import worker from "../src/index";

const TOKEN = "test-token";

function createEnv(overrides: Record<string, unknown> = {}) {
  const inserted: unknown[][] = [];

  const DB = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              inserted.push(values);
              return {};
            }
          };
        }
      };
    }
  } as unknown as D1Database;

  return {
    DB,
    EVENTS_API_TOKEN: TOKEN,
    inserted,
    ...overrides
  };
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TOKEN}`
  };
}

describe("cfpoc worker", () => {
  it("returns health information", async () => {
    const env = createEnv();

    const response = await worker.fetch(new Request("https://example.com/"), env as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "cfpoc",
      ok: true
    });
  });

  it("stores an event", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://example.com/events", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          device_id: "test-01",
          timestamp: "2026-10-01T12:00:00Z",
          event_type: "telemetry",
          payload: {
            temperature: 23.4
          }
        })
      }),
      env as never
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true
    });

    expect(env.inserted).toEqual([
      ["test-01", "2026-10-01T12:00:00Z", "telemetry", JSON.stringify({ temperature: 23.4 })]
    ]);
  });

  it("rejects invalid JSON", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://example.com/events", {
        method: "POST",
        headers: authHeaders(),
        body: "{"
      }),
      env as never
    );

    expect(response.status).toBe(400);
  });

  describe("authorization", () => {
    const body = JSON.stringify({
      device_id: "test-01",
      timestamp: "2026-10-01T12:00:00Z",
      event_type: "telemetry",
      payload: {}
    });

    function post(env: unknown, headers: Record<string, string>) {
      return worker.fetch(
        new Request("https://example.com/events", {
          method: "POST",
          headers,
          body
        }),
        env as never
      );
    }

    it("rejects a request without an Authorization header", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json"
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Unauthorized"
      });
      // Nothing must be written when the request is rejected.
      expect(env.inserted).toEqual([]);
    });

    it("rejects a wrong token", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json",
        Authorization: "Bearer nope"
      });

      expect(response.status).toBe(401);
      expect(env.inserted).toEqual([]);
    });

    it("rejects a token with a different length", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}-extra`
      });

      expect(response.status).toBe(401);
      expect(env.inserted).toEqual([]);
    });

    it("rejects a non-bearer scheme", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json",
        Authorization: `Basic ${TOKEN}`
      });

      expect(response.status).toBe(401);
    });

    it("accepts a lowercase bearer scheme", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json",
        Authorization: `bearer ${TOKEN}`
      });

      expect(response.status).toBe(201);
      expect(env.inserted).toHaveLength(1);
    });

    it("fails closed when the token binding is missing", async () => {
      const env = createEnv({ EVENTS_API_TOKEN: undefined });

      const response = await post(env, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`
      });

      expect(response.status).toBe(401);
      expect(env.inserted).toEqual([]);
    });

    it("sends a WWW-Authenticate header", async () => {
      const env = createEnv();

      const response = await post(env, {
        "Content-Type": "application/json"
      });

      expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="cfpoc"');
    });

    it("leaves the health endpoint open", async () => {
      const env = createEnv();

      const response = await worker.fetch(new Request("https://example.com/"), env as never);

      expect(response.status).toBe(200);
    });
  });
});
