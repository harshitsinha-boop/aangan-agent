import { Button, Heading, Link, Text } from '@react-email/components'
import { buttonStyle, Field, Layout, theme } from './Layout'
import type { EscalationData } from './types'

export const escalationSubject = (d: Pick<EscalationData, 'name' | 'callbackMinutes'>) =>
  `URGENT: Existing client · ${d.name ?? 'Unknown'} · callback within ${d.callbackMinutes} min`

export default function EscalationEmail(d: EscalationData) {
  return (
    <Layout preview={`Existing client ${d.name ?? ''} needs a callback within ${d.callbackMinutes} minutes`} accent={theme.danger}>
      <Text style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: theme.danger }}>URGENT · EXISTING CLIENT</Text>
      <Heading as="h1" style={{ fontSize: 22, margin: '0 0 6px' }}>Callback within {d.callbackMinutes} minutes</Heading>
      <Text style={{ margin: '0 0 14px', fontSize: 15, color: theme.muted }}>An existing client called with a complaint. Someone senior needs to call them back.</Text>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <Field label="Client" value={d.name} />
          <Field label="Project" value={d.project} />
          <Field label="Designer" value={d.designer} />
          <Field label="Issue" value={d.issue} />
          <Field label="Called at" value={d.calledAt} />
        </tbody>
      </table>
      <Text style={{ margin: '18px 0 10px', fontSize: 14 }}>Clicking Acknowledge records you as the owner. If nobody acknowledges in time, the system phones the studio head.</Text>
      <Button href={d.acknowledgeUrl} style={buttonStyle('danger')}>Acknowledge, I will call back</Button>
      <Text style={{ margin: '4px 0 18px', fontSize: 14 }}>
        <Link href={d.dashboardUrl} style={{ color: theme.brand }}>Open in dashboard</Link>
      </Text>
    </Layout>
  )
}
