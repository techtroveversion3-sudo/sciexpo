import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface EmailJob {
  id: string;
  participant_name: string;
  recipient_email: string;
  registration_code: string;
  participation: string;
  team_details: string;
  attempts: number;
}

interface ClaimedBatch {
  status: "claimed" | "waiting" | "paused" | "empty";
  reason?: string;
  batch_id?: string;
  jobs?: EmailJob[];
}

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function renderTemplate(template: string, job: EmailJob) {
  return template
    .replaceAll("{{name}}", job.participant_name)
    .replaceAll("{{registration_code}}", job.registration_code)
    .replaceAll("{{participation}}", job.participation)
    .replaceAll("{{team_details}}", job.team_details);
}

const DEFAULT_EMAIL_SUBJECT = "Science Expo 2026 registration successful";
const DEFAULT_EMAIL_BODY = `Hello {{name}},

Your registration is successful for Science Expo at SIMATS Engineering.

Event date: 20 November 2026
Registration code: {{registration_code}}
Participation: {{participation}}
{{team_details}}

Join the Science Expo WhatsApp community:
https://chat.whatsapp.com/CIHaS5HmoGzIz3UqCf5Hz7

We look forward to welcoming you.

Science Expo Team`;

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function encodeRawEmail(from: string, to: string, subject: string, body: string) {
  const cleanSubject = subject.replace(/[\r\n]+/g, " ").trim();
  const encodedSubject = /^[\x20-\x7e]*$/.test(cleanSubject)
    ? cleanSubject
    : `=?UTF-8?B?${base64Utf8(cleanSubject)}?=`;
  const message = [
    `From: Science Expo 2026 <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Utf8(body),
  ].join("\r\n");
  return base64Utf8(message)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function gmailAccessToken() {
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail API OAuth credentials are not configured");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google token refresh failed with status ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json();
  if (typeof tokenData.access_token !== "string") {
    throw new Error("Google did not return an access token");
  }
  return tokenData.access_token as string;
}

async function sendGmail(accessToken: string, from: string, to: string, subject: string, body: string) {
  const gmailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encodeRawEmail(from, to, subject, body) }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await gmailResponse.json().catch(() => ({}));
  if (!gmailResponse.ok) {
    throw new Error(`Gmail API send failed with status ${gmailResponse.status}`);
  }
  return typeof result.id === "string" ? result.id : null;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const workerSecret = Deno.env.get("EMAIL_WORKER_SECRET");
  const suppliedSecret = request.headers.get("x-worker-secret") || "";
  if (!workerSecret) {
    return response({ error: "Unauthorized" }, 401);
  }
  const suppliedBytes = new TextEncoder().encode(suppliedSecret);
  const expectedBytes = new TextEncoder().encode(workerSecret);
  if (suppliedBytes.length !== expectedBytes.length) {
    return response({ error: "Unauthorized" }, 401);
  }
  let secretDifference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    secretDifference |= suppliedBytes[index] ^ expectedBytes[index];
  }
  const secretMatches = secretDifference === 0;
  if (!secretMatches) return response({ error: "Unauthorized" }, 401);

  const subjectTemplate = Deno.env.get("REGISTRATION_EMAIL_SUBJECT")?.trim() || DEFAULT_EMAIL_SUBJECT;
  const bodyTemplate = Deno.env.get("REGISTRATION_EMAIL_BODY")?.trim() || DEFAULT_EMAIL_BODY;

  const sender = Deno.env.get("GMAIL_SENDER_EMAIL")?.trim().toLowerCase();
  const monitor = Deno.env.get("EMAIL_MONITOR_ADDRESS")?.trim().toLowerCase();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!sender || !monitor || !supabaseUrl || !serviceRoleKey) {
    return response({ error: "Email worker configuration is incomplete" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: batch, error: claimError } = await supabase.rpc("claim_registration_email_batch");
  if (claimError) {
    console.error("Could not claim registration email batch:", claimError.message);
    return response({ error: "Could not claim email batch" }, 500);
  }

  const claimed = batch as ClaimedBatch;
  if (claimed.status !== "claimed" || !claimed.batch_id || !claimed.jobs?.length) {
    return response({ status: claimed.status, reason: claimed.reason });
  }

  let accessToken: string;
  try {
    accessToken = await gmailAccessToken();
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Google authentication failed";
    await Promise.all(claimed.jobs.map((job) =>
      supabase.rpc("finish_registration_email_job", {
        job_id: job.id,
        was_sent: false,
        gmail_message_id: null,
        failure_reason: reason,
      })
    ));
    await supabase.rpc("finish_registration_email_batch", {
      target_batch_id: claimed.batch_id,
      monitor_sent: false,
      failure_reason: reason,
    });
    console.error(reason);
    return response({ status: "failed", reason: "gmail_authentication_failed" }, 502);
  }

  let successfulTemplate: { subject: string; body: string } | null = null;
  let batchFailure: string | null = null;

  for (const [index, job] of claimed.jobs.entries()) {
    const subject = renderTemplate(subjectTemplate, job);
    const body = renderTemplate(bodyTemplate, job);
    try {
      if (index > 0) await sleep(1100);
      const messageId = await sendGmail(accessToken, sender, job.recipient_email, subject, body);
      const { error } = await supabase.rpc("finish_registration_email_job", {
        job_id: job.id,
        was_sent: true,
        gmail_message_id: messageId,
        failure_reason: null,
      });
      if (error) throw new Error("Could not record email delivery");
      successfulTemplate ??= { subject, body };
    } catch (error) {
      batchFailure = error instanceof Error ? error.message : "Gmail API send failed";
      const { error: saveError } = await supabase.rpc("finish_registration_email_job", {
        job_id: job.id,
        was_sent: false,
        gmail_message_id: null,
        failure_reason: batchFailure,
      });
      if (saveError) console.error("Could not record failed email:", saveError.message);

      for (const remainingJob of claimed.jobs.slice(index + 1)) {
        const { error: pendingError } = await supabase.rpc("finish_registration_email_job", {
          job_id: remainingJob.id,
          was_sent: false,
          gmail_message_id: null,
          failure_reason: "Batch stopped after a Gmail API error",
        });
        if (pendingError) console.error("Could not release remaining email:", pendingError.message);
      }
      break;
    }
  }

  let monitorSent = false;
  if (successfulTemplate) {
    try {
      await sleep(1100);
      await sendGmail(
        accessToken,
        sender,
        monitor,
        successfulTemplate.subject,
        successfulTemplate.body,
      );
      monitorSent = true;
    } catch (error) {
      batchFailure = batchFailure || (error instanceof Error ? error.message : "Verification email failed");
    }
  }

  const { error: finishError } = await supabase.rpc("finish_registration_email_batch", {
    target_batch_id: claimed.batch_id,
    monitor_sent: monitorSent,
    failure_reason: batchFailure,
  });
  if (finishError) {
    console.error("Could not finish email batch:", finishError.message);
    return response({ status: "partial", error: "Could not record batch completion" }, 500);
  }

  return response({
    status: batchFailure ? "partial" : "sent",
    participant_emails_in_batch: claimed.jobs.length,
    verification_copy_sent: monitorSent,
  });
});
