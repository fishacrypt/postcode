import { z } from 'zod'
import { CLAIM_FIELDS, SENSITIVE_CLAIMS } from '@pp/shared'

const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))

export const emailSchema = z.string().trim().toLowerCase().email().max(254)

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper case, lower case and a number.')

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: trimmed(80),
  role: z.enum(['user', 'business']).default('user'),
  businessName: optionalText(120),
})

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) })

export const gpsSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000),
  capturedAt: z.string().datetime(),
})

export const addressSchema = z.object({
  country: z.literal('NG'),
  state: trimmed(60),
  lga: trimmed(80),
  city: trimmed(80),
  district: optionalText(80),
  street: trimmed(120),
  buildingNumber: trimmed(30),
  unit: optionalText(40),
  postcode: trimmed(20),
  additionalInfo: optionalText(240),
  gps: gpsSchema.optional(),
})
export type AddressPayload = z.infer<typeof addressSchema>

export const postcodeValidateSchema = z.object({
  country: z.literal('NG').default('NG'),
  postcode: trimmed(20),
  state: optionalText(60),
  lga: optionalText(80),
  gps: gpsSchema.optional(),
})

export const claimFieldSchema = z.enum(CLAIM_FIELDS)

export const tokenCreateSchema = z.object({
  fields: z.array(claimFieldSchema).min(1).max(CLAIM_FIELDS.length),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(24),
  label: optionalText(80),
  maxUses: z.number().int().min(1).max(1000).optional(),
  acknowledgeSensitive: z.boolean().default(false),
})

export const verificationRequestCreateSchema = z.object({
  reference: trimmed(80),
  purpose: trimmed(200),
  requestedFields: z
    .array(claimFieldSchema)
    .min(1)
    .max(CLAIM_FIELDS.length)
    .default(['country', 'state']),
  expiresInHours: z.number().int().min(1).max(24 * 14).default(72),
})

export const consentDecisionSchema = z.object({
  code: z.string().trim().min(6).max(20),
  approve: z.boolean(),
  fields: z.array(claimFieldSchema).max(CLAIM_FIELDS.length).default([]),
  credentialId: z.string().uuid().optional(),
  acknowledgeSensitive: z.boolean().default(false),
})


const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
export const anchorSchema = z.object({
  holder: evmAddress,
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
})

export const tokenSchema = z.object({ token: z.string().min(20).max(200) })
export const forgotPasswordSchema = z.object({ email: emailSchema })
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema })

export const consentStatementSchema = z.object({ accepted: z.literal(true), statementVersion: z.string().max(10) })
export const credentialCreateSchema = z.object({ addressId: z.string().uuid(), consent: consentStatementSchema })
export const revokeSchema = z.object({ reason: z.string().trim().max(200).optional() })

export const businessUpdateSchema = z.object({
  name: trimmed(120),
  website: z.string().trim().url().max(200).optional().or(z.literal('')),
  contactEmail: emailSchema.optional().or(z.literal('')),
  description: optionalText(400),
})

export const API_SCOPES = ['verification:create', 'verification:read', 'credential:verify'] as const
export const apiKeyCreateSchema = z.object({
  name: trimmed(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(['verification:create', 'verification:read']),
  expiresInDays: z.number().int().min(1).max(365).optional(),
})

export const presentationSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  disclosures: z.array(z.object({ field: claimFieldSchema, value: z.string().max(300), salt: z.string().max(100) })).max(20).default([]),
})

export const disclosureRequestSchema = z.object({ requestId: z.string().uuid() })
export const consentCodeSchema = z.object({ code: z.string().trim().min(6).max(20) })
export const adminRoleSchema = z.object({ role: z.enum(['user', 'business', 'issuer', 'admin']) })
export const gpsConfirmSchema = z.object({ gps: gpsSchema })

export const profileUpdateSchema = z.object({ displayName: trimmed(80), businessName: optionalText(120) })
export const passwordChangeSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })

export const contactSchema = z.object({
  name: trimmed(80),
  email: emailSchema,
  message: trimmed(2000),
})

export function isSensitiveClaim(field: string): boolean {
  return (SENSITIVE_CLAIMS as readonly string[]).includes(field)
}

/** Flatten zod issues into a field -> message map for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    out[key] ??= issue.message
  }
  return out
}
