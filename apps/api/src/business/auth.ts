import { sha256Hex } from '@pp/crypto/server'
import type { AppContext } from '../context'
import { HttpError, limit, requireUser, type Ctx } from '../http'

export type ApiScope = 'verification:create' | 'verification:read' | 'credential:verify'

export interface BusinessActor {
  businessId: string
  businessName: string
  userId: string | null
  apiKeyId: string | null
}

export const hashApiKey = (app: AppContext, key: string): string => sha256Hex(`${app.config.pepper}:apikey:${key}`)
export const hashRequestCode = (app: AppContext, code: string): string =>
  sha256Hex(`${app.config.pepper}:request-code:${code.trim().toUpperCase().replace(/[\s-]/g, '')}`)

interface KeyRow {
  id: string
  business_id: string
  name: string
  scopes: ApiScope[]
  expires_at: Date | null
  revoked_at: Date | null
  status: string
}

/**
 * Authenticates a business either by API key (Authorization: Bearer pp_live_...) or by a business session.
 * API keys must carry the requested scope. Usage is recorded for keys.
 */
export async function authBusiness(ctx: Ctx, scope: ApiScope): Promise<BusinessActor> {
  const header = ctx.req.headers.get('authorization')
  if (header?.startsWith('Bearer ')) {
    const key = header.slice(7).trim()
    if (!/^pp_live_[A-Za-z0-9_-]{40,}$/.test(key)) throw new HttpError(401, 'invalid_api_key', 'The API key is invalid.')
    const rows = await ctx.app.db<KeyRow[]>`
      SELECT k.id, k.business_id, b.name, k.scopes, k.expires_at, k.revoked_at, b.status
      FROM business_api_keys k JOIN businesses b ON b.id = k.business_id
      WHERE k.key_hash = ${hashApiKey(ctx.app, key)}`
    const k = rows[0]
    if (!k || k.revoked_at || (k.expires_at && k.expires_at <= ctx.app.now()) || k.status !== 'active') {
      limit(ctx, 'api-key-miss', 20, 10 * 60_000)
      throw new HttpError(401, 'invalid_api_key', 'The API key is invalid.')
    }
    limit(ctx, `api-key:${k.id}`, 120, 60_000)
    if (!k.scopes.includes(scope)) throw new HttpError(403, 'insufficient_scope', `This API key lacks the ${scope} scope.`)
    ctx.apiKeyId = k.id
    await ctx.app.db`UPDATE business_api_keys SET last_used_at = ${ctx.app.now()} WHERE id = ${k.id}`
    await ctx.app.db`INSERT INTO api_usage (api_key_id, route, status) VALUES (${k.id}, ${ctx.url.pathname}, 200)`
    return { businessId: k.business_id, businessName: k.name, userId: null, apiKeyId: k.id }
  }
  const user = requireUser(ctx, 'business')
  const rows = await ctx.app.db<{ id: string; name: string; status: string }[]>`
    SELECT id, name, status FROM businesses WHERE owner_user_id = ${user.id}`
  const b = rows[0]
  if (!b || b.status !== 'active') throw new HttpError(403, 'business_unavailable', 'This business account is not active.')
  limit(ctx, 'business-session', 120, 60_000, true)
  return { businessId: b.id, businessName: b.name, userId: user.id, apiKeyId: null }
}
