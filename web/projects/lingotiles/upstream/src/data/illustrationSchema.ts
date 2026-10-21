export type IllustratedSense = { word: string; pos: string; meaning: string };
export type IllustrationEntry = IllustratedSense & { src: string; alt: string };
export type IllustrationManifest = {
  version: 1;
  total: number;
  ready: number;
  pending: number;
  revision: string;
  buckets: Record<string, { path: string; count: number; sha256: string }>;
};

export function illustrationSenseKey(sense: IllustratedSense): string {
  return JSON.stringify([sense.word.trim().toLowerCase(), sense.pos.trim().toLowerCase(), sense.meaning.normalize('NFC').trim()]);
}

/** Stable browser/server partition: only the current round's small indexes are read. */
export function illustrationBucket(sense: IllustratedSense): string {
  let hash = 2166136261;
  for (const character of illustrationSenseKey(sense)) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(-2);
}
