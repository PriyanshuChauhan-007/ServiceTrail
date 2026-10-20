import { PageHeading, Brand, Icon } from './components'

export default function About() {
  return (
    <div className="about-page">
      <PageHeading
        eyebrow="ABOUT OPSBRIDGE / SYSTEM SPECIFICATION"
        title="Accountable manufacturing incident coordination."
        description="A dual-control operations platform enforcing strict separation of duties, deterministic safety gap analysis, and tamper-evident audit trails."
      />

      <div className="about-links-bar panel">
        <div className="about-links-content">
          <div className="about-link-item">
            <span className="eyebrow">LIVE DEPLOYMENT</span>
            <a
              href="https://opsbridge-demo.onrender.com"
              target="_blank"
              rel="noreferrer"
              className="about-primary-link mono"
            >
              🌐 opsbridge-demo.onrender.com ↗
            </a>
          </div>
          <div className="about-link-item">
            <span className="eyebrow">SOURCE REPOSITORY</span>
            <a
              href="https://github.com/PriyanshuChauhan-007/opsbridge"
              target="_blank"
              rel="noreferrer"
              className="about-primary-link mono"
            >
              🐙 github.com/PriyanshuChauhan-007/opsbridge ↗
            </a>
          </div>
          <div className="about-link-item">
            <span className="eyebrow">SYSTEM ARCHITECTURE</span>
            <span className="mono">docs/architecture-diagrams.md</span>
          </div>
          <div className="about-link-item">
            <span className="eyebrow">AUTHOR</span>
            <strong>Priyanshu Chauhan</strong>
          </div>
        </div>
      </div>

      <div className="about-grid">
        <section className="panel">
          <span className="eyebrow">THE MANUFACTURING PROBLEM</span>
          <h2>Beyond WhatsApp groups &amp; paper logs.</h2>
          <p>
            In modern manufacturing plants (machining cells, stamping presses, packaging lines), equipment
            breakdowns cause severe downtime and life-safety hazards. Yet floor observations and maintenance handoffs
            are frequently scattered across informal chat channels, phone calls, and paper clipboards.
          </p>
          <p>
            This informal coordination creates dangerous points of failure:
          </p>
          <ul className="about-list">
            <li><strong>Self-Approval Hazard:</strong> The technician who executes a fix often self-certifies their own work without independent oversight.</li>
            <li><strong>Lost Evidence:</strong> Photos, sensor readings, and measurements vanish across personal phones with zero chain-of-custody.</li>
            <li><strong>Silent State Drift:</strong> If equipment condition worsens after initial sign-off, work proceeds under obsolete assumptions.</li>
            <li><strong>Zero Compliance Proof:</strong> ISO/OSHA audits require documented dual-control (&ldquo;four-eyes principle&rdquo;) that informal systems cannot provide.</li>
          </ul>
        </section>

        <section className="panel">
          <span className="eyebrow">THE 6-STAGE ACCOUNTABLE LOOP</span>
          <h2>Observe. Decide. Verify.</h2>
          <div className="about-stages">
            <div className="about-stage-card">
              <span className="stage-num mono">01</span>
              <div>
                <strong>Floor Observation</strong>
                <p>Field technician scans asset QR, logs physical symptoms, and uploads timestamped photo evidence.</p>
              </div>
            </div>
            <div className="about-stage-card">
              <span className="stage-num mono">02</span>
              <div>
                <strong>Deterministic Gap Analysis</strong>
                <p>Rule engine flags missing isolation statements and contradictory observations (no AI hallucinations).</p>
              </div>
            </div>
            <div className="about-stage-card">
              <span className="stage-num mono">03</span>
              <div>
                <strong>Independent Review</strong>
                <p>Reliability engineer requests clarification or verifies technical work method. Source edits invalidate review.</p>
              </div>
            </div>
            <div className="about-stage-card">
              <span className="stage-num mono">04</span>
              <div>
                <strong>Dual-Control Release</strong>
                <p>Work method is approved with mandatory notes. The engineer cannot execute what they approved.</p>
              </div>
            </div>
            <div className="about-stage-card">
              <span className="stage-num mono">05</span>
              <div>
                <strong>Execution with Mandatory Notes</strong>
                <p>Technician marks safety checklist steps complete with physical observations. Cannot skip notes.</p>
              </div>
            </div>
            <div className="about-stage-card">
              <span className="stage-num mono">06</span>
              <div>
                <strong>Independent Verification</strong>
                <p>Supervisor or independent engineer inspects the restored asset, confirms safe state, and closes record.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <span className="eyebrow">SEPARATION OF DUTIES</span>
        <h2>Why separate logins are mandatory for plant safety.</h2>
        <p>
          OpsBridge does not use a single shared login or browser-toggled role permissions. Authorization is strictly
          enforced on the server per authenticated account:
        </p>
        <div className="table-wrapper">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Account type</th>
                <th>Core Responsibilities</th>
                <th>Architectural Safety Guardrails</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Field Technician</strong></td>
                <td className="mono">Admin-provisioned worker</td>
                <td>Captures floor observations, photos, and measurements; executes released checklists.</td>
                <td>Cannot approve work; cannot bypass engineering review; cannot close incidents.</td>
              </tr>
              <tr>
                <td><strong>Reliability Engineer</strong></td>
                <td className="mono">Admin-provisioned engineer</td>
                <td>Evaluates safety gaps, selects work methods, releases work.</td>
                <td>Cannot approve their own report; cannot execute work they approved.</td>
              </tr>
              <tr>
                <td><strong>Operations Supervisor</strong></td>
                <td className="mono">Admin-provisioned supervisor</td>
                <td>Monitors plant queues, prioritizes production impact, verifies field completion.</td>
                <td>Cannot alter technician execution notes; verification requires independent sign-off.</td>
              </tr>
              <tr>
                <td><strong>Site Administrator</strong></td>
                <td className="mono">First-run administrator</td>
                <td>Manages asset register, user accounts, and inbound integrations.</td>
                <td>Cannot alter append-only audit trail or bypass security rules.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="field-help" style={{ marginTop: '0.75rem' }}>
          💡 Password for all demo accounts: <code>*Pass1234!</code> (e.g. <code>WorkerPass1234!</code>).
          Use separate signed-in accounts in separate browser profiles to test the handoffs authentically.
        </p>
      </section>

      <section className="panel">
        <span className="eyebrow">CORE TECHNICAL CAPABILITIES</span>
        <h2>Built for industrial reliability &amp; security.</h2>
        <div className="about-grid" style={{ marginTop: '0.75rem' }}>
          <div>
            <h3>Operations Analytics &amp; SLAs</h3>
            <p>
              Real-time Mean Time to Resolution (MTTR), 7-day incident volume trends, priority distributions,
              and SLA compliance tracking directly on the operations desk.
            </p>
          </div>
          <div>
            <h3>Tamper-Evident Audit Export</h3>
            <p>
              RFC 4180 CSV export and cryptographic JSON audit trails with SHA-256 evidence digests, preserving
              every actor ID, rationale, and state change for compliance audits.
            </p>
          </div>
          <div>
            <h3>Client-Side AES-256-GCM Vault</h3>
            <p>
              Technicians in shielded basements or network dead zones can store field drafts securely using the
              Web Crypto API with PBKDF2 key derivation. Sensitive data is never in plaintext localStorage.
            </p>
          </div>
          <div>
            <h3>Sub-Millisecond Health Monitoring</h3>
            <p>
              Active health check (<code>/api/v1/health</code>) measuring live database query latency in
              milliseconds to detect storage degradation before operations are impacted.
            </p>
          </div>
        </div>
      </section>

      <div className="panel about-credits">
        <Brand />
        <p>
          <strong>OpsBridge</strong> was designed and developed by <strong>Priyanshu Chauhan</strong> as a BTech
          final-year engineering capstone project demonstrating production full-stack architecture, deterministic workflow
          design, and security engineering.
        </p>
        <p className="muted small">
          Academic engineering demonstration. Not a certified SIL/safety hardware interlock. Always follow site Lockout/Tagout procedures.
        </p>
      </div>
    </div>
  )
}
