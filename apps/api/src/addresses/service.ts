import { decrypt, encrypt } from '@pp/crypto/server'
import { getCountryModule, validatePostcode, type GpsFix, type PostcodeValidation } from '@pp/address'
import type { AddressPayload } from '@pp/validation'
import type { AppContext } from '../context'
import { HttpError } from '../http'

interface Sensitive {
  street: string
  buildingNumber: string
  unit?: string
  district?: string
  additionalInfo?: string
  gps?: GpsFix
}

export interface AddressRow {
  id: string
  user_id: string
  country: string
  state: string
  state_code: string
  lga: string
  city: string
  postcode: string
  postcode_format: string | null
  sensitive_blob: Uint8Array
  encryption_key_version: number
  assurance_level: number
  created_at: Date
  updated_at: Date
}

export interface AddressDto {
  id: string
  country: string
  state: string
  stateCode: string
  lga: string
  city: string
  district: string | null
  street: string
  buildingNumber: string
  unit: string | null
  postcode: string
  postcodeFormat: string | null
  additionalInfo: string | null
  gps: GpsFix | null
  assuranceLevel: number
  validation: PostcodeValidation | null
  createdAt: Date
  updatedAt: Date
}

const aad = (id: string, userId: string): string => `address:${id}:${userId}`

export function readSensitive(app: AppContext, row: AddressRow): Sensitive {
  return JSON.parse(decrypt(app.config.keys, row.sensitive_blob, aad(row.id, row.user_id))) as Sensitive
}

async function latestValidation(app: AppContext, addressId: string): Promise<PostcodeValidation | null> {
  const rows = await app.db<{ result: PostcodeValidation }[]>`
    SELECT result FROM address_validation_records WHERE address_id = ${addressId} ORDER BY validated_at DESC LIMIT 1`
  return rows[0]?.result ?? null
}

export async function toDto(app: AppContext, row: AddressRow): Promise<AddressDto> {
  const s = readSensitive(app, row)
  return {
    id: row.id,
    country: row.country,
    state: row.state,
    stateCode: row.state_code,
    lga: row.lga,
    city: row.city,
    district: s.district ?? null,
    street: s.street,
    buildingNumber: s.buildingNumber,
    unit: s.unit ?? null,
    postcode: row.postcode,
    postcodeFormat: row.postcode_format,
    additionalInfo: s.additionalInfo ?? null,
    gps: s.gps ?? null,
    assuranceLevel: row.assurance_level,
    validation: await latestValidation(app, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Loads an address only if it belongs to `userId`. Unknown and foreign ids are indistinguishable. */
export async function loadOwned(app: AppContext, id: string, userId: string): Promise<AddressRow> {
  const rows = await app.db<AddressRow[]>`SELECT * FROM addresses WHERE id = ${id} AND user_id = ${userId}`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'not_found', 'Address not found.')
  return row
}

function resolvePlace(input: Pick<AddressPayload, 'country' | 'state' | 'lga'>) {
  const module = getCountryModule(input.country)
  if (!module) throw new HttpError(422, 'country_unsupported', 'This country is not active yet.')
  const state = module.findState(input.state)
  if (!state) throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { state: 'Choose a valid state.' })
  const lga = module.canonicalLga(state, input.lga)
  if (!lga) {
    throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { lga: `This LGA is not in ${state.name}.` })
  }
  return { module, state, lga }
}

export async function runValidation(
  app: AppContext,
  addressId: string,
  userId: string,
  input: Pick<AddressPayload, 'country' | 'state' | 'lga' | 'postcode' | 'gps'>,
): Promise<PostcodeValidation> {
  const { module, state, lga } = resolvePlace(input)
  const result = await validatePostcode(
    module,
    app.provider,
    { postcode: input.postcode, state: state.name, lga, gps: input.gps },
    app.now(),
  )
  await app.db`
    INSERT INTO address_validation_records
      (address_id, user_id, assurance_level, format_valid, dataset_status, dataset_source, geographic, gps_status, result)
    VALUES (${addressId}, ${userId}, ${result.assuranceLevel}, ${result.format.valid}, ${result.dataset.status},
            ${result.dataset.record?.sourceId ?? null}, ${result.geographic.status}, ${result.gps.status}, ${JSON.stringify(result)}::text::jsonb)`
  await app.db`UPDATE addresses SET assurance_level = ${result.assuranceLevel} WHERE id = ${addressId}`
  return result
}

export async function createAddress(app: AppContext, userId: string, input: AddressPayload): Promise<string> {
  const { module, state, lga } = resolvePlace(input)
  const format = module.validatePostcodeFormat(input.postcode)
  if (!format.valid || !format.normalised) {
    throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { postcode: format.reason ?? 'Invalid postcode.' })
  }
  const id = crypto.randomUUID()
  const sensitive: Sensitive = {
    street: input.street,
    buildingNumber: input.buildingNumber,
    unit: input.unit,
    district: input.district,
    additionalInfo: input.additionalInfo,
    gps: input.gps,
  }
  const { blob, keyVersion } = encrypt(app.config.keys, JSON.stringify(sensitive), aad(id, userId))
  await app.db`
    INSERT INTO addresses (id, user_id, country, state, state_code, lga, city, postcode, postcode_format, sensitive_blob, encryption_key_version)
    VALUES (${id}, ${userId}, ${module.code}, ${state.name}, ${state.isoCode}, ${lga}, ${input.city}, ${format.normalised},
            ${format.format}, ${blob}, ${keyVersion})`
  await runValidation(app, id, userId, input)
  return id
}

export async function updateAddress(app: AppContext, row: AddressRow, input: AddressPayload): Promise<void> {
  const { module, state, lga } = resolvePlace(input)
  const format = module.validatePostcodeFormat(input.postcode)
  if (!format.valid || !format.normalised) {
    throw new HttpError(422, 'validation_failed', 'Some fields need attention.', { postcode: format.reason ?? 'Invalid postcode.' })
  }
  const previous = readSensitive(app, row)
  const sensitive: Sensitive = {
    street: input.street,
    buildingNumber: input.buildingNumber,
    unit: input.unit,
    district: input.district,
    additionalInfo: input.additionalInfo,
    // A previous GPS fix only carries over when the caller sends none and the postcode is unchanged.
    gps: input.gps ?? (row.postcode === format.normalised ? previous.gps : undefined),
  }
  const { blob, keyVersion } = encrypt(app.config.keys, JSON.stringify(sensitive), aad(row.id, row.user_id))
  await app.db`
    UPDATE addresses SET state = ${state.name}, state_code = ${state.isoCode}, lga = ${lga}, city = ${input.city},
      postcode = ${format.normalised}, postcode_format = ${format.format}, sensitive_blob = ${blob}, encryption_key_version = ${keyVersion}
    WHERE id = ${row.id}`
  await runValidation(app, row.id, row.user_id, { ...input, gps: sensitive.gps })
}

export async function setGps(app: AppContext, row: AddressRow, gps: GpsFix): Promise<PostcodeValidation> {
  const sensitive = { ...readSensitive(app, row), gps }
  const { blob, keyVersion } = encrypt(app.config.keys, JSON.stringify(sensitive), aad(row.id, row.user_id))
  await app.db`UPDATE addresses SET sensitive_blob = ${blob}, encryption_key_version = ${keyVersion} WHERE id = ${row.id}`
  return runValidation(app, row.id, row.user_id, {
    country: 'NG',
    state: row.state,
    lga: row.lga,
    postcode: row.postcode,
    gps,
  })
}
