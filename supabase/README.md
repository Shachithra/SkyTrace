# SkyTrace × Supabase (optional)

Guest mode needs none of this. Set it up only if you want accounts, cross-device sync and server push alerts.

## 1. Project and schema

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-ref>
supabase db push            # applies migrations/20261001000000_skytrace_v2.sql
```

The migration creates these tables, all with **Row Level Security**:

- **Per-user tables** (users can read and write only their own rows): `users`, `saved_satellites`, `saved_locations`, `observation_history`, `trace_history`, `pass_alerts` and `notification_preferences`.
- **Public read-only tables**: `satellite_metadata` and `dataset_versions`.
- **Server-only tables**: `push_subscriptions`, `sent_alerts` and `function_calls` (rate limiting).

## 2. Auth

In **Authentication → Providers**, enable the Email provider (magic link). Add your site URL, for example `https://skytrace-seven.vercel.app`, under **URL Configuration**.

## 3. Front-end environment (Vercel → Project → Settings → Environment Variables)

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_VAPID_PUBLIC_KEY=<VAPID public key>     # only for push
```

Only the **anon** key goes to the browser. Never put the service-role key in `VITE_*` variables.

## 4. Push alerts (optional)

```bash
npx web-push generate-vapid-keys
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com CRON_SECRET=$(openssl rand -hex 24)
supabase functions deploy push-subscribe
supabase functions deploy send-pass-alerts
```

Then enable `pg_cron` and `pg_net`. Store `project_url` and `cron_secret` in Vault, and run the `cron.schedule(...)` block at the end of the migration.

Server push only works for alerts tied to a **saved location**, because the server never receives your live position. Alerts set for "current location" are delivered locally by the app instead.
