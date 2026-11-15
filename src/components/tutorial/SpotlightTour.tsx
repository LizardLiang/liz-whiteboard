import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CUTOUT_PADDING, padRect, placeCard } from './placement'
import type { Rect } from './placement'
import type { TourStep } from './use-spotlight-tour'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export interface SpotlightTourLabels {
  next: string
  back: string
  skip: string
  done: string
  stepOf: (step: number, total: number) => string
}

export interface SpotlightTourProps {
  open: boolean
  step: number
  steps: Array<TourStep>
  labels: SpotlightTourLabels
  onNext: () => void
  onBack: () => void
  onEnd: () => void
}

const CUTOUT_RADIUS = 8
const CARD_WIDTH_MAX = 352
const CARD_MARGIN = 32

function readRect(el: Element | null): Rect | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  )
}

export function SpotlightTour({
  open,
  step,
  steps,
  labels,
  onNext,
  onBack,
  onEnd,
}: SpotlightTourProps) {
  const titleId = useId()
  const maskId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<Element | null>(null)
  const [target, setTarget] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [cardSize, setCardSize] = useState({ width: CARD_WIDTH_MAX, height: 0 })
  const current = open ? (steps[step] as TourStep | undefined) : undefined
  const last = step >= steps.length - 1

  // Remember the previously focused element on start; restore it on end.
  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement
    return () => {
      const el = returnFocusRef.current
      returnFocusRef.current = null
      if (el instanceof HTMLElement && el.isConnected) el.focus()
    }
  }, [open])

  // Run the step's `before` hook when the step becomes active.
  useEffect(() => {
    if (!current?.before) return
    void current.before()
  }, [current])

  // Follow the target: re-read the rect on every animation frame.
  useEffect(() => {
    if (!current) return
    let frame = 0
    const tick = () => {
      const rect = readRect(current.target())
      setTarget((prev) => (sameRect(prev, rect) ? prev : rect))
      setViewport((prev) =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      )
      const card = cardRef.current
      if (card) {
        const w = card.offsetWidth
        const h = card.offsetHeight
        setCardSize((prev) =>
          prev.width === w && prev.height === h
            ? prev
            : { width: w, height: h },
        )
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [current])

  useEffect(() => {
    if (!current) return
    nextRef.current?.focus()
  }, [current])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onEnd()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        onBack()
      }
    },
    [onEnd, onNext, onBack],
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onKey])

  if (!current || typeof document === 'undefined') return null

  const vw = viewport.width || window.innerWidth
  const vh = viewport.height || window.innerHeight
  const cutout = target ? padRect(target, CUTOUT_PADDING) : null
  const width = Math.min(CARD_WIDTH_MAX, vw - CARD_MARGIN)
  const placement = placeCard(
    cutout,
    { width, height: cardSize.height },
    { width: vw, height: vh },
  )
  const swallow = (e: React.SyntheticEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[45]"
      data-testid="spotlight-tour"
      onPointerDown={swallow}
      onClick={swallow}
      onContextMenu={swallow}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        width={vw}
        height={vh}
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId}>
            <rect width={vw} height={vh} fill="white" />
            {cutout && (
              <rect
                data-testid="spotlight-cutout"
                x={cutout.left}
                y={cutout.top}
                width={cutout.width}
                height={cutout.height}
                rx={CUTOUT_RADIUS}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width={vw}
          height={vh}
          fill="rgb(0 0 0 / 0.55)"
          mask={`url(#${maskId})`}
        />
      </svg>
      <Card
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="spotlight-card"
        className="absolute gap-3 py-4 motion-safe:transition-[left,top] motion-safe:duration-150 motion-safe:ease-out"
        style={{ left: placement.left, top: placement.top, width }}
      >
        <CardHeader className="px-4">
          <h2 id={titleId} className="text-base leading-tight font-semibold">
            {current.title}
          </h2>
        </CardHeader>
        <CardContent className="px-4 text-sm">{current.body}</CardContent>
        <CardFooter className="flex items-center justify-between gap-2 px-4">
          <span className="text-muted-foreground text-xs">
            {labels.stepOf(step + 1, steps.length)}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onEnd}>
              {labels.skip}
            </Button>
            {step > 0 && (
              <Button variant="outline" size="sm" onClick={onBack}>
                {labels.back}
              </Button>
            )}
            <Button ref={nextRef} size="sm" onClick={onNext}>
              {last ? labels.done : labels.next}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>,
    document.body,
  )
}
