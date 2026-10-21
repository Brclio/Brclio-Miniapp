import type { GameState, Tile, TileKind } from './engine.ts'

const PRESENTATION_ORDER: TileKind[] = ['word', 'pos', 'meaning']

/** Recover the actual consumed cards, including borrowed POS and synonym cards. */
export function getMatchedTiles(before: GameState, after: GameState, selectedId: string): Tile[] {
  if (before.status !== 'playing' || before === after || after.moves !== before.moves + 1 || !after.lastMatch) return []
  const previousMatches = before.matchedWordIds
  if (after.matchedWordIds.length !== previousMatches.length + 1
    || previousMatches.some((id, index) => after.matchedWordIds[index] !== id)
    || after.matchedWordIds[previousMatches.length] !== after.lastMatch
    || previousMatches.includes(after.lastMatch)) return []

  const selected = before.tiles.find((tile) => tile.id === selectedId)
  if (!selected || after.tiles.some((tile) => tile.id === selectedId)) return []
  const remainingIds = new Set(after.tray.map((tile) => tile.id))
  const consumed = [...before.tray, selected].filter((tile) => !remainingIds.has(tile.id))
  if (consumed.length !== 3 || !consumed.some((tile) => tile.id === selectedId)) return []

  const ordered = PRESENTATION_ORDER.map((kind) => consumed.find((tile) => tile.kind === kind))
  if (ordered.some((tile) => !tile)) return []
  const [word, pos, meaning] = ordered as Tile[]
  const matchedWord = before.words.find((entry) => entry.id === after.lastMatch)
  if (!matchedWord || word.wordId !== matchedWord.id
    || pos.text !== matchedWord.pos || meaning.text !== matchedWord.meaning) return []
  return [word, pos, meaning]
}
