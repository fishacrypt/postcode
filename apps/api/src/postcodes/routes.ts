import { z } from 'zod'
import { getCountryModule, validatePostcode } from '@pp/address'
import { HttpError, json, limit, type Router } from '../http'

const queryShape = z.object({ state: z.string().max(60).optional(), lga: z.string().max(80).optional() })

export function registerPostcodeRoutes(router: Router): void {
  router.get('/api/v1/geo/:country/states', (ctx) => {
    const module = getCountryModule(ctx.params.country ?? '')
    if (!module) throw new HttpError(404, 'country_unsupported', 'This country is not active yet.')
    return json({
      country: module.code,
      states: module.states.map((s) => ({ code: s.isoCode, name: s.name, lgaCount: s.lgas.length })),
    })
  })

  router.get('/api/v1/geo/:country/states/:code/lgas', (ctx) => {
    const module = getCountryModule(ctx.params.country ?? '')
    if (!module) throw new HttpError(404, 'country_unsupported', 'This country is not active yet.')
    const state = module.findState(ctx.params.code ?? '')
    if (!state) throw new HttpError(404, 'state_not_found', 'State not found.')
    return json({ state: { code: state.isoCode, name: state.name }, lgas: state.lgas })
  })

  router.get('/api/v1/postcodes/dataset', async (ctx) => {
    const rows = await ctx.app.db<{ id: string; name: string; publisher: string; url: string | null; coverage: string; retrieved_at: Date; records: string }[]>`
      SELECT s.id, s.name, s.publisher, s.url, s.coverage, s.retrieved_at,
             (SELECT count(*) FROM postcode_records r WHERE r.source_id = s.id)::text AS records
      FROM postcode_sources s ORDER BY s.retrieved_at DESC`
    const available = await ctx.app.provider.isAvailable('NG')
    return json({
      country: 'NG',
      available,
      message: available
        ? 'A postcode dataset is loaded. Coverage is limited to the sources listed here.'
        : 'No verified postcode dataset is loaded yet. Postcodes are checked for format only.',
      sources: rows.map((r) => ({
        id: r.id, name: r.name, publisher: r.publisher, url: r.url, coverage: r.coverage,
        retrievedAt: r.retrieved_at, records: Number(r.records),
      })),
    })
  })

  /** Public, rate limited. Reports layered validation; it never returns a street address. */
  router.get('/api/v1/postcodes/:code', async (ctx) => {
    limit(ctx, 'postcode-lookup', 60, 60_000)
    const module = getCountryModule('NG')
    if (!module) throw new HttpError(404, 'country_unsupported', 'This country is not active yet.')
    const query = queryShape.safeParse(Object.fromEntries(ctx.url.searchParams))
    if (!query.success) throw new HttpError(422, 'validation_failed', 'Invalid query.')
    const validation = await validatePostcode(
      module,
      ctx.app.provider,
      { postcode: ctx.params.code ?? '', state: query.data.state ?? '', lga: query.data.lga ?? '' },
      ctx.app.now(),
    )
    return json({ validation })
  })
}
