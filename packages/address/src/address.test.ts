import { describe, expect, test } from 'bun:test'
import { NG_MODULE, NG_STATES, getCountryModule, validatePostcode, type PostcodeProvider } from './index'

const none: PostcodeProvider = {
  id: 'none',
  isAvailable: () => Promise.resolve(false),
  lookup: () => Promise.resolve(null),
}
const empty: PostcodeProvider = { id: 'empty', isAvailable: () => Promise.resolve(true), lookup: () => Promise.resolve(null) }

describe('Nigeria module', () => {
  test('covers 36 states and the FCT with 774 LGAs', () => {
    expect(NG_STATES.length).toBe(37)
    expect(NG_STATES.reduce((n, s) => n + s.lgas.length, 0)).toBe(774)
    expect(NG_STATES.find((s) => s.isoCode === 'NG-LA')?.lgas.length).toBe(20)
    expect(NG_STATES.find((s) => s.isoCode === 'NG-KN')?.lgas.length).toBe(44)
    expect(NG_STATES.find((s) => s.isoCode === 'NG-FC')?.lgas.length).toBe(6)
  })

  test('state lookup tolerates case, punctuation and common aliases', () => {
    expect(NG_MODULE.findState('lagos')?.isoCode).toBe('NG-LA')
    expect(NG_MODULE.findState('FCT')?.isoCode).toBe('NG-FC')
    expect(NG_MODULE.findState('Abuja')?.name).toBe('Federal Capital Territory')
    expect(NG_MODULE.findState('Nassarawa')?.isoCode).toBe('NG-NA')
    expect(NG_MODULE.findState('Atlantis')).toBeNull()
  })

  test('LGA must belong to the state', () => {
    const lagos = NG_MODULE.findState('Lagos')!
    expect(NG_MODULE.isLgaInState(lagos, 'ikeja')).toBe(true)
    expect(NG_MODULE.isLgaInState(lagos, 'Aba North')).toBe(false)
    expect(NG_MODULE.canonicalLga(lagos, 'EPE')).toBe('Epe')
  })

  test('only Nigeria is active', () => {
    expect(getCountryModule('ng')?.code).toBe('NG')
    expect(getCountryModule('GH')).toBeNull()
  })

  test('only FC has a published digital postcode prefix', () => {
    expect(NG_STATES.filter((s) => s.digitalPostcodeCode !== null).map((s) => s.digitalPostcodeCode)).toEqual(['FC'])
  })
})

describe('postcode format', () => {
  test.each<[string, string, 'legacy_6_digit' | 'digital_11_char']>([
    ['100271', '100271', 'legacy_6_digit'],
    [' 900 001 ', '900001', 'legacy_6_digit'],
    ['FC 02 A09 DB 09', 'FC 02 A09 DB 09', 'digital_11_char'],
    ['fc02a09db09', 'FC 02 A09 DB 09', 'digital_11_char'],
  ])('accepts %s', (input, normalised, format) => {
    const r = NG_MODULE.validatePostcodeFormat(input)
    expect(r.valid).toBe(true)
    expect(r.normalised).toBe(normalised)
    expect(r.format).toBe(format)
  })

  test.each(['', '12345', '1234567', '12345678', 'ABCDEF', 'F 02 A09 DB 09', 'FC 02 A09 DB 0', "100001'; DROP TABLE x"])('rejects %p', (input) => {
    const r = NG_MODULE.validatePostcodeFormat(input)
    expect(r.valid).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

describe('layered validation', () => {
  const base = { state: 'Lagos', lga: 'Ikeja' }

  test('a well-formed code is NOT reported as matched when no dataset is loaded', async () => {
    const v = await validatePostcode(NG_MODULE, none, { ...base, postcode: '100001' })
    expect(v.format.valid).toBe(true)
    expect(v.dataset.status).toBe('dataset_unavailable')
    expect(v.assuranceLevel).toBe(1)
    expect(v.proofOfResidence).toBe('not_established')
  })

  test('a loaded dataset that lacks the code yields not_found', async () => {
    const v = await validatePostcode(NG_MODULE, empty, { ...base, postcode: '100001' })
    expect(v.dataset.status).toBe('not_found')
    expect(v.assuranceLevel).toBe(1)
  })

  test('dataset match raises assurance only when geography is consistent', async () => {
    const provider: PostcodeProvider = {
      id: 'fx', isAvailable: () => Promise.resolve(true),
      lookup: (_c, p) => Promise.resolve({ postcode: p, state: 'Lagos', lga: 'Ikeja', area: null, sourceId: 'fx' }),
    }
    expect((await validatePostcode(NG_MODULE, provider, { ...base, postcode: '100001' })).assuranceLevel).toBe(2)
    const wrong = await validatePostcode(NG_MODULE, provider, { state: 'Kano', lga: 'Fagge', postcode: '100001' })
    expect(wrong.geographic.status).toBe('inconsistent')
    expect(wrong.assuranceLevel).toBe(1)
  })

  test('a state-only comparison (no LGA entered yet) is not reported as a conflict', async () => {
    const provider: PostcodeProvider = {
      id: 'fx', isAvailable: () => Promise.resolve(true),
      lookup: (_c, p) => Promise.resolve({ postcode: p, state: 'Lagos', lga: 'Ikeja', area: null, sourceId: 'fx' }),
    }
    const v = await validatePostcode(NG_MODULE, provider, { state: 'Lagos', lga: '', postcode: '100001' })
    expect(v.geographic.status).toBe('consistent')
    const other = await validatePostcode(NG_MODULE, provider, { state: 'Kano', lga: '', postcode: '100001' })
    expect(other.geographic.status).toBe('inconsistent')
  })

  test('FC digital prefix is checked against the state', async () => {
    const ok = await validatePostcode(NG_MODULE, none, { state: 'FCT', lga: 'Municipal Area Council', postcode: 'FC 02 A09 DB 09' })
    expect(ok.geographic.status).toBe('consistent')
    const bad = await validatePostcode(NG_MODULE, none, { state: 'Lagos', lga: 'Ikeja', postcode: 'FC 02 A09 DB 09' })
    expect(bad.geographic.status).toBe('inconsistent')
    const unknownPrefix = await validatePostcode(NG_MODULE, none, { state: 'Lagos', lga: 'Ikeja', postcode: 'ZZ 02 A09 DB 09' })
    expect(unknownPrefix.geographic.status).toBe('not_assessable')
  })

  test('GPS only counts when fresh, accurate and inside Nigeria', async () => {
    const now = new Date('2026-11-17T10:00:00Z')
    const fix = { latitude: 6.5, longitude: 3.3, accuracyMeters: 30, capturedAt: now.toISOString() }
    const gps = async (g: typeof fix) => (await validatePostcode(NG_MODULE, none, { ...base, postcode: '100001', gps: g }, now)).gps.status
    expect(await gps(fix)).toBe('confirmed')
    expect(await gps({ ...fix, accuracyMeters: 500 })).toBe('low_accuracy')
    expect(await gps({ ...fix, latitude: 48.8 })).toBe('low_accuracy')
    expect(await gps({ ...fix, capturedAt: '2026-11-17T08:00:00Z' })).toBe('low_accuracy')
  })
})
