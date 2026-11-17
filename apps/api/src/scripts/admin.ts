/**
 * Operator CLI. There is deliberately no public way to become an admin.
 *   bun run admin:grant <email> <user|business|issuer|admin>
 */
import { createDb } from '../database/db'

const [email, role] = process.argv.slice(2)
if (!email || !['user', 'business', 'issuer', 'admin'].includes(role ?? '')) {
  console.error('Usage: bun run admin:grant <email> <user|business|issuer|admin>')
  process.exit(1)
}
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const db = createDb(url)
const rows = await db<{ id: string }[]>`UPDATE users SET role = ${role ?? 'user'} WHERE email = ${email.toLowerCase()} RETURNING id`
if (!rows[0]) {
  console.error('No user with that email.')
  process.exitCode = 1
} else {
  await db`DELETE FROM sessions WHERE user_id = ${rows[0].id}`
  await db`INSERT INTO audit_logs (user_id, action, meta) VALUES (${rows[0].id}, 'admin.role_granted_cli', ${JSON.stringify({ role })}::text::jsonb)`
  console.log(`Role for ${email} set to ${role}. Existing sessions were ended.`)
}
await db.close()
