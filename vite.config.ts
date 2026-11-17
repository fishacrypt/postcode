import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Content Security Policy for production builds only (the dev server needs inline scripts for fast refresh).
 * Extend connect-src when you add RPC providers. frame-ancestors and HSTS are set by public/_headers.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://rpc.testnet.arc.io https://rpc.mainnet.arc.io",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    nodePolyfills(),
    {
      name: 'postcodeproof-csp',
      transformIndexHtml(html: string) {
        return command === 'build' ? html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`) : html
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pp/address': path.resolve(__dirname, './packages/address/src/index.ts'),
      '@pp/crypto': path.resolve(__dirname, './packages/crypto/src/index.ts'),
      '@pp/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@pp/validation': path.resolve(__dirname, './packages/validation/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'react-router-dom',
      'qrcode',
      'zod',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
}))
