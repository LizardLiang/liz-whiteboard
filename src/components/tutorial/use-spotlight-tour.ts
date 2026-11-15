import { useCallback, useMemo, useReducer } from 'react'

export interface TourStep {
  id: string
  target: () => Element | null
  title: string
  body: string
  before?: () => void | Promise<void>
}

export interface TourState {
  open: boolean
  step: number
  total: number
}

export type TourAction =
  | { type: 'start'; total: number }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'end' }

export const initialTourState: TourState = { open: false, step: 0, total: 0 }

export function tourReducer(state: TourState, action: TourAction): TourState {
  switch (action.type) {
    case 'start':
      if (action.total <= 0) return state
      return { open: true, step: 0, total: action.total }
    case 'next':
      if (!state.open) return state
      if (state.step >= state.total - 1) return { ...state, open: false }
      return { ...state, step: state.step + 1 }
    case 'back':
      if (!state.open || state.step === 0) return state
      return { ...state, step: state.step - 1 }
    case 'end':
      if (!state.open) return state
      return { ...state, open: false }
  }
}

export function useSpotlightTour() {
  const [state, dispatch] = useReducer(tourReducer, initialTourState)
  const start = useCallback(
    (total: number) => dispatch({ type: 'start', total }),
    [],
  )
  const next = useCallback(() => dispatch({ type: 'next' }), [])
  const back = useCallback(() => dispatch({ type: 'back' }), [])
  const end = useCallback(() => dispatch({ type: 'end' }), [])
  return useMemo(
    () => ({ state, start, next, back, end }),
    [state, start, next, back, end],
  )
}
