import type { MetadataRoute } from 'next'

// The dashboard is open (no login), so at least keep search engines away from it.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
