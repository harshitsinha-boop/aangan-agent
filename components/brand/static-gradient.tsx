/** Warm, quiet gradient: the fallback for reduced-motion / touch-only devices, and the layer under the canvas while it loads. */
export function StaticGradient({ hue = 25, className = '' }: { hue?: number; className?: string }) {
  return (
    <div
      className={`absolute inset-0 ${className}`}
      style={{
        background: [
          `radial-gradient(60% 90% at 78% 30%, hsl(${hue} 55% 38% / 0.55), transparent 70%)`,
          `radial-gradient(50% 80% at 15% 85%, hsl(${hue + 10} 40% 28% / 0.55), transparent 70%)`,
          `linear-gradient(135deg, hsl(${hue} 30% 11%), hsl(${hue - 5} 28% 17%))`,
        ].join(','),
      }}
    />
  )
}
