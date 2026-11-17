import { z } from 'zod'
import { addressSchema, gpsConfirmSchema } from '@pp/validation'
import { HttpError, json, limit, readBody, requireUser, type Router } from '../http'
import { audit } from '../security/session'
import {
  createAddress,
  loadOwned,
  runValidation,
  setGps,
  toDto,
  updateAddress,
  readSensitive,
  type AddressRow,
} from './service'

const idSchema = z.string().uuid()
const idParam = (raw: string | undefined): string => {
  const parsed = idSchema.safeParse(raw)
  if (!parsed.success) throw new HttpError(404, 'not_found', 'Address not found.')
  return parsed.data
}

export function registerAddressRoutes(router: Router): void {
  router.post('/api/v1/addresses', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'address-write', 30, 60 * 60 * 1000, true)
    const body = await readBody(ctx, addressSchema)
    const count = await ctx.app.db<{ n: string }[]>`SELECT count(*)::text AS n FROM addresses WHERE user_id = ${user.id}`
    if (Number(count[0]?.n ?? 0) >= 10) throw new HttpError(409, 'address_limit', 'You can store up to 10 addresses.')
    const id = await createAddress(ctx.app, user.id, body)
    if (body.gps) {
      await ctx.app.db`INSERT INTO consent_records (user_id, kind, decision, purpose) VALUES (${user.id}, 'gps', 'granted', 'Address location confirmation')`
    }
    await audit(ctx.app, user.id, 'address.created', { addressId: id }, ctx.ip)
    return json({ address: await toDto(ctx.app, await loadOwned(ctx.app, id, user.id)) }, 201)
  })

  router.get('/api/v1/addresses', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const rows = await ctx.app.db<AddressRow[]>`SELECT * FROM addresses WHERE user_id = ${user.id} ORDER BY created_at DESC`
    return json({ addresses: await Promise.all(rows.map((r) => toDto(ctx.app, r))) })
  })

  router.get('/api/v1/addresses/:id', async (ctx) => {
    const user = requireUser(ctx, 'user')
    return json({ address: await toDto(ctx.app, await loadOwned(ctx.app, idParam(ctx.params.id), user.id)) })
  })

  router.add('PATCH', '/api/v1/addresses/:id', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const row = await loadOwned(ctx.app, idParam(ctx.params.id), user.id)
    const body = await readBody(ctx, addressSchema)
    await updateAddress(ctx.app, row, body)
    await audit(ctx.app, user.id, 'address.updated', { addressId: row.id }, ctx.ip)
    return json({ address: await toDto(ctx.app, await loadOwned(ctx.app, row.id, user.id)) })
  })

  router.delete('/api/v1/addresses/:id', async (ctx) => {
    const user = requireUser(ctx, 'user')
    const row = await loadOwned(ctx.app, idParam(ctx.params.id), user.id)
    const active = await ctx.app.db<{ n: string }[]>`
      SELECT count(*)::text AS n FROM credentials
      WHERE address_id = ${row.id} AND status = 'active' AND expires_at > ${ctx.app.now()}`
    if (Number(active[0]?.n ?? 0) > 0) {
      throw new HttpError(409, 'credential_active', 'Revoke the active credential for this address before deleting it.')
    }
    await ctx.app.db.begin(async (tx) => {
      // Expired or revoked credentials keep their signed public record but lose the encrypted claim values.
      await tx`UPDATE credentials SET claims_blob = NULL, encryption_key_version = NULL WHERE address_id = ${row.id}`
      await tx`DELETE FROM addresses WHERE id = ${row.id}`
    })
    await audit(ctx.app, user.id, 'address.deleted', { addressId: row.id }, ctx.ip)
    return json({ ok: true })
  })

  router.post('/api/v1/addresses/:id/validate', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'address-validate', 30, 60 * 60 * 1000, true)
    const row = await loadOwned(ctx.app, idParam(ctx.params.id), user.id)
    const s = readSensitive(ctx.app, row)
    const validation = await runValidation(ctx.app, row.id, user.id, {
      country: 'NG', state: row.state, lga: row.lga, postcode: row.postcode, gps: s.gps,
    })
    return json({ validation })
  })

  router.post('/api/v1/addresses/:id/gps-confirmation', async (ctx) => {
    const user = requireUser(ctx, 'user')
    limit(ctx, 'address-gps', 20, 60 * 60 * 1000, true)
    const row = await loadOwned(ctx.app, idParam(ctx.params.id), user.id)
    const body = await readBody(ctx, gpsConfirmSchema)
    const validation = await setGps(ctx.app, row, body.gps)
    await ctx.app.db`INSERT INTO consent_records (user_id, kind, decision, purpose) VALUES (${user.id}, 'gps', 'granted', 'Address location confirmation')`
    await audit(ctx.app, user.id, 'address.gps_confirmed', { addressId: row.id, status: validation.gps.status }, ctx.ip)
    return json({ validation })
  })
}
