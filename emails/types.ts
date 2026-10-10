export type RubricLine = { label: string; status: 'pass' | 'unclear' | 'fail'; note?: string | null }

export type HandoffData = {
  name: string | null
  phone: string | null // only the last 4 digits are ever rendered
  location: string | null
  projectType: string | null
  carpetArea: number | null
  scope: string | null
  timeline: string | null
  budget: string | null
  source: string | null
  rubric: RubricLine[]
  uncertainty: string | null
  consultation: { when: string; visitType: string } | null
  summary: string
  priority: boolean
  acceptUrl: string
  reassignUrl: string
  dashboardUrl: string
}

export type ReminderData = HandoffData & { hoursWaiting: number }

export type EscalationData = {
  name: string | null
  project: string | null
  designer: string | null
  issue: string | null
  calledAt: string
  callbackMinutes: number
  acknowledgeUrl: string
  dashboardUrl: string
}

export type ConfirmationData = {
  name: string | null
  when: string
  visitType: 'site' | 'studio'
  designerFirstName: string
  studioAddress: string
}
