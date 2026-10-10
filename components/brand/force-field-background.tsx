'use client'

import { useEffect, useRef, useState } from 'react'
import { brandParticles, MAX_POINTS, type ParticleConfig } from '@/lib/brand/particles'
import { buildPoints, pointerForce, type Points } from '@/lib/brand/field-math'
import { StaticGradient } from './static-gradient'

type Props = Partial<ParticleConfig> & { className?: string; maxPoints?: number }
type Status = 'loading' | 'ready' | 'error'
const BUCKETS = 6

/**
 * Interactive "force field" of warm strokes sampled from a photograph; strokes bloom and part around the pointer.
 * A brand layer only: it renders BEHIND content and is hidden from assistive tech. p5 is imported lazily and only when the
 * canvas will actually be shown (no p5 for reduced-motion or touch-only visitors, who get a static gradient instead).
 */
export function ForceFieldBackground(props: Props) {
  const cfg = { ...brandParticles, ...props }
  const { className = '', maxPoints = MAX_POINTS } = props
  const host = useRef<HTMLDivElement>(null)
  // Client-only component (loaded with ssr:false), so reading window in the initialiser is safe: no hydration mismatch.
  const [mode] = useState<'canvas' | 'static'>(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const noHover = window.matchMedia('(hover: none)').matches || !window.matchMedia('(any-hover: hover)').matches
    return reduce || noHover ? 'static' : 'canvas'
  })
  const [status, setStatus] = useState<Status>('loading')
  // The effect below must not restart when the parent re-renders with identical numbers.
  const key = JSON.stringify([cfg.imageUrl, cfg.hue, cfg.saturation, cfg.spacing, cfg.forceStrength, cfg.magnifierRadius, cfg.minStroke, cfg.maxStroke, maxPoints])

  useEffect(() => {
    if (mode !== 'canvas') return
    const el = host.current
    if (!el) return
    let disposed = false
    let cleanup: (() => void) | undefined

    ;(async () => {
      let P5: typeof import('p5')
      try {
        P5 = (await import('p5')).default as unknown as typeof import('p5')
      } catch {
        if (!disposed) setStatus('error')
        return
      }
      if (disposed) return
      const [, hue, sat] = [cfg.imageUrl, cfg.hue, cfg.saturation]

      const sketch = (p: import('p5')) => {
        let img: import('p5').Image | null = null
        let pts: Points | null = null
        let ready = false
        let visible = true
        let docVisible = !document.hidden
        let active = false // pointer inside the host
        let mx = 0, my = 0
        const force = new Float32Array(3) // reused every point, every frame: no per-point allocation
        let resizeTimer: ReturnType<typeof setTimeout> | undefined

        const size = () => ({ w: Math.max(1, Math.floor(el.clientWidth)), h: Math.max(1, Math.floor(el.clientHeight)) })

        /** (Re)build the grid. img.loadPixels() runs ONCE here, not in draw(). */
        const processImage = () => {
          if (!img) return
          const { w, h } = size()
          img.loadPixels()
          pts = buildPoints({ width: w, height: h, spacing: cfg.spacing, maxPoints, minStroke: cfg.minStroke, maxStroke: cfg.maxStroke, img: { width: img.width, height: img.height, pixels: img.pixels } })
        }

        const syncLoop = () => {
          if (!ready) return
          if (visible && docVisible && active) p.loop()
          else { p.noLoop(); p.redraw() } // settle one final frame, then stop burning CPU
        }

        p.setup = () => {
          const { w, h } = size()
          const c = p.createCanvas(w, h)
          c.parent(el)
          c.elt.setAttribute('aria-hidden', 'true')
          c.elt.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
          p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2))
          p.noLoop()
          p.loadImage(
            cfg.imageUrl,
            (loaded) => { img = loaded; processImage(); ready = true; if (!disposed) setStatus('ready'); p.redraw() },
            () => { if (!disposed) setStatus('error') },
          )
        }

        p.draw = () => {
          if (!pts) return
          p.clear()
          const ctx = p.drawingContext as CanvasRenderingContext2D
          ctx.lineCap = 'round'
          const R = cfg.magnifierRadius, R2 = R * R
          const len = pts.spacing * 0.62
          const buckets: number[][] = Array.from({ length: BUCKETS }, () => [])
          const near: number[] = []
          for (let i = 0; i < pts.count; i++) {
            if (active) {
              const dx = pts.xs[i] - mx, dy = pts.ys[i] - my
              if (dx * dx + dy * dy < R2) { near.push(i); continue }
            }
            buckets[Math.min(BUCKETS - 1, Math.floor(pts.br[i] * BUCKETS))].push(i)
          }
          // Far points: batched per brightness bucket (one path + one stroke each) so 12k strokes stay cheap.
          for (let b = 0; b < BUCKETS; b++) {
            const list = buckets[b]
            if (!list.length) continue
            const lum = (b + 0.5) / BUCKETS
            ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${28 + 52 * lum}%, ${0.28 + 0.55 * lum})`
            let wSum = 0
            for (const i of list) wSum += pts.sw[i]
            ctx.lineWidth = wSum / list.length
            ctx.beginPath()
            for (const i of list) {
              const x = pts.xs[i], y = pts.ys[i]
              const a = Math.sin(x * 0.012) * 1.1 + Math.cos(y * 0.017) * 0.9 // calm, fixed flow field
              ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
            }
            ctx.stroke()
          }
          // Near the pointer: individually displaced, swelled and brightened (the magnifier).
          for (const i of near) {
            pointerForce(pts.xs[i], pts.ys[i], mx, my, R, cfg.forceStrength, force)
            const x = pts.xs[i] + force[0], y = pts.ys[i] + force[1], t = force[2]
            const a = Math.atan2(y - my, x - mx) + Math.PI / 2 * (1 - t) // lines swing to point away from the pointer
            const l = len * (1 + t * 0.9)
            ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${40 + 45 * Math.min(1, pts.br[i] + t * 0.5)}%, ${0.4 + 0.55 * t})`
            ctx.lineWidth = Math.min(cfg.maxStroke * 1.4, pts.sw[i] * (1 + t * 0.6))
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke()
          }
        }

        // Debounced ResizeObserver on the CONTAINER (the hero band resizes independently of the window).
        const ro = new ResizeObserver(() => {
          clearTimeout(resizeTimer)
          resizeTimer = setTimeout(() => {
            const { w, h } = size()
            p.resizeCanvas(w, h, true)
            processImage()
            p.redraw()
          }, 150)
        })
        ro.observe(el)

        const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; syncLoop() }, { threshold: 0.01 })
        io.observe(el)
        const onVis = () => { docVisible = !document.hidden; syncLoop() }
        document.addEventListener('visibilitychange', onVis)

        const onMove = (e: PointerEvent) => {
          const r = el.getBoundingClientRect()
          mx = e.clientX - r.left; my = e.clientY - r.top
          const inside = mx >= 0 && my >= 0 && mx <= r.width && my <= r.height
          if (inside !== active) { active = inside; syncLoop() }
        }
        const onLeave = () => { if (active) { active = false; syncLoop() } }
        window.addEventListener('pointermove', onMove, { passive: true })
        document.documentElement.addEventListener('pointerleave', onLeave)

        cleanup = () => {
          clearTimeout(resizeTimer)
          ro.disconnect(); io.disconnect()
          document.removeEventListener('visibilitychange', onVis)
          window.removeEventListener('pointermove', onMove)
          document.documentElement.removeEventListener('pointerleave', onLeave)
        }
      }

      const inst = new (P5 as unknown as new (s: (p: import('p5')) => void) => import('p5'))(sketch)
      const prev = cleanup
      cleanup = () => { prev?.(); inst.remove() }
    })()

    return () => { disposed = true; cleanup?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, key])

  return (
    <div ref={host} aria-hidden="true" className={`absolute inset-0 overflow-hidden ${className}`}>
      <StaticGradient hue={cfg.hue} />
      {mode === 'canvas' && status === 'loading' && <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />}
      {mode === 'canvas' && status === 'error' && (
        <span className="absolute bottom-2 right-3 text-[10px] tracking-wide text-white/40">background unavailable</span>
      )}
    </div>
  )
}
