import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./logic.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { approvalGaps, canEdit, filterIncidents, sourceVersion } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const reviewer = { id: 'engineer', role: 'engineer' }
const record = (overrides = {}) => ({ id: '1', number: 'INC-001', version: 4, status: 'ready_for_review', reporter: { id: 'worker', name: 'Worker One' }, assigned_to: null, asset: { code: 'PRS-04', name: 'Press', area: 'Bay 3' }, description: 'Protective interlock stopped the press.', findings: [], analysis: { report_version: 2 }, timeline: [{ report_version: 2 }], updated_at: '2026-10-01T12:00:00Z', ...overrides })

test('independent approval follows source version, not unrelated record revision', () => {
  const incident = record()
  assert.equal(sourceVersion(incident), 2)
  assert.deepEqual(approvalGaps(incident, reviewer), [])
  assert.match(approvalGaps(incident, { ...reviewer, id: 'worker' }).join(' '), /independent reviewer/)
  assert.match(approvalGaps(record({ assigned_to: reviewer }), reviewer).join(' '), /assigned executor/)
})
test('revision and blocking findings prevent a release while warning alone does not', () => {
  assert.match(approvalGaps(record({ timeline: [{ report_version: 3 }] }), reviewer).join(' '), /earlier report version/)
  assert.match(approvalGaps(record({ findings: [{ severity: 'blocking', message: 'Confirm isolation' }] }), reviewer).join(' '), /Confirm isolation/)
  assert.deepEqual(approvalGaps(record({ findings: [{ severity: 'warning', message: 'Measurement absent' }] }), reviewer), [])
  assert.match(approvalGaps(record({ analysis: null }), reviewer).join(' '), /Analyze/)
  assert.match(approvalGaps(record({ status: 'submitted' }), reviewer).join(' '), /ready for review/)
})
test('only the author can revise an editable source, not a reviewer or released author', () => {
  assert.equal(canEdit(record({ status: 'changes_requested' }), { id: 'worker' }), true)
  assert.equal(canEdit(record({ status: 'changes_requested' }), reviewer), false)
  assert.equal(canEdit(record({ status: 'approved' }), { id: 'worker' }), false)
})
test('register search combines assignment, status groups and actual registered asset fields', () => {
  const items = [record(), record({ id: '2', status: 'approved', assigned_to: { id: 'engineer' }, updated_at: '2026-10-02T12:00:00Z' }), record({ id: '3', status: 'resolved' })]
  assert.equal(filterIncidents(items, 'prs-04', 'open', false, 'worker').length, 2)
  assert.deepEqual(filterIncidents(items, 'BAY 3', 'released', true, 'engineer').map(i => i.id), ['2'])
  assert.equal(filterIncidents(items, 'unknown code', 'all', false, 'worker').length, 0)
  assert.deepEqual(items.map(i => i.id), ['1', '2', '3'])
})
