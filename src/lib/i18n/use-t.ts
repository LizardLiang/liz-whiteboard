// src/lib/i18n/use-t.ts
import { useContext } from 'react'
import { I18nContext } from './I18nProvider'

export function useI18n() {
  return useContext(I18nContext)
}

export function useT() {
  return useContext(I18nContext).t
}
