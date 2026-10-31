# agent-api

A bearer-token-protected HTTP API over the `expenses` table, so an AI assistant
(e.g. **Muse**) can log and review your expenses. The typical flow:

1. You send Muse a photo of a receipt (or a gas-station sales screen) in chat.
2. Muse reads the merchant / total / date / category from the image.
3. Muse calls `POST /expenses` here with those fields — and it shows up in the
   app instantly.

## Setup

1. **Schema** — run [`../../schema.sql`](../../schema.sql) in the Supabase SQL
   Editor (creates the `expenses` table + storage bucket).
2. **Secret** — set a long random bearer token:
   ```bash
   openssl rand -hex 32
   supabase secrets set AGENT_API_TOKEN=<that value> --project-ref <ref>
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
3. **Deploy with JWT verification OFF** (we use our own bearer token):
   ```bash
   supabase functions deploy agent-api --no-verify-jwt --project-ref <ref>
   ```

## Auth

Every request must send `Authorization: Bearer <AGENT_API_TOKEN>`.
Missing/incorrect → `401`.

## Endpoints

Base: `https://<project>.supabase.co/functions/v1/agent-api`

| Method | Path | Purpose |
|---|---|---|
| GET | `/expenses?month=YYYY-MM&category=&from=&to=&q=&limit=&offset=` | list / filter (returns `data`, `pagination`, and `sum`) |
| GET | `/expenses/summary?month=YYYY-MM` | month total + per-category breakdown |
| GET | `/expenses/:id` | one expense |
| POST | `/expenses` | create (log) an expense |
| PATCH | `/expenses/:id` | update fields |
| DELETE | `/expenses/:id` | delete an expense |

### Expense shape

```json
{
  "merchant": "Costco",
  "amount": 182.44,
  "category": "Groceries",
  "date": "2026-10-31",
  "note": "weekly shop",
  "photoUrl": null
}
```

- `amount` is a number (dollars). Required on create and must be > 0.
- `date` is `"YYYY-MM-DD"`. Optional on create (defaults to today).
- `category` is normalized to the app's known set when it matches (case-insensitive),
  otherwise a custom category is stored as-is.
- `note` and `photoUrl` are optional.

### Examples

Log an expense:
```bash
curl -X POST "https://<project>.supabase.co/functions/v1/agent-api/expenses" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"merchant":"Shell","amount":54.10,"category":"Gas","date":"2026-10-31","note":"gallons: 12.3"}'
```

This month's breakdown:
```bash
curl "https://<project>.supabase.co/functions/v1/agent-api/expenses/summary?month=2026-10" \
  -H "Authorization: Bearer $AGENT_API_TOKEN"
```

## Notes

- Deletes are **hard** (the row is removed). There's no soft-delete here.
- The function uses the service_role key, so it bypasses Row Level Security —
  the bearer token is the only thing standing between the world and your data.
  **Keep `AGENT_API_TOKEN` secret**, and rotate it with `supabase secrets set`
  if it ever leaks.
