import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), commonjs(), nodeResolve()],
    build: {
      rollupOptions: {
        input: 'main.js'
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          preload: resolve('preload.js'),
          'browser-preload': resolve('browser-preload.js')
        }
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
