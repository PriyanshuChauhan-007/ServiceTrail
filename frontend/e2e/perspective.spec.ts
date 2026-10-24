import { test, expect, type Page } from '@playwright/test'

// These are UI contract tests at the HTTP boundary. Backend acceptance tests
// separately prove real cookies, audit events and role/scoping enforcement.
async function workspace(page: Page, listingStatus = 200) {
  const administrator = { id: 'test-admin', name: 'Test Administrator', email: 'admin@example.test', role: 'admin',
    organization_id: 'test-org', site_id: 'test-site', organization_name: 'Test Organization', site_name: 'Test Site' }
  const worker = { ...administrator, id: 'test-worker', name: 'Test Worker', email: 'worker@example.test', role: 'worker' }
  const engineer = { ...administrator, id: 'test-engineer', name: 'Test Engineer', email: 'engineer@example.test', role: 'engineer' }
  const people = [administrator, worker, engineer]
  let current = administrator
  const requests: { path: string; body: unknown }[] = []
  let switchStatus = 200
  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    requests.push({ path, body: request.postDataJSON() })
    const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/setup/status')) return respond({ needs_setup: false, demo_available: listingStatus === 200 })
    if (path.endsWith('/auth/me')) return respond({ user: current })
    if (path.endsWith('/auth/perspectives/switch')) {
      if (switchStatus !== 200) return respond({ detail: 'Perspective is unavailable' }, switchStatus)
      current = people.find(person => person.role === request.postDataJSON().perspective)!
      return respond({ user: current })
    }
    if (path.endsWith('/auth/perspectives')) return listingStatus === 200
      ? respond(people.map(person => ({ key: person.role, id: person.id, name: person.name, role: person.role })))
      : respond({ detail: 'Perspective switching is unavailable' }, listingStatus)
    if (path.endsWith('/incidents/page')) return respond({ items: [], total: 0, counts: {} })
    if (path.endsWith('/users')) return respond(people)
    return respond([])
  })
  return { requests, rejectSwitch: () => { switchStatus = 404 } }
}

test('View as replaces the authenticated workspace only after the switch response', async ({ page }) => {
  const { requests } = await workspace(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await expect(page.getByLabel('View as')).toBeVisible()
  await page.getByLabel('View as').selectOption('worker')
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'My notebook', exact: true })).toHaveCount(0)
  const bounds = await page.locator('.perspective-control').boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375)
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My notebook', exact: true })).toBeVisible()
  await expect(page.getByLabel('View as')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toHaveCount(0)
  expect(requests.find(value => value.path.endsWith('/perspectives/switch'))?.body).toEqual({ perspective: 'worker' })
  await page.reload()
  await expect(page.getByRole('button', { name: 'My notebook', exact: true })).toBeVisible()
  await expect(page.getByLabel('View as')).toBeVisible()
  await page.getByLabel('View as').selectOption('engineer')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Work register', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toHaveCount(0)
  await page.getByLabel('View as').selectOption('admin')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
})

test('a denied perspective change preserves the server-confirmed administrator and reports the error', async ({ page }) => {
  const state = await workspace(page)
  state.rejectSwitch()
  await page.goto('/')
  await page.getByLabel('View as').selectOption('worker')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Perspective is unavailable')
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'My notebook', exact: true })).toHaveCount(0)
})

for (const status of [403, 404]) {
  test(`a normal administrator has no perspective control when the backend returns ${status}`, async ({ page }) => {
    const { requests } = await workspace(page, status)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
    await expect.poll(() => requests.some(value => value.path.endsWith('/auth/perspectives'))).toBeTruthy()
    await expect(page.getByLabel('View as')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toHaveCount(0)
  })
}

test('prepared shared workspace entry and role roundtrip use real server sessions', async ({ page, context }) => {
  test.skip(process.env.E2E_SHARED_WORKSPACE !== 'true', 'Run with E2E_SHARED_WORKSPACE=true against an isolated demo database')
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Shared workspace', exact: true })).toBeVisible()
  await expect(page.getByText('Records are examples, not real operations. Edits are shared.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Work email', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open workspace', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
  const initialCookies = await context.cookies()
  const controller = initialCookies.find(cookie => cookie.name === 'servicetrail_perspective')!
  expect(controller.httpOnly).toBeTruthy()
  expect(controller.path).toBe('/api/v1/auth')
  const active = initialCookies.find(cookie => cookie.name === 'servicetrail_session')!
  expect(active.httpOnly).toBeTruthy()
  await page.getByLabel('View as').selectOption('worker')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My notebook', exact: true })).toBeVisible()
  expect((await page.request.get('/api/v1/admin/audit')).status()).toBe(403)
  const records = await (await page.request.get('/api/v1/incidents')).json()
  const source = records.find((record: { status: string }) => record.status === 'submitted')
  await page.getByRole('searchbox').fill(source.description)
  await page.locator('.incident-card').filter({ hasText: source.description }).first().click()
  await page.getByRole('button', { name: 'Revise report', exact: true }).click()
  const revised = 'Example record: browser-entered alarm detail persisted for review.'
  await page.getByRole('textbox', { name: 'What did you observe?', exact: true }).fill(revised)
  await page.getByRole('textbox', { name: 'Production / operational impact', exact: true }).fill('Example shift paused for review.')
  await page.getByRole('combobox', { name: 'Injury status', exact: true }).selectOption('none')
  await page.getByRole('combobox', { name: 'Current equipment state', exact: true }).selectOption('isolated')
  await page.getByRole('button', { name: 'Save new report version', exact: true }).click()
  await expect(page.getByText(revised, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('View as')).toBeVisible()
  await page.getByLabel('View as').selectOption('engineer')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Work register', exact: true })).toBeVisible()
  const saved = await (await page.request.get(`/api/v1/incidents/${source.id}`)).json()
  expect(saved.description).toBe(revised)
  expect(saved.version).toBeGreaterThan(source.version)
  expect((await page.request.get('/api/v1/admin/audit')).status()).toBe(403)

  await page.getByRole('searchbox').fill(revised)
  await page.locator('.incident-card').filter({ hasText: revised }).first().click()
  await page.getByRole('button', { name: 'Analysis & decision', exact: true }).click()
  await page.getByRole('button', { name: 'Analyze current report', exact: true }).click()
  await expect(page.getByText('Analysis recorded against the current report version.', { exact: true })).toBeVisible()
  const methods = await (await page.request.get('/api/v1/work-methods')).json()
  const methodSelect = page.getByRole('combobox', { name: 'Work method to copy into this release', exact: true })
  await expect(methodSelect).toBeVisible()
  await methodSelect.selectOption(methods.find((method: { name: string }) => method.name === 'Press observation handoff').id)
  await page.getByLabel('Decision / clarification note', { exact: true }).fill('Reviewed the changed example source and observation method.')
  await page.getByRole('checkbox', { name: /I independently reviewed source version/ }).check()
  await page.getByRole('button', { name: 'Approve & release work', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Approved by Morgan Chen', exact: true })).toBeVisible()

  await page.getByLabel('View as').selectOption('worker')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('searchbox').fill(revised)
  await page.locator('.incident-card').filter({ hasText: revised }).first().click()
  await page.getByRole('button', { name: /^Released work/ }).click()
  await page.getByRole('button', { name: 'Begin released work', exact: true }).click()
  const steps = page.locator('.work-checklist > li')
  for (let index = 0; index < await steps.count(); index++) {
    const step = steps.nth(index)
    await step.getByLabel('Execution notes', { exact: true }).fill(`Example observation note ${index + 1} entered through the form.`)
    await step.getByRole('checkbox', { name: 'Mark complete on save', exact: true }).check()
    await step.getByRole('button', { name: 'Save step record', exact: true }).click()
    await expect(step.getByRole('button', { name: 'Save step record', exact: true })).toBeDisabled()
  }
  await page.getByLabel('Completion & handoff note', { exact: true }).fill('Example handover ready for independent review.')
  await page.getByRole('button', { name: 'Submit for engineer verification', exact: true }).click()
  await expect(page.getByText('Work is awaiting independent engineering verification. It is not closed yet.')).toBeVisible()

  await page.getByLabel('View as').selectOption('engineer')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.getByRole('searchbox').fill(revised)
  await page.locator('.incident-card').filter({ hasText: revised }).first().click()
  await page.getByRole('button', { name: /^Released work/ }).click()
  await page.getByLabel('Verification / return note', { exact: true }).fill('Checked the example notes entered through the form.')
  await page.getByRole('button', { name: 'Verify & close incident', exact: true }).click()
  await expect(page.locator('.detail-status .badge')).toHaveText('Closed')

  await page.getByLabel('View as').selectOption('admin')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Site & team', exact: true })).toBeVisible()
  expect((await page.request.get('/api/v1/admin/audit')).status()).toBe(200)
  const currentCookies = await context.cookies()
  expect(currentCookies.find(cookie => cookie.name === 'servicetrail_session')!.value).not.toBe(active.value)
  expect(currentCookies.find(cookie => cookie.name === 'servicetrail_perspective')!.value).toBe(controller.value)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open workspace', exact: true })).toBeVisible()
  expect((await context.cookies()).some(cookie => ['servicetrail_session', 'servicetrail_perspective'].includes(cookie.name))).toBeFalsy()
  expect((await page.request.post('/api/v1/auth/perspectives/switch', { data: { perspective: 'admin' } })).status()).toBe(401)
})
