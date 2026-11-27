const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { STATE_FILE, readState, writeState, clearState } = require('./state')

let tmp = null

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mhy-state-'))
})

afterEach(() => {
  fs.removeSync(tmp)
})

test('readState returns null for missing, empty, corrupt or phase-less files', () => {
  expect(readState(tmp)).toBeNull()
  fs.writeFileSync(path.join(tmp, STATE_FILE), '')
  expect(readState(tmp)).toBeNull()
  fs.writeFileSync(path.join(tmp, STATE_FILE), '{ broken json')
  expect(readState(tmp)).toBeNull()
  fs.writeFileSync(path.join(tmp, STATE_FILE), JSON.stringify({ fromVersion: '1.0.1' }))
  expect(readState(tmp)).toBeNull()
})

test('writeState creates the directory, stamps updatedAt and survives a roundtrip', () => {
  const state = {
    phase: 'staged',
    fromVersion: '1.0.1',
    toVersion: '1.0.2',
    oldAppRoot: 'D:\\old',
    newAppRoot: 'D:\\new',
    backupDir: 'D:\\backup'
  }
  const written = writeState(tmp, state)
  expect(written.updatedAt).toEqual(expect.any(Number))
  expect(readState(tmp)).toEqual(written)
  expect(fs.existsSync(path.join(tmp, `${STATE_FILE}.tmp`))).toBe(false)
})

test('writeState atomically overwrites a previous state', () => {
  writeState(tmp, { phase: 'staged', toVersion: '1.0.2' })
  writeState(tmp, { phase: 'done', toVersion: '1.0.2' })
  expect(readState(tmp).phase).toBe('done')
})

test('clearState removes the state file and is safe to call twice', () => {
  writeState(tmp, { phase: 'done' })
  expect(clearState(tmp)).toBe(true)
  expect(readState(tmp)).toBeNull()
  expect(clearState(tmp)).toBe(true)
})

test('state file name is part of the cross-version contract', () => {
  expect(STATE_FILE).toBe('update-state.json')
})
