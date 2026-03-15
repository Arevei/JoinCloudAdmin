const CF_BASE = "https://api.cloudflare.com/client/v4";
const CF_HEADERS: Record<string, string> = {
  Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || ""}`,
  "Content-Type": "application/json",
};

export async function cfRequest<T = unknown>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${CF_BASE}${path}`, {
    method,
    headers: CF_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as { success?: boolean; errors?: Array<{ message?: string }>; result?: T };
  if (!data.success) {
    throw new Error(
      data.errors?.[0]?.message || "Cloudflare API error"
    );
  }
  return data.result as T;
}
