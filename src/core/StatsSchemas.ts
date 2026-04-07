import { z } from "zod";
import { UnitType } from "./game/Game";

export const bombUnits = ["ator", "nbomb", "cwhead", "cwsub"] as const;
export const BombUnitSchema = z.enum(bombUnits);
export type BombUnit = z.infer<typeof BombUnitSchema>;
export type NukeType =
  | UnitType.AntimatterTorpedo
  | UnitType.NovaBomb
  | UnitType.ClusterWarhead
  | UnitType.ClusterWarheadSubmunition;

export const unitTypeToBombUnit = {
  [UnitType.AntimatterTorpedo]: "ator",
  [UnitType.NovaBomb]: "nbomb",
  [UnitType.ClusterWarhead]: "cwhead",
  [UnitType.ClusterWarheadSubmunition]: "cwsub",
} as const satisfies Record<NukeType, BombUnit>;

export const spaceUnits = ["tfreight", "ashuttle"] as const;
export const SpaceUnitSchema = z.enum(spaceUnits);
export type SpaceUnit = z.infer<typeof SpaceUnitSchema>;
export type SpaceUnitType = UnitType.TradeFreighter | UnitType.AssaultShuttle;

// export const unitTypeToSpaceUnit = {
//   [UnitType.TradeFreighter]: "tfreight",
//   [UnitType.AssaultShuttle]: "ashuttle",
// } as const satisfies Record<SpaceUnitType, SpaceUnit>;

export const otherUnits = [
  "coln",
  "defs",
  "sprt",
  "bcrs",
  "osp",
  "pda",
  "fndy",
] as const;
export const OtherUnitSchema = z.enum(otherUnits);
export type OtherUnit = z.infer<typeof OtherUnitSchema>;
export type OtherUnitType =
  | UnitType.Colony
  | UnitType.DefenseStation
  | UnitType.OrbitalStrikePlatform
  | UnitType.Spaceport
  | UnitType.PointDefenseArray
  | UnitType.Battlecruiser
  | UnitType.Foundry;

export const unitTypeToOtherUnit = {
  [UnitType.Colony]: "coln",
  [UnitType.DefenseStation]: "defs",
  [UnitType.OrbitalStrikePlatform]: "osp",
  [UnitType.Spaceport]: "sprt",
  [UnitType.PointDefenseArray]: "pda",
  [UnitType.Battlecruiser]: "bcrs",
  [UnitType.Foundry]: "fndy",
} as const satisfies Record<OtherUnitType, OtherUnit>;

// Attacks
export const ATTACK_INDEX_SENT = 0; // Outgoing attack troops
export const ATTACK_INDEX_RECV = 1; // Incmoing attack troops
export const ATTACK_INDEX_CANCEL = 2; // Cancelled attack troops

// Player types
export const PLAYER_INDEX_HUMAN = 0;
export const PLAYER_INDEX_NATION = 1;
export const PLAYER_INDEX_BOT = 2;

// Shuttles
export const SHUTTLE_INDEX_SENT = 0; // Shuttles launched
export const SHUTTLE_INDEX_ARRIVE = 1; // Shuttles arrived
export const SHUTTLE_INDEX_CAPTURE = 2; // Shuttles captured
export const SHUTTLE_INDEX_DESTROY = 3; // Shuttles destroyed

// Bombs
export const BOMB_INDEX_LAUNCH = 0; // Bombs launched
export const BOMB_INDEX_LAND = 1; // Bombs landed
export const BOMB_INDEX_INTERCEPT = 2; // Bombs intercepted

// Credits
export const CREDITS_INDEX_WORK = 0; // Credits earned by workers
export const CREDITS_INDEX_WAR = 1; // Credits earned by conquering players
export const CREDITS_INDEX_TRADE = 2; // Credits earned by trade freighters
export const CREDITS_INDEX_STEAL = 3; // Credits earned by capturing trade freighters
export const CREDITS_INDEX_FRIGATE_SELF = 4; // Credits earned by own frigates
export const CREDITS_INDEX_FRIGATE_OTHER = 5; // Credits earned by other players frigates

// Other Units
export const OTHER_INDEX_BUILT = 0; // Structures and battlecruisers built
export const OTHER_INDEX_DESTROY = 1; // Structures and battlecruisers destroyed
export const OTHER_INDEX_CAPTURE = 2; // Structures captured
export const OTHER_INDEX_LOST = 3; // Structures/battlecruisers destroyed/captured by others
export const OTHER_INDEX_UPGRADE = 4; // Structures upgraded

export const BigIntStringSchema = z.preprocess((val) => {
  if (typeof val === "string" && /^-?\d+$/.test(val)) return BigInt(val);
  if (typeof val === "bigint") return val;
  return val;
}, z.bigint());

const AtLeastOneNumberSchema = BigIntStringSchema.array().min(1);
export type AtLeastOneNumber = z.infer<typeof AtLeastOneNumberSchema>;

export const PlayerStatsSchema = z
  .object({
    attacks: AtLeastOneNumberSchema.optional(),
    betrayals: BigIntStringSchema.optional(),
    killedAt: BigIntStringSchema.optional(),
    conquests: AtLeastOneNumberSchema.optional(),
    shuttles: z
      .partialRecord(SpaceUnitSchema, AtLeastOneNumberSchema)
      .optional(),
    bombs: z.partialRecord(BombUnitSchema, AtLeastOneNumberSchema).optional(),
    credits: AtLeastOneNumberSchema.optional(),
    units: z.partialRecord(OtherUnitSchema, AtLeastOneNumberSchema).optional(),
  })
  .optional();
export type PlayerStats = z.infer<typeof PlayerStatsSchema>;
