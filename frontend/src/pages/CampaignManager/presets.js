/**
 * Preset data for Campaign Approval Screen testing (FE-23).
 */
export const DEMO_PRESETS = {
  valid: {
    label: '1. All Checks Pass (Valid Ready)',
    recipient: {
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@acme-robotics.io',
      verifiedStatus: 'deliverable'
    },
    subject: 'Regarding your Junior Python Backend Developer opening',
    body: 'Hi Sarah,\n\nI noticed your recent opening for a Junior Python Backend Developer on Internshala. Our candidates bring hands-on experience building FastAPI microservices and Dockerized systems.\n\nWould you be open to reviewing a few profiles this week?\n\nBest regards,\nCarlos Campaigner',
    dailyLimit: 50,
    sentToday: 12
  },
  invalid_recipient: {
    label: '2. Invalid Recipient (Undeliverable)',
    recipient: {
      name: 'Alex Mercer',
      email: 'invalid-bounce@nonexistent.domain',
      verifiedStatus: 'undeliverable'
    },
    subject: 'Application inquiry for Engineering Team',
    body: 'Hello Alex, reaching out regarding fresher talent.',
    dailyLimit: 50,
    sentToday: 12
  },
  empty_subject: {
    label: '3. Empty Subject Line',
    recipient: {
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@acme-robotics.io',
      verifiedStatus: 'deliverable'
    },
    subject: '',
    body: 'Valid email body text for outreach review.',
    dailyLimit: 50,
    sentToday: 12
  },
  empty_body: {
    label: '4. Empty Message Body',
    recipient: {
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@acme-robotics.io',
      verifiedStatus: 'deliverable'
    },
    subject: 'Valid subject line for review',
    body: '',
    dailyLimit: 50,
    sentToday: 12
  },
  suppressed_email: {
    label: '5. Suppressed Recipient Email',
    recipient: {
      name: 'Opt-Out User',
      email: 'optout@example.com',
      verifiedStatus: 'deliverable'
    },
    subject: 'Regarding your engineering role',
    body: 'Hello, inquiring about current junior developer hiring.',
    dailyLimit: 50,
    sentToday: 12
  },
  suppressed_domain: {
    label: '6. Suppressed Recipient Domain',
    recipient: {
      name: 'Hiring Lead',
      email: 'recruiter@blocked-company.example.com',
      verifiedStatus: 'deliverable'
    },
    subject: 'Fresher talent pipeline for review',
    body: 'Hello team, reaching out with verified technical candidates.',
    dailyLimit: 50,
    sentToday: 12
  },
  limit_exhausted: {
    label: '7. Daily Send Limit Exhausted',
    recipient: {
      name: 'Sarah Jenkins',
      email: 'sarah.jenkins@acme-robotics.io',
      verifiedStatus: 'deliverable'
    },
    subject: 'Regarding your Junior Python Developer opening',
    body: 'Hello Sarah, introducing our pre-vetted candidates.',
    dailyLimit: 50,
    sentToday: 50
  },
  unknown_status: {
    label: '8. Unknown Deliverability Status',
    recipient: {
      name: 'Dev Recruiter',
      email: 'recruiter@startup-pending.org',
      verifiedStatus: 'unknown'
    },
    subject: 'Introduction to technical freshers',
    body: 'Hello, inquiring about current openings.',
    dailyLimit: 50,
    sentToday: 12
  }
}
