import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response({ error: "Sign in as an administrator to send email" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return response({ error: "Email service configuration is incomplete" }, 503);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return response({ error: "Your session is invalid. Sign in again." }, 401);
  }
  if (userData.user.app_metadata?.role !== "admin") {
    return response({ error: "Only administrators can queue registration emails" }, 403);
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return response({ error: "Registration IDs are required" }, 400);
  }
  if (!requestBody || typeof requestBody !== "object") {
    return response({ error: "Registration IDs are required" }, 400);
  }

  const body = requestBody as Record<string, unknown>;
  const isBatch = Array.isArray(body.registration_ids);
  const rawRegistrationIds: unknown[] = isBatch ? body.registration_ids : [body.registration_id];
  const registrationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const registrationIds = rawRegistrationIds.filter(
    (id): id is string => typeof id === "string" && registrationIdPattern.test(id),
  );
  if (
    rawRegistrationIds.length < 1 ||
    rawRegistrationIds.length > 15 ||
    registrationIds.length !== rawRegistrationIds.length ||
    new Set(registrationIds).size !== registrationIds.length
  ) {
    return response({ error: "Provide 1 to 15 unique, valid registration IDs" }, 400);
  }

  if (isBatch) {
    const { data, error } = await supabase.rpc("admin_enqueue_registration_email_batch", {
      target_registration_ids: registrationIds,
    });
    if (error) {
      console.error("Could not queue admin registration email batch:", error.message);
      return response({ error: "Could not queue the email batch" }, 500);
    }

    const results = Array.isArray(data?.results) ? data.results : [];
    if (results.length !== registrationIds.length) {
      console.error("Unexpected admin email batch response");
      return response({ error: "Could not confirm the email batch status" }, 500);
    }
    const queuedCount = results.filter((result: { status?: unknown }) => result?.status === "queued").length;
    return response({
      status: queuedCount === registrationIds.length ? "queued" : queuedCount > 0 ? "partial" : "failed",
      batch_id: data.batch_id,
      queued_count: queuedCount,
      total_count: registrationIds.length,
      results,
    });
  }

  const { data, error } = await supabase.rpc("admin_enqueue_registration_email", {
    target_registration_id: registrationIds[0],
  });
  if (error) {
    console.error("Could not queue admin registration email:", error.message);
    return response({ error: "Could not queue the registration email" }, 500);
  }
  if (data?.status === "not_found") return response({ error: "Registration not found" }, 404);
  if (data?.status === "sending") {
    return response({ status: "sending", error: "This registration email is already being sent" }, 409);
  }
  if (data?.status !== "queued") {
    console.error("Unexpected admin email queue response");
    return response({ error: "Could not queue the registration email" }, 500);
  }

  return response({ status: "queued" });
});
