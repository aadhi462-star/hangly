/// <reference types="vite/client" />
import type { ScreenPalsApi } from '../shared/ipc'

declare global {
  interface Window {
    screenpals: ScreenPalsApi
  }
}

export {}
