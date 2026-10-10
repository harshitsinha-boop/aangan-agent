import { Heading, Text } from '@react-email/components'
import { Field, Layout } from './Layout'
import type { ConfirmationData } from './types'

export const confirmationSubject = 'Your Aangan Studio consultation is booked'

export default function ConfirmationEmail(d: ConfirmationData) {
  const site = d.visitType === 'site'
  return (
    <Layout preview={`Your consultation is confirmed for ${d.when}`}>
      <Heading as="h1" style={{ fontSize: 22, margin: '0 0 8px' }}>Hello{d.name ? ` ${d.name}` : ''},</Heading>
      <Text style={{ margin: '0 0 14px', fontSize: 15 }}>Your consultation with Aangan Studio is confirmed.</Text>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          <Field label="When" value={d.when} />
          <Field label="Type" value={site ? 'Site visit' : 'Studio visit'} />
          <Field label="Designer" value={d.designerFirstName} />
          <Field label={site ? 'Where' : 'Studio'} value={site ? 'At your property' : d.studioAddress} />
        </tbody>
      </table>
      <Text style={{ margin: '16px 0 0', fontSize: 15, lineHeight: '22px' }}>
        {site
          ? `${d.designerFirstName} will visit your site. We will confirm the exact address with you before the visit.`
          : `Please come to the studio at the time above. ${d.designerFirstName} will be expecting you.`}
      </Text>
      <Text style={{ margin: '12px 0 20px', fontSize: 15 }}>If you need to change the time, just reply to this email or call us back.</Text>
      <Text style={{ margin: '0 0 18px', fontSize: 15 }}>Warm regards,<br />Aangan Studio</Text>
    </Layout>
  )
}
