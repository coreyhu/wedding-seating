# Deploy runbook

One-time setup to take this from local dev to a live URL guests can scan into,
plus the loop you'll re-run whenever the floorplan or guest list changes.

## 1. Create the hosted Supabase project

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a new project
   (pick a region close to the venue/guests). Note the **project ref** (the
   `<ref>` in `https://<ref>.supabase.co`).
2. Link the local repo to it and push the schema (first time only: run
   `supabase login` before `link` — it opens a browser to authorize the CLI):

   ```sh
   supabase link --project-ref <ref>
   supabase db push
   ```

   This applies `supabase/migrations/0001_init.sql` — tables, RLS policies,
   `is_admin()`, and the write RPCs (`assign_seat`, `unseat`, `import_guests`,
   `search_guests`).

3. Open the hosted **SQL Editor** and run **only the `tables` insert** from
   `supabase/seed.sql` — the twelve `Table 1`…`Table 12` rows. **Do not run the
   `guests` insert** in that file; those nine rows (Carol Zhao, Kevin Hu, …)
   are local dev fixtures, not real guests. Copy just this statement in:

   ```sql
   insert into tables (table_no, label_en, label_zh)
   select n, format('Table %s', n), format('%s号桌', n) from generate_series(1, 12) n;
   ```

   (Adjust `12` to the real table count if it's changed since `0001_init.sql`
   was written.)

## 2. Lock down auth

The hosted project starts with public signups **on** — anyone who finds the
URL could otherwise create an account. Before adding the real host user:

1. Dashboard → **Authentication → Providers/Settings** → **disable "Allow new
   users to sign up"** (public signups off). This mirrors the local
   `[auth] enable_signup = false` in `supabase/config.toml`.

2. **Do not also disable the Email provider.** `supabase/config.toml` has a
   comment on `[auth.email]` explaining the trap: `enable_signup` under
   `[auth.email]` maps to GoTrue's `EXTERNAL_EMAIL_ENABLED`, which gates
   email **sign-in**, not just signup — turning it off locks out the host
   entirely. The signup gate that matters is the top-level `[auth]
   enable_signup`; leave the Email provider itself **enabled**.

3. Dashboard → **Authentication → Users → Add user** — create the one real
   host account (email + password). This is the only login the app will
   ever need; there's no self-serve signup.

4. Copy that user's UUID (shown in the Users table), then in the SQL Editor:

   ```sql
   insert into admins (user_id) values ('<that user''s uuid>');
   ```

   Every write RPC (`assign_seat`, `unseat`, `import_guests`) checks
   `is_admin()` against this table. Skip this step and the host page loads
   fine but every assign/move/swap/import fails with `not authorized`.

## 3. Deploy to Netlify

1. Netlify → **Add new site → Import an existing project** → pick this repo.
   `netlify.toml` already sets the build command (`npm run build`) and
   publish directory (`dist`), so the defaults Netlify shows should match.
2. Site settings → **Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   Get both from the hosted project's **Settings → API** page (not from
   `.env.local` — that file is gitignored and only has the local `supabase
   status` values, e.g. `127.0.0.1:54321`).

   ⚠️ Vite bakes `VITE_*` values in at **build** time, and Netlify usually
   auto-builds the moment you import the repo — likely *before* you set these
   vars. If that happened, trigger a fresh build after setting them
   (**Deploys → Trigger deploy → Clear cache and deploy site**), or the site
   ships with blank Supabase config and every search fails.
3. Deploy. Confirm both `/` (guest search) and `/host.html` (host login)
   load on the live URL, and that host login with the account from step 2.3
   works.
4. Generate the QR code guests will scan:

   ```sh
   npm run qr -- https://<your-site>.netlify.app
   ```

   This writes `qr.png` (1200px, for print). It's gitignored — regenerate it
   any time the URL changes rather than committing it.

## 4. Day-before checklist

- [ ] Real floorplan is through the SVG pipeline: `npm run svg` has been run
      against the actual venue export (see the floorplan loop below), and
      `src/generated/floorplan.svg` / `seatmap.json` reflect it — not the
      dev placeholder.
- [ ] Real guest CSV imported via the host page's Import panel (not the
      `seed.sql` sample rows). **Check the counts:** the toast's imported
      number should equal your CSV's row count. Guests are deduplicated by
      the exact (English, Chinese) name pair, so on a first import into an
      empty table, any "already existed" count > 0 means your sheet contains
      two guests with identical names — the second one is silently dropped
      and can't be seated. Disambiguate in the sheet (e.g. "Wang Wei (uncle)")
      and re-import. Note there is no in-app edit/delete; fixing a typo means
      correcting the sheet and re-importing (which adds the corrected name as
      a new unseated guest — unseat/ignore the old row via SQL if needed).
- [ ] Spot-check 3 guests from a phone: open the live guest URL, search each
      by name (try one in Chinese), confirm the right seat highlights.

## Floorplan re-export loop (for future edits, e.g. Task 14)

Whenever the venue layout changes:

1. Edit the layout in Affinity Designer (`seating_affinity.af`).
2. Export to SVG from Affinity, overwriting `seating_affinity.svg`.
3. Copy it into place and re-run the SVG pipeline:

   ```sh
   cp seating_affinity.svg assets/floorplan/venue.svg
   npm run svg
   ```

   `npm run svg` reads `assets/floorplan/venue.svg`, recompresses any
   embedded JPEG, and writes `src/generated/floorplan.svg` +
   `src/generated/seatmap.json`.

4. **Diff guard:** by default the script diffs the new seat map against the
   previously committed `src/generated/seatmap.json`. If any seat moved more
   than ~25 svg units or disappeared, it throws instead of writing — that
   protects existing guest assignments from silently scrambling on an
   accidental Affinity export change. If the layout change is real (tables
   moved/added/removed on purpose), pass `--force` to accept the new
   positions:

   ```sh
   npm run svg -- --force
   ```

5. Re-run `npm run test` after any re-export — the seatmap feeds the guest
   highlight logic and host click-to-assign, and the test suite catches
   drift early.
