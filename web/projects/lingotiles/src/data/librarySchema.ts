/** Generated ECDICT records. A game round uses exactly one attested sense. */
export type LibraryPartOfSpeech =
  | 'n.' | 'v.' | 'adj.' | 'adv.' | 'pron.'
  | 'prep.' | 'conj.' | 'num.' | 'art.' | 'interj.';

export type LibraryStageId = 'primary' | 'junior' | 'senior' | 'cet4' | 'cet6' | 'advanced';

export type LibraryWord = {
  id: string;
  word: string;
  pos: LibraryPartOfSpeech;
  meaning: string;
  phonetic: string;
  /** Complete Chinese definition in the source, including its other senses. */
  definition: string;
  tags: string[];
  stageId: LibraryStageId;
  /** Frequency/complexity ordering signal, not a calibrated difficulty score. */
  rank: number;
  example: string;
  exampleZh: string;
};

export type VocabularyChunk = {
  path: string;
  count: number;
  /** Zero-based offset within this stage. */
  start: number;
  bytes: number;
  sha256: string;
};

export type VocabularyManifest = {
  version: 1;
  total: number;
  curatedWordCount: number;
  source: {
    name: string;
    url: string;
    revision: string;
    csvSha256: string;
    license: string;
  };
  stages: {
    id: LibraryStageId;
    title: string;
    count: number;
    chunks: VocabularyChunk[];
  }[];
  /** Index shard keys are the lowercase first character of the spelling. */
  lookupFiles: Record<string, string>;
  statistics: {
    partsOfSpeech: Record<LibraryPartOfSpeech, number>;
    spellings: { singleWord: number; hyphenated: number; phrase: number };
    withPhonetic: number;
    withFrequency: number;
    eligibleSourceEntries: number;
  };
};

/** Lowercase spelling -> [stage index, chunk index, row index]. */
export type VocabularyLookup = Record<string, [number, number, number]>;
