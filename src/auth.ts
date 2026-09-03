const AUTH_SERVICE = 'leanworkflowRealtimeAuth'
const AUTH_TIMEOUT_MS = 5000

const encoder = new TextEncoder()


export const isIngestAuthorized = async (request: Request, env: Env) => {
  if (!env.INGEST_SECRET) {
    return false
  }
  const provided = request.headers.get('Authorization') ?? ''
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(`Bearer ${env.INGEST_SECRET}`)),
  ])
  return crypto.subtle.timingSafeEqual(a, b)
}


export const isOriginAllowed = (request: Request, env: Env) => {
  const origin = request.headers.get('Origin')
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim())
  return !!origin && allowed.includes(origin)
}


export const isSubscriptionAuthorized = async (request: Request, submissionId: string) => {
  const cookie = request.headers.get('Cookie')
  if (!cookie) {
    return false
  }

  // Resolved against the incoming request because the worker sits in front of Literatum: same-zone
  // subrequests bypass Worker routes and go straight to the origin, so this does not loop.
  const url = new URL(`/action/${AUTH_SERVICE}`, request.url)
  url.searchParams.set('id', submissionId)
  try {
    const response = await fetch(url, {
      headers: { Cookie: cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    })
    if (!response.ok) {
      return false
    }
    const body = (await response.json().catch(() => null)) as { userId?: unknown } | null
    return typeof body?.userId === 'string'
  } catch (error) {
    console.error('failed to authorize subscription', error)
    return false
  }
}
