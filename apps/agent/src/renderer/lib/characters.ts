export const CHARACTER_MAP: Record<number, string> = {
  0: 'Captain Falcon', 1: 'Donkey Kong', 2: 'Fox', 3: 'Mr. Game & Watch',
  4: 'Kirby', 5: 'Bowser', 6: 'Link', 7: 'Luigi', 8: 'Mario', 9: 'Marth',
  10: 'Mewtwo', 11: 'Ness', 12: 'Peach', 13: 'Pikachu', 14: 'Ice Climbers',
  15: 'Jigglypuff', 16: 'Samus', 17: 'Yoshi', 18: 'Zelda', 19: 'Sheik',
  20: 'Falco', 21: 'Young Link', 22: 'Dr. Mario', 23: 'Roy', 24: 'Pichu', 25: 'Ganondorf',
};

export const CHARACTER_SHORT_NAMES: Record<number, string> = {
  0: 'Falcon', 1: 'DK', 2: 'Fox', 3: 'G&W', 4: 'Kirby', 5: 'Bowser',
  6: 'Link', 7: 'Luigi', 8: 'Mario', 9: 'Marth', 10: 'Mewtwo', 11: 'Ness',
  12: 'Peach', 13: 'Pikachu', 14: 'ICs', 15: 'Puff', 16: 'Samus',
  17: 'Yoshi', 18: 'Zelda', 19: 'Sheik', 20: 'Falco', 21: 'YLink',
  22: 'Doc', 23: 'Roy', 24: 'Pichu', 25: 'Ganon',
};

export function getCharacterImagePath(id: number): string {
  if (CHARACTER_MAP[id] == null) return '';
  return `./stockicons/${id}.png`;
}

export function getCharacterName(id: number): string { return CHARACTER_MAP[id] ?? 'Unknown'; }
export function getCharacterShortName(id: number): string { return CHARACTER_SHORT_NAMES[id] ?? '???'; }

export const STAGE_MAP: Record<number, string> = {
  2: 'Fountain of Dreams', 3: 'Pokemon Stadium', 8: "Yoshi's Story",
  28: 'Dream Land N64', 31: 'Battlefield', 32: 'Final Destination',
};

// Slippi internal char ID → start.gg char ID
export const SLIPPI_TO_STARTGG_CHAR: Record<number, number> = {
  0: 2,   // Captain Falcon
  1: 3,   // Donkey Kong
  2: 6,   // Fox
  3: 16,  // Mr. Game & Watch
  4: 10,  // Kirby
  5: 1,   // Bowser
  6: 11,  // Link
  7: 12,  // Luigi
  8: 13,  // Mario
  9: 14,  // Marth
  10: 15, // Mewtwo
  11: 17, // Ness
  12: 18, // Peach
  13: 20, // Pikachu
  14: 8,  // Ice Climbers
  15: 9,  // Jigglypuff
  16: 22, // Samus
  17: 24, // Yoshi
  18: 26, // Zelda
  19: 23, // Sheik
  20: 5,  // Falco
  21: 25, // Young Link
  22: 4,  // Dr. Mario
  23: 21, // Roy
  24: 19, // Pichu
  25: 7,  // Ganondorf
};

export const STARTGG_TO_SLIPPI_CHAR: Record<number, number> = Object.fromEntries(
  Object.entries(SLIPPI_TO_STARTGG_CHAR).map(([s, g]) => [g, Number(s)]),
);

export type LegalStage = {
  slippiId: number;
  startggId: number;
  name: string;
  short: string;
};

export const LEGAL_STAGES: LegalStage[] = [
  { slippiId: 31, startggId: 19, name: 'Battlefield', short: 'BF' },
  { slippiId: 32, startggId: 20, name: 'Final Destination', short: 'FD' },
  { slippiId: 8,  startggId: 5,  name: "Yoshi's Story", short: 'YS' },
  { slippiId: 2,  startggId: 11, name: 'Fountain of Dreams', short: 'FoD' },
  { slippiId: 28, startggId: 25, name: 'Dream Land N64', short: 'DL' },
  { slippiId: 3,  startggId: 15, name: 'Pokemon Stadium', short: 'PS' },
];
