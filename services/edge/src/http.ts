/** Small helpers shared by the HTTP routes. */

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, { status, headers })
}

export function problem(status: number, code: string): Response {
  return json({ error: code }, status)
}

export function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...headers } })
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return value.join('=')
  }
  return null
}

/** The site's public address: `PUBLIC_URL` when set, else the address the request came to. */
export function siteOrigin(request: Request, env: Env): string {
  return env.PUBLIC_URL ?? new URL(request.url).origin
}

/**
 * Whether a state-changing request comes from our own pages. The session cookie is
 * SameSite=Lax already; this also stops a cross-site form posting with it.
 */
export function fromOurPages(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  return origin === null || origin === siteOrigin(request, env)
}
