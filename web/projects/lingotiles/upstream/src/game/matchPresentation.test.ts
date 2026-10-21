import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, selectTile, shuffleBoard, undoMove, type GameState, type Word } from './engine.ts'
import { getMatchedTiles } from './matchPresentation.ts'

const vocabulary: Word[] = [
  { id: 'forest', word: 'forest', pos: 'n.', meaning: '森林' },
  { id: 'woodland', word: 'woodland', pos: 'n.', meaning: '森林' },
  { id: 'apple', word: 'apple', pos: 'n.', meaning: '苹果' },
  { id: 'grow', word: 'grow', pos: 'v.', meaning: '生长' },
  { id: 'gentle', word: 'gentle', pos: 'adj.', meaning: '温柔的' },
  { id: 'slowly', word: 'slowly', pos: 'adv.', meaning: '缓慢地' },
]

function flatGame(words = vocabulary): GameState {
  const state = createGame(words, 12)
  return { ...state, tiles: state.tiles.map((tile, index) => ({ ...tile, x: index, y: 0, layer: 0 })) }
}

function select(state: GameState, ...ids: string[]): GameState {
  return ids.reduce((current, id) => selectTile(current, id), state)
}

test('every click order presents the actual consumed cards in word, POS, meaning order', () => {
  const permutations = [
    ['forest:word', 'apple:pos', 'woodland:meaning'], ['forest:word', 'woodland:meaning', 'apple:pos'],
    ['apple:pos', 'forest:word', 'woodland:meaning'], ['apple:pos', 'woodland:meaning', 'forest:word'],
    ['woodland:meaning', 'forest:word', 'apple:pos'], ['woodland:meaning', 'apple:pos', 'forest:word'],
  ]
  for (const [first, second, last] of permutations) {
    const before = select(flatGame(), first, second)
    const after = selectTile(before, last)
    const tiles = getMatchedTiles(before, after, last)
    assert.deepEqual(tiles.map((tile) => tile.id), ['forest:word', 'apple:pos', 'woodland:meaning'])
    assert.deepEqual(tiles.map((tile) => tile.kind), ['word', 'pos', 'meaning'])
    assert.equal(tiles.find((tile) => tile.id === last), before.tiles.find((tile) => tile.id === last))
  }
})

test('a seventh tile completing a borrowed-card match does not collect unrelated tray cards', () => {
  const before = select(flatGame(), 'forest:word', 'woodland:meaning', 'apple:word', 'grow:word', 'gentle:word', 'slowly:word')
  const after = selectTile(before, 'apple:pos')
  assert.equal(before.tray.length, 6)
  assert.equal(after.tray.length, 4)
  assert.equal(after.status, 'playing')
  assert.deepEqual(getMatchedTiles(before, after, 'apple:pos').map((tile) => tile.id), ['forest:word', 'apple:pos', 'woodland:meaning'])
})

test('last match of the level still supplies all three cards for a winning presentation', () => {
  const before = select(flatGame(vocabulary.slice(0, 1)), 'forest:pos', 'forest:meaning')
  const after = selectTile(before, 'forest:word')
  assert.equal(after.status, 'won')
  assert.deepEqual(getMatchedTiles(before, after, 'forest:word').map((tile) => tile.kind), ['word', 'pos', 'meaning'])
})

test('non-matches, invalid selections, undo and shuffle produce no presentation', () => {
  const original = flatGame()
  const partial = selectTile(original, 'forest:word')
  assert.deepEqual(getMatchedTiles(original, partial, 'forest:word'), [])
  assert.deepEqual(getMatchedTiles(partial, selectTile(partial, 'not-a-tile'), 'not-a-tile'), [])
  assert.deepEqual(getMatchedTiles(partial, undoMove(partial), 'forest:word'), [])
  assert.deepEqual(getMatchedTiles(partial, shuffleBoard(partial, 13), 'forest:word'), [])
  const before = select(partial, 'woodland:meaning')
  const after = selectTile(before, 'apple:pos')
  assert.deepEqual(getMatchedTiles(after, selectTile(after, 'forest:word'), 'forest:word'), [])
})

test('stale lastMatch or a mismatched history cannot replay an earlier presentation', () => {
  const before = select(flatGame(), 'forest:word', 'woodland:meaning')
  const after = selectTile(before, 'apple:pos')
  assert.deepEqual(getMatchedTiles(before, { ...after, matchedWordIds: [] }, 'apple:pos'), [])
  assert.deepEqual(getMatchedTiles(before, { ...after, lastMatch: 'apple' }, 'apple:pos'), [])
  const later = select(after, 'woodland:word', 'forest:meaning')
  const completed = selectTile(later, 'forest:pos')
  assert.deepEqual(getMatchedTiles(later, { ...completed, matchedWordIds: ['apple', 'woodland'] }, 'forest:pos'), [])
})
