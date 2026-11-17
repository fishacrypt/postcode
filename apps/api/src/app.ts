import type { AppContext } from './context'
import {
  assertSameSiteRequest,
  clientIp,
  errorResponse,
  HttpError,
  json,
  readCookie,
  Router,
  SECURITY_HEADERS,
  SESSION_COOKIE,
  type Ctx,
} from './http'
import { loadSession } from './security/session'
import { registerAuthRoutes } from './auth/routes'
import { registerPostcodeRoutes } from './postcodes/routes'
import { registerAddressRoutes } from './addresses/routes'
import { registerCredentialRoutes } from './credentials/routes'
import { registerVerificationRoutes } from './verification/routes'
import { registerBusinessRoutes } from './business/routes'
import { registerAdminRoutes } from './admin/routes'

export function createRouter(): Router {
  const router = new Router()
  registerAuthRoutes(router)
  registerPostcodeRoutes(router)
  registerAddressRoutes(router)
  registerCredentialRoutes(router)
  registerVerificationRoutes(router)
  registerBusinessRoutes(router)
  registerAdminRoutes(router)
  return router
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createHandler(app: AppContext) {
  const router = createRouter()

  return async function handle(req: Request, remoteIp = 'unknown'): Promise<Response> {
    const ctx: Ctx = {
      req,
      url: new URL(req.url),
      params: {},
      app,
      ip: clientIp(req, remoteIp, app.config.trustProxy),
      user: null,
      apiKeyId: null,
      responseCookies: [],
    }
    let response: Response
    try {
      if (!ctx.url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Not found.')
      if (req.method === 'OPTIONS') {
        // No CORS grants: the API is same-origin only.
        return new Response(null, { status: 204, headers: SECURITY_HEADERS })
      }
      const matched = router.match(req.method, ctx.url.pathname)
      if (matched === null) throw new HttpError(404, 'not_found', 'Not found.')
      if (matched === 'method') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.')

      const bearer = req.headers.get('authorization')?.startsWith('Bearer ') === true
      const token = readCookie(req, SESSION_COOKIE)
      // Cookie-authenticated or anonymous browser writes need the CSRF marker. Bearer calls carry no ambient credentials.
      if (!SAFE_METHODS.has(req.method) && !bearer) assertSameSiteRequest(req, app)
      if (token && !bearer) ctx.user = await loadSession(app, token)

      ctx.params = matched.params
      response = await matched.handler(ctx)
    } catch (error) {
      response = errorResponse(error)
    }
    for (const cookie of ctx.responseCookies) response.headers.append('set-cookie', cookie)
    return response
  }
}

export { json }
