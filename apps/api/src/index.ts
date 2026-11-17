import { createHandler } from './app'
import { loadConfig } from './config'
import { createDb } from './database/db'
import { migrate } from './database/migrate'
import { DbPostcodeProvider } from './postcodes/provider'
import { RateLimiter } from './security/ratelimit'
import { createMailer } from './services/mailer'

const config = loadConfig()
const db = createDb(config.databaseUrl)
const applied = await migrate(db)
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)

const handle = createHandler({
  db,
  config,
  provider: new DbPostcodeProvider(db),
  limiter: new RateLimiter(true),
  mailer: createMailer(config),
  now: () => new Date(),
})

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: 128 * 1024,
  fetch(req, srv) {
    return handle(req, srv.requestIP(req)?.address ?? 'unknown')
  },
})

console.log(`PostcodeProof API listening on :${server.port} (${config.env})`)
