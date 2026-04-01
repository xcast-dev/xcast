import type { ProxyOptions } from 'vite'

export const proxy: Record<string, ProxyOptions> = {
  '/ms-oauth': {
    target: 'https://login.microsoftonline.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/ms-oauth/, ''),
  },
  '/ms-live': {
    target: 'https://login.live.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/ms-live/, ''),
  },
}
