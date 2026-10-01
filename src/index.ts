export interface Env {
  DB: D1Database;
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
