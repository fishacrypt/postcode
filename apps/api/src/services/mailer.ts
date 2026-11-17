import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config'

export interface MailMessage {
  to: string
  subject: string
  text: string
  /** Machine-readable kind, e.g. "verify-email". */
  kind: string
  /** One-time token that the link in `text` carries. Present so the dev outbox can surface it. */
  token?: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/** Development mailer: keeps messages in memory and in .dev-mail/outbox.jsonl. Never used in production. */
export class DevMailer implements Mailer {
  readonly outbox: MailMessage[] = []

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message)
    if (this.outbox.length > 200) this.outbox.shift()
    try {
      const dir = join(process.cwd(), '.dev-mail')
      mkdirSync(dir, { recursive: true })
      appendFileSync(join(dir, 'outbox.jsonl'), `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`)
    } catch {
      // Best effort only.
    }
    return Promise.resolve()
  }
}

/** Posts the message (without the raw token field) to a transactional-email webhook you operate. */
export class WebhookMailer implements Mailer {
  constructor(private readonly url: string) {}

  async send(message: MailMessage): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text, kind: message.kind }),
    })
    if (!res.ok) throw new Error('Mail delivery failed')
  }
}

export function createMailer(config: Config): Mailer {
  return config.mailer === 'webhook' && config.mailWebhookUrl ? new WebhookMailer(config.mailWebhookUrl) : new DevMailer()
}
