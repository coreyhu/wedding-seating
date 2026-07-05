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

   This applies all of `supabase/migrations/` — tables, RLS policies,
   `is_admin()`, and the write RPCs (`assign_seat`, `unseat`, `import_seating`,
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

   Every write RPC (`assign_seat`, `unseat`, `import_seating`) checks
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
- [ ] Real seating matrix imported via the host page's Import panel (not the
      `seed.sql` sample rows): export the Google Sheet as CSV — the whole
      sheet (row 1 = the 12 table names, each column below a table, each row
      a seat) — and paste the entire thing into the panel, not just a range.
      The preview must show **12 tables** and the guest count you expect from
      the sheet before the Import button enables. If the panel shows errors
      instead (wrong header count, a column with more than 8 guests, an
      in-sheet duplicate name), the list explains what to fix — correct the
      Sheet and re-paste; the button stays disabled until `errors` is empty.
      Import is **full-replace**: whatever the sheet says becomes the seating
      truth on every import, so re-import any time the sheet changes — but
      note any table renames or seat moves made on the host map since the
      last import are overwritten by design (the sheet wins), so do map
      touch-ups *after* the last import of the day, not before. Guests absent
      from the sheet are unseated, never deleted. After importing, spot-check
      one guest from each side of the room to confirm they land correctly.
- [ ] After the final import, glance at the host page's unseated list and the
      preview's new-guest count — the parser can't tell a real guest from
      sheet noise (e.g. `Kevin Hu +1`, truncated `<Visa Pend…` cells), so
      noise imports as real seated guests; clean the Sheet, not the app.

## Testing from a phone (dev)

The map now supports pinch-to-zoom and one-finger pan on touch devices — to
try it on an actual phone against your local dev server instead of waiting
for a deploy:

1. Start Vite bound to all interfaces, not just localhost:

   ```sh
   npx vite --host
   ```

2. Find your Mac's LAN IP: `ipconfig getifaddr en0`. On the phone,
   `127.0.0.1` means "the phone itself," so `.env.local`'s
   `VITE_SUPABASE_URL` needs to point at that LAN IP (not `127.0.0.1`) or the
   phone can't reach your local Supabase — e.g.
   `VITE_SUPABASE_URL=http://192.168.1.23:54321`. Restart Vite after editing
   `.env.local` so the new value is picked up.
3. Make sure the phone and the Mac are on the **same Wi-Fi network**.
4. Generate a QR code for the LAN URL so you don't have to type it on the
   phone's keyboard:

   ```sh
   npm run qr -- http://<lan-ip>:5173
   ```

   Scan `qr.png` with the phone's camera to open the page directly.

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
