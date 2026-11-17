/** Sends credential expiry reminders. Schedule daily:  bun run notify:expiry [days] */
import { loadConfig } from '../config'
import { createDb } from '../database/db'
import { DbPostcodeProvider } from '../postcodes/provider'
import { RateLimiter } from '../security/ratelimit'
import { createMailer } from '../services/mailer'
import { sendExpiryReminders } from '../services/notifications'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const sent = await sendExpiryReminders(
  { db, config, provider: new DbPostcodeProvider(db), limiter: new RateLimiter(false), mailer: createMailer(config), now: () => new Date() },
  Number(process.argv[2] ?? 14),
)
console.log(`Sent ${sent} expiry reminder(s).`)
await db.close()
