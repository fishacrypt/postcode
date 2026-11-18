/** Typed client for the PostcodeProof API. Cookies carry the session; no secret ever lives in browser code. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      'x-requested-with': 'PostcodeProof',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {}
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong. Please try again.', err?.fields ?? {})
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export type Role = 'user' | 'business' | 'issuer' | 'admin'
export interface User {
  id: string
  email: string
  displayName: string
  role: Role
  emailVerified: boolean
}

export interface Gps {
  latitude: number
  longitude: number
  accuracyMeters: number
  capturedAt: string
}

export interface Validation {
  format: { valid: boolean; normalised: string | null; format: string | null; reason: string | null; statePrefix: string | null }
  dataset: { status: 'matched' | 'not_found' | 'dataset_unavailable' | 'not_checked'; record: { state: string | null; lga: string | null; area: string | null; sourceId?: string } | null }
  geographic: { status: 'consistent' | 'inconsistent' | 'not_assessable'; detail: string }
  gps: { status: 'not_provided' | 'confirmed' | 'low_accuracy'; accuracyMeters: number | null; capturedAt: string | null }
  proofOfResidence: 'not_established'
  assuranceLevel: 0 | 1 | 2 | 3
}

export interface Address {
  id: string
  country: string
  state: string
  lga: string
  city: string
  district: string | null
  street: string
  buildingNumber: string
  unit: string | null
  postcode: string
  additionalInfo: string | null
  gps: Gps | null
  assuranceLevel: 0 | 1 | 2 | 3
  validation: Validation | null
  createdAt: string
  updatedAt: string
}

export type ClaimField = 'country' | 'state' | 'lga' | 'city' | 'district' | 'postcode' | 'street' | 'buildingNumber'
export const CLAIM_LABELS: Record<ClaimField, string> = {
  country: 'Country',
  state: 'State',
  lga: 'Local Government Area',
  city: 'City or town',
  district: 'District or neighbourhood',
  postcode: 'Postcode',
  street: 'Street',
  buildingNumber: 'Building number',
}
export const SENSITIVE: ClaimField[] = ['street', 'buildingNumber']

export interface Credential {
  id: string
  type: string
  status: 'active' | 'expired' | 'revoked'
  issuer: { name: string; address: string }
  issuedAt: string
  expiresAt: string
  credentialHash: string
  assurance: { level: 0 | 1 | 2 | 3; formatValid: boolean; datasetMatch: boolean; gpsFix: boolean; proofOfResidence: string }
  renewable: boolean
  addressChanged: boolean
  address: { state: string; lga: string; city: string; postcode: string } | null
  anchor: { status: 'not_anchored' } | { status: 'anchored'; chainId: number; registry: string; holder: string; txHash: string; anchoredAt: string }
}

export const ASSURANCE_LABELS = [
  'Not validated',
  'Format valid only',
  'Matched to postcode dataset',
  'Matched to dataset with device location fix',
]

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.'
}
