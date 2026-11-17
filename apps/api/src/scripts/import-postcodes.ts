/**
 * Imports a postcode dataset from CSV with documented provenance.
 *
 *   bun run postcodes:import data.csv --source-id nipost-2026-10 --name "NIPOST postcode directory" \
 *     --publisher "Nigerian Postal Service" --url https://nipost.gov.ng/ --coverage "Lagos only" \
 *     --retrieved 2026-11-01 --licence "Terms from publisher" [--dry-run]
 *
 * CSV columns: postcode,state,lga,area  (header row required, lga and area may be empty).
 * Nothing is invented or inferred: rows that fail validation are reported and skipped.
 */
import { readFileSync } from 'node:fs'
import { NG_MODULE } from '@pp/address'
import { createDb } from '../database/db'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

export interface ParsedRow {
  postcode: string
  state: string
  lga: string | null
  area: string | null
}

export function parseCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: ParsedRow[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const header = (lines.shift() ?? '').split(',').map((h) => h.trim().toLowerCase())
  const idx = (n: string) => header.indexOf(n)
  if (idx('postcode') < 0 || idx('state') < 0) throw new Error('CSV needs at least the columns postcode and state')
  lines.forEach((line, n) => {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const fmt = NG_MODULE.validatePostcodeFormat(cells[idx('postcode')] ?? '')
    const state = NG_MODULE.findState(cells[idx('state')] ?? '')
    if (!fmt.valid || !fmt.normalised) return void errors.push(`Row ${n + 2}: invalid postcode`)
    if (!state) return void errors.push(`Row ${n + 2}: unknown state`)
    const lgaRaw = idx('lga') >= 0 ? (cells[idx('lga')] ?? '') : ''
    const lga = lgaRaw ? NG_MODULE.canonicalLga(state, lgaRaw) : null
    if (lgaRaw && !lga) return void errors.push(`Row ${n + 2}: LGA does not belong to ${state.name}`)
    rows.push({ postcode: fmt.normalised, state: state.name, lga, area: (idx('area') >= 0 ? cells[idx('area')] : '') || null })
  })
  return { rows, errors }
}

if (import.meta.main) {
  const file = process.argv[2]
  const required = ['source-id', 'name', 'publisher', 'coverage', 'retrieved']
  const missing = required.filter((r) => !arg(r))
  if (!file || missing.length) {
    console.error(`Usage: postcodes:import <file.csv> ${required.map((r) => `--${r} <value>`).join(' ')} [--url] [--licence] [--notes] [--dry-run]`)
    process.exit(1)
  }
  const { rows, errors } = parseCsv(readFileSync(file, 'utf8'))
  console.log(`${rows.length} valid rows, ${errors.length} rejected`)
  errors.slice(0, 20).forEach((e) => console.log(`  ${e}`))
  if (process.argv.includes('--dry-run')) process.exit(0)
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const db = createDb(url)
  await db.begin(async (tx) => {
    const id = arg('source-id') ?? ''
    await tx`
      INSERT INTO postcode_sources (id, name, publisher, url, coverage, licence, retrieved_at, notes)
      VALUES (${id}, ${arg('name') ?? ''}, ${arg('publisher') ?? ''}, ${arg('url') ?? null}, ${arg('coverage') ?? ''},
              ${arg('licence') ?? null}, ${arg('retrieved') ?? ''}, ${arg('notes') ?? null})`
    for (const r of rows) {
      await tx`INSERT INTO postcode_records (country, postcode, state, lga, area, source_id) VALUES ('NG', ${r.postcode}, ${r.state}, ${r.lga}, ${r.area}, ${id})`
    }
  })
  await db.close()
  console.log('Import complete.')
}
