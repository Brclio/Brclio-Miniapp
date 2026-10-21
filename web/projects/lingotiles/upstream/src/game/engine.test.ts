import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOARD_HEIGHT, BOARD_WIDTH, TRAY_CAPACITY, createGame, getAvailableTiles,
  getHint, isTileAvailable, seededRandom, selectTile, shuffleBoard, undoMove,
  type GameState, type Tile, type Word,
} from './engine.ts'

const words: Word[] = [
  { id: 'apple', word: 'apple', pos: 'n.', meaning: '苹果' },
  { id: 'forest', word: 'forest', pos: 'n.', meaning: '森林' },
  { id: 'explore', word: 'explore', pos: 'v.', meaning: '探索' },
  { id: 'gentle', word: 'gentle', pos: 'adj.', meaning: '温柔的' },
  { id: 'swiftly', word: 'swiftly', pos: 'adv.', meaning: '迅速地' },
  { id: 'create', word: 'create', pos: 'v.', meaning: '创造' },
  { id: 'island', word: 'island', pos: 'n.', meaning: '岛屿' },
  { id: 'brave', word: 'brave', pos: 'adj.', meaning: '勇敢的' },
]

function flatGame(input: Word[] = words): GameState {
  const state = createGame(input, 42)
  return { ...state, tiles: state.tiles.map((tile, index) => ({ ...tile, layer: 0, x: index, y: 0 })) }
}

function select(state: GameState, ...ids: string[]): GameState {
  return ids.reduce((current, id) => selectTile(current, id), state)
}

function replay(state: GameState): GameState {
  const sequence = [...state.solution]
  for (const id of sequence) {
    const next = selectTile(state, id)
    assert.notEqual(next, state, `Solution tile ${id} must be available`)
    assert.notEqual(next.status, 'lost', `Solution may not overflow the tray at ${id}`)
    state = next
  }
  assert.equal(state.status, 'won')
  assert.equal(state.tiles.length, 0)
  assert.equal(state.tray.length, 0)
  assert.equal(state.matchedWordIds.length, state.words.length)
  return state
}

test('all six ordering permutations of word, POS and meaning match', () => {
  const permutations = [
    ['word', 'pos', 'meaning'], ['word', 'meaning', 'pos'],
    ['pos', 'word', 'meaning'], ['pos', 'meaning', 'word'],
    ['meaning', 'word', 'pos'], ['meaning', 'pos', 'word'],
  ]
  for (const order of permutations) {
    const game = select(flatGame([words[0]]), ...order.map((kind) => `apple:${kind}`))
    assert.equal(game.status, 'won')
    assert.equal(game.lastMatch, 'apple')
    assert.deepEqual(game.matchedWordIds, ['apple'])
  }
})

test('word and meaning must have the corresponding visible meaning', () => {
  const game = select(flatGame(), 'apple:word', 'apple:pos', 'forest:meaning')
  assert.equal(game.tray.length, 3)
  assert.equal(game.matchedWordIds.length, 0)
})

const synonyms: Word[] = [
  { id: 'forest', word: 'forest', pos: 'n.', meaning: '森林' },
  { id: 'woodland', word: 'woodland', pos: 'n.', meaning: '森林' },
  { id: 'protect', word: 'protect', pos: 'v.', meaning: '保护' },
  { id: 'protection', word: 'protection', pos: 'n.', meaning: '保护' },
]

test('identical Chinese meaning cards can be exchanged without hidden identity constraints', () => {
  let game = select(flatGame(synonyms.slice(0, 2)), 'forest:word', 'woodland:meaning', 'forest:pos')
  assert.deepEqual(game.matchedWordIds, ['forest'])
  assert.equal(game.tray.length, 0)
  game = select(game, 'woodland:word', 'forest:meaning', 'woodland:pos')
  assert.equal(game.status, 'won')
  assert.deepEqual(game.matchedWordIds, ['forest', 'woodland'])
})

test('exchanged meaning cards still require the selected word\'s correct part of speech', () => {
  let game = select(flatGame(synonyms.slice(2)), 'protect:word', 'protection:meaning', 'protection:pos')
  assert.equal(game.tray.length, 3)
  assert.deepEqual(game.matchedWordIds, [])
  game = select(game, 'protect:pos')
  assert.deepEqual(game.matchedWordIds, ['protect'])
  assert.deepEqual(game.tray.map((tile) => tile.id), ['protection:pos'])
  game = select(game, 'protection:word', 'protect:meaning')
  assert.equal(game.status, 'won')
})

test('hints accept an available synonym meaning when the original meaning is covered', () => {
  let game = flatGame(synonyms)
  // Forest's own meaning is under another card; the visible woodland meaning is equivalent.
  game = { ...game, tiles: game.tiles.map((tile) => tile.id === 'forest:meaning' ? { ...tile, x: 0, layer: 0 } : tile.id === 'protect:word' ? { ...tile, x: 0, layer: 1 } : { ...tile, x: tile.x + 2 }) }
  game = select(game, 'forest:word', 'forest:pos')
  assert.equal(isTileAvailable(game.tiles.find((tile) => tile.id === 'forest:meaning')!, game.tiles), false)
  assert.deepEqual(getHint(game), ['woodland:meaning'])
  game = select(game, ...getHint(game))
  assert.deepEqual(game.matchedWordIds, ['forest'])
})

test('shuffle remains solvable after synonym meanings and POS cards have been borrowed', () => {
  let game = select(flatGame(synonyms), 'forest:word', 'woodland:meaning', 'protection:pos')
  game = select(game, 'woodland:word', 'protect:word', 'protection:meaning')
  for (let seed = 0; seed < 60; seed++) replay(shuffleBoard(game, seed))
})

test('synonym-rich boards remain solvable after varied selections and reshuffles', () => {
  const vocabulary = [...synonyms, ...words.filter((word) => word.id !== 'forest')]
  let recovered = 0
  for (let seed = 0; seed < 150; seed++) {
    const random = seededRandom(seed)
    let game = createGame(vocabulary, seed, seed % 2 === 0)
    for (let move = 0; move < 12 && game.status === 'playing'; move++) {
      const available = getAvailableTiles(game)
      game = selectTile(game, available[Math.floor(random() * available.length)].id)
    }
    if (game.status !== 'playing') continue
    const shuffled = shuffleBoard(game, seed + 900)
    if (shuffled.solution.length) { replay(shuffled); recovered++ }
  }
  assert.ok(recovered > 10)
})

test('a POS tile is reusable across lexemes with that POS, but not across different POS', () => {
  let game = select(flatGame(words.slice(0, 3)), 'apple:word', 'forest:pos', 'apple:meaning')
  assert.deepEqual(game.matchedWordIds, ['apple'])
  assert.equal(game.tray.length, 0)
  game = select(game, 'forest:word', 'forest:meaning', 'explore:pos')
  assert.equal(game.tray.length, 3)
  game = select(game, 'apple:pos')
  assert.deepEqual(game.matchedWordIds, ['apple', 'forest'])
  assert.deepEqual(game.tray.map((tile) => tile.id), ['explore:pos'])
  game = select(game, 'explore:word', 'explore:meaning')
  assert.equal(game.status, 'won')
})

test('the seventh tile resolves its match before checking full-tray failure', () => {
  const initial = select(flatGame(), 'apple:word', 'apple:meaning', 'forest:word', 'explore:word', 'gentle:word', 'swiftly:word')
  assert.equal(initial.tray.length, 6)
  const result = selectTile(initial, 'forest:pos')
  assert.equal(result.status, 'playing')
  assert.equal(result.tray.length, 4)
  assert.deepEqual(result.matchedWordIds, ['apple'])
})

test('a seventh unmatched tile loses and can be undone exactly once', () => {
  const start = flatGame()
  const six = select(start, ...words.slice(0, 6).map((word) => `${word.id}:word`))
  const lost = selectTile(six, 'island:word')
  assert.equal(lost.status, 'lost')
  assert.equal(lost.tray.length, TRAY_CAPACITY)
  assert.equal(selectTile(lost, 'brave:word'), lost)
  const restored = undoMove(lost)
  assert.equal(restored.status, 'playing')
  assert.deepEqual(restored.tray, six.tray)
  assert.equal(restored.moves, six.moves)
  assert.deepEqual(restored.solution, six.solution)
  assert.ok(restored.tiles.some((tile) => tile.id === 'island:word'))
  assert.equal(undoMove(restored), restored)
})

test('matched tiles cannot be undone and updates do not mutate the input state', () => {
  const initial = flatGame()
  const copy = structuredClone(initial)
  const game = select(initial, 'apple:word', 'apple:pos', 'apple:meaning')
  assert.deepEqual(initial, copy)
  assert.equal(game.undo, null)
  assert.equal(undoMove(game), game)
})

test('partial overlap by a higher layer blocks a card; edge contact and same layer do not', () => {
  const original = flatGame(words.slice(0, 1))
  const [a, b, c] = original.tiles
  const lower: Tile = { ...a, x: 0, y: 0, layer: 0 }
  const higher: Tile = { ...b, x: .75, y: .75, layer: 1 }
  const neighbor: Tile = { ...c, x: 1, y: 0, layer: 0 }
  let game = { ...original, tiles: [lower, higher, neighbor] }
  assert.equal(isTileAvailable(lower, game.tiles), false)
  assert.equal(selectTile(game, lower.id), game)
  assert.equal(isTileAvailable(higher, game.tiles), true)
  game = selectTile(game, higher.id)
  assert.equal(isTileAvailable(lower, game.tiles), true)
  assert.equal(isTileAvailable(neighbor, game.tiles), true)
  assert.equal(isTileAvailable(higher, game.tiles), false)
  const edge = { ...higher, x: 1, y: 0 }
  assert.equal(isTileAvailable(lower, [lower, edge]), true)
})

test('deals are deterministic and have a valid constructive solution across many seeds and sizes', () => {
  assert.deepEqual(createGame(words, 543), createGame(words, 543))
  assert.notDeepEqual(createGame(words, 543).tiles, createGame(words, 544).tiles)
  const largerWords = Array.from({ length: 18 }, (_, index) => ({ ...words[index % words.length], id: `word-${index}` }))
  for (let seed = 0; seed < 200; seed++) {
    for (const count of [1, 3, 6, 8, 12, 18]) {
      const game = createGame(largerWords.slice(0, count), seed)
      assert.equal(game.tiles.length, count * 3)
      assert.equal(new Set(game.tiles.map((tile) => tile.id)).size, count * 3)
      for (const tile of game.tiles) {
        assert.ok(tile.x >= 0 && tile.x + 1 <= BOARD_WIDTH)
        assert.ok(tile.y >= 0 && tile.y + 1 <= BOARD_HEIGHT)
      }
      replay(game)
    }
  }
})

test('compact deals fit a 4 by 5 board and remain solvable across many seeds', () => {
  const vocabulary = Array.from({ length: 18 }, (_, index) => ({ ...words[index % words.length], id: `compact-${index}` }))
  assert.deepEqual(createGame(words, 4, true), createGame(words, 4, true))
  for (let seed = 0; seed < 120; seed++) {
    for (const count of [1, 6, 8, 10, 12, 18]) {
      const game = createGame(vocabulary.slice(0, count), seed, true)
      assert.equal(game.boardWidth, 4)
      assert.equal(game.boardHeight, 5)
      assert.equal(game.tiles.length, count * 3)
      for (const tile of game.tiles) {
        assert.ok(tile.x >= 0 && tile.x + 1 <= game.boardWidth)
        assert.ok(tile.y >= 0 && tile.y + 1 <= game.boardHeight)
      }
      replay(game)
    }
  }
})

test('compact shuffles preserve dimensions, physical positions and tray contents', () => {
  for (let seed = 0; seed < 60; seed++) {
    let game = createGame(words, seed, true)
    game = selectTile(game, game.solution[0])
    game = selectTile(game, game.solution[0])
    const shuffled = shuffleBoard(game, seed + 100)
    const positionKeys = (state: GameState) => state.tiles.map((tile) => `${tile.x},${tile.y},${tile.layer}`).sort()
    assert.equal(shuffled.boardWidth, 4)
    assert.equal(shuffled.boardHeight, 5)
    assert.deepEqual(shuffled.tray, game.tray)
    assert.deepEqual(positionKeys(shuffled), positionKeys(game))
    replay(shuffled)
  }
})

test('visual card faces and engine agree on blocking at mobile and desktop sizes', () => {
  const vocabulary = Array.from({ length: 18 }, (_, index) => ({ ...words[index % words.length], id: `layout-${index}` }))
  // The full layout also covers the additional layers allowed for custom sets.
  for (const compact of [false, true]) {
    const game = createGame(vocabulary, 17, compact)
    for (const gridSize of [40, 44, 55, 110]) {
      for (const lower of game.tiles) {
        for (const upper of game.tiles.filter((tile) => tile.layer > lower.layer)) {
          const logicalOverlap = Math.abs(upper.x - lower.x) < 1 && Math.abs(upper.y - lower.y) < 1
          // Match App.tsx: x + 3px, width - 6px, and height - 9px.
          // Exclude the extra 5px shadow: the actual card face must visibly overlap.
          const horizontalOverlap = gridSize - 6 - Math.abs(upper.x - lower.x) * gridSize
          const verticalOverlap = gridSize - 9 - Math.abs(upper.y - lower.y) * gridSize
          const visibleOverlap = horizontalOverlap > 0 && verticalOverlap > 0
          assert.equal(visibleOverlap, logicalOverlap, `${gridSize}px cells: ${upper.id} / ${lower.id}`)
          if (logicalOverlap) {
            assert.ok(verticalOverlap >= gridSize * .375 - 9 - 1e-8)
            // Even a highlighted card raised by 5px retains a visible overlap.
            assert.ok(verticalOverlap - 5 > 0)
          }
        }
      }
    }
  }
})

test('shuffle preserves tray and remaining card identities, and constructs a usable new solution', () => {
  for (let seed = 0; seed < 120; seed++) {
    let game = createGame(words, seed)
    game = selectTile(game, game.solution[0])
    game = selectTile(game, game.solution[0])
    const original = structuredClone(game)
    const shuffled = shuffleBoard(game, seed + 200)
    assert.deepEqual(game, original)
    assert.deepEqual(shuffled.tray, game.tray)
    assert.deepEqual(shuffled.matchedWordIds, game.matchedWordIds)
    assert.deepEqual(shuffled.tiles.map((tile) => tile.id).sort(), game.tiles.map((tile) => tile.id).sort())
    assert.equal(shuffled.undo, null)
    replay(shuffled)
  }
})

test('shuffle correctly plans with POS tiles borrowed from different lexemes', () => {
  const game = select(flatGame(), 'apple:word', 'apple:meaning', 'forest:word', 'explore:pos', 'gentle:pos')
  for (let seed = 0; seed < 50; seed++) replay(shuffleBoard(game, seed))
})

test('shuffle solutions remain valid after varied legal player choices', () => {
  let recovered = 0
  for (let seed = 0; seed < 300; seed++) {
    const random = seededRandom(seed)
    let game = createGame(words, seed)
    const numberOfMoves = Math.floor(random() * 14)
    for (let move = 0; move < numberOfMoves && game.status === 'playing'; move++) {
      const available = getAvailableTiles(game)
      game = selectTile(game, available[Math.floor(random() * available.length)].id)
    }
    if (game.status !== 'playing') continue
    const rearranged = shuffleBoard(game, seed + 500)
    if (rearranged.solution.length) {
      replay(rearranged)
      recovered++
    }
  }
  assert.ok(recovered > 100)
})

test('shuffle does not promise a solution for a logically unrecoverable tray', () => {
  const game = select(flatGame(), ...words.slice(0, 6).map((word) => `${word.id}:word`))
  const shuffled = shuffleBoard(game, 2)
  assert.deepEqual(shuffled.tray, game.tray)
  assert.deepEqual(shuffled.solution, [])
  assert.deepEqual(getHint(shuffled), [])
})

test('hints only highlight available cards and help finish every constructive deal', () => {
  for (let seed = 0; seed < 80; seed++) {
    let game = createGame(words, seed, seed % 2 === 0)
    let moves = 0
    while (game.status === 'playing' && moves++ < words.length * 3) {
      const hint = getHint(game)
      assert.ok(hint.length > 0, `Expected a hint for seed ${seed}`)
      const available = getAvailableTiles(game).map((tile) => tile.id)
      assert.ok(hint.every((id) => available.includes(id)))
      game = select(game, ...hint)
    }
    assert.equal(game.status, 'won', `Following hints must win seed ${seed}`)
  }
})

test('empty game is complete; duplicate lexeme identifiers are rejected', () => {
  assert.equal(createGame([], 1).status, 'won')
  assert.throws(() => createGame([words[0], words[0]], 1), /unique id/)
})
