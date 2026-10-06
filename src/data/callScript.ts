/**
 * The scripted conversation a simulated call plays out.
 *
 * This is the one piece that stands in for a recording bot joining Zoom. Everything
 * downstream of it is real: the lines stream in on a clock, the live coach is a real
 * model call on real context, and the saved meeting is summarised by a real model.
 *
 * It is written so the user is *in* the conversation and gets asked things directly —
 * otherwise live coaching has nothing to coach. `addressedToYou` marks the moments
 * where the room is waiting for them, which is when a suggestion is worth interrupting
 * for.
 */

export interface ScriptLine {
  /** Seconds from the start of the call. */
  t: number
  speaker: string
  text: string
  /** The room is waiting for the user here. */
  addressedToYou?: boolean
}

export interface CallScenario {
  id: string
  name: string
  blurb: string
  platform: 'zoom' | 'meet' | 'teams'
  participants: string[]
  lines: ScriptLine[]
}

export const YOU = 'You'

export const SCENARIOS: CallScenario[] = [
  {
    id: 'northwind-sso',
    name: 'Northwind SSO — scope call',
    blurb: 'Four people, a contractual date, and a scope that does not fit. You get asked twice.',
    platform: 'zoom',
    participants: [YOU, 'Priya Raman', 'Daniel Okafor', 'Tom Reyes'],
    lines: [
      { t: 3, speaker: 'Priya Raman', text: 'Right, we have twenty minutes and one thing to settle. Northwind have SSO in their contract for the first of November.' },
      { t: 13, speaker: 'Tom Reyes', text: 'It is in the signed annex with a termination clause attached. This is not a roadmap aspiration.' },
      { t: 23, speaker: 'Daniel Okafor', text: 'The scope we wrote is SAML, OIDC and SCIM provisioning plus an admin UI. That is a quarter, not five weeks.' },
      { t: 35, speaker: 'Priya Raman', text: 'So either the date moves or the scope does.' },
      { t: 42, speaker: 'Tom Reyes', text: 'The date cannot move. I would have to go back and renegotiate an annex we already signed.' },
      { t: 52, speaker: 'Priya Raman', text: 'You have been closest to the Northwind account this month. What do they actually need on day one?', addressedToYou: true },
      { t: 68, speaker: 'Daniel Okafor', text: 'If it is only SAML I can hold the first of November. Everything else is what makes it a quarter.' },
      { t: 79, speaker: 'Tom Reyes', text: 'Their annex names SAML with Okta. Nothing else is named.' },
      { t: 88, speaker: 'Priya Raman', text: 'Then we cut to SAML only and move SCIM and OIDC to Q4 with no date.' },
      { t: 98, speaker: 'Daniel Okafor', text: 'Group-to-role mapping would have to be a config file for the first release. For one customer that is fine.' },
      { t: 110, speaker: 'Priya Raman', text: 'Acme have been asking about SCIM too. If we promise them Q4 and miss it we are back here in January. How do you want to handle that one?', addressedToYou: true },
      { t: 128, speaker: 'Tom Reyes', text: 'I can live with that as long as I know what I am allowed to say to them.' },
      { t: 137, speaker: 'Priya Raman', text: 'Good. Daniel, SAML only, plan by Thursday. Tom, confirm the scope and the date to Northwind in writing by Friday.' },
      { t: 150, speaker: 'Daniel Okafor', text: 'Thursday works.' },
      { t: 155, speaker: 'Priya Raman', text: 'That is the meeting. Thanks everyone.' },
    ],
  },
  {
    id: 'latency-escalation',
    name: 'Customer escalation — intermittent latency',
    blurb: 'Three people, an angry customer, and no reproduction. You own the response.',
    platform: 'meet',
    participants: [YOU, 'Rachel Donovan', 'Luis Ferreira'],
    lines: [
      { t: 3, speaker: 'Rachel Donovan', text: 'Third report this week from the same customer. Slow sometimes, fine mostly, no request IDs.' },
      { t: 14, speaker: 'Luis Ferreira', text: 'I think I have it. The p99 on the ingest endpoint spikes to two and a half seconds, on the hour, every hour.' },
      { t: 26, speaker: 'Rachel Donovan', text: 'The backfill runs on the hour.' },
      { t: 31, speaker: 'Luis Ferreira', text: 'And it shares a connection pool with the ingest API. It is pool saturation, not a slow query.' },
      { t: 42, speaker: 'Rachel Donovan', text: 'So it is not intermittent at all. It is four minutes, twenty-four times a day, and they happen to notice three times a week.' },
      { t: 54, speaker: 'Luis Ferreira', text: 'I can move the backfill off the hour tomorrow. The real fix is separate pools and that is not this week.' },
      { t: 65, speaker: 'Rachel Donovan', text: 'They are up for renewal in February and they have asked for a date twice. What do we tell them?', addressedToYou: true },
      { t: 82, speaker: 'Luis Ferreira', text: 'I would rather not promise a date on the permanent fix. I have been wrong about that before.' },
      { t: 92, speaker: 'Rachel Donovan', text: 'The part that bothers me is that the customer was our monitoring. We alert on p50 and error rate, and this trips neither.' },
      { t: 105, speaker: 'Luis Ferreira', text: 'I will add a p99 alert at eight hundred milliseconds this week.' },
      { t: 114, speaker: 'Rachel Donovan', text: 'Then I will write back today. Mitigated tomorrow, permanent fix in flight, no date.' },
      { t: 125, speaker: 'Luis Ferreira', text: 'Agreed.' },
    ],
  },
]

export function scenarioById(id: string): CallScenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export function scenarioDuration(scenario: CallScenario): number {
  return scenario.lines.length === 0 ? 0 : scenario.lines[scenario.lines.length - 1].t + 8
}
