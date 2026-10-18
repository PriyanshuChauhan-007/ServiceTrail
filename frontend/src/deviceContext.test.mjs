import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('./deviceContext.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { sameDeviceIdentity } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
test('decrypted device context requires same live account, organization and site before submission', () => {
  const cached = { id: 'reporter', organization_id: 'plant-org', site_id: 'north' }
  assert.equal(sameDeviceIdentity(cached, { ...cached, name: 'Updated name', role: 'engineer' }), true)
  for (const mismatch of [{ id: 'another-reporter' }, { organization_id: 'other-org' }, { site_id: 'south' }]) {
    assert.equal(sameDeviceIdentity(cached, { ...cached, ...mismatch }), false)
  }
})
