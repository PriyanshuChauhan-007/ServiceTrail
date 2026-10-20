import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

// Server-render real components through Vite, not copied HTML or a simulated UI.
// Interaction/browser acceptance remains a separate check.
const server = await createServer({ configFile: false, plugins: [react()], optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' })
after(async () => { await server.close() })
const user = role => ({ id: role, role, name: role === 'engineer' ? 'Priyanshu Chauhan' : 'Field Reporter', email: `${role}@example.test`, organization_id: 'org', site_id: 'site', organization_name: 'Plant Organization', site_name: 'North Plant' })
const noop = () => undefined

test('first-run identity setup is a real credential form, never a role picker', async () => {
  const { default: Auth } = await server.ssrLoadModule('/src/Auth.tsx')
  const setup = renderToStaticMarkup(createElement(Auth, { setup: true, onAuthenticated: noop }))
  assert.match(setup, /Priyanshu Chauhan/)
  assert.match(setup, /type="password"/)
  assert.match(setup, /minLength="12"/i)
  assert.match(setup, /Organization/)
  const login = renderToStaticMarkup(createElement(Auth, { setup: false, onAuthenticated: noop }))
  assert.match(login, /Sign in securely/)
  assert.match(login, /Authenticator code/)
  assert.match(login, /Use a recovery code/)
  assert.match(login, /administrator token/)
  assert.doesNotMatch(login, /Enter control room|Choose.*role/)
})

test('a prepared workspace offers server entry without a credential form only when available', async () => {
  const { default: Auth } = await server.ssrLoadModule('/src/Auth.tsx')
  const prepared = renderToStaticMarkup(createElement(Auth, { setup: false, sharedAvailable: true, onAuthenticated: noop }))
  assert.match(prepared, /Shared workspace/)
  assert.match(prepared, /Open workspace/)
  assert.match(prepared, /Records are examples, not real operations\. Edits are shared\./)
  assert.doesNotMatch(prepared, /type="password"|type="email"|Choose.*role|demo persona|1-click/i)
  const ordinary = renderToStaticMarkup(createElement(Auth, { setup: false, sharedAvailable: false, onAuthenticated: noop }))
  assert.doesNotMatch(ordinary, /Open workspace|Shared workspace/)
})

test('worker and reviewer registers expose different responsibility and report controls', async () => {
  const { default: Queue } = await server.ssrLoadModule('/src/Queue.tsx')
  const props = { onOpen: noop, onReport: noop }
  const worker = renderToStaticMarkup(createElement(Queue, { ...props, user: user('worker') }))
  const engineer = renderToStaticMarkup(createElement(Queue, { ...props, user: user('engineer') }))
  assert.notEqual(worker, engineer)
  assert.match(worker, /field report/i)
  assert.doesNotMatch(engineer, /Approve &amp; release work/)
  assert.match(engineer, /review/i)
  assert.match(engineer, /Counts await server confirmation/)
  assert.doesNotMatch(engineer, /<strong>00<\/strong>/)
})

test('security shows mandatory rotation and protected MFA enrollment without fabricated sessions or recovery secrets', async () => {
  const { default: Security } = await server.ssrLoadModule('/src/Security.tsx')
  const markup = renderToStaticMarkup(createElement(Security, { user: { ...user('worker'), must_change_password: true, mfa_enabled: false }, onUserChanged: noop, onSignedOut: noop, onVaultChanged: noop }))
  assert.match(markup, /requires a password change/)
  assert.match(markup, /Current password/)
  assert.match(markup, /minLength="12"/i)
  assert.match(markup, /Show the one-time enrollment secret on this private screen/)
  assert.match(markup, /Begin MFA enrollment/)
  assert.doesNotMatch(markup, /otpauth:\/\/|Save these recovery codes now|Other signed-in session/)
})

test('inbound token issuance requires private-screen consent and initially exposes no secret', async () => {
  const { default: Integrations } = await server.ssrLoadModule('/src/Integrations.tsx')
  const markup = renderToStaticMarkup(createElement(Integrations))
  assert.match(markup, /want to display the new token once/)
  assert.match(markup, /disabled="">Create &amp; show token once/)
  assert.match(markup, /unverified observations/)
  assert.doesNotMatch(markup, /<code>|one-time-secret|Connected to SCADA|No inbound sources registered/)
})

test('operational metrics await actual aggregates and work methods are authored step records', async () => {
  const { MetricsView, WorkMethods, Notifications } = await server.ssrLoadModule('/src/Operations.tsx')
  const metrics = renderToStaticMarkup(createElement(MetricsView))
  assert.match(metrics, /ACTUAL SERVER AGGREGATES/)
  assert.doesNotMatch(metrics, /<dd>0|100%|No qualifying/)
  const methods = renderToStaticMarkup(createElement(WorkMethods))
  assert.match(methods, /Create immutable method/)
  assert.match(methods, /Required for verification handoff/)
  assert.match(methods, /Step 1/)
  const notifications = renderToStaticMarkup(createElement(Notifications, { onOpen: noop }))
  assert.doesNotMatch(notifications, /No notifications returned|Mark as read/)
})

test('offline workspace identifies cached profile as device context and exposes no incident queue or released work', async () => {
  const { default: OfflineWorkspace } = await server.ssrLoadModule('/src/OfflineWorkspace.tsx')
  const markup = renderToStaticMarkup(createElement(OfflineWorkspace, { user: user('worker'), onRevalidated: noop, onExit: noop }))
  assert.match(markup, /DEVICE CONTEXT · NOT SERVER SIGN-IN/)
  assert.match(markup, /Reconnect &amp; revalidate server session/)
  assert.match(markup, /No approved work is cached or released here/)
  assert.doesNotMatch(markup, /Site incident queue|Execution checklist|Approve &amp; release work/)
})

test('equipment scans match only an exact registered code or ID, never an invented asset', async () => {
  const { assetForLabel } = await server.ssrLoadModule('/src/AssetScanner.tsx')
  const assets = [{ id: 'asset-id-4', code: 'PRESS-04', name: 'Registered press' }]
  assert.equal(assetForLabel(assets, ' press-04 ').id, 'asset-id-4')
  assert.equal(assetForLabel(assets, 'asset-id-4').code, 'PRESS-04')
  assert.equal(assetForLabel(assets, 'PRESS-0'), undefined)
  assert.equal(assetForLabel(assets, 'PRESS-04 fault detected'), undefined)
})
