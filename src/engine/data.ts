import type { Database, Relation, Value } from './types';

/** Build a relation whose columns all belong to `name`. */
function rel(name: string, cols: string[], rows: Value[][]): Relation {
  return { name, columns: cols.map((c) => ({ name: c, rel: name })), rows };
}

// Tables exactly as they appear in the CIS3530 Week 2 slides (slides 9, 44, 22/47).

export const MOVIES = rel('Movies', ['mID', 'title', 'director', 'year', 'length'], [
  [1, 'Shining', 'Kubrick', 1980, 146],
  [2, 'Player', 'Altman', 1992, 146],
  [3, 'Chinatown', 'Polaski', 1974, 131],
  [4, 'Repulsion', 'Polaski', 1965, 143],
  [5, 'Star Wars IV', 'Lucas', 1977, 126],
  [6, 'American Graffiti', 'Lucas', 1973, 110],
  [7, 'Full Metal Jacket', 'Kubrick', 1987, 156],
]);

const ARTIST_ROWS: Value[][] = [
  [1, 'Nicholson', 'American'],
  [2, 'Ford', 'American'],
  [3, 'Stone', 'British'],
  [4, 'Fisher', 'American'],
];

/** Slide 44 adds this artist (who plays no role) to demonstrate dangling tuples. */
export const BACHCHAN_ROW: Value[] = [5, 'Bachchan', 'Indian'];

export const ROLES = rel('Roles', ['mID', 'aID', 'character'], [
  [1, 1, 'Jack Torrance'],
  [3, 1, "Jake 'J.J.' Gittes"],
  [1, 3, 'Delbert Grady'],
  [5, 2, 'Han Solo'],
  [6, 2, 'Bob Falfa'],
  [5, 4, 'Princess Leia Organa'],
]);

export const R1 = rel('R1', ['col0', 'col1'], [
  ['a', 1],
  ['b', 2],
]);

export const R2 = rel('R2', ['col1', 'col2'], [
  [1, 'x'],
  [1, 'y'],
  [3, 'z'],
]);

export function buildDatabase(includeBachchan: boolean): Database {
  const artists = rel('Artists', ['aID', 'aName', 'nationality'], includeBachchan ? [...ARTIST_ROWS, BACHCHAN_ROW] : ARTIST_ROWS);
  return { Movies: MOVIES, Artists: artists, Roles: ROLES, R1, R2 };
}
