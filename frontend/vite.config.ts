import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// No runtime URL discovery: precache only files emitted by this exact build.
function offlineShell() {
  return {
    name: 'opsbridge-offline-shell',
    apply: 'build' as const,
    enforce: 'post' as const,
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' }, injectTo: 'head' as const },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/icons/opsbridge.svg' }, injectTo: 'head' as const },
      ]
    },
    generateBundle(this: import('rollup').PluginContext, _options: unknown, bundle: import('rollup').OutputBundle) {
      const template = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
      const files = Object.keys(bundle).filter(name => name === 'index.html' || name.startsWith('assets/') && !name.endsWith('.map')).sort()
      if (!files.includes('index.html')) throw new Error('Offline shell build must include its entry document')
      const publicFiles = ['manifest.webmanifest', 'icons/opsbridge.svg', 'icons/opsbridge-maskable.svg']
      const hash = createHash('sha256').update(template)
      for (const name of files) {
        const file = bundle[name]
        hash.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      for (const name of publicFiles) hash.update(readFileSync(new URL(`./public/${name}`, import.meta.url)))
      const source = template.replace('__OPSBRIDGE_SHELL_VERSION__', hash.digest('hex').slice(0, 20))
        .replace('__OPSBRIDGE_SHELL_ASSETS__', JSON.stringify([...files, ...publicFiles].map(name => `/${name}`)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), offlineShell()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.OPSBRIDGE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  preview: {
    proxy: { '/api': { target: process.env.OPSBRIDGE_API_TARGET || 'http://127.0.0.1:8000', changeOrigin: false } },
  },
})
