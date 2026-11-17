import type { z } from 'zod'
import { fieldErrors } from '@pp/validation'
import type { AppContext, SessionUser } from './context'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export interface Ctx {
  req: Request
  url: URL
  params: Record<string, string>
  app: AppContext
  ip: string
  user: SessionUser | null
  /** Set by API-key routes. */
  apiKeyId: string | null
  responseCookies: string[]
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response

interface Route {
  method: string
  segments: string[]
  handler: Handler
}

export class Router {
  private readonly routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler)
  }
  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler)
  }
  put(pattern: string, handler: Handler): this {
    return this.add('PUT', pattern, handler)
  }
  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler)
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const parts = pathname.split('/').filter(Boolean)
    let pathMatched = false
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i]
        const part = parts[i]
        if (seg.startsWith(':')) {
          try {
            params[seg.slice(1)] = decodeURIComponent(part)
          } catch {
            ok = false
            break
          }
        } else if (seg !== part) {
          ok = false
          break
        }
      }
      if (!ok) continue
      pathMatched = true
      if (route.method === method) return { handler: route.handler, params }
    }
    return pathMatched ? 'method' : null
  }
}

const MAX_BODY_BYTES = 64 * 1024

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-site',
  'permissions-policy': 'geolocation=(self), camera=(), microphone=()',
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...headers },
  })
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message, fields: error.fields } }, error.status)
  }
  console.error('Unhandled error', error instanceof Error ? error.message : 'unknown')
  return json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } }, 500)
}

export async function readBody<S extends z.ZodTypeAny>(ctx: Ctx, schema: S): Promise<z.infer<S>> {
  const type = ctx.req.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json.')
  }
  const declared = Number(ctx.req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'The request body is too large.')
  const text = await ctx.req.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'The request body is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON.')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new HttpError(422, 'validation_failed', 'Some fields need attention.', fieldErrors(result.error))
  }
  return result.data
}

export function requireUser(ctx: Ctx, ...roles: SessionUser['role'][]): SessionUser {
  if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'Sign in to continue.')
  if (roles.length > 0 && !roles.includes(ctx.user.role)) {
    throw new HttpError(403, 'forbidden', 'This account type cannot do that.')
  }
  return ctx.user
}

/** Email must be verified before issuing credentials or creating API keys. */
export function requireVerifiedEmail(user: SessionUser): void {
  if (!user.emailVerified) throw new HttpError(403, 'email_unverified', 'Verify your email address to continue.')
}

export const SESSION_COOKIE = 'pp_session'

export function sessionCookie(ctx: Ctx, token: string, maxAgeSeconds: number): string {
  const embedded = ctx.app.config.cookieMode === 'embedded'
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', `Max-Age=${maxAgeSeconds}`]
  if (embedded) parts.push('SameSite=None', 'Secure', 'Partitioned')
  else parts.push('SameSite=Lax', ...(ctx.app.config.env === 'production' ? ['Secure'] : []))
  return parts.join('; ')
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim()
  }
  return null
}

/** Applies to cookie-authenticated, state-changing requests. API-key calls carry no ambient credentials. */
export function assertSameSiteRequest(req: Request, app: AppContext): void {
  const origin = req.headers.get('origin')
  if (req.headers.get('x-requested-with') !== 'PostcodeProof') {
    throw new HttpError(403, 'csrf_blocked', 'Missing request marker.')
  }
  if (!origin) return
  const { config } = app
  let host: string
  try {
    host = new URL(origin).hostname
  } catch {
    throw new HttpError(403, 'csrf_blocked', 'Invalid request origin.')
  }
  if (config.allowedOrigins.includes(origin)) return
  if (config.env !== 'production') {
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.preview.studio.arc.io')) return
  }
  throw new HttpError(403, 'csrf_blocked', 'This origin is not allowed.')
}

/**
 * Client address for rate limiting. X-Forwarded-For is only honoured when TRUST_PROXY is set, i.e. when a reverse
 * proxy you control appends the real client address. The last entry is the one that proxy added; earlier entries
 * are client-supplied and spoofable, so they are ignored.
 */
export function clientIp(req: Request, fallback: string, trustProxy = false): string {
  if (!trustProxy) return fallback
  const parts = req.headers.get('x-forwarded-for')?.split(',')
  const last = parts?.[parts.length - 1]?.trim()
  return last && last.length <= 64 ? last : fallback
}

export function limit(ctx: Ctx, bucket: string, max: number, windowMs: number, byUser = false): void {
  const key = `${bucket}:${byUser && ctx.user ? ctx.user.id : ctx.ip}`
  const retry = ctx.app.limiter.check(key, max, windowMs, ctx.app.now().getTime())
  if (retry !== null) {
    throw new HttpError(429, 'rate_limited', `Too many requests. Try again in ${retry} seconds.`)
  }
}
