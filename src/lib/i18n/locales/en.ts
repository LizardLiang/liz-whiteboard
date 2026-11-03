// src/lib/i18n/locales/en.ts
// English dictionary. Source of truth for the key shape: zh-TW must match it.
// Interpolation uses {name} placeholders.

export const en = {
  common: {
    appName: 'ER Whiteboard',
  },
  header: {
    connections: 'Connections',
    connectedApplications: 'Connected applications',
    logout: 'Log out',
    loggingOut: 'Logging out...',
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
    themeLoading: 'Theme toggle loading',
    language: 'Language',
  },
  meta: {
    title: 'ER Whiteboard - Collaborative Diagram Editor',
  },
  // Server error messages stay English on the wire. The display layer maps the
  // exact English text (the value here) to the key and shows the translation.
  errors: {
    unauthorized: 'Unauthorized',
  },
} as const

export type Dictionary = typeof en

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`
}[keyof T & string]

export type TranslationKey = Paths<Dictionary>

export type DeepStringRecord<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStringRecord<T[K]>
}
