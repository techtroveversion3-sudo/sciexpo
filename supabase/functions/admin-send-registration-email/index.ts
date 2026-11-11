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

  let registrationId: unknown;
  try {
    ({ registration_id: registrationId } = await request.json());
  } catch {
    return response({ error: "A registration ID is required" }, 400);
  }
  if (typeof registrationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registrationId)) {
    return response({ error: "A valid registration ID is required" }, 400);
  }

  const { data, error } = await supabase.rpc("admin_enqueue_registration_email", {
    target_registration_id: registrationId,
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
