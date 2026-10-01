import { describe, expect, it } from "vitest";
import worker from "../src/index";

function createEnv() {
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
    inserted
  };
}

describe("cfpoc worker", () => {
  it("returns health information", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://example.com/"),
      env.DB as never
    );

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
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_id: "test-01",
          timestamp: "2026-10-01T12:00:00Z",
          event_type: "telemetry",
          payload: {
            temperature: 23.4
          }
        })
      }),
      env.DB as never
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true
    });

    expect(env.inserted).toEqual([
      [
        "test-01",
        "2026-10-01T12:00:00Z",
        "telemetry",
        JSON.stringify({ temperature: 23.4 })
      ]
    ]);
  });

  it("rejects invalid JSON", async () => {
    const env = createEnv();

    const response = await worker.fetch(
      new Request("https://example.com/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{"
      }),
      env.DB as never
    );

    expect(response.status).toBe(400);
  });
});
