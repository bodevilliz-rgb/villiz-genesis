# Awo + n8n Automation Gateway (Sprint 9)

Genesis is the system of record. n8n transports operational events; Awo
interprets them and produces recommendations. Neither service can approve a
review, edit a draft, retry a publishing job, or publish content through this
gateway. The Render worker remains the only publisher and Blotato remains the
delivery provider.

## Trust boundary

- Never give n8n or Awo `SUPABASE_SERVICE_ROLE_KEY`.
- Give n8n one dedicated `GENESIS_AUTOMATION_API_KEY` bearer token.
- Keep `BLOTATO_LIVE_PUBLISHING_ENABLED=false` during integration testing.
- Event payloads contain identifiers and state transitions only. They exclude
  draft bodies, review comments, staff emails, media URLs, and secrets.
- A failed n8n run leaves the event lease to expire so another run can claim it.

## Production setup

1. Generate a token locally:

   ```bash
   openssl rand -hex 32
   ```

2. In Vercel, add `GENESIS_AUTOMATION_API_KEY` to the Production environment.
   Redeploy Genesis after saving it.
3. In n8n, create a Header Auth credential:
   - Header name: `Authorization`
   - Header value: `Bearer <the same token>`
4. Apply the Supabase migration with `npm run db:push` against the production
   project before activating the workflow.

## Read-only HTTP contract

All responses are JSON. Every request needs the bearer credential above.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/automation/v1/status` | Compact operational snapshot for Awo context. |
| `POST` | `/api/automation/v1/events/claim` | Lease up to 100 undelivered semantic events. |
| `POST` | `/api/automation/v1/events/{eventId}/ack` | Mark one leased event delivered. |

Claim body:

```json
{ "consumer": "n8n-awo-production", "limit": 25, "leaseSeconds": 60 }
```

Acknowledgement body:

```json
{ "consumer": "n8n-awo-production", "leaseToken": "<token returned by claim>" }
```

The claim endpoint uses PostgreSQL `FOR UPDATE SKIP LOCKED`. Multiple n8n
executions cannot claim the same event concurrently. Acknowledgement succeeds
only for the consumer and unexpired lease token returned by the claim.

## Recommended n8n workflow

Run every minute:

1. **HTTP Request — Claim events:** POST the claim body above.
2. **If — Events exist:** stop successfully when the array is empty.
3. **HTTP Request — Status:** GET the status endpoint once for current context.
4. **Awo analysis:** send the semantic events and compact snapshot to Awo.
5. **Persist recommendation:** initially store or notify through n8n's normal
   tools; do not call a Genesis mutation endpoint because none exists.
6. **HTTP Request — Acknowledge:** acknowledge each event only after the Awo
   step and its destination have succeeded.

Use the stable production origin, `https://villiz-genesis.vercel.app`, for all
three requests. Preview deployment authentication is intentionally unsupported.

## Smoke test

1. Keep live Blotato publishing false.
2. Submit or approve a test draft, or queue a simulated publish in Genesis.
3. Run the n8n workflow manually.
4. Confirm the claim returns a `review.*` or `publishing.*` event.
5. Confirm Awo receives only the expected identifiers/state fields.
6. Confirm acknowledgement returns `{ "acknowledged": true }`.
7. Run the workflow again and confirm the acknowledged event is absent.

An invalid/missing token returns `401`; an unconfigured Vercel gateway returns
`503`; malformed bodies return `400`. No case grants a write path into Genesis.
