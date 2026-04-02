const CONTROL_PLANE = "https://plane.joincloud.in";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)(\/.*)?$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const shortId = match[1];
    const subPath = match[2] || "";

    const resolveRes = await fetch(
      `${CONTROL_PLANE}/api/v1/share/resolve/${shortId}`,
      { headers: { "x-worker-secret": env.WORKER_SECRET } }
    );

    if (!resolveRes.ok) {
      return new Response("Share not found or expired", {
        status: resolveRes.status,
      });
    }

    const { tunnelUrl, shareId, token, exp } = await resolveRes.json();

    const upstreamUrl = new URL(`${tunnelUrl}/share/${shareId}${subPath}`);
    upstreamUrl.searchParams.set("token", token);
    upstreamUrl.searchParams.set("exp", exp);

    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "token" && key !== "exp") {
        upstreamUrl.searchParams.set(key, value);
      }
    }

    const upstreamHeaders = {
      "x-tunnel-source": "cloudflare",
    };
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) upstreamHeaders["range"] = rangeHeader;
    const contentTypeHeader = request.headers.get("content-type");
    if (contentTypeHeader) upstreamHeaders["content-type"] = contentTypeHeader;

    const upstreamReq = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: upstreamHeaders,
      body: ["POST", "PUT", "PATCH"].includes(request.method)
        ? request.body
        : undefined,
    });

    const upstreamRes = await fetch(upstreamReq, { cf: { cacheEverything: false } });

    if (!upstreamRes.ok && subPath === "") {
      return new Response("Failed to fetch share from tunnel", {
        status: upstreamRes.status,
      });
    }

    const contentType = upstreamRes.headers.get("content-type") || "";

    if (contentType.startsWith("text/html")) {
      let html = await upstreamRes.text();

      html = html.replace(
        /window\.__SHARE_BASE__\s*=\s*['"]{2}\s*;/,
        `window.__SHARE_BASE__ = '/s/${shortId}';`
      );

      const headers = new Headers();
      headers.set("content-type", "text/html; charset=UTF-8");
      headers.set("cache-control", "no-store");
      return new Response(html, { status: 200, headers });
    }

    const headers = new Headers();
    const ct = upstreamRes.headers.get("content-type");
    const cd = upstreamRes.headers.get("content-disposition");
    const cr = upstreamRes.headers.get("content-range");
    const ar = upstreamRes.headers.get("accept-ranges");
    const cl = upstreamRes.headers.get("content-length");
    const ce = upstreamRes.headers.get("content-encoding");
    const vary = upstreamRes.headers.get("vary");
    const xjrs = upstreamRes.headers.get("x-joincloud-range-support");
    const xcto = upstreamRes.headers.get("x-content-type-options");
    const cc = upstreamRes.headers.get("cache-control");

    if (ct) headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    if (cr) headers.set("content-range", cr);
    if (ar) headers.set("accept-ranges", ar);
    if (cl) headers.set("content-length", cl);
    if (ce) headers.set("content-encoding", ce);
    if (vary) headers.set("vary", vary);
    if (xjrs) headers.set("x-joincloud-range-support", xjrs);
    if (xcto) headers.set("x-content-type-options", xcto);
    if (cc) headers.set("cache-control", cc);

    // Ensure proper caching for range requests
    if (!cc) headers.set("cache-control", "no-store");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  },
};

