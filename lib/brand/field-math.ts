// Pure maths for the force-field background, kept out of the component so it is testable and allocation-free:
// no vector objects, typed arrays only, nothing here touches the DOM or p5.

/** Raise the grid spacing so the canvas never holds more than `maxPoints` grid cells, whatever the screen size. */
export function effectiveSpacing(width: number, height: number, spacing: number, maxPoints: number): number {
  if (width <= 0 || height <= 0) return spacing
  const needed = Math.sqrt((width * height) / maxPoints)
  return Math.max(spacing, Math.ceil(needed * 100) / 100)
}

export type PixelSource = { width: number; height: number; pixels: ArrayLike<number> } // RGBA, like p5.Image.pixels

export type Points = {
  xs: Float32Array; ys: Float32Array
  /** stroke width in px */ sw: Float32Array
  /** 0..1 luminance */ br: Float32Array
  count: number; spacing: number
}

/** Sample the image on a cover-fitted grid. Called once per (re)size, never per frame. Dark pixels are skipped. */
export function buildPoints(o: {
  width: number; height: number; spacing: number; maxPoints: number; minStroke: number; maxStroke: number; img: PixelSource
}): Points {
  const sp = effectiveSpacing(o.width, o.height, o.spacing, o.maxPoints)
  const cols = Math.max(1, Math.floor(o.width / sp))
  const rows = Math.max(1, Math.floor(o.height / sp))
  const cap = cols * rows
  const xs = new Float32Array(cap), ys = new Float32Array(cap), sw = new Float32Array(cap), br = new Float32Array(cap)
  const { img } = o
  const scale = Math.max(o.width / img.width, o.height / img.height)
  const offX = (img.width * scale - o.width) / 2
  const offY = (img.height * scale - o.height) / 2
  const padX = (o.width - (cols - 1) * sp) / 2
  const padY = (o.height - (rows - 1) * sp) / 2
  let n = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = padX + c * sp, y = padY + r * sp
      const ix = Math.min(img.width - 1, Math.max(0, Math.floor((x + offX) / scale)))
      const iy = Math.min(img.height - 1, Math.max(0, Math.floor((y + offY) / scale)))
      const k = (iy * img.width + ix) * 4
      const lum = (0.299 * img.pixels[k] + 0.587 * img.pixels[k + 1] + 0.114 * img.pixels[k + 2]) / 255
      if (lum < 0.05) continue
      xs[n] = x; ys[n] = y; br[n] = lum
      sw[n] = o.minStroke + (o.maxStroke - o.minStroke) * lum * lum
      n++
    }
  }
  return { xs: xs.subarray(0, n), ys: ys.subarray(0, n), sw: sw.subarray(0, n), br: br.subarray(0, n), count: n, spacing: sp }
}

/** Magnifier force at (px,py) from a pointer at (mx,my): 0 outside the radius, smooth falloff inside.
 *  Writes into `out` ([dx, dy, t]) to avoid allocating per point per frame. */
export function pointerForce(px: number, py: number, mx: number, my: number, radius: number, strength: number, out: Float32Array): void {
  const dx = px - mx, dy = py - my
  const d2 = dx * dx + dy * dy
  if (d2 >= radius * radius || d2 === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return }
  const d = Math.sqrt(d2)
  const u = 1 - d / radius
  const t = u * u * (3 - 2 * u) // smoothstep
  const push = t * strength * 2.2
  out[0] = (dx / d) * push; out[1] = (dy / d) * push; out[2] = t
}
