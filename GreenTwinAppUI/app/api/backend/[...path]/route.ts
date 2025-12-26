import { NextResponse } from "next/server";

export const revalidate = 0;

function buildTargetUrl(pathParts: string[], searchParams: URLSearchParams) {
  const base = process.env.AZ_FUNC_BASE_URL; // https://xxx.azurewebsites.net/api
  const key = process.env.AZ_FUNC_KEY;

  if (!base || !key) throw new Error("Missing AZ_FUNC_BASE_URL / AZ_FUNC_KEY");

  const url = new URL(base.replace(/\/$/, "") + "/" + pathParts.join("/"));

  // giữ nguyên query từ client
  for (const [k, v] of searchParams.entries()) url.searchParams.set(k, v);

  // add function key
  if (!url.searchParams.has("code")) url.searchParams.set("code", key);

  return url;
}

async function handler(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const nextUrl = new URL(req.url);
  const targetUrl = buildTargetUrl(path, nextUrl.searchParams);

  const init: RequestInit = {
    method: req.method,
    headers: {
      "content-type": req.headers.get("content-type") ?? "",
    },
    cache: "no-store",
  };

  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.text();
  }

  const res = await fetch(targetUrl, init);
  const body = await res.text();

  return new NextResponse(body, {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const PUT = handler;
export const PATCH = handler;
