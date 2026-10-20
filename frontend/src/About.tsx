import { PageHeading } from './components'

const stages = [
  ['Report the problem', 'Choose an asset in New field report. Describe what happened, the impact, and what is still unknown. Attach an image or PDF to the saved report if useful.'],
  ['Ask for missing information', 'An engineer opens Analysis & decision, reads the source, checks the findings, and returns questions to the author when needed.'],
  ['Review the current version', 'The author uses Revise report to answer. Changes create a new source version, so the engineer must analyze and review that version again.'],
  ['Release the work', 'The engineer selects a work method, adds a decision note, confirms review, and approves. A report author cannot approve their own report.'],
  ['Record the work', 'The author or assigned worker opens Released work, begins, and saves notes against the checklist. Finished work is submitted for verification, not automatically closed.'],
  ['Verify and close', 'A reviewer who did not report or execute the work checks the notes and records a verification decision. Activity trail and the exports retain the history.'],
]

export default function About() {
  return <div className="about-page">
    <PageHeading eyebrow="HOW IT WORKS" title="One equipment problem. A clear handover."
      description="Keep the original observation, questions, work decisions, and completion notes together so the next person knows what happened and what to do." />

    <div className="about-grid">
      <section className="panel">
        <p className="eyebrow">THE PROBLEM</p><h2>A message is not a completed handover.</h2>
        <p>When a machine stops, a short message rarely answers every question. Which asset? What did the operator see? Was anyone hurt? Who agreed to the work? Has someone checked the result?</p>
        <p>OpsBridge keeps those answers in a single incident record. Missing information can be requested before work is released, and changes stay visible rather than replacing the original account.</p>
      </section>
      <section className="panel">
        <p className="eyebrow">START WITH A RECORD</p><h2>Read the next responsibility.</h2>
        <p>Open a record from My notebook or Work register. Its status and next responsibility explain who needs to act.</p>
        <ul className="about-list">
          <li><strong>Source &amp; evidence:</strong> what was reported and attached.</li>
          <li><strong>Analysis &amp; decision:</strong> questions, findings, assignment, and approval.</li>
          <li><strong>Released work:</strong> checklist notes and verification.</li>
          <li><strong>Activity trail:</strong> who changed what and against which source version.</li>
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
