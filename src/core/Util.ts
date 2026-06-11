import DOMPurify from "dompurify";
import { customAlphabet } from "nanoid";
import { Cell, PlayerType, Unit } from "./game/Game";
import { GameMap, TileRef } from "./game/GameMap";
import {
  GameConfig,
  GameID,
  GameRecord,
  PartialGameRecord,
  PlayerRecord,
  Turn,
  Winner,
} from "./Schemas";

import {
  TRIBE_NAME_PREFIXES,
  TRIBE_NAME_SUFFIXES,
} from "./execution/utils/TribeNames";

export function manhattanDistWrapped(
  c1: Cell,
  c2: Cell,
  width: number,
): number {
  // Calculate x distance
  let dx = Math.abs(c1.x - c2.x);
  // Check if wrapping around the x-axis is shorter
  dx = Math.min(dx, width - dx);

  // Calculate y distance (no wrapping for y-axis)
  const dy = Math.abs(c1.y - c2.y);

  // Return the sum of x and y distances
  return dx + dy;
}

export function within(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distSort(
  gm: GameMap,
  target: TileRef,
): (a: TileRef, b: TileRef) => number {
  return (a: TileRef, b: TileRef) => {
    return gm.manhattanDist(a, target) - gm.manhattanDist(b, target);
  };
}

export function distSortUnit(
  gm: GameMap,
  target: Unit | TileRef,
): (a: Unit, b: Unit) => number {
  const targetRef = typeof target === "number" ? target : target.tile();

  return (a: Unit, b: Unit) => {
    return (
      gm.manhattanDist(a.tile(), targetRef) -
      gm.manhattanDist(b.tile(), targetRef)
    );
  };
}

/**
 * Finds minimum, by score, with single pass search
 * Faster than array.reduce()
 */
export function findMinimumBy<T>(
  values: readonly T[],
  score: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;

  if (isCandidate === undefined) {
    for (let i = 0, len = values.length; i < len; i++) {
      const value = values[i];
      const currentScore = score(value);
      if (currentScore < bestScore) {
        bestScore = currentScore;
        best = value;
      }
    }
    return best;
  }

  for (let i = 0, len = values.length; i < len; i++) {
    const value = values[i];
    if (!isCandidate(value)) continue;

    const currentScore = score(value);
    if (currentScore < bestScore) {
      bestScore = currentScore;
      best = value;
    }
  }

  return best;
}

/**
 * Finds closest by fast. Example usage:
 * findClosestBy(
 *       this.units(UnitType.OrbitalStrikePlatform),
 *       (platform) => mg.manhattanDist(platform.tile(), tile),
 *       (platform) => !platform.isInCooldown() && !platform.isUnderConstruction(),
 *     )
 */
export function findClosestBy<T>(
  values: readonly T[],
  distance: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  return findMinimumBy(values, distance, isCandidate);
}

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function calculateBoundingBox(
  gm: GameMap,
  borderTiles: ReadonlySet<TileRef>,
): { min: Cell; max: Cell } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const tile of borderTiles) {
    const x = gm.x(tile);
    const y = gm.y(tile);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
}

export function boundingBoxTiles(
  gm: GameMap,
  center: TileRef,
  radius: number,
): TileRef[] {
  const tiles: TileRef[] = [];

  const centerX = gm.x(center);
  const centerY = gm.y(center);

  const minX = centerX - radius;
  const maxX = centerX + radius;
  const minY = centerY - radius;
  const maxY = centerY + radius;

  // Top and bottom edges (full width)
  for (let x = minX; x <= maxX; x++) {
    if (gm.isValidCoord(x, minY)) {
      tiles.push(gm.ref(x, minY));
    }
    if (gm.isValidCoord(x, maxY) && minY !== maxY) {
      tiles.push(gm.ref(x, maxY));
    }
  }

  // Left and right edges (exclude corners already added)
  for (let y = minY + 1; y < maxY; y++) {
    if (gm.isValidCoord(minX, y)) {
      tiles.push(gm.ref(minX, y));
    }
    if (gm.isValidCoord(maxX, y) && minX !== maxX) {
      tiles.push(gm.ref(maxX, y));
    }
  }

  return tiles;
}

export function getMode<T>(counts: Map<T, number>): T | null {
  let mode: T | null = null;
  let maxCount = 0;

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = item;
    }
  }

  return mode;
}

export function calculateBoundingBoxCenter(
  gm: GameMap,
  borderTiles: ReadonlySet<TileRef>,
): Cell {
  const { min, max } = calculateBoundingBox(gm, borderTiles);
  return boundingBoxCenter({ min, max });
}

export function boundingBoxCenter(box: { min: Cell; max: Cell }): Cell {
  return new Cell(
    box.min.x + Math.floor((box.max.x - box.min.x) / 2),
    box.min.y + Math.floor((box.max.y - box.min.y) / 2),
  );
}

export function inscribed(
  outer: { min: Cell; max: Cell },
  inner: { min: Cell; max: Cell },
): boolean {
  return (
    outer.min.x <= inner.min.x &&
    outer.min.y <= inner.min.y &&
    outer.max.x >= inner.max.x &&
    outer.max.y >= inner.max.y
  );
}

export function sanitize(name: string): string {
  return Array.from(name)
    .join("")
    .replace(/[^\p{L}\p{N}\s\p{Emoji}\p{Emoji_Component}[\]_]/gu, "");
}

export function onlyImages(html: string) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["span", "img"],
    ALLOWED_ATTR: ["src", "alt", "class", "style"],
    ALLOWED_URI_REGEXP: /^https:\/\/cdn\.jsdelivr\.net\/gh\/twitter\/twemoji/,
    ADD_ATTR: ["style"],
  });
}

export function createPartialGameRecord(
  gameID: GameID,
  config: GameConfig,
  // username does not need to be set.
  players: PlayerRecord[],
  allTurns: Turn[],
  start: number,
  end: number,
  winner: Winner,
  // lobby creation time (ms). Defaults to start time for singleplayer.
  lobbyCreatedAt?: number,
  // Time the lobby became visible to players (ms).
  visibleAt?: number,
): PartialGameRecord {
  const duration = Math.floor((end - start) / 1000);
  const num_turns = allTurns.length;
  const turns = allTurns.filter(
    (t) => t.intents.length !== 0 || t.hash !== undefined,
  );

  // Use start time as lobby creation time for singleplayer
  const actualLobbyCreatedAt = lobbyCreatedAt ?? start;
  const lobbyFillTime = Math.max(
    0,
    start - (visibleAt ?? actualLobbyCreatedAt),
  );

  const record: PartialGameRecord = {
    info: {
      gameID,
      lobbyCreatedAt: actualLobbyCreatedAt,
      visibleAt,
      lobbyFillTime,
      config,
      players,
      start,
      end,
      duration,
      num_turns,
      winner,
    },
    version: "v0.0.2",
    turns,
  };
  return record;
}

export function decompressGameRecord(gameRecord: GameRecord) {
  const turns: Turn[] = [];
  let lastTurnNum = -1;
  for (const turn of gameRecord.turns) {
    while (lastTurnNum < turn.turnNumber - 1) {
      lastTurnNum++;
      turns.push({
        turnNumber: lastTurnNum,
        intents: [],
      });
    }
    turns.push(turn);
    lastTurnNum = turn.turnNumber;
  }
  const turnLength = turns.length;
  for (let i = turnLength; i < gameRecord.info.num_turns; i++) {
    turns.push({
      turnNumber: i,
      intents: [],
    });
  }
  gameRecord.turns = turns;
  return gameRecord;
}

export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + x);
}

export function generateID(): GameID {
  const nanoid = customAlphabet(
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
    8,
  );
  return nanoid();
}

export function toInt(num: number): bigint {
  if (num === Infinity) {
    return BigInt(Number.MAX_SAFE_INTEGER);
  }
  if (num === -Infinity) {
    return BigInt(Number.MIN_SAFE_INTEGER);
  }
  return BigInt(Math.floor(num));
}

export function maxInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function withinInt(num: bigint, min: bigint, max: bigint): bigint {
  const atLeastMin = maxInt(num, min);
  return minInt(atLeastMin, max);
}

export function createRandomName(
  name: string,
  playerType: PlayerType,
): string | null {
  let randomName: string | null = null;
  if (playerType === PlayerType.Human) {
    const hash = simpleHash(name);
    const prefixIndex = hash % TRIBE_NAME_PREFIXES.length;
    const suffixIndex =
      Math.floor(hash / TRIBE_NAME_PREFIXES.length) %
      TRIBE_NAME_SUFFIXES.length;

    randomName = `👤 ${TRIBE_NAME_PREFIXES[prefixIndex]} ${TRIBE_NAME_SUFFIXES[suffixIndex]}`;
  }
  return randomName;
}

export const emojiTable = [
  ["😀", "😊", "🥰", "😇", "😎"],
  ["😞", "🥺", "😭", "😱", "😡"],
  ["😈", "🤡", "🥱", "🫡", "🖕"],
  ["👋", "👏", "✋", "🙏", "💪"],
  ["👍", "👎", "🫴", "🤌", "🤦‍♂️"],
  ["🤝", "🆘", "🕊️", "🏳️", "⏳"],
  ["🔥", "💥", "💀", "☢️", "⚠️"],
  ["↖️", "⬆️", "↗️", "👑", "🥇"],
  ["⬅️", "🎯", "➡️", "🥈", "🥉"],
  ["↙️", "⬇️", "↘️", "❤️", "💔"],
  ["💰", "⚓", "⛵", "🏡", "🛡️"],
  ["🏭", "🚂", "❓", "🐔", "🐀"],
] as const;
// 2d to 1d array
export const flattenedEmojiTable = emojiTable.flat();

export type Emoji = (typeof flattenedEmojiTable)[number];

/**
 * JSON.stringify replacer function that converts bigint values to strings.
 */
export function replacer(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Deterministic transcendental replacements for sim code.
 *
 * ECMA-262 specifies Math.exp / Math.log / Math.pow (and the other
 * transcendentals) as *implementation-approximated*: V8, JavaScriptCore and
 * SpiderMonkey may legally differ in the last ULP. Any such value feeding the
 * lockstep simulation is a cross-engine desync vector — a Math.floor or
 * BigInt() conversion amplifies a 1-ULP wobble into a whole credit/unit.
 *
 * IEEE-754 basic operations (+ - * / and Math.sqrt) ARE exactly specified
 * (correctly rounded), so the functions below are built from those only and
 * return bit-identical results on every engine. Deterministic game state must
 * use these instead of Math.exp / Math.pow / Math.log.
 */

// ln(2) and 1/ln(2) as the nearest-double literals (numeric literals round
// deterministically per ECMA-262 §6.1.6.1).
const DET_LN2 = 0.6931471805599453;
const DET_INV_LN2 = 1.4426950408889634;

/**
 * 2**k for integer k via repeated squaring. Every intermediate is an exact
 * power of two, so each multiply is exact — never calls Math.pow. Covers the
 * whole finite double range; |k| beyond it over/underflows to Infinity/0
 * exactly like 2**k would.
 */
export function detPow2(k: number): number {
  let result = 1;
  let base = k < 0 ? 0.5 : 2;
  let e = Math.abs(k);
  while (e > 0) {
    if (e % 2 === 1) result *= base;
    base *= base;
    e = Math.floor(e / 2);
  }
  return result;
}

/**
 * Deterministic Math.exp replacement (basic IEEE-754 ops only).
 *
 * Argument reduction x = k·ln2 + r with |r| ≤ ln2/2, exp(r) via a fixed
 * 14-term Taylor series (truncation < 1e-17), exact 2**k scaling. Max
 * relative error vs. true exp: < 1e-14 for |x| ≤ 100 (the sim's range),
 * < 2e-13 over the whole finite domain — far below the cross-engine ULP
 * wobble this replaces, and identical on every engine.
 */
export function detExp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.9) return Infinity; // Math.exp overflow threshold ≈ 709.78
  if (x < -745.2) return 0; // underflow threshold ≈ -745.13
  const k = Math.round(x * DET_INV_LN2);
  const r = x - k * DET_LN2;
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 14; i++) {
    term = (term * r) / i;
    sum += term;
  }
  return sum * detPow2(k);
}

/**
 * Deterministic Math.log (natural log) replacement (basic ops only).
 *
 * Reduction x = m·2**k with m ∈ [√½, √2) via exact doublings/halvings, then
 * ln(m) = 2·atanh(t), t = (m-1)/(m+1), |t| ≤ 0.1716, as a fixed 11-term odd
 * series (truncation < 1e-19). Max absolute error ≈ 1e-16·(1 + |k|), i.e.
 * relative error < ~1e-13 in a subsequent exp.
 */
export function detLog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let m = x;
  let k = 0;
  while (m >= 1.4142135623730951) {
    m *= 0.5;
    k++;
  }
  while (m < 0.7071067811865476) {
    m *= 2;
    k--;
  }
  const t = (m - 1) / (m + 1);
  const t2 = t * t;
  let term = t;
  let sum = t;
  for (let i = 3; i <= 21; i += 2) {
    term *= t2;
    sum += term / i;
  }
  return 2 * sum + k * DET_LN2;
}

/**
 * Deterministic Math.pow replacement for non-integer exponents:
 * detExp(exponent · detLog(base)). Defined for base ≥ 0; max relative error
 * < ~1e-13 for the |exponent·ln(base)| ≤ 100 range the sim uses. For 2**k
 * with integer k use detPow2 (exact) instead.
 */
export function detPow(base: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (base === 1) return 1;
  if (Number.isNaN(base) || base < 0) return NaN;
  if (base === 0) return exponent > 0 ? 0 : Infinity;
  return detExp(exponent * detLog(base));
}

export function sigmoid(
  value: number,
  decayRate: number,
  midpoint: number,
): number {
  // detExp (not Math.exp): sigmoid feeds deterministic sim state — see the
  // deterministic-transcendentals block above.
  return 1 / (1 + detExp(-decayRate * (value - midpoint)));
}

export function formatPlayerDisplayName(
  username: string,
  clanTag?: string | null,
): string {
  return clanTag ? `[${clanTag}] ${username}` : username;
}

const CLAN_TAG_CHARS = "a-zA-Z0-9";

const CLAN_TAG_INVALID_CHARS = new RegExp(`[^${CLAN_TAG_CHARS}]`, "g");

export function sanitizeClanTag(tag: string): string {
  return tag.replace(CLAN_TAG_INVALID_CHARS, "").substring(0, 5).toUpperCase();
}
