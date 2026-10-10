import { Body, Container, Head, Html, Preview, Section, Text } from '@react-email/components'
import type { ReactNode } from 'react'

export const theme = {
  bg: '#f6f0e8', card: '#ffffff', ink: '#2b211a', muted: '#7a6b5d', line: '#e6dccf',
  brand: '#7a4a2b', brandSoft: '#f1e4d6', danger: '#b3261e', dangerSoft: '#fdecea', warnSoft: '#fff4e5',
  font: "'Helvetica Neue', Helvetica, Arial, sans-serif",
}

export function Layout({ preview, children, accent = theme.brand }: { preview: string; children: ReactNode; accent?: string }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: theme.bg, margin: 0, padding: '24px 12px', fontFamily: theme.font, color: theme.ink }}>
        <Container style={{ maxWidth: 560, margin: '0 auto' }}>
          <Text style={{ fontSize: 13, letterSpacing: 3, textTransform: 'uppercase', color: accent, margin: '0 0 12px 4px', fontWeight: 700 }}>
            Aangan Studio
          </Text>
          <Section style={{ backgroundColor: theme.card, border: `1px solid ${theme.line}`, borderTop: `4px solid ${accent}`, borderRadius: 12, padding: '24px 24px 8px' }}>
            {children}
          </Section>
          <Text style={{ fontSize: 12, color: theme.muted, margin: '14px 4px 0' }}>
            Sent by Aangan Studio, Pune. This message contains a summary only; the full record is in the dashboard.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  if (!value) return null
  return (
    <tr>
      <td style={{ padding: '4px 14px 4px 0', color: theme.muted, fontSize: 13, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '4px 0', fontSize: 15 }}>{value}</td>
    </tr>
  )
}

export const buttonStyle = (variant: 'primary' | 'secondary' | 'danger' = 'primary') => ({
  display: 'inline-block', padding: '12px 22px', borderRadius: 10, fontSize: 15, fontWeight: 600, textDecoration: 'none', margin: '0 8px 10px 0',
  ...(variant === 'secondary'
    ? { backgroundColor: '#ffffff', color: theme.brand, border: `1px solid ${theme.brand}` }
    : { backgroundColor: variant === 'danger' ? theme.danger : theme.brand, color: '#ffffff', border: `1px solid ${variant === 'danger' ? theme.danger : theme.brand}` }),
})
