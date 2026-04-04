import React, { useState, useCallback, useEffect, useRef } from "react";
import { assetUrl } from "../../core/AssetUrls";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { PauseGameIntentEvent } from "../Transport";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../InputHandler";
import { translateText } from "../Utils";
import SoundManager from "../sound/SoundManager";
import { useGameTick } from "./useGameTick";
import { useEventBus } from "../bridge/useEventBus";
import { useTransform } from "./TransformContext";
import { ShowSettingsModalEvent } from "./events";

const structureIcon = assetUrl("images/CityIconWhite.svg");
const cursorPriceIcon = assetUrl("images/CursorPriceIconWhite.svg");
const darkModeIcon = assetUrl("images/DarkModeIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const explosionIcon = assetUrl("images/ExplosionIconWhite.svg");
const mouseIcon = assetUrl("images/MouseIconWhite.svg");
const ninjaIcon = assetUrl("images/NinjaIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const sirenIcon = assetUrl("images/SirenIconWhite.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const treeIcon = assetUrl("images/TreeIconWhite.svg");
const musicIcon = assetUrl("images/music.svg");

export function SettingsModal(): React.JSX.Element {
  const { gameView, eventBus } = useGameTick(100);
  const transformCtx = useTransform();
  const userSettings = transformCtx?.userSettings ?? null;
  const modalOverlayRef = useRef<HTMLDivElement>(null);

  const [isVisible, setIsVisible] = useState(false);
  const [alternateView, setAlternateView] = useState(false);
  const [shouldPause, setShouldPause] = useState(false);
  const [wasPausedWhenOpened, setWasPausedWhenOpened] = useState(false);

  // Initialize sound volumes on mount
  useEffect(() => {
    if (!userSettings) return;
    SoundManager.setBackgroundMusicVolume(
      userSettings.backgroundMusicVolume(),
    );
    SoundManager.setSoundEffectsVolume(userSettings.soundEffectsVolume());
  }, [userSettings]);

  // Listen for settings modal toggle events
  useEventBus(eventBus, ShowSettingsModalEvent, (event) => {
    setIsVisible(event.isVisible);
    setShouldPause(event.shouldPause);
    setWasPausedWhenOpened(event.isPaused);
    pauseGame(true);
  });

  const pauseGame = useCallback(
    (pause: boolean) => {
      if (shouldPause && !wasPausedWhenOpened) {
        if (pause) {
          crazyGamesSDK.gameplayStop();
        } else {
          crazyGamesSDK.gameplayStart();
        }
        eventBus.emit(new PauseGameIntentEvent(pause));
      }
    },
    [shouldPause, wasPausedWhenOpened, eventBus],
  );

  const openModal = useCallback(() => {
    setIsVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsVisible(false);
    pauseGame(false);
  }, [pauseGame]);

  const handleOutsideClick = useCallback(
    (event: MouseEvent) => {
      if (
        isVisible &&
        modalOverlayRef.current &&
        event.target === modalOverlayRef.current
      ) {
        closeModal();
      }
    },
    [isVisible, closeModal],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isVisible && event.key === "Escape") {
        closeModal();
      }
    },
    [isVisible, closeModal],
  );

  useEffect(() => {
    window.addEventListener("click", handleOutsideClick, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleOutsideClick, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleOutsideClick, handleKeyDown]);

  const onTerrainButtonClick = useCallback(() => {
    setAlternateView((prev) => {
      const newValue = !prev;
      eventBus.emit(new AlternateViewEvent(newValue));
      return newValue;
    });
  }, [eventBus]);

  const onToggleEmojisButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleEmojis();
    setIsVisible((prev) => !prev); // Force re-render
  }, [userSettings]);

  const onToggleStructureSpritesButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleStructureSprites();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleSpecialEffectsButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleFxLayer();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleAlertFrameButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleAlertFrame();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleDarkModeButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleDarkMode();
    eventBus.emit(new RefreshGraphicsEvent());
    setIsVisible((prev) => !prev);
  }, [userSettings, eventBus]);

  const onToggleRandomNameModeButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleRandomName();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleLeftClickOpensMenu = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleLeftClickOpenMenu();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleCursorCostLabelButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleCursorCostLabel();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onToggleAttackingTroopsOverlayButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.toggleAttackingTroopsOverlay();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onTogglePerformanceOverlayButtonClick = useCallback(() => {
    if (!userSettings) return;
    userSettings.togglePerformanceOverlay();
    setIsVisible((prev) => !prev);
  }, [userSettings]);

  const onExitButtonClick = useCallback(() => {
    window.location.href = "/";
  }, []);

  const onVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!userSettings) return;
      const volume = parseFloat(event.target.value) / 100;
      userSettings.setBackgroundMusicVolume(volume);
      SoundManager.setBackgroundMusicVolume(volume);
      setIsVisible((prev) => !prev);
    },
    [userSettings],
  );

  const onSoundEffectsVolumeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!userSettings) return;
      const volume = parseFloat(event.target.value) / 100;
      userSettings.setSoundEffectsVolume(volume);
      SoundManager.setSoundEffectsVolume(volume);
      setIsVisible((prev) => !prev);
    },
    [userSettings],
  );

  if (!isVisible || !userSettings) {
    return null as any;
  }

  return (
    <div
      className="modal-overlay fixed inset-0 bg-black/60 backdrop-blur-xs z-2000 flex items-center justify-center p-4"
      ref={modalOverlayRef}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-slate-800 border border-slate-600 rounded-lg max-w-md w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-600">
          <div className="flex items-center gap-2">
            <img
              src={settingsIcon}
              alt="settings"
              width="24"
              height="24"
              className="align-middle"
            />
            <h2 className="text-xl font-semibold text-white">
              {translateText("user_setting.tab_basic")}
            </h2>
          </div>
          <button
            className="text-slate-400 hover:text-white text-2xl font-bold leading-none"
            onClick={closeModal}
          >
            ×
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors">
            <img src={musicIcon} alt="musicIcon" width="20" height="20" />
            <div className="flex-1">
              <div className="font-medium">
                {translateText("user_setting.background_music_volume")}
              </div>
              <input
                type="range"
                min="0"
                max="100"
                defaultValue={userSettings.backgroundMusicVolume() * 100}
                onChange={onVolumeChange}
                className="w-full border border-slate-500 rounded-lg"
              />
            </div>
            <div className="text-sm text-slate-400">
              {Math.round(userSettings.backgroundMusicVolume() * 100)}%
            </div>
          </div>

          <div className="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors">
            <img
              src={musicIcon}
              alt="soundEffectsIcon"
              width="20"
              height="20"
            />
            <div className="flex-1">
              <div className="font-medium">
                {translateText("user_setting.sound_effects_volume")}
              </div>
              <input
                type="range"
                min="0"
                max="100"
                defaultValue={userSettings.soundEffectsVolume() * 100}
                onChange={onSoundEffectsVolumeChange}
                className="w-full border border-slate-500 rounded-lg"
              />
            </div>
            <div className="text-sm text-slate-400">
              {Math.round(userSettings.soundEffectsVolume() * 100)}%
            </div>
          </div>

          <SettingButton
            icon={treeIcon}
            label={translateText("user_setting.toggle_terrain")}
            description={translateText("user_setting.toggle_view_desc")}
            value={
              alternateView
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onTerrainButtonClick}
          />

          <SettingButton
            icon={emojiIcon}
            label={translateText("user_setting.emojis_label")}
            description={translateText("user_setting.emojis_desc")}
            value={
              userSettings.emojis()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleEmojisButtonClick}
          />

          <SettingButton
            icon={darkModeIcon}
            label={translateText("user_setting.dark_mode_label")}
            description={translateText("user_setting.dark_mode_desc")}
            value={
              userSettings.darkMode()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleDarkModeButtonClick}
          />

          <SettingButton
            icon={explosionIcon}
            label={translateText("user_setting.special_effects_label")}
            description={translateText("user_setting.special_effects_desc")}
            value={
              userSettings.fxLayer()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleSpecialEffectsButtonClick}
          />

          <SettingButton
            icon={sirenIcon}
            label={translateText("user_setting.alert_frame_label")}
            description={translateText("user_setting.alert_frame_desc")}
            value={
              userSettings.alertFrame()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleAlertFrameButtonClick}
          />

          <SettingButton
            icon={structureIcon}
            label={translateText("user_setting.structure_sprites_label")}
            description={translateText("user_setting.structure_sprites_desc")}
            value={
              userSettings.structureSprites()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleStructureSpritesButtonClick}
          />

          <SettingButton
            icon={swordIcon}
            label={translateText("user_setting.attacking_troops_overlay_label")}
            description={translateText("user_setting.attacking_troops_overlay_desc")}
            value={
              userSettings.attackingTroopsOverlay()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleAttackingTroopsOverlayButtonClick}
          />

          <SettingButton
            icon={cursorPriceIcon}
            label={translateText("user_setting.cursor_cost_label_label")}
            description={translateText("user_setting.cursor_cost_label_desc")}
            value={
              userSettings.cursorCostLabel()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleCursorCostLabelButtonClick}
          />

          <SettingButton
            icon={ninjaIcon}
            label={translateText("user_setting.anonymous_names_label")}
            description={translateText("user_setting.anonymous_names_desc")}
            value={
              userSettings.anonymousNames()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleRandomNameModeButtonClick}
          />

          <SettingButton
            icon={mouseIcon}
            label={translateText("user_setting.left_click_menu")}
            description={translateText("user_setting.left_click_desc")}
            value={
              userSettings.leftClickOpensMenu()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onToggleLeftClickOpensMenu}
          />

          <SettingButton
            icon={settingsIcon}
            label={translateText("user_setting.performance_overlay_label")}
            description={translateText("user_setting.performance_overlay_desc")}
            value={
              userSettings.performanceOverlay()
                ? translateText("user_setting.on")
                : translateText("user_setting.off")
            }
            onClick={onTogglePerformanceOverlayButtonClick}
          />

          <div className="border-t border-slate-600 pt-3 mt-4">
            <button
              className="flex gap-3 items-center w-full text-left p-3 hover:bg-red-600/20 rounded-sm text-red-400 transition-colors"
              onClick={onExitButtonClick}
            >
              <img src={exitIcon} alt="exitIcon" width="20" height="20" />
              <div className="flex-1">
                <div className="font-medium">
                  {translateText("user_setting.exit_game_label")}
                </div>
                <div className="text-sm text-slate-400">
                  {translateText("user_setting.exit_game_info")}
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SettingButtonProps {
  icon: string;
  label: string;
  description: string;
  value: string;
  onClick: () => void;
}

function SettingButton({
  icon,
  label,
  description,
  value,
  onClick,
}: SettingButtonProps): React.JSX.Element {
  return (
    <button
      className="flex gap-3 items-center w-full text-left p-3 hover:bg-slate-700 rounded-sm text-white transition-colors"
      onClick={onClick}
    >
      <img src={icon} alt={label} width="20" height="20" />
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-slate-400">{description}</div>
      </div>
      <div className="text-sm text-slate-400">{value}</div>
    </button>
  );
}

export default SettingsModal;
