const CONTROL_PLANE = "https://plane.joincloud.in";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const shortId = match[1];

    const resolveRes = await fetch(
      `${CONTROL_PLANE}/api/v1/share/resolve/${shortId}`,
      {
        headers: {
          "x-worker-secret": env.WORKER_SECRET,
        },
      }
    );

    if (!resolveRes.ok) {
      return new Response("Share not found or expired", {
        status: resolveRes.status,
      });
    }

    const { tunnelUrl, shareId, token, exp } = await resolveRes.json();

    const fileUrl = `${tunnelUrl}/share/${shareId}?token=${token}&exp=${exp}`;
    const fileRes = await fetch(fileUrl, {
      headers: {
        "x-tunnel-source": "cloudflare",
      },
    });

    if (!fileRes.ok) {
      return new Response("Failed to fetch file from tunnel", {
        status: fileRes.status,
      });
    }

    // Inject tunnel base URL and token into HTML for the share page.
    // Other content types (e.g. direct file downloads) are passed through as-is.
    const contentType = fileRes.headers.get("content-type") || "";
    if (contentType.startsWith("text/html")) {
      let html = await fileRes.text();
      const baseScript = `<script>window.__SHARE_BASE__ = "${tunnelUrl}"; window.__SHARE_TOKEN__ = "${token}"; window.__SHARE_EXP__ = "${exp}";</script>`;
      html = html.replace("</head>", `${baseScript}</head>`);

      const headers = new Headers();
      headers.set("content-type", "text/html; charset=UTF-8");
      headers.set("cache-control", "no-store");
      return new Response(html, {
        status: 200,
        headers,
      });
    }

    const headers = new Headers();
    const ct = fileRes.headers.get("content-type");
    const cd = fileRes.headers.get("content-disposition");
    if (ct) headers.set("content-type", ct);
    if (cd) headers.set("content-disposition", cd);
    headers.set("cache-control", "no-store");

    return new Response(fileRes.body, {
      status: 200,
      headers,
    });
  },
};
