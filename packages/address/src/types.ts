/**
 * Country-independent address contracts.
 * A country module implements `CountryModule`; Nigeria (NG) is the only active module in this release.
 */

export type CountryCode = string

export interface AdminArea {
  /** ISO 3166-2 subdivision code, for example NG-LA. */
  readonly isoCode: string
  readonly name: string
  readonly lgas: readonly string[]
  /**
   * Two-letter state code used by the national digital postcode, only when
   * the postal authority has published it. Otherwise null (never guessed).
   */
  readonly digitalPostcodeCode: string | null
}

export type PostcodeFormat = 'legacy_6_digit' | 'digital_11_char'

export interface GpsFix {
  readonly latitude: number
  readonly longitude: number
  /** Horizontal accuracy in metres, as reported by the device. */
  readonly accuracyMeters: number
  /** ISO timestamp of the device fix. */
  readonly capturedAt: string
}

export interface AddressInput {
  readonly country: CountryCode
  readonly state: string
  readonly lga: string
  readonly city: string
  readonly district?: string
  readonly street: string
  readonly buildingNumber: string
  readonly unit?: string
  readonly postcode: string
  readonly additionalInfo?: string
  readonly gps?: GpsFix
}

export interface PostcodeFormatResult {
  readonly valid: boolean
  readonly normalised: string | null
  readonly format: PostcodeFormat | null
  /** Human-readable reason when invalid. */
  readonly reason: string | null
  /** Two-letter prefix of a digital postcode, when present. */
  readonly statePrefix: string | null
}

export interface PostcodeRecord {
  readonly postcode: string
  readonly state: string | null
  readonly lga: string | null
  readonly area: string | null
  readonly sourceId: string
}

/**
 * A provider answers "is this postcode in a dataset I trust?".
 * `isAvailable` is false when no dataset is loaded for the country, so callers
 * can say "unavailable" instead of pretending the postcode was unknown.
 */
export interface PostcodeProvider {
  readonly id: string
  isAvailable(country: CountryCode): Promise<boolean>
  lookup(country: CountryCode, normalisedPostcode: string): Promise<PostcodeRecord | null>
}

export interface CountryModule {
  readonly code: CountryCode
  readonly name: string
  readonly active: boolean
  readonly states: readonly AdminArea[]
  findState(nameOrCode: string): AdminArea | null
  isLgaInState(state: AdminArea, lga: string): boolean
  canonicalLga(state: AdminArea, lga: string): string | null
  validatePostcodeFormat(input: string): PostcodeFormatResult
}

export type DatasetStatus = 'matched' | 'not_found' | 'dataset_unavailable' | 'not_checked'
export type GeographicConsistency = 'consistent' | 'inconsistent' | 'not_assessable'
export type GpsStatus = 'not_provided' | 'confirmed' | 'low_accuracy'

/** Layered result. Each layer is a separate claim and is never merged into one boolean. */
export interface PostcodeValidation {
  readonly format: PostcodeFormatResult
  readonly dataset: {
    readonly status: DatasetStatus
    readonly record: PostcodeRecord | null
  }
  readonly geographic: {
    readonly status: GeographicConsistency
    readonly detail: string
  }
  readonly gps: {
    readonly status: GpsStatus
    readonly accuracyMeters: number | null
    readonly capturedAt: string | null
  }
  /** Residence is never established by this system. */
  readonly proofOfResidence: 'not_established'
  readonly assuranceLevel: AssuranceLevel
}

/**
 * 0 = unverified (format invalid), 1 = format only, 2 = dataset match,
 * 3 = dataset match plus device GPS fix.
 */
export type AssuranceLevel = 0 | 1 | 2 | 3
