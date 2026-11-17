import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Registers a DOM for component tests. Run these separately from the API tests (`bun run test:web`),
// because it replaces global fetch, Request and Response.
GlobalRegistrator.register({ url: 'http://localhost/' })
