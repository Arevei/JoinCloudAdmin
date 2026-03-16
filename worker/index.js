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

    const upstreamReq = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers: {
        "x-tunnel-source": "cloudflare",
        ...(request.headers.get("content-type")
          ? { "content-type": request.headers.get("content-type") }
          : {}),
      },
      body: ["POST", "PUT", "PATCH"].includes(request.method)
        ? request.body
        : undefined,
    });

    const upstreamRes = await fetch(upstreamReq);

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
    if (ct) headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    headers.set("cache-control", "no-store");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  },
};

