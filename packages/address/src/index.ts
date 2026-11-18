import { NG_MODULE, foldName } from './countries/NG'
import type {
  AddressInput,
  AssuranceLevel,
  CountryCode,
  CountryModule,
  DatasetStatus,
  GeographicConsistency,
  GpsFix,
  GpsStatus,
  PostcodeProvider,
  PostcodeValidation,
} from './types'

export * from './types'
export { NG_MODULE, NG_STATES, validateNgPostcodeFormat } from './countries/NG'

/** Only active modules are exposed. Adding a country means adding a module here and activating it. */
const MODULES: Readonly<Record<CountryCode, CountryModule>> = { NG: NG_MODULE }

export function getCountryModule(code: string): CountryModule | null {
  const module = MODULES[code.toUpperCase()]
  return module?.active ? module : null
}

export function listActiveCountries(): readonly CountryModule[] {
  return Object.values(MODULES).filter((m) => m.active)
}

/** Nigeria's land and territorial waters sit inside this box; anything else is not a Nigerian fix. */
const NG_BOUNDS = { minLat: 4.0, maxLat: 14.0, minLon: 2.6, maxLon: 14.8 }
export const GPS_MAX_ACCURACY_METERS = 100
export const GPS_MAX_AGE_MS = 10 * 60 * 1000

export function assessGps(country: CountryCode, gps: GpsFix | undefined, now: Date = new Date()): PostcodeValidation['gps'] {
  if (!gps) return { status: 'not_provided', accuracyMeters: null, capturedAt: null }
  const inBounds =
    country !== 'NG' ||
    (gps.latitude >= NG_BOUNDS.minLat &&
      gps.latitude <= NG_BOUNDS.maxLat &&
      gps.longitude >= NG_BOUNDS.minLon &&
      gps.longitude <= NG_BOUNDS.maxLon)
  const age = now.getTime() - new Date(gps.capturedAt).getTime()
  const fresh = Number.isFinite(age) && age >= -60_000 && age <= GPS_MAX_AGE_MS
  const status: GpsStatus =
    inBounds && fresh && gps.accuracyMeters <= GPS_MAX_ACCURACY_METERS ? 'confirmed' : 'low_accuracy'
  return { status, accuracyMeters: gps.accuracyMeters, capturedAt: gps.capturedAt }
}

/**
 * Validate a postcode in layers. Each layer is reported separately:
 * format, dataset match, geographic consistency, GPS fix. Proof of residence is never established here.
 */
export async function validatePostcode(
  module: CountryModule,
  provider: PostcodeProvider,
  input: Pick<AddressInput, 'postcode' | 'state' | 'lga' | 'gps'>,
  now: Date = new Date(),
): Promise<PostcodeValidation> {
  const format = module.validatePostcodeFormat(input.postcode)
  const gps = assessGps(module.code, input.gps, now)
  const state = module.findState(input.state)

  let datasetStatus: DatasetStatus = 'not_checked'
  let record: PostcodeValidation['dataset']['record'] = null
  if (format.valid && format.normalised) {
    if (!(await provider.isAvailable(module.code))) {
      datasetStatus = 'dataset_unavailable'
    } else {
      record = await provider.lookup(module.code, format.normalised)
      datasetStatus = record ? 'matched' : 'not_found'
    }
  }

  let geoStatus: GeographicConsistency = 'not_assessable'
  let geoDetail = 'No reference data is available to compare this postcode with the state and LGA.'
  if (record && !record.state) geoDetail = 'NIPOST confirmed that this postcode exists. Your current Validator access does not return state or LGA details.'
  if (format.valid && state) {
    if (record?.state) {
      const recordState = module.findState(record.state)
      const stateOk = recordState?.isoCode === state.isoCode
      const lgaOk = !record.lga || !input.lga || foldName(record.lga) === foldName(module.canonicalLga(state, input.lga) ?? input.lga)
      geoStatus = stateOk && lgaOk ? 'consistent' : 'inconsistent'
      geoDetail = stateOk && lgaOk
        ? 'The postcode dataset places this postcode in the state and LGA you entered.'
        : `The postcode dataset places this postcode in ${record.state}${record.lga ? `, ${record.lga}` : ''}.`
    } else if (!record && format.statePrefix) {
      const prefixOwner = module.states.find((s) => s.digitalPostcodeCode === format.statePrefix)
      if (prefixOwner) {
        const ok = prefixOwner.isoCode === state.isoCode
        geoStatus = ok ? 'consistent' : 'inconsistent'
        geoDetail = ok
          ? `The digital postcode prefix ${format.statePrefix} matches ${state.name}.`
          : `The digital postcode prefix ${format.statePrefix} belongs to ${prefixOwner.name}, not ${state.name}.`
      } else if (state.digitalPostcodeCode && state.digitalPostcodeCode !== format.statePrefix) {
        geoStatus = 'inconsistent'
        geoDetail = `${state.name} uses the digital postcode prefix ${state.digitalPostcodeCode}.`
      } else {
        geoDetail = 'The prefix of this digital postcode is not yet in the published list of state codes.'
      }
    }
  }

  let assuranceLevel: AssuranceLevel = 0
  if (format.valid) assuranceLevel = 1
  if (datasetStatus === 'matched' && geoStatus !== 'inconsistent') {
    assuranceLevel = gps.status === 'confirmed' ? 3 : 2
  }

  return {
    format,
    dataset: { status: datasetStatus, record },
    geographic: { status: geoStatus, detail: geoDetail },
    gps,
    proofOfResidence: 'not_established',
    assuranceLevel,
  }
}

export const ASSURANCE_LABELS: Readonly<Record<AssuranceLevel, string>> = {
  0: 'Not validated',
  1: 'Format valid only',
  2: 'Matched to postcode dataset',
  3: 'Matched to dataset with device location fix',
}
