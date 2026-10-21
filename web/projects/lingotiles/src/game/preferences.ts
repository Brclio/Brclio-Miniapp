const PREFERENCES_KEY = 'lingotiles.preferences.v1'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>

function parsePreferences(raw: string | null): Record<string, unknown> {
  if (raw === null) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/** The optional teaching animation is off until the player explicitly enables it. */
export function loadMatchAnimation(storage?: ReadStorage): boolean {
  try {
    const availableStorage = storage ?? globalThis.localStorage
    return availableStorage
      ? parsePreferences(availableStorage.getItem(PREFERENCES_KEY)).matchAnimation === true
      : false
  } catch {
    // Browsers may reject even access to the localStorage property.
    return false
  }
}

/** Keep other preferences intact; unavailable storage must not interrupt a game. */
export function saveMatchAnimation(enabled: boolean, storage?: WriteStorage): boolean {
  try {
    const availableStorage = storage ?? globalThis.localStorage
    if (!availableStorage) return false
    const preferences = parsePreferences(availableStorage.getItem(PREFERENCES_KEY))
    availableStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...preferences, matchAnimation: enabled }))
    return true
  } catch {
    return false
  }
}
