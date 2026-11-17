import { SQL } from 'bun'

export type Db = SQL

export function createDb(url: string): Db {
  return new SQL({ url, max: 10, idleTimeout: 30, connectionTimeout: 10 })
}
