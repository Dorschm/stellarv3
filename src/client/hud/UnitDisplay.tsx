import React, { useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import {
  BuildableUnit,
  BuildMenus,
  PlayerBuildableUnitType,
  UnitType,
} from "../../core/game/Game";
import {
  GhostStructureChangedEvent,
  ToggleStructureEvent,
} from "../InputHandler";
import { renderNumber, translateText } from "../Utils";
import { useHUDStore } from "../bridge/HUDStore";
import { useGameTick } from "./useGameTick";

const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const defensePostIcon = assetUrl("images/ShieldIconWhite.svg");

const UNIT_CONFIG = [
  {
    icon: cityIcon,
    type: UnitType.Colony,
    key: "colony",
    defaultKey: "1",
  },
  {
    icon: factoryIcon,
    type: UnitType.Foundry,
    key: "foundry",
    defaultKey: "2",
  },
  {
    icon: portIcon,
    type: UnitType.Spaceport,
    key: "spaceport",
    defaultKey: "3",
  },
  {
    icon: defensePostIcon,
    type: UnitType.DefenseStation,
    key: "defense_station",
    defaultKey: "4",
  },
  {
    icon: missileSiloIcon,
    type: UnitType.OrbitalStrikePlatform,
    key: "orbital_strike_platform",
    defaultKey: "5",
  },
  {
    icon: samLauncherIcon,
    type: UnitType.PointDefenseArray,
    key: "point_defense_array",
    defaultKey: "6",
  },
  {
    icon: warshipIcon,
    type: UnitType.Battlecruiser,
    key: "battlecruiser",
    defaultKey: "7",
  },
  {
    icon: atomBombIcon,
    type: UnitType.AntimatterTorpedo,
    key: "antimatter_torpedo",
    defaultKey: "8",
  },
  {
    icon: hydrogenBombIcon,
    type: UnitType.NovaBomb,
    key: "nova_bomb",
    defaultKey: "9",
  },
  {
    icon: mirvIcon,
    type: UnitType.ClusterWarhead,
    key: "cluster_warhead",
    defaultKey: "0",
  },
];

const KEYBIND_KEYS = {
  [UnitType.Colony]: "buildColony",
  [UnitType.Foundry]: "buildFoundry",
  [UnitType.Spaceport]: "buildSpaceport",
  [UnitType.DefenseStation]: "buildDefenseStation",
  [UnitType.OrbitalStrikePlatform]: "buildOrbitalStrikePlatform",
  [UnitType.PointDefenseArray]: "buildPointDefenseArray",
  [UnitType.Battlecruiser]: "buildBattlecruiser",
  [UnitType.AntimatterTorpedo]: "buildAntimatterTorpedo",
  [UnitType.NovaBomb]: "buildNovaBomb",
  [UnitType.ClusterWarhead]: "buildClusterWarhead",
} as Record<PlayerBuildableUnitType, string>;

export function UnitDisplay(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(100);
  const [playerBuildables, setPlayerBuildables] = useState<
    BuildableUnit[] | null
  >(null);
  const [keybinds, setKeybinds] = useState<
    Record<string, { value: string; key: string }>
  >({});
  const [unitCounts, setUnitCounts] = useState({
    colonies: 0,
    battlecruisers: 0,
    foundries: 0,
    orbitalStrikePlatform: 0,
    spaceport: 0,
    defenseStation: 0,
    pointDefenseArray: 0,
  });
  const [allDisabled, setAllDisabled] = useState(false);
  const [hoveredUnit, setHoveredUnit] =
    useState<PlayerBuildableUnitType | null>(null);
  const ghostStructure = useHUDStore((state) => state.ghostStructure);

  // Initialize
  useEffect(() => {
    const config = gameView.config();

    const savedKeybinds = localStorage.getItem("settings.keybinds");
    if (savedKeybinds) {
      try {
        setKeybinds(JSON.parse(savedKeybinds));
      } catch (e) {
        console.warn("Invalid keybinds JSON:", e);
      }
    }

    const disabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));
    setAllDisabled(disabled);
  }, [gameView]);

  // Update on tick
  useEffect(() => {
    const player = gameView.myPlayer();
    if (!player) return;

    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      setPlayerBuildables(buildables);
    });

    setUnitCounts({
      colonies: player.totalUnitLevels(UnitType.Colony),
      orbitalStrikePlatform: player.totalUnitLevels(
        UnitType.OrbitalStrikePlatform,
      ),
      spaceport: player.totalUnitLevels(UnitType.Spaceport),
      defenseStation: player.totalUnitLevels(UnitType.DefenseStation),
      pointDefenseArray: player.totalUnitLevels(UnitType.PointDefenseArray),
      foundries: player.totalUnitLevels(UnitType.Foundry),
      battlecruisers: player.totalUnitLevels(UnitType.Battlecruiser),
    });
  }, [tick, gameView]);

  const getCost = (item: UnitType): bigint => {
    for (const bu of playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  };

  const canBuild = (item: UnitType): boolean => {
    if (gameView.config().isUnitDisabled(item)) return false;
    const player = gameView.myPlayer();
    switch (item) {
      case UnitType.AntimatterTorpedo:
      case UnitType.NovaBomb:
      case UnitType.ClusterWarhead:
        return (
          getCost(item) <= (player?.credits() ?? 0n) &&
          (player?.units(UnitType.OrbitalStrikePlatform).length ?? 0) > 0
        );
      case UnitType.Battlecruiser:
        return (
          getCost(item) <= (player?.credits() ?? 0n) &&
          (player?.units(UnitType.Spaceport).length ?? 0) > 0
        );
      default:
        return getCost(item) <= (player?.credits() ?? 0n);
    }
  };

  const handleUnitClick = (unitType: PlayerBuildableUnitType) => {
    if (ghostStructure === unitType) {
      useHUDStore.setState({ ghostStructure: null });
      eventBus.emit(new GhostStructureChangedEvent(null));
    } else if (canBuild(unitType)) {
      useHUDStore.setState({ ghostStructure: unitType });
      eventBus.emit(new GhostStructureChangedEvent(unitType));
    }
  };

  const handleUnitMouseEnter = (unitType: PlayerBuildableUnitType) => {
    switch (unitType) {
      case UnitType.AntimatterTorpedo:
      case UnitType.NovaBomb:
        eventBus.emit(
          new ToggleStructureEvent([
            UnitType.OrbitalStrikePlatform,
            UnitType.PointDefenseArray,
          ]),
        );
        break;
      case UnitType.Battlecruiser:
        eventBus.emit(new ToggleStructureEvent([UnitType.Spaceport]));
        break;
      default:
        eventBus.emit(new ToggleStructureEvent([unitType]));
    }
  };

  const handleUnitMouseLeave = () => {
    eventBus.emit(new ToggleStructureEvent(null));
  };

  const renderUnitItem = (
    config: (typeof UNIT_CONFIG)[0],
    countValue: number | null,
  ) => {
    const { icon, type, key, defaultKey } = config;

    if (gameView.config().isUnitDisabled(type)) {
      return null;
    }

    const keybind = keybinds[KEYBIND_KEYS[type as PlayerBuildableUnitType]];
    const hotkey = keybind?.key ?? `Digit${defaultKey}`;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    const selected = ghostStructure === type;
    const hovered = hoveredUnit === type;
    const cost = getCost(type);
    const canBuildUnit = canBuild(type);

    return (
      <div
        key={type}
        className="flex flex-col items-center relative"
        onMouseEnter={() => {
          setHoveredUnit(type as PlayerBuildableUnitType);
          handleUnitMouseEnter(type as PlayerBuildableUnitType);
        }}
        onMouseLeave={() => {
          setHoveredUnit(null);
          handleUnitMouseLeave();
        }}
      >
        {hovered && (
          <div className="absolute -top-[250%] left-1/2 -translate-x-1/2 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none">
            <div className="font-bold text-sm mb-1">
              {translateText(`unit_type.${key}`)}
              {` [${displayHotkey}]`}
            </div>
            <div className="p-2">{translateText(`build_menu.desc.${key}`)}</div>
            <div className="flex items-center justify-center gap-1">
              <img src={goldCoinIcon} width="13" height="13" alt="" />
              <span className="text-yellow-300">{renderNumber(cost)}</span>
            </div>
          </div>
        )}
        <div
          className={`${
            canBuildUnit ? "" : "opacity-40"
          } border border-slate-500 rounded-sm px-0.5 pb-0.5 flex items-center gap-0.5 cursor-pointer ${
            selected ? "hover:bg-gray-400/10" : "hover:bg-gray-800"
          } rounded-sm text-white ${selected ? "bg-slate-400/20" : ""}`}
          onClick={() => handleUnitClick(type as PlayerBuildableUnitType)}
        >
          <div className="ml-0.5 text-[10px] relative -top-1 text-gray-400">
            {displayHotkey}
          </div>
          <div className="flex items-center gap-0.5 pt-0.5">
            <img src={icon} alt={key} className="align-middle size-5" />
            {countValue !== null && (
              <span className="text-xs">{renderNumber(countValue)}</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const myPlayer = gameView.myPlayer();
  if (
    !gameView ||
    !myPlayer ||
    gameView.inSpawnPhase() ||
    !myPlayer.isAlive() ||
    allDisabled
  ) {
    return <div />;
  }

  // Map unit counts to config
  const countMap: Record<UnitType, number | null> = {
    [UnitType.Colony]: unitCounts.colonies,
    [UnitType.Foundry]: unitCounts.foundries,
    [UnitType.Spaceport]: unitCounts.spaceport,
    [UnitType.DefenseStation]: unitCounts.defenseStation,
    [UnitType.OrbitalStrikePlatform]: unitCounts.orbitalStrikePlatform,
    [UnitType.PointDefenseArray]: unitCounts.pointDefenseArray,
    [UnitType.Battlecruiser]: unitCounts.battlecruisers,
    [UnitType.AntimatterTorpedo]: null,
    [UnitType.NovaBomb]: null,
    [UnitType.ClusterWarhead]: null,
    [UnitType.AssaultShuttle]: null,
    [UnitType.PlasmaBolt]: null,
    [UnitType.PointDefenseMissile]: null,
    [UnitType.TradeFreighter]: null,
    [UnitType.ClusterWarheadSubmunition]: null,
    [UnitType.Frigate]: null,
    [UnitType.JumpGate]: null,
    [UnitType.ScoutSwarm]: null,
  };

  return (
    <div className="border-t border-white/10 p-0.5 w-full">
      <div className="grid grid-rows-1 auto-cols-max grid-flow-col gap-0.5 w-fit mx-auto">
        {UNIT_CONFIG.map((config) =>
          renderUnitItem(config, countMap[config.type]),
        )}
      </div>
    </div>
  );
}
