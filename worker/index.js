const CONTROL_PLANE = "https://plane.joincloud.in";

// Only cache simple single-file downloads, not ZIP, HLS segments, or previews
function isCacheableDownload(subPath) {
  return subPath === "/download";
}

// Parse an HTTP Range header into R2-compatible range options
function parseRangeForR2(rangeHeader, totalSize) {
  if (!rangeHeader) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (!startRaw && !endRaw) return null;
  let start, end;
  if (!startRaw && endRaw) {
    // suffix range: bytes=-N  →  last N bytes
    const suffix = parseInt(endRaw);
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = parseInt(startRaw);
    end = endRaw ? parseInt(endRaw) : totalSize - 1;
  }
  if (isNaN(start) || isNaN(end) || start > end || start >= totalSize) return null;
  end = Math.min(end, totalSize - 1);
  return { offset: start, length: end - start + 1, start, end };
}

// Serve a cached file from R2, supporting range requests
async function serveFromR2(env, r2Key, request) {
  const rangeHeader = request.headers.get("range");
  const totalSize = parseInt((await env.joincloud_share_cache.head(r2Key))?.customMetadata?.contentLength || "0");

  const range = rangeHeader && totalSize > 0 ? parseRangeForR2(rangeHeader, totalSize) : null;

  const object = range
    ? await env.joincloud_share_cache.get(r2Key, { range: { offset: range.offset, length: range.length } })
    : await env.joincloud_share_cache.get(r2Key);

  if (!object) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("x-joincloud-range-support", "bytes");
  headers.set("x-jc-served-by", "r2-cache");
  headers.set("cache-control", "no-store");
  headers.set("vary", "Range");

  if (range && totalSize > 0) {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${totalSize}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  if (totalSize > 0) headers.set("content-length", String(totalSize));
  return new Response(object.body, { status: 200, headers });
}

// Pull the full file from the sharer's tunnel and store it in R2.
// Called via ctx.waitUntil — runs in background after response is sent.
async function cacheFileToR2(env, r2Key, tunnelUrl, shareId, token, exp) {
  const downloadUrl = new URL(`${tunnelUrl}/share/${shareId}/download`);
  downloadUrl.searchParams.set("token", token);
  downloadUrl.searchParams.set("exp", String(exp));

  let res;
  try {
    res = await fetch(downloadUrl.toString(), {
      headers: { "x-tunnel-source": "cloudflare" },
    });
  } catch (_) {
    return; // sharer offline
  }

  if (!res.ok || !res.body) return;

  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const contentLength = res.headers.get("content-length") || "";
  const contentDisposition = res.headers.get("content-disposition") || "";

  try {
    await env.joincloud_share_cache.put(r2Key, res.body, {
      httpMetadata: {
        contentType,
        contentDisposition: contentDisposition || undefined,
      },
      customMetadata: {
        cachedAt: String(Date.now()),
        contentLength,
        cacheComplete: "true",
      },
    });
  } catch (_) {
    // R2 put failed — ignore, sharer will serve next time
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const match = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)(\/.*)?$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const shortId = match[1];
    const subPath = match[2] || "";

    // ── Priority 3: Serve from R2 cache if already cached ──────────────────
    if (isCacheableDownload(subPath) && env.joincloud_share_cache) {
      try {
        const head = await env.joincloud_share_cache.head(`share/${shortId}`);
        if (head && head.customMetadata?.cacheComplete === "true") {
          const r2Response = await serveFromR2(env, `share/${shortId}`, request);
          if (r2Response) return r2Response;
        }
      } catch (_) {
        // R2 unavailable — fall through to proxy
      }
    }

    // ── Resolve short ID → tunnel URL via admin control plane ───────────────
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

    // ── Priority 2: Concurrent detection → trigger R2 cache ─────────────────
    if (isCacheableDownload(subPath) && env.CONCURRENT_KV && env.joincloud_share_cache) {
      try {
        const concurrentKey = `concurrent:${shortId}`;
        const cachingKey = `caching:${shortId}`;
        const countStr = await env.CONCURRENT_KV.get(concurrentKey);
        const currentCount = parseInt(countStr || "0");
        // Increment with 5-minute TTL (approximate — KV is eventually consistent)
        await env.CONCURRENT_KV.put(concurrentKey, String(currentCount + 1), {
          expirationTtl: 300,
        });
        // If 2nd+ concurrent request and not already caching → trigger R2 cache
        if (currentCount >= 1) {
          const alreadyCaching = await env.CONCURRENT_KV.get(cachingKey);
          if (!alreadyCaching) {
            await env.CONCURRENT_KV.put(cachingKey, "1", { expirationTtl: 3600 });
            ctx.waitUntil(cacheFileToR2(env, `share/${shortId}`, tunnelUrl, shareId, token, exp));
          }
        }
      } catch (_) {
        // KV unavailable — continue without caching
      }
    }

    // ── Proxy to sharer's tunnel ─────────────────────────────────────────────
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
    if (!cc) headers.set("cache-control", "no-store");

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers,
    });
  },
};
