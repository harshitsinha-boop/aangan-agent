import { describe, expect, it } from 'vitest'
import { buildPoints, effectiveSpacing, pointerForce } from '@/lib/brand/field-math'

const flat = (w: number, h: number, v: number) => ({ width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4).fill(v) })

describe('effectiveSpacing: point count is capped whatever the screen size', () => {
  it('keeps the configured spacing when the canvas is small', () => expect(effectiveSpacing(1200, 220, 12, 12000)).toBe(12))
  it('raises spacing on a huge canvas so cells <= 12,000', () => {
    for (const [w, h] of [[3840, 2160], [5120, 2880], [7680, 4320], [2560, 1440]]) {
      const s = effectiveSpacing(w, h, 12, 12000)
      expect(Math.floor(w / s) * Math.floor(h / s)).toBeLessThanOrEqual(12000)
    }
  })
  it('degenerate sizes do not blow up', () => { expect(effectiveSpacing(0, 0, 12, 12000)).toBe(12) })
})

describe('buildPoints', () => {
  const base = { spacing: 12, maxPoints: 12000, minStroke: 1.5, maxStroke: 5 }
  it('never exceeds the cap even for a 4K canvas and a bright image', () => {
    const p = buildPoints({ ...base, width: 3840, height: 2160, img: flat(64, 64, 255) })
    expect(p.count).toBeLessThanOrEqual(12000); expect(p.count).toBeGreaterThan(8000)
  })
  it('skips dark pixels entirely', () => expect(buildPoints({ ...base, width: 800, height: 220, img: flat(32, 32, 0) }).count).toBe(0))
  it('stroke width stays within [minStroke, maxStroke] and grows with brightness', () => {
    const dim = buildPoints({ ...base, width: 400, height: 200, img: flat(8, 8, 90) })
    const bright = buildPoints({ ...base, width: 400, height: 200, img: flat(8, 8, 255) })
    for (const p of [dim, bright]) for (let i = 0; i < p.count; i++) { expect(p.sw[i]).toBeGreaterThanOrEqual(1.5); expect(p.sw[i]).toBeLessThanOrEqual(5) }
    expect(bright.sw[0]).toBeGreaterThan(dim.sw[0])
    expect(bright.sw[0]).toBeCloseTo(5, 5)
  })
  it('points stay inside the canvas', () => {
    const p = buildPoints({ ...base, width: 500, height: 220, img: flat(10, 10, 200) })
    for (let i = 0; i < p.count; i++) { expect(p.xs[i]).toBeGreaterThanOrEqual(0); expect(p.xs[i]).toBeLessThanOrEqual(500); expect(p.ys[i]).toBeLessThanOrEqual(220) }
  })
  it('covers (not letterboxes) a wide canvas with a square image: samples only the image centre band', () => {
    // top half of image dark, bottom bright; a very wide canvas shows only the middle -> some of each
    const w = 10, h = 10, px = new Uint8ClampedArray(w * h * 4)
    for (let y = 5; y < 10; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 4; px[k] = px[k + 1] = px[k + 2] = 255 }
    const p = buildPoints({ ...base, width: 1000, height: 100, img: { width: w, height: h, pixels: px } })
    expect(p.count).toBeGreaterThan(0)
    const rowsBright = new Set(Array.from(p.ys.subarray(0, p.count)).map((y) => Math.round(y)))
    expect(Math.min(...rowsBright)).toBeGreaterThanOrEqual(50 - 1) // only the lower half of the canvas is lit
  })
})

describe('pointerForce (allocation-free)', () => {
  const out = new Float32Array(3)
  it('is zero outside the radius and at the exact pointer position', () => {
    pointerForce(500, 500, 100, 100, 140, 8, out); expect([...out]).toEqual([0, 0, 0])
    pointerForce(100, 100, 100, 100, 140, 8, out); expect([...out]).toEqual([0, 0, 0])
  })
  it('pushes points away from the pointer, more strongly when closer', () => {
    pointerForce(110, 100, 100, 100, 140, 8, out); const near = { dx: out[0], t: out[2] }
    pointerForce(200, 100, 100, 100, 140, 8, out); const far = { dx: out[0], t: out[2] }
    expect(near.dx).toBeGreaterThan(far.dx); expect(far.dx).toBeGreaterThan(0); expect(near.t).toBeGreaterThan(far.t)
  })
  it('scales with forceStrength and keeps direction', () => {
    pointerForce(100, 130, 100, 100, 140, 4, out); const a = out[1]
    pointerForce(100, 130, 100, 100, 140, 8, out); expect(out[1]).toBeCloseTo(a * 2, 5); expect(out[0]).toBeCloseTo(0, 5)
  })
})
