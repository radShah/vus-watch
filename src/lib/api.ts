/** POST to the dev-server API (src/server/api.ts). Vite hot-reloads the data files after a write. */
export async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `HTTP ${res.status}${res.status === 404 ? ' (saving needs npm run dev)' : ''}`)
  }
}
