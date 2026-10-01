# cfpoc

Small Cloudflare Workers + D1 proof of concept for receiving and storing events.

The project is intentionally small:

```text
HTTP client
    |
    | POST /events
    v
Cloudflare Worker
    |
    | INSERT
    v
D1 (SQLite)
```

The same Worker can run locally with a local D1 database or online with a Cloudflare D1 database.

## Requirements

- Node.js 20+
- A Cloudflare account
- Wrangler (installed locally through the project dependencies)
- For online deployment: authentication with your Cloudflare account

Check Node:

```bash
node --version
```

## Install

Clone the repository and install dependencies:

```bash
git clone <YOUR_REPOSITORY_URL>
cd cfpoc
npm install
```

## Local development

The local development environment uses Wrangler's local D1 database. It does not modify the remote Cloudflare database.

First apply the migrations locally:

```bash
npm run db:migrate:local
```

Start the Worker:

```bash
npm run dev
```

Wrangler will show the local URL, normally:

```text
http://localhost:8787
```

Send an event:

```bash
curl -X POST http://localhost:8787/events \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "demo-01",
    "timestamp": "2026-10-01T12:00:00Z",
    "event_type": "telemetry",
    "payload": {
      "temperature": 23.4
    }
  }'
```

Expected response:

```json
{"ok":true}
```

Query the local database:

```bash
npm run db:query:local
```

The command executes:

```sql
SELECT * FROM events ORDER BY id DESC;
```

## Cloudflare authentication

For online deployment, authenticate Wrangler with your Cloudflare account:

```bash
npx wrangler login
```

This opens a browser where you authorize Wrangler.

Alternatively, Wrangler can use an API token in CI. Do not commit tokens to the repository.

## Create the production D1 database

The repository contains the database binding, but the D1 database itself needs to be created once.

Run:

```bash
npm run db:create
```

Wrangler will print a `database_id`. Copy that ID into `wrangler.jsonc`:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "cfpoc-events",
    "database_id": "YOUR_DATABASE_ID",
    "migrations_dir": "migrations"
  }
]
```

Commit the resulting configuration.

## Apply production migrations

After the D1 database exists:

```bash
npm run db:migrate:remote
```

This applies the SQL migrations in `migrations/` to the remote D1 database.

## Deploy the Worker

Deploy with:

```bash
npm run deploy
```

Wrangler will print the deployed URL, for example:

```text
https://cfpoc.<your-subdomain>.workers.dev
```

Test the online API:

```bash
curl -X POST https://YOUR_WORKER_URL/events \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "demo-01",
    "timestamp": "2026-10-01T12:00:00Z",
    "event_type": "telemetry",
    "payload": {
      "temperature": 23.4
    }
  }'
```

Query the production database:

```bash
npm run db:query:remote
```

## Database migrations

Migrations are versioned SQL files:

```text
migrations/
├── 0001_initial.sql
└── ...
```

When the schema changes, create the next migration instead of editing an already-applied migration:

```text
migrations/
├── 0001_initial.sql
└── 0002_add_something.sql
```

Apply it locally:

```bash
npm run db:migrate:local
```

Then apply it remotely:

```bash
npm run db:migrate:remote
```

## Tests

Run the test suite:

```bash
npm test
```

Run it in watch mode:

```bash
npm run test:watch
```

## Useful commands

```bash
npm run dev                 # Local Worker
npm test                    # Tests
npm run db:migrate:local    # Apply migrations to local D1
npm run db:migrate:remote   # Apply migrations to remote D1
npm run db:query:local      # Query local D1
npm run db:query:remote     # Query remote D1
npm run deploy              # Deploy Worker
```

## Project structure

```text
cfpoc/
├── migrations/
│   └── 0001_initial.sql
├── src/
│   └── index.ts
├── test/
│   └── index.test.ts
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.jsonc
└── README.md
```

## API

### `POST /events`

Request:

```json
{
  "device_id": "demo-01",
  "timestamp": "2026-10-01T12:00:00Z",
  "event_type": "telemetry",
  "payload": {
    "temperature": 23.4
  }
}
```

Response:

```json
{
  "ok": true
}
```

The payload is stored as JSON text in D1. This deliberately keeps the PoC schema flexible.

### `GET /`

Returns a small health response:

```json
{
  "service": "cfpoc",
  "ok": true
}
```

### Unsupported routes/methods

The Worker returns `404` for unknown routes and `405` for unsupported HTTP methods.

## Notes

This is a proof of concept, not a production-ready API. In particular, authentication, authorization, rate limiting, payload-size limits, stronger validation and observability should be added before exposing it to untrusted clients.
