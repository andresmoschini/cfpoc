export interface Env {
  DB: D1Database;
  EVENTS_API_TOKEN: string;
}

interface EventRequest {
  device_id: string;
  timestamp: string;
  event_type: string;
  payload: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "cfpoc",
        ok: true
      });
    }

    if (request.method === "POST" && url.pathname === "/events") {
      return handleCreateEvent(request, env);
    }

    if (url.pathname === "/events") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "POST"
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;

async function handleCreateEvent(
  request: Request,
  env: Env
): Promise<Response> {
  // The health endpoint stays open; everything else needs the shared token.
  if (!isAuthorized(request, env)) {
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Bearer realm="cfpoc"'
        }
      }
    );
  }

  let event: EventRequest;

  try {
    event = await request.json<EventRequest>();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  if (
    typeof event.device_id !== "string" ||
    typeof event.timestamp !== "string" ||
    typeof event.event_type !== "string" ||
    event.payload === undefined
  ) {
    return Response.json(
      {
        error:
          "device_id, timestamp, event_type and payload are required"
      },
      { status: 400 }
    );
  }

  await env.DB
    .prepare(
      `
        INSERT INTO events (
          device_id,
          timestamp,
          event_type,
          payload
        )
        VALUES (?, ?, ?, ?)
      `
    )
    .bind(
      event.device_id,
      event.timestamp,
      event.event_type,
      JSON.stringify(event.payload)
    )
    .run();

  return Response.json({ ok: true }, { status: 201 });
}

/**
 * Checks the shared token in the Authorization header.
 *
 * Uses a timing-safe comparison so the token cannot be guessed one character at
 * a time. The token is a shared secret, not a real auth system: see the Notes
 * section of the README.
 */
function isAuthorized(request: Request, env: Env): boolean {
  // Fail closed. If the binding is missing there is no way to authenticate.
  if (!env.EVENTS_API_TOKEN) {
    return false;
  }

  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  if (!match) {
    return false;
  }

  const expected = new TextEncoder().encode(env.EVENTS_API_TOKEN);
  const provided = new TextEncoder().encode(match[1].trim());

  // Compare lengths first: TextEncoder gives byte lengths, and constant-time
  // comparison only makes sense for equal-length inputs.
  if (expected.length !== provided.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ provided[i];
  }

  return diff === 0;
}
