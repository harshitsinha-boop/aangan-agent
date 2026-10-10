import { Button, Heading, Hr, Link, Section, Text } from '@react-email/components'
import { buttonStyle, Field, Layout, theme } from './Layout'
import type { HandoffData } from './types'
import { phoneLast4 } from '../lib/phone'

export const handoffSubject = (d: Pick<HandoffData, 'priority' | 'name' | 'location' | 'projectType'>) =>
  `${d.priority ? '⭐ Priority: ' : ''}New lead: ${d.name ?? 'Unknown'} · ${d.location ?? 'Location TBC'} · ${d.projectType ?? 'Project TBC'}`

export default function HandoffEmail({ reminderHours, ...d }: HandoffData & { reminderHours?: number }) {
  return (
    <Layout preview={`${d.name ?? 'A new lead'} · ${d.location ?? ''} · ${d.projectType ?? ''}`} accent={d.priority ? '#a8631d' : theme.brand}>
      {reminderHours !== undefined && (
        <Section style={{ backgroundColor: theme.warnSoft, borderRadius: 8, padding: '10px 14px', margin: '0 0 16px' }}>
          <Text style={{ margin: 0, fontSize: 14 }}>
            This lead has waited {Math.round(reminderHours * 10) / 10}h without being accepted. If nobody accepts it soon, it will be reassigned to the principal designer.
          </Text>
        </Section>
      )}
      {d.priority && <Text style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#a8631d' }}>⭐ PRIORITY LEAD</Text>}
      <Heading as="h1" style={{ fontSize: 22, margin: '0 0 14px' }}>{d.name ?? 'New lead'}</Heading>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <Field label="Phone" value={phoneLast4(d.phone)} />
          <Field label="Location" value={d.location} />
          <Field label="Project" value={d.projectType} />
          <Field label="Carpet area" value={d.carpetArea ? `${d.carpetArea} sq ft` : null} />
          <Field label="Scope" value={d.scope} />
          <Field label="Timeline" value={d.timeline} />
          <Field label="Budget (volunteered)" value={d.budget} />
          <Field label="Source" value={d.source} />
          <Field label="Consultation" value={d.consultation ? `${d.consultation.when} · ${d.consultation.visitType} visit` : 'Not booked yet'} />
        </tbody>
      </table>

      <Hr style={{ borderColor: theme.line, margin: '18px 0' }} />
      <Text style={{ margin: '0 0 6px', fontSize: 13, color: theme.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Rubric</Text>
      {d.rubric.map((r) => (
        <Text key={r.label} style={{ margin: '3px 0', fontSize: 14 }}>
          {r.status === 'pass' ? '✅' : '⚠️'} {r.label}
          {r.note ? <span style={{ color: theme.muted }}> — {r.note}</span> : null}
        </Text>
      ))}
      {d.uncertainty && (
        <Section style={{ backgroundColor: theme.warnSoft, borderRadius: 8, padding: '8px 12px', margin: '12px 0 0' }}>
          <Text style={{ margin: 0, fontSize: 14 }}><b>Uncertainty:</b> {d.uncertainty}</Text>
        </Section>
      )}

      <Hr style={{ borderColor: theme.line, margin: '18px 0' }} />
      <Text style={{ margin: '0 0 18px', fontSize: 15, lineHeight: '22px' }}>{d.summary}</Text>

      <Button href={d.acceptUrl} style={buttonStyle('primary')}>Accept</Button>
      <Button href={d.reassignUrl} style={buttonStyle('secondary')}>Reassign</Button>
      <Text style={{ margin: '4px 0 18px', fontSize: 14 }}>
        <Link href={d.dashboardUrl} style={{ color: theme.brand }}>Open in dashboard</Link>
      </Text>
    </Layout>
  )
}
