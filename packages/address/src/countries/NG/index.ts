import type { AdminArea, CountryModule, PostcodeFormatResult } from '../../types'
import { NG_LGAS } from './lgas'

/** [ISO 3166-2 code, name]. The FCT is listed as "Federal Capital Territory". */
const STATE_ROWS: readonly (readonly [string, string])[] = [
  ['NG-AB', 'Abia'],
  ['NG-AD', 'Adamawa'],
  ['NG-AK', 'Akwa Ibom'],
  ['NG-AN', 'Anambra'],
  ['NG-BA', 'Bauchi'],
  ['NG-BY', 'Bayelsa'],
  ['NG-BE', 'Benue'],
  ['NG-BO', 'Borno'],
  ['NG-CR', 'Cross River'],
  ['NG-DE', 'Delta'],
  ['NG-EB', 'Ebonyi'],
  ['NG-ED', 'Edo'],
  ['NG-EK', 'Ekiti'],
  ['NG-EN', 'Enugu'],
  ['NG-FC', 'Federal Capital Territory'],
  ['NG-GO', 'Gombe'],
  ['NG-IM', 'Imo'],
  ['NG-JI', 'Jigawa'],
  ['NG-KD', 'Kaduna'],
  ['NG-KN', 'Kano'],
  ['NG-KT', 'Katsina'],
  ['NG-KE', 'Kebbi'],
  ['NG-KO', 'Kogi'],
  ['NG-KW', 'Kwara'],
  ['NG-LA', 'Lagos'],
  ['NG-NA', 'Nasarawa'],
  ['NG-NI', 'Niger'],
  ['NG-OG', 'Ogun'],
  ['NG-ON', 'Ondo'],
  ['NG-OS', 'Osun'],
  ['NG-OY', 'Oyo'],
  ['NG-PL', 'Plateau'],
  ['NG-RI', 'Rivers'],
  ['NG-SO', 'Sokoto'],
  ['NG-TA', 'Taraba'],
  ['NG-YO', 'Yobe'],
  ['NG-ZA', 'Zamfara'],
]

/**
 * NIPOST has published only one two-character code of the new digital postcode so far in the
 * material we could verify: "FC" for the Federal Capital Territory. Every other state stays null
 * until NIPOST publishes the approved list. Never fill these in from memory.
 */
const DIGITAL_CODES: Readonly<Record<string, string>> = { 'NG-FC': 'FC' }

export const NG_STATES: readonly AdminArea[] = STATE_ROWS.map(([isoCode, name]) => ({
  isoCode,
  name,
  lgas: NG_LGAS[isoCode] ?? [],
  digitalPostcodeCode: DIGITAL_CODES[isoCode] ?? null,
}))

const fold = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const STATE_ALIASES: Readonly<Record<string, string>> = {
  fct: 'NG-FC',
  abuja: 'NG-FC',
  'fct abuja': 'NG-FC',
  'federal capital territory': 'NG-FC',
  'nassarawa': 'NG-NA',
}

const LEGACY = /^\d{6}$/
// 11 characters: two-letter state prefix + nine letters or digits.
// The published example is "FC 02 A09 DB 09". Segment typing beyond the prefix is not documented,
// so only the length and the prefix are enforced. The dataset decides whether a code exists.
const DIGITAL = /^[A-Z]{2}[A-Z0-9]{9}$/

export function validateNgPostcodeFormat(input: string): PostcodeFormatResult {
  const compact = input.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '')
  const fail = (reason: string): PostcodeFormatResult => ({
    valid: false,
    normalised: null,
    format: null,
    reason,
    statePrefix: null,
  })
  if (compact.length === 0) return fail('Enter a postcode.')
  if (/^\d+$/.test(compact)) {
    if (LEGACY.test(compact)) {
      return { valid: true, normalised: compact, format: 'legacy_6_digit', reason: null, statePrefix: null }
    }
    if (compact.length === 8) {
      return fail('8-digit "Postcode+2" values are not supported yet. Use the 6-digit postcode or the digital postcode.')
    }
    return fail('A 6-digit postcode must contain exactly six digits.')
  }
  if (DIGITAL.test(compact)) {
    const grouped = `${compact.slice(0, 2)} ${compact.slice(2, 4)} ${compact.slice(4, 7)} ${compact.slice(7, 9)} ${compact.slice(9, 11)}`
    return { valid: true, normalised: grouped, format: 'digital_11_char', reason: null, statePrefix: compact.slice(0, 2) }
  }
  return fail('Use a 6-digit postcode (for example 100271) or an 11-character digital postcode (for example FC 02 A09 DB 09).')
}

function findState(nameOrCode: string): AdminArea | null {
  const key = fold(nameOrCode)
  if (!key) return null
  const aliasCode = STATE_ALIASES[key]
  if (aliasCode) return NG_STATES.find((s) => s.isoCode === aliasCode) ?? null
  return (
    NG_STATES.find((s) => fold(s.name) === key || fold(s.name.replace(/ state$/i, '')) === key || fold(s.isoCode) === key) ??
    null
  )
}

function canonicalLga(state: AdminArea, lga: string): string | null {
  const key = fold(lga)
  if (!key) return null
  return state.lgas.find((l) => fold(l) === key) ?? null
}

export const NG_MODULE: CountryModule = {
  code: 'NG',
  name: 'Nigeria',
  active: true,
  states: NG_STATES,
  findState,
  isLgaInState: (state, lga) => canonicalLga(state, lga) !== null,
  canonicalLga,
  validatePostcodeFormat: validateNgPostcodeFormat,
}

export { fold as foldName }
