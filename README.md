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

- Node.js 22.18.0 or newer, named in [.nvmrc](.nvmrc)
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

The local development environment uses Wrangler's local D1 database. It does not modify the remote
Cloudflare database.

> **Note: `npm run dev` always uses the local D1 database.**
>
> Even when `wrangler.jsonc` points at a real `database_id`, `wrangler dev` binds the database in
> `local` mode. Requests sent to the local server are written to the local database, never to the
> remote one. You can confirm it in the startup output:
>
> ```text
> env.DB (cfpoc-events)      D1 Database      local
> ```
>
> To send development traffic to the remote database, start Wrangler with `--remote`:
>
> ```bash
> npx wrangler dev --remote
> ```
>
> Every request then goes to your Cloudflare account. This is rarely what you want during
> development, and it is the most common reason a row you thought you had written never shows up in
> production.
>
> The local database is a separate SQLite file under `.wrangler/state/`, keyed by `database_id`. If
> you change `database_id`, Wrangler points at a _new_ empty local database, so run
> `npm run db:migrate:local` again and expect local rows to be gone.

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
{ "ok": true }
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

For this project that is:

```text
https://cfpoc.andresmoschini.workers.dev
```

The endpoint is public and has no authentication, so anyone can post events to it. Do not send
sensitive data until you add auth.

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

## Authentication

`POST /events` requires a shared token in the `Authorization` header. The health endpoint `GET /`
stays open, so you can still check that the Worker is alive without a token.

```bash
curl -X POST https://cfpoc.andresmoschini.workers.dev/events \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"demo-01","timestamp":"2026-10-01T12:00:00Z","event_type":"telemetry","payload":{"temperature":23.4}}'
```

Requests without a valid token get `401` and nothing is written to the database.

### Set up the token locally

Wrangler reads `.dev.vars` automatically and exposes the values as env bindings, so the same code
runs locally and in production. That file is gitignored.

```bash
cp .dev.vars.example .dev.vars
```

Then generate a token and put it in `.dev.vars`:

```bash
node -e "console.log(crypto.randomUUID())"
```

```text
EVENTS_API_TOKEN=paste-the-generated-value-here
```

Then run `npm run dev` as usual. The token is required locally too, so you cannot forget it and only
discover the problem in production.

#### Why `.dev.vars` and not `.env`?

Wrangler reads both, so either works for `npm run dev`. This was verified by removing `.dev.vars`,
leaving only `.env`, and confirming the Worker still received the binding. The project keeps
`.dev.vars` because:

- It is the name Wrangler's own scaffolding uses for local secrets, so it is greppable when you are
  unsure where a local secret lives.
- Its contents are only ever read by `wrangler dev`. A `.env` file is picked up by many tools, so a
  secret in it can leak into a test runner, a linter or a bundler that loads the environment
  implicitly.

Note that the VS Code REST Client extension does **not** read `.env` files, so switching to `.env`
would not make the tokens available to `demo.http` anyway. The extension takes its variables from
`http-client.env.json` (safe to commit) and `http-client.private.env.json` (private, gitignored
here). Requesting native `.env` support is a long-standing open issue in the extension
([#418](https://github.com/Huachao/vscode-restclient/issues/418)).

#### Tokens for `demo.http`

`demo.http` takes its tokens from `http-client.private.env.json`, which is gitignored. Create it
once:

```json
{
  "localToken": "the value of EVENTS_API_TOKEN in your .dev.vars",
  "prodToken": "the production secret"
}
```

Then switch environments by editing the two marked lines in `demo.http`:

```text
@url = {{localUrl}}
@apiToken = {{localToken}}
```

Change both to `{{remoteUrl}}` and `{{prodToken}}` to test production. They travel together on
purpose: each environment has its own token.

### Set the token in production

Production reads the token from a Wrangler secret, not from a file. Generate one:

```bash
node -e "console.log(crypto.randomUUID())"
```

Store it as a secret:

```bash
npx wrangler secret put EVENTS_API_TOKEN
```

Wrangler prompts for the value and encrypts it.

**Local and production use different tokens on purpose.** A token leaked from a developer's machine
should not grant access to production, and a token pasted into a chat window or a screenshot should
not be a production credential. The two environments are therefore independent: rotating one does
not affect the other.

To confirm a secret exists without revealing it:

```bash
npx wrangler secret list
```

### Changing the production token

Secrets are environment-level, not tied to a version, so you do **not** need to redeploy. Wrangler
applies the new value on the next request.

1. Generate a new token:

   ```bash
   node -e "console.log(crypto.randomUUID())"
   ```

2. Overwrite the secret. `wrangler secret put` asks for the new value and replaces the old one:

   ```bash
   npx wrangler secret put EVENTS_API_TOKEN
   ```

3. Update the `prodToken` value in `http-client.private.env.json`, so `demo.http` keeps working. The
   local token in `.dev.vars` is unaffected.

4. Verify, checking both that the new token works and that the old one does not:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://cfpoc.andresmoschini.workers.dev/events \
     -H "Authorization: Bearer NUEVO_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"device_id":"x","timestamp":"2026-10-01T12:00:00Z","event_type":"t","payload":{}}'
   ```

   `201` means it worked. Swap in the old token and confirm you get `401`, so you know the rotation
   really took effect.

To remove the secret entirely, which locks the endpoint with `401`:

```bash
npx wrangler secret delete EVENTS_API_TOKEN
```

> Right after a deploy or a secret change there is a short window while the change propagates across
> the network, during which some requests may still be served by the previous version. If you rotate
> a token because you believe it leaked, treat the endpoint as exposed for a minute or two and
> verify afterwards.

## Inspecting the production database

This section explains the commands used to check the D1 database in production.

### Ver the tables and indexes that exist

Run arbitrary SQL against the remote database with `db:execute:remote`:

```bash
npm run db:execute:remote -- "SELECT name FROM sqlite_master WHERE type IN ('table','index');"
```

```text
name
d1_migrations          <- control table Wrangler uses to track applied migrations
events                 <- the table this project creates
idx_events_device_timestamp
```

The `d1_migrations` table is managed by Wrangler, not by your SQL. Do not edit it.

### Confirm data arrived

```bash
npm run db:query:remote
```

To see only what you care about, pass your own SQL:

```bash
npm run db:execute:remote -- "SELECT id, device_id, event_type, payload FROM events ORDER BY id DESC LIMIT 10;"
```

The `payload` column is the original JSON stored as text, so it comes back escaped:
`{"temperature":23.4}`.

### Count rows without dumping them

Useful right after a deploy to confirm a request wrote anything:

```bash
npm run db:execute:remote -- "SELECT count(*) AS total FROM events;"
```

### Check the database size and usage

```bash
npx wrangler d1 info cfpoc-events
```

This reports the database size, the region, and read/write query counts for the last 24 hours. Handy
for confirming the production database is the one you think it is.

### Delete test rows

The endpoint has no authentication, so public test data is expected. To clean up:

```bash
npm run db:execute:remote -- "DELETE FROM events;"
```

To keep only recent data:

```bash
npm run db:execute:remote -- "DELETE FROM events WHERE timestamp < '2026-01-01T00:00:00Z';"
```

> `--remote` is what makes these commands touch production. Without it, they operate on the local
> database and production stays untouched. Double-check the flag before running anything
> destructive.

### Inspecting the database from the Cloudflare dashboard

The same data is browsable at [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages →
D1 → `cfpoc-events`, where you can run queries and see rows without touching the CLI.

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

## Manual API requests

`demo.http` contains ready-made requests for every endpoint and error case. It works with the VS
Code "REST Client" extension.

The requests are unified against a single `{{url}}` variable, which points at the local environment
by default:

```text
@localUrl = http://127.0.0.1:8787
@remoteUrl = https://cfpoc.<your-subdomain>.workers.dev

@url = {{localUrl}}
```

To test production, change only the `@url` line to `{{remoteUrl}}`.

The Worker is currently deployed at:

```text
https://cfpoc.andresmoschini.workers.dev
```

Note that this endpoint is public and has no authentication. Do not send sensitive data to it.

## Useful commands

```bash
npm run dev                 # Local Worker
npm test                    # Tests
npm run db:migrate:local    # Apply migrations to local D1
npm run db:migrate:remote   # Apply migrations to remote D1
npm run db:query:local      # Query local D1
npm run db:query:remote     # Query remote D1
npm run db:execute:local -- "SELECT count(*) FROM events;"   # Custom SQL, local
npm run db:execute:remote -- "SELECT count(*) FROM events;"  # Custom SQL, remote
npm run deploy              # Deploy Worker
```

Token and database commands, useful when you are not familiar with Cloudflare:

```bash
npx wrangler secret put EVENTS_API_TOKEN   # Set the production token (prompts)
npx wrangler secret list                   # Show secret names, never values
npx wrangler d1 info cfpoc-events          # DB size, region, 24h query counts
npx wrangler deployments list              # Deployed versions
npx wrangler d1 list                      # All D1 databases in the account
npx wrangler whoami                       # Logged-in account and permissions
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
├── demo.http
├── .dev.vars.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── wrangler.jsonc
└── README.md
```

## API

### `POST /events`

Requires the `Authorization: Bearer YOUR_TOKEN` header. Returns `401` without it.

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

This is a proof of concept, not a production-ready API. Rate limiting, payload-size limits, stronger
validation and observability should be added before exposing it to untrusted clients.

The shared token is a deliberate simplification, not real authentication:

- One token for all clients, so anyone holding it can write events. There are no identities, no
  per-device credentials and no way to revoke access for a single client.
- It travels in a header, so it must only be sent over HTTPS.
- The comparison is timing-safe, but there is no rate limiting, so an attacker with a fast
  connection could still brute-force a weak token. Use a long random value, not a memorable one.
- Rotating the token means updating the secret and every client at the same time.

For anything beyond a PoC, use a real auth mechanism and store the secret in Cloudflare's secret
store rather than in a shared header.
