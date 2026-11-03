// src/lib/i18n/locales/zh-TW.ts
// Traditional Chinese dictionary. Typed against the English shape, so a
// missing key fails `bun run typecheck`.

import type { DeepStringRecord, Dictionary } from './en'

export const zhTW: DeepStringRecord<Dictionary> = {
  common: {
    appName: 'ER Whiteboard',
  },
  header: {
    connections: '連線',
    connectedApplications: '已連線的應用程式',
    logout: '登出',
    loggingOut: '登出中...',
    switchToLight: '切換為淺色模式',
    switchToDark: '切換為深色模式',
    themeLoading: '主題切換載入中',
    language: '語言',
  },
  meta: {
    title: 'ER Whiteboard - 協作式圖表編輯器',
  },
  errors: {
    unauthorized: '未經授權',
  },
}
