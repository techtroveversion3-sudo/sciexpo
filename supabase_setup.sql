-- Science Expo 2026 registration schema
-- Run in Supabase Dashboard > SQL Editor. Safe to re-run for this project's schema.

CREATE SEQUENCE IF NOT EXISTS public.registration_code_seq;

CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_code TEXT UNIQUE NOT NULL,
  participation_type TEXT NOT NULL CHECK (participation_type IN ('internal', 'external')),
  team_or_solo TEXT NOT NULL CHECK (team_or_solo IN ('solo', 'team')),
  team_name TEXT NOT NULL,
  team_size INTEGER NOT NULL CHECK (team_size BETWEEN 1 AND 4),
  category TEXT,
  project_title TEXT,
  project_description TEXT,
  leader_name TEXT NOT NULL,
  leader_email TEXT NOT NULL,
  leader_phone TEXT NOT NULL,
  leader_reg_number TEXT,
  leader_college TEXT,
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep legacy project fields nullable; the current registration form does not use them.
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS members JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.registrations
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN project_title DROP NOT NULL,
  ALTER COLUMN project_description DROP NOT NULL;

UPDATE public.registrations
SET members = '[]'::jsonb
WHERE members IS NULL;

UPDATE public.registrations
SET leader_college = 'Saveetha Institute of Medical And Technical Science'
WHERE participation_type = 'internal';

ALTER TABLE public.registrations
  DROP CONSTRAINT IF EXISTS registrations_team_size_consistent,
  DROP CONSTRAINT IF EXISTS registrations_participant_type_details,
  DROP CONSTRAINT IF EXISTS registrations_members_array,
  DROP CONSTRAINT IF EXISTS registrations_terms_accepted,
  DROP CONSTRAINT IF EXISTS registrations_leader_details;

ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_members_array
    CHECK (jsonb_typeof(members) = 'array'),
  ADD CONSTRAINT registrations_terms_accepted
    CHECK (terms_accepted = true),
  ADD CONSTRAINT registrations_team_size_consistent
    CHECK (
      CASE
        WHEN jsonb_typeof(members) <> 'array' THEN false
        WHEN team_or_solo = 'solo' THEN team_size = 1 AND jsonb_array_length(members) = 0
        WHEN team_or_solo = 'team' THEN team_size BETWEEN 2 AND 4
          AND jsonb_array_length(members) = team_size - 1
        ELSE false
      END
    ),
  ADD CONSTRAINT registrations_participant_type_details
    CHECK (
      (participation_type = 'internal'
        AND NULLIF(btrim(leader_reg_number), '') IS NOT NULL
        AND leader_college = 'Saveetha Institute of Medical And Technical Science')
      OR
      (participation_type = 'external'
        AND NULLIF(btrim(leader_college), '') IS NOT NULL
        AND leader_reg_number IS NULL)
    ),
  ADD CONSTRAINT registrations_leader_details
    CHECK (
      NULLIF(btrim(leader_name), '') IS NOT NULL
      AND leader_email ~* '^[^[:space:]@]+@gmail[.]com$'
      AND length(regexp_replace(leader_phone, '[^0-9]', '', 'g')) = 10
    );

CREATE INDEX IF NOT EXISTS idx_registrations_type
  ON public.registrations (participation_type);
CREATE INDEX IF NOT EXISTS idx_registrations_created
  ON public.registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_code
  ON public.registrations (registration_code);

-- Continue numbering after existing registrations without risking duplicate codes.
SELECT setval(
  'public.registration_code_seq',
  GREATEST(
    COALESCE((
      SELECT MAX(
        CASE
          WHEN registration_code ~ '^REG-[0-9]+$' THEN SUBSTRING(registration_code FROM 5)::BIGINT
          WHEN registration_code ~ '^SE-[0-9]+$' THEN SUBSTRING(registration_code FROM 4)::BIGINT
        END
      )
      FROM public.registrations
      WHERE registration_code ~ '^(REG|SE)-[0-9]+$'
    ), 0) + 1,
    (
      SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END
      FROM public.registration_code_seq
    )
  ),
  false
);

CREATE OR REPLACE FUNCTION public.prepare_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  member JSONB;
  next_code BIGINT;
  internal_college CONSTANT TEXT := 'Saveetha Institute of Medical And Technical Science';
BEGIN
  IF TG_OP = 'INSERT' THEN
    next_code := nextval('public.registration_code_seq');
    NEW.registration_code :=
      'REG-' || lpad(next_code::TEXT, GREATEST(5, length(next_code::TEXT)), '0');
  END IF;

  IF jsonb_typeof(NEW.members) <> 'array' THEN
    RAISE EXCEPTION 'Team members must be a JSON array';
  END IF;

  IF NEW.team_or_solo = 'solo' AND (NEW.team_size <> 1 OR jsonb_array_length(NEW.members) <> 0) THEN
    RAISE EXCEPTION 'Solo registrations must have exactly one participant';
  ELSIF NEW.team_or_solo = 'team'
    AND (NEW.team_size NOT BETWEEN 2 AND 4 OR jsonb_array_length(NEW.members) <> NEW.team_size - 1) THEN
    RAISE EXCEPTION 'Teams must contain between two and four participants';
  END IF;

  IF NULLIF(btrim(NEW.leader_name), '') IS NULL
    OR NEW.leader_email !~* '^[^[:space:]@]+@gmail[.]com$'
    OR length(regexp_replace(NEW.leader_phone, '[^0-9]', '', 'g')) <> 10 THEN
    RAISE EXCEPTION 'Leader name, Gmail address, and 10 digit phone number are required';
  END IF;

  IF NEW.participation_type = 'internal' THEN
    NEW.leader_college := internal_college;
    IF NULLIF(btrim(NEW.leader_reg_number), '') IS NULL THEN
      RAISE EXCEPTION 'Internal participants must provide a register number';
    END IF;
  ELSIF NEW.participation_type = 'external' THEN
    IF NULLIF(btrim(NEW.leader_college), '') IS NULL OR NEW.leader_reg_number IS NOT NULL THEN
      RAISE EXCEPTION 'External participants must provide a college and no register number';
    END IF;
  ELSE
    RAISE EXCEPTION 'Participation type must be internal or external';
  END IF;

  FOR member IN SELECT value FROM jsonb_array_elements(NEW.members)
  LOOP
    IF jsonb_typeof(member) <> 'object'
      OR NULLIF(btrim(member ->> 'name'), '') IS NULL
      OR COALESCE(member ->> 'email', '') !~* '^[^[:space:]@]+@gmail[.]com$'
      OR length(regexp_replace(COALESCE(member ->> 'phone', ''), '[^0-9]', '', 'g')) <> 10 THEN
      RAISE EXCEPTION 'Each participant must have a name, Gmail address, and 10 digit phone number';
    END IF;

    IF NEW.participation_type = 'internal' THEN
      IF NULLIF(btrim(member ->> 'reg_number'), '') IS NULL
        OR member ->> 'college' IS DISTINCT FROM internal_college THEN
        RAISE EXCEPTION 'Internal team members must provide a register number';
      END IF;
    ELSIF NULLIF(btrim(member ->> 'college'), '') IS NULL
      OR NULLIF(btrim(member ->> 'reg_number'), '') IS NOT NULL THEN
      RAISE EXCEPTION 'External team members must provide a college and no register number';
    END IF;
  END LOOP;

  IF NEW.terms_accepted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Event rules must be accepted';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_registration_code ON public.registrations;
DROP TRIGGER IF EXISTS set_updated_at ON public.registrations;
DROP TRIGGER IF EXISTS prepare_registration ON public.registrations;
CREATE TRIGGER prepare_registration
  BEFORE INSERT OR UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.prepare_registration();

REVOKE ALL ON FUNCTION public.prepare_registration() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registrations FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  participation_type,
  team_or_solo,
  team_name,
  team_size,
  leader_name,
  leader_email,
  leader_phone,
  leader_reg_number,
  leader_college,
  members,
  terms_accepted
) ON TABLE public.registrations TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.registrations TO authenticated;

DROP POLICY IF EXISTS "Allow anonymous reads" ON public.registrations;
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.registrations;
DROP POLICY IF EXISTS "Allow public registration inserts" ON public.registrations;
DROP POLICY IF EXISTS "Authenticated participants can submit registrations" ON public.registrations;
DROP POLICY IF EXISTS "Admins can read registrations" ON public.registrations;
DROP POLICY IF EXISTS "Authenticated admins can read registrations" ON public.registrations;
DROP POLICY IF EXISTS "Authenticated admins can update registrations" ON public.registrations;
DROP POLICY IF EXISTS "Google participants can read own registrations" ON public.registrations;

CREATE POLICY "Authenticated participants can submit registrations"
  ON public.registrations
  FOR INSERT TO authenticated
  WITH CHECK (
    terms_accepted = true
    AND auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
    AND NULLIF(auth.jwt() ->> 'email', '') IS NOT NULL
    AND lower(auth.jwt() ->> 'email') = lower(leader_email)
  );

CREATE POLICY "Google participants can read own registrations"
  ON public.registrations
  FOR SELECT TO authenticated
  USING (
    auth.jwt() -> 'app_metadata' ->> 'provider' = 'google'
    AND NULLIF(auth.jwt() ->> 'email', '') IS NOT NULL
    AND lower(auth.jwt() ->> 'email') = lower(leader_email)
  );

CREATE POLICY "Authenticated admins can read registrations"
  ON public.registrations
  FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE POLICY "Authenticated admins can update registrations"
  ON public.registrations
  FOR UPDATE TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

CREATE TABLE IF NOT EXISTS public.registration_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  registration_code TEXT NOT NULL,
  team_details TEXT NOT NULL DEFAULT 'Individual registration',
  participation TEXT NOT NULL DEFAULT 'Individual',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  manual_batch_id UUID,
  batch_id UUID,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_email_queue_unique_recipient
  ON public.registration_email_queue (registration_id, recipient_email);
CREATE INDEX IF NOT EXISTS idx_registration_email_queue_pending
  ON public.registration_email_queue (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.registration_email_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  participant_count INTEGER NOT NULL CHECK (participant_count BETWEEN 1 AND 15),
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'partial', 'failed')),
  verification_sent_at TIMESTAMPTZ,
  last_error TEXT
);

ALTER TABLE public.registration_email_queue
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS team_details TEXT NOT NULL DEFAULT 'Individual registration',
  ADD COLUMN IF NOT EXISTS participation TEXT NOT NULL DEFAULT 'Individual',
  ADD COLUMN IF NOT EXISTS manual_batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_registration_email_queue_manual_batch
  ON public.registration_email_queue (manual_batch_id, next_attempt_at, created_at)
  WHERE status = 'pending' AND manual_batch_id IS NOT NULL;
ALTER TABLE public.registration_email_queue
  DROP CONSTRAINT IF EXISTS registration_email_queue_batch_id_fkey;
ALTER TABLE public.registration_email_queue
  ADD CONSTRAINT registration_email_queue_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.registration_email_batches(id);

ALTER TABLE public.registration_email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_email_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registration_email_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.registration_email_batches FROM PUBLIC, anon, authenticated;

UPDATE public.registration_email_queue q
SET participation = CASE
      WHEN r.team_or_solo = 'team' THEN 'Team'
      ELSE 'Individual'
    END,
    team_details = CASE
      WHEN r.team_or_solo = 'team' THEN 'Team members: ' || COALESCE((
        SELECT string_agg(member ->> 'name', ', ' ORDER BY member_order)
        FROM jsonb_array_elements(r.members) WITH ORDINALITY AS members(member, member_order)
      ), 'No additional members listed')
      ELSE 'Individual registration'
    END
FROM public.registrations r
WHERE q.registration_id = r.id
  AND lower(q.recipient_email) = lower(r.leader_email);

CREATE OR REPLACE FUNCTION public.enqueue_registration_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.registration_email_queue (
    registration_id,
    participant_name,
    recipient_email,
    registration_code,
    team_details,
    participation
  )
  VALUES (
    NEW.id,
    NEW.leader_name,
    lower(btrim(NEW.leader_email)),
    NEW.registration_code,
    CASE
      WHEN NEW.team_or_solo = 'team' THEN 'Team members: ' || COALESCE((
        SELECT string_agg(member ->> 'name', ', ' ORDER BY member_order)
        FROM jsonb_array_elements(NEW.members) WITH ORDINALITY AS members(member, member_order)
      ), 'No additional members listed')
      ELSE 'Individual registration'
    END,
    CASE WHEN NEW.team_or_solo = 'team' THEN 'Team' ELSE 'Individual' END
  )
  ON CONFLICT (registration_id, recipient_email) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_registration_emails ON public.registrations;
CREATE TRIGGER enqueue_registration_emails
  AFTER INSERT ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_registration_emails();
REVOKE ALL ON FUNCTION public.enqueue_registration_emails() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_enqueue_registration_email(target_registration_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  registration_row public.registrations%ROWTYPE;
  queue_status TEXT;
BEGIN
  SELECT *
  INTO registration_row
  FROM public.registrations
  WHERE id = target_registration_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  INSERT INTO public.registration_email_queue AS existing_queue (
    registration_id,
    participant_name,
    recipient_email,
    registration_code,
    team_details,
    participation,
    manual_batch_id
  )
  VALUES (
    registration_row.id,
    registration_row.leader_name,
    lower(btrim(registration_row.leader_email)),
    registration_row.registration_code,
    CASE
      WHEN registration_row.team_or_solo = 'team' THEN 'Team members: ' || COALESCE((
        SELECT string_agg(member ->> 'name', ', ' ORDER BY member_order)
        FROM jsonb_array_elements(registration_row.members) WITH ORDINALITY AS members(member, member_order)
      ), 'No additional members listed')
      ELSE 'Individual registration'
    END,
    CASE WHEN registration_row.team_or_solo = 'team' THEN 'Team' ELSE 'Individual' END,
    gen_random_uuid()
  )
  ON CONFLICT (registration_id, recipient_email) DO UPDATE
  SET participant_name = EXCLUDED.participant_name,
      registration_code = EXCLUDED.registration_code,
      team_details = EXCLUDED.team_details,
      participation = EXCLUDED.participation,
      manual_batch_id = EXCLUDED.manual_batch_id,
      status = 'pending',
      attempts = 0,
      next_attempt_at = now(),
      batch_id = NULL,
      sent_at = NULL,
      provider_message_id = NULL,
      last_error = NULL,
      created_at = now()
  WHERE existing_queue.status <> 'sending';

  SELECT status
  INTO queue_status
  FROM public.registration_email_queue
  WHERE registration_id = registration_row.id
    AND recipient_email = lower(btrim(registration_row.leader_email));

  IF queue_status = 'sending' THEN
    RETURN jsonb_build_object('status', 'sending');
  END IF;

  RETURN jsonb_build_object('status', 'queued');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enqueue_registration_email(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_registration_email(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_enqueue_registration_email_batch(target_registration_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  manual_batch UUID := gen_random_uuid();
  registration_id_to_queue UUID;
  queued_result JSONB;
  batch_results JSONB := '[]'::jsonb;
BEGIN
  IF target_registration_ids IS NULL
    OR cardinality(target_registration_ids) < 1
    OR cardinality(target_registration_ids) > 15
    OR cardinality(target_registration_ids) <> (
      SELECT count(DISTINCT id) FROM unnest(target_registration_ids) AS ids(id)
    ) THEN
    RAISE EXCEPTION 'A batch must contain 1 to 15 unique registration IDs';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('science-expo-email-queue'));

  FOREACH registration_id_to_queue IN ARRAY target_registration_ids LOOP
    queued_result := public.admin_enqueue_registration_email(registration_id_to_queue);

    IF queued_result ->> 'status' = 'queued' THEN
      UPDATE public.registration_email_queue
      SET manual_batch_id = manual_batch
      WHERE registration_id = registration_id_to_queue
        AND status = 'pending'
        AND recipient_email = (
          SELECT lower(btrim(leader_email))
          FROM public.registrations
          WHERE id = registration_id_to_queue
        );
    END IF;

    batch_results := batch_results || jsonb_build_array(
      queued_result || jsonb_build_object('registration_id', registration_id_to_queue)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'queued',
    'batch_id', manual_batch,
    'results', batch_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_enqueue_registration_email_batch(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_enqueue_registration_email_batch(UUID[]) TO service_role;

-- Cancel any unsent team-member messages from an earlier version of this setup.
UPDATE public.registration_email_queue q
SET status = 'failed',
    last_error = 'Only the team leader receives registration emails'
FROM public.registrations r
WHERE q.registration_id = r.id
  AND lower(q.recipient_email) <> lower(r.leader_email)
  AND q.status IN ('pending', 'sending');

CREATE OR REPLACE FUNCTION public.claim_registration_email_batch()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  new_batch_id UUID;
  manual_group_id UUID;
  batch_limit INTEGER;
  daily_total INTEGER;
  job_rows JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('science-expo-email-queue'));

  UPDATE public.registration_email_queue q
  SET status = CASE WHEN q.attempts >= 3 THEN 'failed' ELSE 'pending' END,
      next_attempt_at = now() + INTERVAL '5 minutes',
      last_error = COALESCE(q.last_error, 'Previous email batch did not finish')
  FROM public.registration_email_batches b
  WHERE q.batch_id = b.id
    AND q.status = 'sending'
    AND b.started_at < now() - INTERVAL '10 minutes';

  UPDATE public.registration_email_batches
  SET status = 'partial',
      last_error = COALESCE(last_error, 'Worker timed out; pending messages will be retried')
  WHERE status = 'sending'
    AND started_at < now() - INTERVAL '10 minutes';

  IF EXISTS (
    SELECT 1
    FROM public.registration_email_batches
    WHERE started_at > now() - INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('status', 'waiting', 'reason', 'batch_interval');
  END IF;

  SELECT COALESCE(SUM(participant_count), 0)::INTEGER
  INTO daily_total
  FROM public.registration_email_batches
  WHERE started_at >= date_trunc('day', now());

  IF daily_total >= 100 THEN
    RETURN jsonb_build_object('status', 'paused', 'reason', 'daily_limit');
  END IF;

  batch_limit := LEAST(15, 100 - daily_total);

  SELECT manual_batch_id
  INTO manual_group_id
  FROM public.registration_email_queue
  WHERE manual_batch_id IS NOT NULL
    AND status = 'pending'
    AND attempts < 3
    AND next_attempt_at <= now()
  ORDER BY created_at, id
  LIMIT 1;

  WITH candidates AS (
    SELECT id
    FROM public.registration_email_queue
    WHERE status = 'pending'
      AND attempts < 3
      AND next_attempt_at <= now()
      AND (
        (manual_group_id IS NOT NULL AND manual_batch_id = manual_group_id)
        OR (manual_group_id IS NULL AND manual_batch_id IS NULL)
      )
    ORDER BY created_at, id
    LIMIT batch_limit
    FOR UPDATE SKIP LOCKED
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.created_at, q.id), '[]'::jsonb)
  INTO job_rows
  FROM public.registration_email_queue q
  JOIN candidates c ON c.id = q.id;

  IF jsonb_array_length(job_rows) = 0 THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  new_batch_id := gen_random_uuid();
  INSERT INTO public.registration_email_batches (id, participant_count)
  VALUES (new_batch_id, jsonb_array_length(job_rows));

  UPDATE public.registration_email_queue
  SET status = 'sending',
      attempts = attempts + 1,
      batch_id = new_batch_id,
      last_error = NULL
  WHERE id IN (
    SELECT (j.job ->> 'id')::UUID
    FROM jsonb_array_elements(job_rows) AS j(job)
  );

  RETURN jsonb_build_object(
    'status', 'claimed',
    'batch_id', new_batch_id,
    'jobs', (
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at, q.id)
      FROM public.registration_email_queue q
      WHERE q.batch_id = new_batch_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_registration_email_job(
  job_id UUID,
  was_sent BOOLEAN,
  gmail_message_id TEXT DEFAULT NULL,
  failure_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.registration_email_queue
  SET status = CASE
        WHEN was_sent THEN 'sent'
        WHEN attempts >= 3 THEN 'failed'
        ELSE 'pending'
      END,
      sent_at = CASE WHEN was_sent THEN now() ELSE sent_at END,
      provider_message_id = CASE WHEN was_sent THEN gmail_message_id ELSE provider_message_id END,
      next_attempt_at = CASE
        WHEN was_sent THEN next_attempt_at
        ELSE now() + make_interval(mins => LEAST(60, 5 * power(2, GREATEST(attempts - 1, 0))::INTEGER))
      END,
      last_error = CASE WHEN was_sent THEN NULL ELSE left(failure_reason, 1000) END
  WHERE id = job_id AND status = 'sending';
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_registration_email_batch(
  target_batch_id UUID,
  monitor_sent BOOLEAN,
  failure_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  remaining_count INTEGER;
  sent_count INTEGER;
BEGIN
  SELECT
    count(*) FILTER (WHERE status IN ('pending', 'sending')),
    count(*) FILTER (WHERE status = 'sent')
  INTO remaining_count, sent_count
  FROM public.registration_email_queue
  WHERE batch_id = target_batch_id;

  UPDATE public.registration_email_batches
  SET status = CASE
        WHEN sent_count = participant_count AND monitor_sent THEN 'sent'
        WHEN sent_count = participant_count THEN 'partial'
        WHEN sent_count > 0 OR remaining_count > 0 THEN 'partial'
        ELSE 'failed'
      END,
      verification_sent_at = CASE WHEN monitor_sent THEN now() ELSE verification_sent_at END,
      last_error = left(failure_reason, 1000)
  WHERE id = target_batch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_registration_email_batch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_registration_email_job(UUID, BOOLEAN, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_registration_email_batch(UUID, BOOLEAN, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.registration_email_queue TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.registration_email_batches TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_registration_email_batch() TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_registration_email_job(UUID, BOOLEAN, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_registration_email_batch(UUID, BOOLEAN, TEXT)
  TO service_role;
