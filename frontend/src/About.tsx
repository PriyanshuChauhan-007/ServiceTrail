import { PageHeading } from './components'

const stages = [
  ['Create the service job', 'Record the customer request, service location, equipment, and the original wording before assigning the visit.'],
  ['Assign the technician', 'A supervisor assigns the job, schedule, and current responsibility. The technician sees the request without needing a technical diagnosis.'],
  ['Record the visit', 'The technician records arrival, observation, work performed, parts or materials, and the outcome in the field.'],
  ['Add proof of work', 'Attach before/after photos, equipment labels, readings, or other evidence that helps the office and customer understand the visit.'],
  ['Review and confirm', 'A supervisor checks that the service record is complete. A customer or site contact can acknowledge the visit without claiming automatic technical validation.'],
  ['Track follow-up', 'If more work or parts are required, assign a follow-up owner and keep the complete customer and equipment history visible.'],
]

export default function About() {
  return <div className="about-page">
      <PageHeading eyebrow="HOW IT WORKS" title="One service visit. A complete record."
      description="Keep the customer request, technician observation, evidence, work performed, confirmation, and follow-up together so the office knows what happened." />

    <div className="about-grid">
      <section className="panel">
        <p className="eyebrow">THE PROBLEM</p><h2>A technician visit should not disappear into chat.</h2>
        <p>After a field visit, the office needs to know what was observed, what changed, which parts were used, what evidence exists, whether the customer acknowledged the work, and what follow-up remains.</p>
        <p>ServiceTrail keeps those answers in one service record. It helps a company coordinate and prove work without pretending to diagnose equipment automatically.</p>
      </section>
      <section className="panel">
        <p className="eyebrow">START WITH A SERVICE JOB</p><h2>Read the next responsibility.</h2>
        <p>Open a job from My jobs or Service jobs. Its status and next responsibility explain who needs to act.</p>
        <ul className="about-list">
          <li><strong>Customer request:</strong> what was asked for and where.</li>
          <li><strong>Visit record:</strong> what the technician observed and performed.</li>
          <li><strong>Evidence and confirmation:</strong> proof attached and acknowledgement recorded.</li>
          <li><strong>Follow-up trail:</strong> who owns the next action and what happened later.</li>
        </ul>
      </section>
    </div>

    <section className="panel"><p className="eyebrow">THE WORKFLOW</p><h2>From observation to closure.</h2>
      <div className="about-stages">{stages.map(([title, body], index) => <div className="about-stage-card" key={title}>
        <span className="stage-num mono">0{index + 1}</span><div><strong>{title}</strong><p>{body}</p></div>
      </div>)}</div>
    </section>

    <section className="panel"><p className="eyebrow">PEOPLE</p><h2>Different jobs, different permissions.</h2>
      <div className="table-wrapper"><table className="audit-table"><thead><tr><th>Role</th><th>What they do</th><th>What they cannot do</th></tr></thead><tbody>
        <tr><td>Worker</td><td>Report observations, answer questions, and record their own or assigned work.</td><td>Approve a report or verify their own execution.</td></tr>
        <tr><td>Engineer</td><td>Review sources, request clarification, release work, and verify others' execution.</td><td>Approve their own report or replace the worker's source statement.</td></tr>
        <tr><td>Supervisor</td><td>Coordinate the site queue, register equipment, review handoffs, and independently verify completed work.</td><td>Approve their own report, change another person's source, or skip the required checks.</td></tr>
        <tr><td>Administrator</td><td>Register assets, create team accounts and sites, and manage access.</td><td>Approve their own report or silently rewrite incident history.</td></tr>
      </tbody></table></div>
    </section>

    <section className="panel"><p className="eyebrow">TRY A DIFFERENT INPUT</p><h2>The records are editable, not a slideshow.</h2>
      <p>In the shared workspace, use View as to change between prepared accounts without another browser. The selected account's actual permissions apply. Example records and changes are shared with other visitors; do not enter private information.</p>
      <p>Try changing an unanswered injury or equipment-state field, save the source, and analyze it again as an engineer. Findings respond to the new input. You can also create a fresh report, add an asset, or create an account through Site &amp; team as the administrator.</p>
      <p>For ordinary accounts, sign in with the account created by your administrator. Those accounts do not inherit the shared workspace's account-switching access.</p>
    </section>

    <section className="panel"><p className="eyebrow">OTHER TOOLS</p><h2>Use what the work needs.</h2>
      <ul className="about-list">
        <li><strong>Asset register:</strong> equipment codes and locations. Supported browsers can look up a registered code with the camera.</li>
        <li><strong>Work methods:</strong> create checklist instructions and select them during release. A changed method is a new record.</li>
        <li><strong>Notifications:</strong> open handoffs and mark them read. Reading does not complete the work.</li>
        <li><strong>Site dashboard and Operations metrics:</strong> counts and timing calculated from saved incidents, not proof of physical equipment performance.</li>
        <li><strong>Device drafts:</strong> explicitly save a report after a connection failure with an unlocked device vault, then sync manually. Approvals, uploads, and verification require a connection.</li>
        <li><strong>Account security:</strong> passwords, authenticator setup, recovery codes, sessions, and the local device vault.</li>
      </ul>
    </section>
    <p className="notice info">Rules help find missing or contradictory information. They do not diagnose equipment, prove isolation, or authorize physical maintenance. Follow qualified personnel and the applicable site procedures.</p>
  </div>
}
