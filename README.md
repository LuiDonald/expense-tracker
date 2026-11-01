# Expenses

A **private** expense tracker — a cross-platform (iOS / Android / web) app built
with [Expo](https://expo.dev) and [Supabase](https://supabase.com), modeled on
the same stack as the Recipe app. You log expenses from a **photo of a receipt**
(or a gas-station sales screen), browse them by **month**, and see a **monthly
category breakdown** plus an all-time **Categories** view. Your agent **Muse**
can also log expenses for you — just send it a receipt photo in chat.

The app supports **multiple private accounts** (e.g. two spouses). Each person
picks who they are, unlocks with **their own passcode**, and sees **only their
own expenses** — enforced by Supabase Row Level Security (not just hidden
buttons). A correct passcode mints that user's real session.

## Features

- 🧾 **Expenses by month** — a month switcher, the month's total, and expenses
  grouped by category (merchant, category, date, amount).
- 📊 **Monthly breakdown** — per-category totals with bars + an all-months
  overview.
- 🏷️ **Categories tab** — all-time totals per category; tap one to see every
  expense in it, grouped by month.
- ✨ **Scan a receipt** — snap/attach a receipt photo and AI fills in merchant,
  amount, date, and a category for you to confirm.
- 🤖 **Muse can log for you** — send a receipt photo to your agent; it reads it
  and logs the expense via a secure token API (see [Let Muse log expenses](#let-muse-log-expenses-agent-api)).
- 🔐 **Passcode lock** — set a passcode on first run (confirmed by a one-time
  email), then just type it to unlock. Data stays owner-only via RLS.
- 📱 **One codebase** for native and web via `expo-router`.

## Tech stack

| Layer    | Choice |
|----------|--------|
| App      | Expo (React Native) + `expo-router`, TypeScript (strict) |
| Backend  | Supabase (Postgres + Storage + Auth + Edge Functions) |
| Auth     | Passcode gate → owner session (first-time setup via email magic-link) |
| AI       | OpenAI vision (`gpt-4o-mini`) via a Supabase Edge Function |
| Hosting  | Web front-end on **EAS Hosting**; native via EAS Build (optional) |

## Project structure

```
app/                      # Screens (expo-router file-based routes)
  (tabs)/_layout.tsx      #   Tab bar, wrapped in the passcode <LockGate>
  (tabs)/index.tsx        #   Expenses, grouped by month then category
  (tabs)/insights.tsx     #   Monthly breakdown (category bars + all months)
  (tabs)/categories.tsx   #   All-time totals per category
  (tabs)/account.tsx      #   Signed-in account: change passcode / log out
  category/[name].tsx     #   One category's expenses, grouped by month
  expense/[id].tsx        #   Expense detail (+ receipt photo)
  edit/[id].tsx           #   Create / edit form with "Scan receipt"
src/
  data/                   # expenseStore (observable repo), categories, mock data
  lib/                    # supabase, auth, passcode, storage, theme, format, parseReceipt
  types/                  # Expense model
  components/             # LockGate (passcode gate), DialogHost, Locked (legacy)
supabase/
  schema.sql              # Table, indexes, owner-only RLS, storage bucket
  schema-passcode.sql     # Re-lock to owner-only + create the app_lock passcode store
  schema-open.sql         # TEMP: open everything up for login-less testing
  functions/parse-receipt # Edge fn: receipt photo -> expense fields (in-app Scan)
  functions/agent-api     # Edge fn: bearer-token CRUD so Muse can log
  functions/passcode      # Edge fn: passcode status / set / verify (mints owner session)
```

## Users (multi-account)

Allowed accounts live in three places that must agree:

- App: `EXPO_PUBLIC_APP_USERS` = `email:Name,email2:Name2` (in `.env`)
- Functions: the `OWNER_USERS` secret (same format) + `OWNER_EMAILS`
- Database: the email list in `supabase/schema-multiuser.sql` (storage policies)

Each user owns their rows (`expenses.user_id = auth.uid()`) and has their own
row in `user_passcode`. To **add a person**: create their Supabase auth user,
add them to those three lists, run the storage-policy part of
`schema-multiuser.sql`, and redeploy the functions + web build. Muse's
`agent-api` logs for one user, set by the `AGENT_USER_ID` secret.

## How the passcode lock works

1. **First run** for each user: on the **"Who's this?"** screen pick your name,
   then (if you have no passcode yet) tap **"Email me a link"**, open the
   one-time link on the device, and **choose a passcode**.
2. **Every run after:** open the app, type your passcode, you're in. The session
   persists, so you stay unlocked until you log out.
3. **Change it:** Account tab → **Change passcode**.
4. **Forgot it:** on the passcode screen tap **"Forgot? Use email instead"** → a
   one-time email link → set a new passcode.

Under the hood: the passcode hash (PBKDF2-SHA256 + per-record salt, 5-attempt
lockout) lives in the `app_lock` table, which has RLS on and **no policies**, so
only the `passcode` Edge Function (service role) can touch it — the hash is never
sent to the browser. On a correct passcode the function returns a one-time
magic-link token that the app redeems into a real **owner** session, which is
what satisfies the owner-only RLS on `expenses`.

## Getting started

### 1. Install

```bash
npm install
```

### 2. Run in demo mode (no backend needed)

```bash
npm start        # dev server (press w for web, i for iOS, a for Android)
```

Without Supabase values the app runs on **in-memory sample data** so you can try
the UI immediately (no passcode gate in demo mode).

### 3. Configure the backend

Copy the template and fill in your Supabase values (**Project Settings → API**):

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
EXPO_PUBLIC_OWNER_EMAIL=you@example.com   # the ONLY account with access
```

> This project reuses the **Recipe app's** Supabase project, so the shared
> secrets (`OPENAI_API_KEY`, `OWNER_EMAIL`, service keys) were already set.

### 4. Set up the database

In **SQL Editor → New query**, run (replace `donaldtlui@gmail.com` with your
owner email, lowercase, if you fork this):

- [`supabase/schema.sql`](supabase/schema.sql) — the `expenses` table, indexes,
  owner-only RLS, and the `receipt-photos` bucket, **then**
- [`supabase/schema-passcode.sql`](supabase/schema-passcode.sql) — the
  `app_lock` passcode store (and it re-asserts the owner-only policies).

Also make sure the owner user exists (**Authentication → Users**), email sign-in
is enabled, new sign-ups are disabled, and your app URL is in **Authentication →
URL Configuration → Redirect URLs**.

### 5. Deploy the Edge Functions

```bash
export SUPABASE_ACCESS_TOKEN=<a Supabase access token>
REF=<your-project-ref>

# receipt scanning (owner-gated); uses gpt-4o-mini via RECEIPT_MODEL
supabase secrets set REQUIRE_OWNER=true RECEIPT_MODEL=gpt-4o-mini --project-ref $REF
supabase functions deploy parse-receipt --project-ref $REF --no-verify-jwt

# passcode gate
supabase functions deploy passcode --project-ref $REF --no-verify-jwt

# Muse's API (token-based)
supabase secrets set EXPENSE_AGENT_TOKEN=$(openssl rand -hex 32) --project-ref $REF
supabase functions deploy agent-api --project-ref $REF --no-verify-jwt
```

### 6. Run / deploy the front-end

```bash
npm start                                   # local dev
# or publish the web build to EAS Hosting:
npx expo export --platform web
npx eas-cli deploy --prod
```

The deployed app lives at **https://luidonalds-team-expense.expo.app**.

## Scan a receipt (in-app AI)

The **New Expense** form has a **Scan receipt** button. It sends the photo to the
`parse-receipt` Edge Function (OpenAI vision, `gpt-4o-mini` by default) and fills
in merchant / amount / date / category for you to review.

- `RECEIPT_MODEL` secret — the model receipts use (defaults to `gpt-4o-mini`;
  kept separate from Recipe's shared `OPENAI_MODEL` so the two apps don't affect
  each other).
- `REQUIRE_OWNER` secret — `true` requires a signed-in owner (normal); set
  `false` only for open testing.

## Let Muse log expenses (agent-api)

So you can just **send a receipt photo to Muse** and have it logged. Muse uses a
dedicated bearer token (`EXPENSE_AGENT_TOKEN`), independent of the Recipe app.

Base URL: `https://<project>.supabase.co/functions/v1/agent-api`
Header on every call: `Authorization: Bearer <EXPENSE_AGENT_TOKEN>`

| Method | Path | Purpose |
|--------|------|---------|
| `GET`    | `/expenses` | list / filter (`?month=&category=&limit=&offset=`) |
| `POST`   | `/expenses` | create — `{merchant, amount, category, date, note, photoUrl?}` |
| `GET`    | `/expenses/summary?month=YYYY-MM` | month total + category breakdown |
| `GET`    | `/expenses/:id` | one expense |
| `PATCH`  | `/expenses/:id` | update |
| `DELETE` | `/expenses/:id` | delete |

Dates are `YYYY-MM-DD`; amount is a number. A standing instruction for Muse:

> When I send you a photo of a receipt, read the merchant, total amount, date,
> and a category, then `POST` it to my expense API at
> `https://<project>.supabase.co/functions/v1/agent-api/expenses` with header
> `Authorization: Bearer <EXPENSE_AGENT_TOKEN>` and a JSON body
> `{ "merchant", "amount", "date": "YYYY-MM-DD", "category", "note" }`.
> Then confirm the amount, merchant, and category back to me.

See [`supabase/functions/agent-api/README.md`](supabase/functions/agent-api/README.md)
for full details. Muse's API bypasses RLS via the service role, so it keeps
working regardless of the passcode lock.

## Open mode vs. locked (toggles)

For quick testing you can run the app with **no login** at all, then re-lock it.
Each layer has one switch:

| | Open (testing) | Locked (passcode) |
|---|---|---|
| App | `REQUIRE_LOGIN = false` in `src/lib/auth.ts` | `REQUIRE_LOGIN = true` |
| Database | run `supabase/schema-open.sql` | run `supabase/schema-passcode.sql` |
| Receipt scan | `REQUIRE_OWNER=false` secret | `REQUIRE_OWNER=true` secret |

After flipping the app flag, rebuild + redeploy the web front-end. ⚠️ In open
mode anyone with the URL can read/write your expenses and trigger paid OpenAI
scans — use it only briefly.

## Refining categories later

Edit the one list in [`src/data/categories.ts`](src/data/categories.ts) (name +
emoji). The `parse-receipt` and `agent-api` functions keep a matching list —
update those two arrays too so AI/agent suggestions stay in sync. Custom
categories not in the list still work; they just fall back to the 📁 icon.
