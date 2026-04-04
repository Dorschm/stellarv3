import { useCallback, useState } from "react";
import { UserSettings } from "../../../core/game/UserSettings";
import { formatKeyForDisplay, translateText } from "../../Utils";
import { Platform } from "../../Platform";
import { ModalContainer, ModalPage } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-3 px-4 rounded-lg bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition-colors">
      <span className="text-white/80 text-sm">{label}</span>
      <div className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-blue-600" : "bg-white/20"}`} onClick={() => onChange(!checked)}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </div>
    </label>
  );
}

export function UserSettingModal() {
  const { showPage } = useNavigation();
  const [userSettings] = useState(() => new UserSettings());
  const [activeTab, setActiveTab] = useState<"basic" | "keybinds">("basic");
  const [, forceUpdate] = useState(0);

  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  const makeToggle = useCallback((toggleFn: () => void) => {
    return () => {
      toggleFn();
      refresh();
    };
  }, [refresh]);

  return (
    <ModalPage pageId="page-settings">
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.settings")}</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-4">
          <button onClick={() => setActiveTab("basic")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "basic" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("settings.basic")}
          </button>
          <button onClick={() => setActiveTab("keybinds")} className={`px-4 py-2 text-sm font-medium uppercase tracking-wider transition-colors ${activeTab === "keybinds" ? "text-blue-400 border-b-2 border-blue-400" : "text-white/50 hover:text-white/80"}`}>
            {translateText("settings.keybinds")}
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {activeTab === "basic" ? (
            <>
              <SettingToggle label={translateText("settings.dark_mode")} checked={userSettings.darkMode()} onChange={makeToggle(() => userSettings.toggleDarkMode())} />
              <SettingToggle label={translateText("settings.emojis")} checked={userSettings.emojis()} onChange={makeToggle(() => userSettings.toggleEmojis())} />
              <SettingToggle label={translateText("settings.alert_frame")} checked={userSettings.alertFrame()} onChange={makeToggle(() => userSettings.toggleAlertFrame())} />
              <SettingToggle label={translateText("settings.fx_layer")} checked={userSettings.fxLayer()} onChange={makeToggle(() => userSettings.toggleFxLayer())} />
              <SettingToggle label={translateText("settings.territory_patterns")} checked={userSettings.territoryPatterns()} onChange={makeToggle(() => userSettings.toggleTerritoryPatterns())} />
              <SettingToggle label={translateText("settings.cursor_cost_label")} checked={userSettings.cursorCostLabel()} onChange={makeToggle(() => userSettings.toggleCursorCostLabel())} />
              <SettingToggle label={translateText("settings.anonymous_names")} checked={userSettings.anonymousNames()} onChange={makeToggle(() => userSettings.toggleRandomName())} />
              <SettingToggle label={translateText("settings.lobby_id_visibility")} checked={userSettings.lobbyIdVisibility()} onChange={makeToggle(() => userSettings.toggleLobbyIdVisibility())} />
              <SettingToggle label={translateText("settings.left_click_opens_menu")} checked={userSettings.leftClickOpensMenu()} onChange={makeToggle(() => userSettings.toggleLeftClickOpenMenu())} />
              <SettingToggle label={translateText("settings.performance_overlay")} checked={userSettings.performanceOverlay()} onChange={makeToggle(() => userSettings.togglePerformanceOverlay())} />

              {/* Attack ratio increment slider */}
              <div className="py-3 px-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/80 text-sm">{translateText("settings.attack_ratio")}</span>
                  <span className="text-white/60 text-xs">{userSettings.attackRatioIncrement()}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={userSettings.attackRatioIncrement()}
                  onChange={(e) => { userSettings.setFloat("settings.attackRatioIncrement", Number(e.target.value)); refresh(); }}
                  className="w-full accent-blue-500"
                />
              </div>
            </>
          ) : (
            <div className="text-white/60 text-sm space-y-2">
              <p className="text-white/40 text-xs uppercase tracking-wider mb-3">{translateText("settings.keybinds_desc")}</p>
              <KeybindSettings />
            </div>
          )}
        </div>
      </ModalContainer>
    </ModalPage>
  );
}

function KeybindSettings() {
  const [keybinds, setKeybinds] = useState<Record<string, string>>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("settings.keybinds") ?? "{}");
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "object" && v !== null && "value" in v) {
          result[k] = (v as any).value;
        } else if (typeof v === "string") {
          result[k] = v;
        }
      }
      return result;
    } catch {
      return {};
    }
  });
  const [editingKey, setEditingKey] = useState<string | null>(null);

  const isMac = Platform.isMac;
  const defaults: Record<string, string> = {
    toggleView: "Space", coordinateGrid: "KeyM", centerCamera: "KeyC",
    moveUp: "KeyW", moveDown: "KeyS", moveLeft: "KeyA", moveRight: "KeyD",
    zoomOut: "KeyQ", zoomIn: "KeyE", attackRatioDown: "KeyT", attackRatioUp: "KeyY",
    swapDirection: "KeyU", shiftKey: "ShiftLeft",
    modifierKey: isMac ? "MetaLeft" : "ControlLeft",
    altKey: "AltLeft", resetGfx: "KeyR", pauseGame: "KeyP",
    gameSpeedUp: "Period", gameSpeedDown: "Comma",
  };

  const getValue = (key: string) => keybinds[key] ?? defaults[key] ?? "";

  const handleKeyCapture = useCallback((action: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    const code = e.code;
    const updated = { ...keybinds, [action]: code };
    setKeybinds(updated);
    setEditingKey(null);

    // Save to localStorage in the format the game expects
    const storageFormat: Record<string, { value: string; key: string }> = {};
    for (const [k, v] of Object.entries(updated)) {
      storageFormat[k] = { value: v, key: k };
    }
    localStorage.setItem("settings.keybinds", JSON.stringify(storageFormat));
  }, [keybinds]);

  const keybindEntries: { action: string; label: string }[] = [
    { action: "toggleView", label: translateText("settings.keybind_toggle_view") },
    { action: "coordinateGrid", label: translateText("settings.keybind_coordinate_grid") },
    { action: "centerCamera", label: translateText("settings.keybind_center_camera") },
    { action: "moveUp", label: translateText("settings.keybind_move_up") },
    { action: "moveDown", label: translateText("settings.keybind_move_down") },
    { action: "moveLeft", label: translateText("settings.keybind_move_left") },
    { action: "moveRight", label: translateText("settings.keybind_move_right") },
    { action: "zoomOut", label: translateText("settings.keybind_zoom_out") },
    { action: "zoomIn", label: translateText("settings.keybind_zoom_in") },
    { action: "attackRatioDown", label: translateText("settings.keybind_attack_ratio_down") },
    { action: "attackRatioUp", label: translateText("settings.keybind_attack_ratio_up") },
    { action: "swapDirection", label: translateText("settings.keybind_swap_direction") },
    { action: "resetGfx", label: translateText("settings.keybind_reset_gfx") },
    { action: "pauseGame", label: translateText("settings.keybind_pause_game") },
    { action: "gameSpeedUp", label: translateText("settings.keybind_game_speed_up") },
    { action: "gameSpeedDown", label: translateText("settings.keybind_game_speed_down") },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {keybindEntries.map(({ action, label }) => (
        <div key={action} className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/10">
          <span className="text-white/70 text-sm">{label}</span>
          {editingKey === action ? (
            <input
              autoFocus
              readOnly
              placeholder="Press a key..."
              className="w-24 text-center px-2 py-1 rounded bg-blue-600/30 border border-blue-500 text-blue-300 text-xs font-mono focus:outline-none"
              onKeyDown={(e) => handleKeyCapture(action, e)}
              onBlur={() => setEditingKey(null)}
            />
          ) : (
            <button
              onClick={() => setEditingKey(action)}
              className="px-2 py-1 rounded bg-[#2a2a2a] border-b-2 border-[#1a1a1a] text-white font-mono text-xs font-bold min-w-[40px] text-center hover:bg-white/10 transition-colors"
            >
              {formatKeyForDisplay(getValue(action))}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
