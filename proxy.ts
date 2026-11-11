import { next, rewrite } from "@vercel/functions";

const ADMIN_ENTRY_PATH = "/admin.html";

export default function proxy(request: Request) {
  const url = new URL(request.url);
  const configuredPath = process.env.SCIENCE_EXPO_ADMIN_PATH?.trim();
  const adminPath = configuredPath
    ? `/${configuredPath.replace(/^\/+|\/+$/g, "")}`
    : "";

  if (url.pathname === ADMIN_ENTRY_PATH) {
    return new Response("Not found", { status: 404 });
  }

  if (
    adminPath &&
    adminPath !== "/" &&
    url.pathname.replace(/\/+$/, "") === adminPath
  ) {
    url.pathname = ADMIN_ENTRY_PATH;
    return rewrite(url);
  }

  return next();
}
