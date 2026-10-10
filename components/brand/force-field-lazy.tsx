'use client'

import dynamic from 'next/dynamic'

/** p5 touches `window`, so the field is client-only (ssr: false) and kept out of server components and the initial bundle. */
export const ForceFieldBackground = dynamic(
  () => import('./force-field-background').then((m) => m.ForceFieldBackground),
  { ssr: false, loading: () => null },
)
