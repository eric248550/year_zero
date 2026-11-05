/** Small typed fetch helper for client components. Throws Error with the server's message. */
export async function api<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    const err = new Error(data.error ?? `Request failed (${res.status})`) as Error & { data?: unknown };
    err.data = data;
    throw err;
  }
  return data;
}
