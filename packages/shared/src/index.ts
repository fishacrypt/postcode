/** Types and constants shared by the web app and the API. */

export type AccountRole = 'user' | 'business' | 'issuer' | 'admin'
export type CredentialStatus = 'active' | 'revoked' | 'expired'
export type AnchorStatus = 'not_anchored' | 'anchored' | 'revoked_onchain'

/** Claims a credential commits to. Street-level claims are sensitive and never requested by default. */
export const CLAIM_FIELDS = ['country', 'state', 'lga', 'city', 'district', 'postcode', 'street', 'buildingNumber'] as const
export type ClaimField = (typeof CLAIM_FIELDS)[number]

export const SENSITIVE_CLAIMS: readonly ClaimField[] = ['street', 'buildingNumber']

export const CLAIM_LABELS: Readonly<Record<ClaimField, string>> = {
  country: 'Country',
  state: 'State',
  lga: 'Local Government Area',
  city: 'City or town',
  district: 'District or neighbourhood',
  postcode: 'Postcode',
  street: 'Street',
  buildingNumber: 'Building number',
}

export interface CredentialDocument {
  format: 'postcodeproof.credential.v1'
  version: 1
  id: string
  type: 'AddressCredential'
  issuer: { name: 'PostcodeProof'; address: string }
  issuedAt: string
  expiresAt: string
  /** Random per credential, so two credentials cannot be linked through their subject reference. */
  subjectRef: string
  /** keccak256 over the canonical commitments object. */
  addressCommitment: string
  /** Salted commitments. Values are revealed only through a presentation the holder consents to. */
  commitments: Partial<Record<ClaimField, string>>
  assurance: {
    level: 0 | 1 | 2 | 3
    formatValid: boolean
    datasetMatch: boolean
    gpsFix: boolean
    proofOfResidence: 'not_established'
    postcodeFormat: 'legacy_6_digit' | 'digital_11_char' | null
  }
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> }
}

export const CREDENTIAL_VALIDITY_DAYS = 365
export const APP_NAME = 'PostcodeProof'
export const TAGLINE = 'Your Address. Verified. Yours.'
