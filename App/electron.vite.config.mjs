import { defineConfig } from 'electron-vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: 'main.js'
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: 'preload.js'
      }
    }
  },
  renderer: {
    root: 'renderer',
    build: {
      rollupOptions: {
        input: resolve('renderer/index.html')
      }
    }
  }
})
