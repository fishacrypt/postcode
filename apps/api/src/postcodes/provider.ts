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
