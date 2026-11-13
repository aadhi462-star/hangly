/// <reference types="vite/client" />
import type { ScreenlyApi } from '../shared/ipc'

declare global {
  interface Window {
    screenly: ScreenlyApi
  }
}

export {}
