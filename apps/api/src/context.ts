import type { PostcodeProvider } from '@pp/address'
import type { Config } from './config'
import type { Db } from './database/db'
import type { RateLimiter } from './security/ratelimit'
import type { Mailer } from './services/mailer'

export interface AppContext {
  db: Db
  config: Config
  provider: PostcodeProvider
  limiter: RateLimiter
  mailer: Mailer
  now: () => Date
}

export type Role = 'user' | 'business' | 'issuer' | 'admin'

export interface SessionUser {
  id: string
  email: string
  displayName: string
  role: Role
  emailVerified: boolean
  sessionId: string
}
