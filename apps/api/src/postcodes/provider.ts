import type { CountryCode, PostcodeProvider, PostcodeRecord } from '@pp/address'
import type { Db } from '../database/db'

interface Row {
  postcode: string
  state: string
  lga: string | null
  area: string | null
  source_id: string
}

/** Reads the imported postcode dataset. An empty table means "dataset unavailable", never "not found". */
export class DbPostcodeProvider implements PostcodeProvider {
  readonly id = 'postgres-dataset'

  constructor(private readonly db: Db) {}

  async isAvailable(country: CountryCode): Promise<boolean> {
    const rows = await this.db<{ ok: boolean }[]>`SELECT EXISTS (SELECT 1 FROM postcode_records WHERE country = ${country}) AS ok`
    return rows[0]?.ok === true
  }

  async lookup(country: CountryCode, normalisedPostcode: string): Promise<PostcodeRecord | null> {
    const rows = await this.db<Row[]>`
      SELECT postcode, state, lga, area, source_id FROM postcode_records
      WHERE country = ${country} AND postcode = ${normalisedPostcode} LIMIT 1`
    const r = rows[0]
    return r ? { postcode: r.postcode, state: r.state, lga: r.lga, area: r.area, sourceId: r.source_id } : null
  }
}


/** Authoritative NIPOST Postcode Validator (level 1). It confirms existence only. */
export class NipostPostcodeProvider implements PostcodeProvider {
  readonly id = 'nipost-validator'

  constructor(private readonly apiKey: string) {}

  async isAvailable(_country: CountryCode): Promise<boolean> {
    return true
  }

  async lookup(_country: CountryCode, normalisedPostcode: string): Promise<PostcodeRecord | null> {
    const code = normalisedPostcode.trim().replace(/\s+/g, '-')
    const url = new URL('https://api.postcode.gov.ng/v1/lookup')
    url.searchParams.set('code', code)
    url.searchParams.set('level', '1')

    const response = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`NIPOST postcode lookup failed (${response.status}): ${detail.slice(0, 300)}`)
    }

    const payload = await response.json() as { data?: { postcode?: string; valid?: boolean } }
    if (payload.data?.valid !== true) return null
    return {
      postcode: payload.data.postcode ?? code,
      state: null,
      lga: null,
      area: null,
      sourceId: 'nipost-validator',
    }
  }
}
