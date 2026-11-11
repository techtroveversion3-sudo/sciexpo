# Science Expo 2026

Single-page registration website with an integrated admin dashboard for Science Expo 2026.

## Requirements

- Node.js 20.19+ or 22.12+
- A Supabase project

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste in [`supabase_setup.sql`](supabase_setup.sql), and run it.
3. Open **Project Settings**, then **API**, and copy the project URL and publishable key. Never use a service-role or secret key in this website.
4. Create a `.env` file in this folder based on [`.env.example`](.env.example):

   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
   ```

5. In **Authentication → Providers**, enable Google and add the Google OAuth client ID and secret from Google Cloud. In Google Cloud, set these values:

   - Authorized JavaScript origins: `http://localhost:5173`, `http://127.0.0.1:5173`, and your deployed website origin (for example, `https://your-domain.example`)
   - Authorized redirect URI: `https://muapudkguodnljykjudt.supabase.co/auth/v1/callback`

   In **Authentication → URL Configuration**, set the site URL to your deployed website origin and allow the participant and admin sign-in return URLs for your local and deployed sites. Google redirects to Supabase first, then Supabase returns users to the page where they started sign-in. The dashboard route is not an access-control mechanism; access is enforced by the admin role and Supabase row-level security.

6. Google sign-in creates a Supabase user, but does not automatically grant admin access. After the first sign-in, run this in the Supabase SQL Editor, replacing the email with the exact administrator email:

   ```sql
   UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   WHERE email = 'admin@example.com';
   ```

   Sign out and sign in again so the user's refreshed token includes the admin role. Only assign this role to trusted administrators; participant accounts do not need the admin role. Row Level Security permits admins to read and update registrations. Participants must sign in with Google before submitting; the database verifies the Google provider and that its account email matches the team leader email. Anonymous visitors cannot submit or read registrations.

7. Re-run [`supabase_setup.sql`](supabase_setup.sql) when updating an existing project. Admins can update participant details and add team members up to the four-person limit.

## Registration email delivery

Email delivery uses a Supabase queue and Edge Function with the Gmail API. It does not send from the website or expose Google credentials to participants. A registration adds exactly one email job: the team leader's address. Team members never receive registration email. The default confirmation subject is `Science Expo 2026 registration successful`; the message confirms registration for Science Expo at SIMATS Engineering, gives the event date (20 November 2026) and registration code, and lists team member names. For an individual registration, it identifies the participation as individual.

The worker enforces a maximum of 15 team-leader emails per batch, at least 5 minutes between batches, and a daily cap of 100 team-leader email attempts. It sends messages one at a time, waits about 1.1 seconds between API calls, and uses bounded retries with increasing delays. Retries count against the daily cap. After a batch with at least one successful leader delivery, it sends one copy of that leader's participant-style message to `gsuvedhan@gmail.com`. The verification copy is additional to the 100-leader daily cap.

These safeguards reduce bursts but cannot guarantee Gmail will not restrict an account. Send only transactional registration confirmations to people who supplied their addresses; do not use this system for unsolicited or promotional mail.

Existing registrations are not automatically added to the queue. Only registrations created after the email queue trigger is installed are queued; this avoids unexpectedly sending a backlog of messages. If an earlier setup already queued messages to team members, rerunning the SQL marks their unsent jobs as failed so they will not be sent. Rerunning the SQL also updates pending leader emails with the team-member names for their confirmation.

1. Enable the Gmail API in Google Cloud for the project that owns the sender account `techtroveversion3@gmail.com`. Create a Web application OAuth client and add `https://developers.google.com/oauthplayground` as an authorized redirect URI. In OAuth Playground settings, select **Use your own OAuth credentials**, enter that client ID and secret, authorize the `https://www.googleapis.com/auth/gmail.send` scope while signed in as `techtroveversion3@gmail.com`, and exchange the code for a refresh token. The Supabase Google sign-in configuration is separate from this Gmail API authorization. Store credentials only as Supabase Edge Function secrets; never add them to `.env`, the website, or this repository. Google may require OAuth app verification for external use, and refresh tokens from an app left in external testing can expire.
2. Deploy the worker from this directory using the Supabase CLI:

   ```powershell
   supabase functions deploy send-registration-emails --project-ref muapudkguodnljykjudt
   ```

3. In the Supabase Dashboard, open **Edge Functions → Secrets** and add:

   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`
   - `GMAIL_SENDER_EMAIL` = `techtroveversion3@gmail.com`
   - `EMAIL_MONITOR_ADDRESS` = `gsuvedhan@gmail.com`
   - `EMAIL_WORKER_SECRET` = a unique random value. Generate one locally, for example with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Use the same value in the next step.
   - `REGISTRATION_EMAIL_SUBJECT` and `REGISTRATION_EMAIL_BODY` are optional overrides for the built-in confirmation. The body supports `{{name}}`, `{{registration_code}}`, `{{participation}}`, and `{{team_details}}`.

   Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Do not copy the service-role key into the website or expose it to participants.

4. In the Supabase **SQL Editor**, run this once to store the worker URL and shared secret in Vault. Replace the placeholder secret with the same random value configured above:

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_cron;
   CREATE EXTENSION IF NOT EXISTS pg_net;

   SELECT vault.create_secret(
     'https://muapudkguodnljykjudt.supabase.co/functions/v1/send-registration-emails',
     'science_expo_email_worker_url'
   );
   SELECT vault.create_secret(
     'PASTE_THE_SAME_RANDOM_EMAIL_WORKER_SECRET_HERE',
     'science_expo_email_worker_secret'
   );
   ```

5. After setting both Vault secrets, schedule the worker every five minutes. Run this once:

   ```sql
   SELECT cron.schedule(
     'science-expo-email-worker',
     '*/5 * * * *',
     $$
     SELECT net.http_post(
       url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'science_expo_email_worker_url'),
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-worker-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'science_expo_email_worker_secret')
       ),
       body := '{}'::jsonb
     );
     $$
   );
   ```

   The queue, batch-size limit, daily cap, retry handling, and five-minute interval are also enforced in the database. If you rerun the schedule command, remove the existing cron job first to avoid duplicate schedules.

   To inspect delivery batches in SQL Editor:

   ```sql
   SELECT started_at, participant_count, status, verification_sent_at, last_error
   FROM public.registration_email_batches
   ORDER BY started_at DESC
   LIMIT 20;
   ```

The built-in email content is ready. Email delivery itself remains inactive until Gmail OAuth credentials are added, the Edge Function is deployed, and the Vault-backed schedule is configured.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The admin dashboard is part of the same React application. During development it opens with fictional sample registrations; you can try the tabs, edit a sample registration, and add team members. Preview changes stay in memory only and never read live participant data. Production admin access requires Supabase authentication.

## Build and deploy

```bash
npm run build
npm run preview
```

Deploy the contents of `dist/` to Vercel and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in its build settings. The Vercel rewrite serves the same React application for the dashboard URL; add the dashboard sign-in return URL to Supabase's redirect URL allow list.

## Registration data

Every registration's team leader signs in with Google, and the leader Gmail field is filled from that account and cannot be edited. The database checks that the authenticated Google email matches the leader email. Team members enter a name, Gmail address, and phone number; external participants also enter their college name. Internal participants are listed under Saveetha Institute of Medical And Technical Science and enter their register number. The form does not ask for project details. Entries can be individual or teams of two to four people, including the leader. The database generates a unique registration code for each submission. Confirmation emails go only to the team leader.
