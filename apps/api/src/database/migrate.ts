import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'
import { createDb } from './db'

const MIGRATIONS_DIR = join(import.meta.dir, '../../../../database/migrations')

/** Applies pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(db: Db): Promise<string[]> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`
  const done = new Set((await db<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name))
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const applied: string[] = []
  for (const file of files) {
    if (done.has(file)) continue
    const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    await db.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
    })
    applied.push(file)
  }
  return applied
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const db = createDb(url)
  const applied = await migrate(db)
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date')
  await db.close()
}
