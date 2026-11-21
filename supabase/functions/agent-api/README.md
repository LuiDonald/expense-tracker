# agent-api

A bearer-token-protected HTTP API over the `expenses` table, so an AI assistant
(e.g. **Muse**) can log and review your expenses. The typical flow:

1. You send Muse a photo of a receipt (or a gas-station sales screen) in chat.
2. Muse reads the merchant / total / date / category from the image.
3. Muse calls `POST /expenses` here with those fields — and it shows up in the
   app instantly.

## Setup

1. **Schema**: run [`../../schema-fresh.sql`](../../schema-fresh.sql) in the
   Supabase SQL Editor (creates the `expenses` table + storage bucket).
2. **Secret**: give each person their own long random token, mapped to their
   login email (or auth user id), as `token:email` pairs separated by commas:
   ```bash
   T1=$(openssl rand -hex 32); T2=$(openssl rand -hex 32)
   echo "you: $T1"; echo "partner: $T2"   # save these: Supabase can't show them again
   supabase secrets set AGENT_TOKENS="$T1:you@example.com,$T2:partner@example.com" \
     --project-ref <ref>
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
   The older single-user form, `EXPENSE_AGENT_TOKEN` (or `AGENT_API_TOKEN`) plus
   `AGENT_USER_ID`, is still honored and merged in as one more entry.
3. **Deploy with JWT verification OFF** (we use our own bearer token):
   ```bash
   supabase functions deploy agent-api --no-verify-jwt --project-ref <ref>
   ```

## Auth

Every request must send `Authorization: Bearer <token>`.
Missing/incorrect → `401`.

The token decides **whose** expenses the request can see and change. Every
query is scoped to that token's user, so one person's token can't read, edit,
or delete the other's expenses (another user's expense id returns `404`).

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
  -H "Authorization: Bearer $MY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"merchant":"Shell","amount":54.10,"category":"Gas","date":"2026-10-31","note":"gallons: 12.3"}'
```

This month's breakdown:
```bash
curl "https://<project>.supabase.co/functions/v1/agent-api/expenses/summary?month=2026-10" \
  -H "Authorization: Bearer $MY_TOKEN"
```

## Notes

- Deletes are **hard** (the row is removed). There's no soft-delete here.
- The function uses the service_role key, so it bypasses Row Level Security —
  the bearer token is the only thing standing between the world and your data.
  **Keep each token secret.** If one leaks, replace just that entry in
  `AGENT_TOKENS` with a new token (`supabase secrets set`), then update that
  person's Muse.
