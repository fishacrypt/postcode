import { mock } from 'bun:test'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth'

type Reply = { status?: number; body: unknown }
type Handler = Reply | ((body: unknown) => Reply)
export const calls: { method: string; path: string; body: unknown }[] = []

/** Replaces fetch with an in-memory API. Unknown routes fail the test loudly. */
export function mockApi(routes: Record<string, Handler>): void {
  calls.length = 0
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    const method = init?.method ?? 'GET'
    const key = `${method} ${url.pathname.replace('/api/v1', '')}`
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path: url.pathname, body })
    const handler = routes[key]
    if (!handler) throw new Error(`Unmocked request: ${key}`)
    const reply = typeof handler === 'function' ? handler(body) : handler
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'content-type': 'application/json' } }))
  }) as unknown as typeof fetch
}

export function renderApp(ui: ReactElement, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

export const USER = { id: 'u1', email: 'a@example.com', displayName: 'Ada Obi', role: 'user', emailVerified: true }
