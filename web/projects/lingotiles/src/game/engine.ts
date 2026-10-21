/** Pure game rules. Board dimensions travel with each game; every tile is 1 × 1. */
export type Word = { id: string; word: string; pos: string; meaning: string }
export type TileKind = 'word' | 'pos' | 'meaning'
export type Tile = {
  id: string
  wordId: string
  kind: TileKind
  text: string
  pos: string
  x: number
  y: number
  layer: number
}
export type GameStatus = 'playing' | 'won' | 'lost'
type UndoSnapshot = { tile: Tile; moves: number; solution: string[] }
export type GameState = {
  boardWidth: number
  boardHeight: number
  words: Word[]
  tiles: Tile[]
  tray: Tile[]
  matchedWordIds: string[]
  status: GameStatus
  moves: number
  lastMatch: string | null
  undo: UndoSnapshot | null
  /** A constructive solution, when one is known, using the current board's tile IDs. */
  solution: string[]
}
export const BOARD_WIDTH = 6
export const BOARD_HEIGHT = 4
export const TRAY_CAPACITY = 7

type Position = Pick<Tile, 'x' | 'y' | 'layer'>
type Random = () => number

export function seededRandom(seed: number): Random {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(values: readonly T[], random: Random): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function overlaps(a: Position, b: Position): boolean {
  return Math.abs(a.x - b.x) < 1 - 1e-8 && Math.abs(a.y - b.y) < 1 - 1e-8
}

export function isTileAvailable(tile: Tile, tiles: readonly Tile[]): boolean {
  return tiles.some((candidate) => candidate.id === tile.id)
    && !tiles.some((other) => other.layer > tile.layer && overlaps(tile, other))
}

export function getAvailableTiles(state: GameState): Tile[] {
  if (state.status !== 'playing') return []
  return state.tiles.filter((tile) => isTileAvailable(tile, state.tiles))
}

function positionsFor(count: number, random: Random, compact: boolean): Position[] {
  const base: Position[] = []
  const middle: Position[] = []
  const upper: Position[] = []
  const crown: Position[] = []
  if (compact) {
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) base.push({ x: column, y: row * 1.25, layer: 0 })
    }
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) middle.push({ x: .5 + column, y: .625 + row * 1.25, layer: 1 })
      for (let column = 0; column < 2; column++) upper.push({ x: 1 + column, y: 1.25 + row * 1.25, layer: 2 })
    }
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) crown.push({ x: .5 + column, y: 1.875 + row * 1.25, layer: 3 })
    }
  } else {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 6; column++) base.push({ x: column, y: .25 + row * 1.25, layer: 0 })
    }
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 5; column++) middle.push({ x: .5 + column, y: .875 + row * 1.25, layer: 1 })
      for (let column = 0; column < 3; column++) upper.push({ x: 1.5 + column, y: 1.5 + row * 1.25, layer: 2 })
    }
    crown.push({ x: 2, y: 1.5, layer: 3 }, { x: 3, y: 1.5, layer: 3 })
  }
  // Both layouts keep every cross-layer overlap at least .375 grid units tall.
  // This stays visible after the UI's 9px vertical card inset, even on phones.
  const firstCount = Math.min(count, 36)
  const baseCount = Math.min(base.length, Math.ceil(firstCount * .5))
  const middleCount = Math.min(middle.length, Math.ceil(firstCount * .28), firstCount - baseCount)
  const upperCount = Math.min(upper.length, firstCount - baseCount - middleCount)
  const result = [
    ...shuffled(base, random).slice(0, baseCount),
    ...shuffled(middle, random).slice(0, middleCount),
    ...shuffled(upper, random).slice(0, upperCount),
    ...(compact ? shuffled(crown, random) : crown).slice(0, firstCount - baseCount - middleCount - upperCount),
  ]
  // Larger custom vocabulary sets keep the same board footprint by adding layers.
  while (result.length < count) {
    const layer = 4 + Math.floor((result.length - 36) / base.length)
    result.push(...shuffled(base, random).slice(0, Math.min(base.length, count - result.length)).map((position) => ({ ...position, layer })))
  }
  return result
}

/** Order positions so every next position is uncovered at the moment it is used. */
function accessiblePositionOrder(positions: Position[], random: Random): Position[] {
  const remaining = [...positions]
  const result: Position[] = []
  while (remaining.length) {
    const available = remaining.filter((position) => !remaining.some((other) => other.layer > position.layer && overlaps(position, other)))
    const next = available[Math.floor(random() * available.length)]
    result.push(next)
    remaining.splice(remaining.indexOf(next), 1)
  }
  return result
}

export function createGame(words: readonly Word[], seed = Date.now(), compact = false): GameState {
  if (new Set(words.map((word) => word.id)).size !== words.length) throw new Error('Each vocabulary word must have a unique id.')
  const random = seededRandom(seed)
  const orderedTiles = shuffled(words, random).flatMap((word) => shuffled<TileKind>(['word', 'pos', 'meaning'], random).map((kind) => ({
    id: `${word.id}:${kind}`, wordId: word.id, kind, text: word[kind], pos: word.pos,
    x: 0, y: 0, layer: 0,
  })))
  const positions = accessiblePositionOrder(positionsFor(orderedTiles.length, random, compact), random)
  const tiles = orderedTiles.map((tile, index) => ({ ...tile, ...positions[index] }))
  return {
    boardWidth: compact ? 4 : BOARD_WIDTH, boardHeight: compact ? 5 : BOARD_HEIGHT,
    words: words.map((word) => ({ ...word })), tiles, tray: [], matchedWordIds: [],
    status: tiles.length ? 'playing' : 'won', moves: 0, lastMatch: null, undo: null,
    solution: tiles.map((tile) => tile.id),
  }
}

/** Identical visible meaning cards are interchangeable, just like POS cards. */
function matchingMeaning(pool: readonly Tile[], word: Tile, words: readonly Word[]): Tile | undefined {
  const meaning = words.find((candidate) => candidate.id === word.wordId)?.meaning
  return meaning === undefined ? undefined : pool.find((tile) => tile.kind === 'meaning' && tile.text === meaning)
}

function findMatch(tray: readonly Tile[], words: readonly Word[]): Tile[] | undefined {
  for (const word of tray) {
    if (word.kind !== 'word') continue
    const meaning = matchingMeaning(tray, word, words)
    const pos = tray.find((tile) => tile.kind === 'pos' && tile.text === word.pos)
    if (meaning && pos) return [word, pos, meaning]
  }
}

export function selectTile(state: GameState, tileId: string): GameState {
  if (state.status !== 'playing') return state
  const tile = state.tiles.find((candidate) => candidate.id === tileId)
  if (!tile || !isTileAvailable(tile, state.tiles)) return state
  const tiles = state.tiles.filter((candidate) => candidate.id !== tileId)
  let tray = [...state.tray, tile]
  const matchedWordIds = [...state.matchedWordIds]
  let lastMatch: string | null = null
  let match = findMatch(tray, state.words)
  while (match) {
    const ids = new Set(match.map((candidate) => candidate.id))
    lastMatch = match[0].wordId
    matchedWordIds.push(lastMatch)
    tray = tray.filter((candidate) => !ids.has(candidate.id))
    match = findMatch(tray, state.words)
  }
  // Resolve matches before checking capacity: the seventh tile may complete a set.
  const status: GameStatus = !tiles.length && !tray.length ? 'won' : tray.length >= TRAY_CAPACITY ? 'lost' : 'playing'
  return {
    ...state, tiles, tray, matchedWordIds, status, moves: state.moves + 1, lastMatch,
    undo: lastMatch ? null : { tile, moves: state.moves, solution: state.solution },
    solution: state.solution.filter((id) => id !== tileId),
  }
}

/** Only the latest, unconsumed move can be taken back; a completed set stays learned. */
export function undoMove(state: GameState): GameState {
  if (!state.undo || !state.tray.some((tile) => tile.id === state.undo!.tile.id)) return state
  const { tile, moves, solution } = state.undo
  return {
    ...state, tiles: [...state.tiles, tile], tray: state.tray.filter((candidate) => candidate.id !== tile.id),
    moves, solution, status: 'playing', lastMatch: null, undo: null,
  }
}

/** Construct a capacity-safe ordering with the current tray, independent of geometry. */
function planRemainingSets(state: GameState, random: Random): Tile[] | null {
  const remaining = [...state.tiles]
  let tray = [...state.tray]
  const plan: Tile[] = []
  while (remaining.length || tray.length) {
    const pool = [...tray, ...remaining]
    const groups = shuffled(pool.filter((tile) => tile.kind === 'word'), random).flatMap((word) => {
      const meaning = matchingMeaning(pool, word, state.words)
      // Looking in the tray first consumes existing generic meaning and POS cards first.
      const pos = pool.find((tile) => tile.kind === 'pos' && tile.text === word.pos)
      if (!meaning || !pos) return []
      const group = [word, meaning, pos]
      const required = group.filter((tile) => !tray.some((held) => held.id === tile.id))
      return [{ group, required }]
    }).sort((a, b) => a.required.length - b.required.length)
    const next = groups.find(({ required }) => tray.length + required.length <= TRAY_CAPACITY)
    if (!next) return null
    plan.push(...shuffled(next.required, random))
    const ids = new Set(next.group.map((tile) => tile.id))
    tray = tray.filter((tile) => !ids.has(tile.id))
    for (let index = remaining.length - 1; index >= 0; index--) {
      if (ids.has(remaining[index].id)) remaining.splice(index, 1)
    }
  }
  return plan
}

export function shuffleBoard(state: GameState, seed = Date.now()): GameState {
  if (state.status !== 'playing' || !state.tiles.length) return state
  const random = seededRandom(seed)
  const plan = planRemainingSets(state, random)
  const ordered = plan ?? shuffled(state.tiles, random)
  const positions = accessiblePositionOrder(state.tiles.map(({ x, y, layer }) => ({ x, y, layer })), random)
  return {
    ...state, tiles: ordered.map((tile, index) => ({ ...tile, ...positions[index] })),
    solution: plan ? ordered.map((tile) => tile.id) : [], undo: null, lastMatch: null,
  }
}

/** IDs to highlight: an immediately available set, or one safe next move if known. */
export function getHint(state: GameState): string[] {
  if (state.status !== 'playing') return []
  const available = getAvailableTiles(state)
  const pool = [...state.tray, ...available]
  const candidates = pool.filter((tile) => tile.kind === 'word').flatMap((word) => {
    const meaning = matchingMeaning(pool, word, state.words)
    const pos = pool.find((tile) => tile.kind === 'pos' && tile.text === word.pos)
    if (!meaning || !pos) return []
    const needed = [word, pos, meaning].filter((tile) => available.some((candidate) => candidate.id === tile.id))
    return needed.length && state.tray.length + needed.length <= TRAY_CAPACITY ? [needed] : []
  }).sort((a, b) => a.length - b.length)
  if (candidates.length) return candidates[0].map((tile) => tile.id)

  // A player may have deviated from the deal's original plan. Verify before recommending it.
  let simulated = state
  const validIds = state.solution.filter((id) => state.tiles.some((tile) => tile.id === id))
  for (const id of validIds) {
    const next = selectTile(simulated, id)
    if (next === simulated || next.status === 'lost') break
    simulated = next
  }
  if (simulated.status === 'won' && validIds.length) return [validIds[0]]

  // Search up to three legal moves for the next match when the original plan is stale.
  // An empty hint honestly signals that no short, safe route is currently known.
  let budget = 2500
  function findNextMatch(current: GameState, path: string[]): string[] | null {
    if (path.length >= 3 || budget-- <= 0) return null
    for (const tile of getAvailableTiles(current)) {
      const next = selectTile(current, tile.id)
      if (next.lastMatch) return [...path, tile.id]
      if (next.status === 'playing') {
        const found = findNextMatch(next, [...path, tile.id])
        if (found) return found
      }
    }
    return null
  }
  const route = findNextMatch(state, [])
  return route ? [route[0]] : []
}
