export type HealthResponse = {
  status: string
  service: string
  version: string
}

/**
 * Hit the backend health endpoint through the Vite dev proxy (/api -> :8000).
 * Throws on any non-2xx response or transport failure.
 */
export async function fetchHealth(
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const res = await fetch('/api/health', {
    signal,
    headers: { Accept: 'application/json' },
  })

  if (!res.ok) {
    throw new Error(`health check failed: ${res.status}`)
  }

  const body = (await res.json()) as Partial<HealthResponse>

  return {
    status: String(body.status ?? 'unknown'),
    service: String(body.service ?? 'unknown'),
    version: String(body.version ?? 'unknown'),
  }
}
