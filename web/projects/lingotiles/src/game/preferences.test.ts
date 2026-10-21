import assert from 'node:assert/strict'
import test from 'node:test'
import { loadMatchAnimation, saveMatchAnimation } from './preferences.ts'

const KEY = 'lingotiles.preferences.v1'

function memoryStorage(initial: string | null = null) {
  const values = new Map<string, string>(initial === null ? [] : [[KEY, initial]])
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

test('match animation defaults off and only accepts an explicit boolean true', () => {
  for (const raw of [null, '', '{broken', '{}', 'null', '[]', 'true', '{"matchAnimation":false}', '{"matchAnimation":"true"}', '{"matchAnimation":1}']) {
    assert.equal(loadMatchAnimation(memoryStorage(raw)), false, String(raw))
  }
  assert.equal(loadMatchAnimation(memoryStorage('{"matchAnimation":true}')), true)
})

test('enabling and disabling survive reload while unrelated preferences are preserved', () => {
  const storage = memoryStorage('{"sound":false,"future":{"option":3}}')
  assert.equal(saveMatchAnimation(true, storage), true)
  assert.equal(loadMatchAnimation(storage), true)
  assert.equal(saveMatchAnimation(false, storage), true)
  assert.equal(loadMatchAnimation(storage), false)
  assert.deepEqual(JSON.parse(storage.getItem(KEY)!), { sound: false, future: { option: 3 }, matchAnimation: false })
})

test('saving recovers malformed settings without touching game progress keys', () => {
  const storage = memoryStorage('{broken')
  storage.setItem('lingotiles.progress.v1', 'existing progress')
  assert.equal(saveMatchAnimation(true, storage), true)
  assert.equal(loadMatchAnimation(storage), true)
  assert.equal(storage.getItem('lingotiles.progress.v1'), 'existing progress')
})

test('storage read and write rejection leave gameplay callers safe', () => {
  const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(loadMatchAnimation(denied), false)
  assert.equal(saveMatchAnimation(true, denied), false)
  assert.equal(saveMatchAnimation(false, { getItem: () => '{"matchAnimation":true}', setItem: denied.setItem }), false)
})

test('default storage lookup is safe without a browser and when its getter is denied', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined })
    assert.equal(loadMatchAnimation(), false)
    assert.equal(saveMatchAnimation(true), false)
    const storage = memoryStorage()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
    assert.equal(saveMatchAnimation(true), true)
    assert.equal(loadMatchAnimation(), true)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('denied') } })
    assert.equal(loadMatchAnimation(), false)
    assert.equal(saveMatchAnimation(true), false)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})
