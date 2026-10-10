/** One place to tune the brand particle field (login page + dashboard hero band). */
export const brandParticles = {
  imageUrl: '/brand/hero.jpg', // local file only; never hotlink
  hue: 25, // warm terracotta / sand
  saturation: 35,
  spacing: 12,
  forceStrength: 8,
  magnifierRadius: 140,
  minStroke: 1.5,
  maxStroke: 5,
} as const

export type ParticleConfig = {
  imageUrl: string; hue: number; saturation: number; spacing: number
  forceStrength: number; magnifierRadius: number; minStroke: number; maxStroke: number
}

export const MAX_POINTS = 12_000
