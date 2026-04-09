import React, { useCallback, useEffect, useState } from "react";
import { assetUrl } from "../../core/AssetUrls";
import {
  BuildableUnit,
  BuildMenus,
  Credits,
  PlayerBuildableUnitType,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { useHUDStore } from "../bridge/HUDStore";
import { useEventBus } from "../bridge/useEventBus";
import {
  CloseViewEvent,
  MouseDownEvent,
  ShowBuildMenuEvent,
  ShowEmojiMenuEvent,
} from "../InputHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { renderNumber, translateText } from "../Utils";
import { useGameTick } from "./useGameTick";

const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const creditsIcon = assetUrl("images/GoldCoinIcon.svg");
const mirvIcon = assetUrl("images/MIRVIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const hydrogenBombIcon = assetUrl("images/MushroomCloudIconWhite.svg");
const atomBombIcon = assetUrl("images/NukeIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samlauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const shieldIcon = assetUrl("images/ShieldIconWhite.svg");

export interface BuildItemDisplay {
  unitType: PlayerBuildableUnitType;
  icon: string;
  description?: string;
  key?: string;
  countable?: boolean;
}

export const buildTable: BuildItemDisplay[][] = [
  [
    {
      unitType: UnitType.AntimatterTorpedo,
      icon: atomBombIcon,
      description: "build_menu.desc.antimatter_torpedo",
      key: "unit_type.antimatter_torpedo",
      countable: false,
    },
    {
      unitType: UnitType.ClusterWarhead,
      icon: mirvIcon,
      description: "build_menu.desc.cluster_warhead",
      key: "unit_type.cluster_warhead",
      countable: false,
    },
    {
      unitType: UnitType.NovaBomb,
      icon: hydrogenBombIcon,
      description: "build_menu.desc.nova_bomb",
      key: "unit_type.nova_bomb",
      countable: false,
    },
    {
      unitType: UnitType.Battlecruiser,
      icon: warshipIcon,
      description: "build_menu.desc.battlecruiser",
      key: "unit_type.battlecruiser",
      countable: true,
    },
    {
      unitType: UnitType.Spaceport,
      icon: portIcon,
      description: "build_menu.desc.spaceport",
      key: "unit_type.spaceport",
      countable: true,
    },
    {
      unitType: UnitType.OrbitalStrikePlatform,
      icon: missileSiloIcon,
      description: "build_menu.desc.orbital_strike_platform",
      key: "unit_type.orbital_strike_platform",
      countable: true,
    },
    {
      unitType: UnitType.PointDefenseArray,
      icon: samlauncherIcon,
      description: "build_menu.desc.point_defense_array",
      key: "unit_type.point_defense_array",
      countable: true,
    },
    {
      unitType: UnitType.DefenseStation,
      icon: shieldIcon,
      description: "build_menu.desc.defense_station",
      key: "unit_type.defense_station",
      countable: true,
    },
    {
      unitType: UnitType.Colony,
      icon: cityIcon,
      description: "build_menu.desc.colony",
      key: "unit_type.colony",
      countable: true,
    },
    {
      unitType: UnitType.Foundry,
      icon: factoryIcon,
      description: "build_menu.desc.foundry",
      key: "unit_type.foundry",
      countable: true,
    },
  ],
];

export const flattenedBuildTable = buildTable.flat();

export function BuildMenu(): React.JSX.Element {
  const { gameView, eventBus, tick } = useGameTick(50); // Throttle to 50ms

  const [hidden, setHidden] = useState(true);
  const [playerBuildables, setPlayerBuildables] = useState<
    BuildableUnit[] | null
  >(null);
  const [clickedTile, setClickedTile] = useState<TileRef | null>(null);
  const [filteredBuildTable, setFilteredBuildTable] =
    useState<BuildItemDisplay[][]>(buildTable);

  // Listen for build menu toggle events
  useEventBus(eventBus, ShowBuildMenuEvent, (e) => {
    if (!gameView.myPlayer()?.isAlive()) {
      return;
    }
    if (!hidden) {
      // Players sometimes hold control while building a unit,
      // so if the menu is already open, ignore the event.
      return;
    }
    // R3F pointer events provide tile coordinates directly.
    if (!gameView.isValidCoord(e.x, e.y)) {
      return;
    }
    const tile = gameView.ref(e.x, e.y);
    showMenu(tile);
  });

  useEventBus(eventBus, CloseViewEvent, () => {
    hideMenu();
  });

  useEventBus(eventBus, ShowEmojiMenuEvent, () => {
    hideMenu();
  });

  useEventBus(eventBus, MouseDownEvent, () => {
    hideMenu();
  });

  const hideMenu = useCallback(() => {
    setHidden(true);
  }, []);

  const showMenu = useCallback((tile: TileRef) => {
    setClickedTile(tile);
    setHidden(false);
  }, []);

  const refresh = useCallback(() => {
    const tile = clickedTile;
    if (tile) {
      gameView
        .myPlayer()
        ?.buildables(tile, BuildMenus.types)
        .then((buildables) => {
          setPlayerBuildables(buildables);
        });

      // Remove disabled buildings from the buildtable
      const filtered = getBuildableUnits();
      setFilteredBuildTable(filtered);
    }
  }, [gameView, clickedTile]);

  const getBuildableUnits = useCallback(() => {
    return buildTable.map((row) =>
      row.filter((item) => !gameView?.config()?.isUnitDisabled(item.unitType)),
    );
  }, [gameView]);

  // Refresh on tick when visible
  useEffect(() => {
    if (!hidden) {
      refresh();
    }
  }, [tick, hidden, refresh]);

  const cost = (item: BuildItemDisplay): Credits => {
    for (const bu of playerBuildables ?? []) {
      if (bu.type === item.unitType) {
        return bu.cost;
      }
    }
    return 0n;
  };

  const count = (item: BuildItemDisplay): string => {
    const player = gameView?.myPlayer();
    if (!player) {
      return "?";
    }
    return player.totalUnitLevels(item.unitType).toString();
  };

  const sendBuildOrUpgrade = (
    buildableUnit: BuildableUnit,
    tile: TileRef,
  ): void => {
    if (buildableUnit.canUpgrade !== false) {
      eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          buildableUnit.canUpgrade,
          buildableUnit.type,
        ),
      );
    } else if (buildableUnit.canBuild) {
      const rocketDirectionUp =
        buildableUnit.type === UnitType.AntimatterTorpedo ||
        buildableUnit.type === UnitType.NovaBomb
          ? useHUDStore.getState().rocketDirectionUp
          : undefined;
      eventBus.emit(
        new BuildUnitIntentEvent(buildableUnit.type, tile, rocketDirectionUp),
      );
    }
    hideMenu();
  };

  if (hidden) {
    return null as any;
  }

  const styles = {
    buildMenu: {
      position: "fixed" as const,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: 9999,
      pointerEvents: "auto" as const,
      backgroundColor: "#1e1e1e",
      padding: "15px",
      boxShadow: "0 0 20px rgba(0, 0, 0, 0.5)",
      borderRadius: "10px",
      display: "flex",
      flexDirection: "column" as const,
      alignItems: "center" as const,
      maxWidth: "95vw",
      maxHeight: "95vh",
      overflowY: "auto" as const,
    },
    buildRow: {
      display: "flex",
      justifyContent: "center" as const,
      flexWrap: "wrap" as const,
      width: "100%",
    },
    buildButton: {
      position: "relative" as const,
      width: "120px",
      height: "140px",
      border: "2px solid #444",
      backgroundColor: "#2c2c2c",
      color: "white",
      borderRadius: "12px",
      cursor: "pointer",
      transition: "all 0.3s ease",
      display: "flex",
      flexDirection: "column" as const,
      justifyContent: "center" as const,
      alignItems: "center" as const,
      margin: "8px",
      padding: "10px",
      gap: "5px",
    },
    buildIcon: {
      fontSize: "40px",
      marginBottom: "5px",
    },
    buildName: {
      fontSize: "14px",
      fontWeight: "bold" as const,
      marginBottom: "5px",
      textAlign: "center" as const,
    },
    buildCost: {
      fontSize: "14px",
      display: "flex",
      alignItems: "center" as const,
      gap: "4px",
    },
    buildCountChip: {
      position: "absolute" as const,
      top: "-10px",
      right: "-10px",
      backgroundColor: "#2c2c2c",
      color: "white",
      padding: "2px 10px",
      borderRadius: "10000px",
      transition: "all 0.3s ease",
      fontSize: "12px",
      display: "flex" as const,
      justifyContent: "center" as const,
      alignContent: "center" as const,
      border: "1px solid #444",
    },
    buildCount: {
      fontWeight: "bold" as const,
      fontSize: "14px",
    },
  };

  return (
    <div
      data-testid="build-menu"
      style={styles.buildMenu}
      onContextMenu={(e) => e.preventDefault()}
    >
      {filteredBuildTable.map((row, rowIdx) => (
        <div key={rowIdx} style={styles.buildRow}>
          {row.map((item) => {
            const buildableUnit = playerBuildables?.find(
              (bu) => bu.type === item.unitType,
            );
            if (buildableUnit === undefined) {
              return null;
            }
            const enabled =
              buildableUnit.canBuild !== false ||
              buildableUnit.canUpgrade !== false;

            return (
              <button
                key={item.unitType}
                style={{
                  ...styles.buildButton,
                  backgroundColor: enabled ? "#2c2c2c" : "#1a1a1a",
                  borderColor: enabled ? "#444" : "#333",
                  opacity: enabled ? 1 : 0.7,
                  cursor: enabled ? "pointer" : "not-allowed",
                }}
                onClick={() =>
                  enabled && sendBuildOrUpgrade(buildableUnit, clickedTile!)
                }
                disabled={!enabled}
                title={
                  !enabled ? translateText("build_menu.not_enough_money") : ""
                }
              >
                <img
                  src={item.icon}
                  alt={item.unitType}
                  width={40}
                  height={40}
                  style={{ opacity: enabled ? 1 : 0.5 }}
                />
                <span style={styles.buildName}>
                  {item.key && translateText(item.key)}
                </span>
                <span style={{ fontSize: "0.6rem" }}>
                  {item.description && translateText(item.description)}
                </span>
                <span
                  style={{
                    ...styles.buildCost,
                    color: enabled ? "white" : "#ff4444",
                  }}
                >
                  {renderNumber(
                    gameView && gameView.myPlayer() ? cost(item) : 0,
                  )}
                  <img
                    src={creditsIcon}
                    alt="credits"
                    width={12}
                    height={12}
                    style={{ verticalAlign: "middle" }}
                  />
                </span>
                {item.countable && (
                  <div style={styles.buildCountChip}>
                    <span style={styles.buildCount}>{count(item)}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default BuildMenu;
