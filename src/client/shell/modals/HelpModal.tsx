import { useMemo } from "react";
import { translateText, TUTORIAL_VIDEO_URL } from "../../Utils";
import { Platform } from "../../Platform";
import { ModalPage, ModalContainer } from "../components/ModalPage";
import { useNavigation } from "../contexts/NavigationContext";

function getKeybinds(): Record<string, string> {
  let saved: Record<string, string> = {};
  try {
    const parsed = JSON.parse(
      localStorage.getItem("settings.keybinds") ?? "{}",
    );
    saved = Object.fromEntries(
      Object.entries(parsed)
        .map(([k, v]) => {
          if (typeof v === "object" && v !== null && "value" in v && typeof (v as any).value === "string") return [k, (v as any).value];
          if (typeof v === "string") return [k, v];
          return [k, undefined];
        })
        .filter(([, v]) => typeof v === "string" && v !== "Null"),
    ) as Record<string, string>;
  } catch (e) {
    console.warn("Invalid keybinds JSON:", e);
  }

  const isMac = Platform.isMac;
  return {
    toggleView: "Space", coordinateGrid: "KeyM", centerCamera: "KeyC",
    moveUp: "KeyW", moveDown: "KeyS", moveLeft: "KeyA", moveRight: "KeyD",
    zoomOut: "KeyQ", zoomIn: "KeyE", attackRatioDown: "KeyT", attackRatioUp: "KeyY",
    swapDirection: "KeyU", shiftKey: "ShiftLeft",
    modifierKey: isMac ? "MetaLeft" : "ControlLeft",
    altKey: "AltLeft", resetGfx: "KeyR", pauseGame: "KeyP",
    gameSpeedUp: "Period", gameSpeedDown: "Comma",
    ...saved,
  };
}

function getKeyLabel(code: string): string {
  if (!code) return "";
  const specialLabels: Record<string, string> = {
    ShiftLeft: "\u21e7 Shift", ShiftRight: "\u21e7 Shift",
    ControlLeft: "Ctrl", ControlRight: "Ctrl",
    AltLeft: "Alt", AltRight: "Alt",
    MetaLeft: "\u2318", MetaRight: "\u2318",
    Space: "Space", Escape: "Esc", Enter: "\u21b5 Return",
    ArrowUp: "\u2191", ArrowDown: "\u2193", ArrowLeft: "\u2190", ArrowRight: "\u2192",
    Period: ">", Comma: "<",
  };
  if (specialLabels[code]) return specialLabels[code];
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

function KeyBadge({ code }: { code: string }) {
  return (
    <span className="inline-block min-w-[32px] text-center px-2 py-1 rounded bg-[#2a2a2a] border-b-2 border-[#1a1a1a] text-white font-mono text-xs font-bold mx-0.5">
      {getKeyLabel(code)}
    </span>
  );
}

function MouseIcon() {
  return (
    <div className="w-5 h-8 border border-white/40 rounded-full relative">
      <div className="absolute top-0 left-0 w-1/2 h-1/2 bg-red-500/80 rounded-tl-full" />
      <div className="w-0.5 h-1.5 bg-white/40 rounded-full absolute top-1.5 left-1/2 -translate-x-1/2" />
    </div>
  );
}

function HotkeyRow({ keys, action }: { keys: React.ReactNode; action: string }) {
  return (
    <tr className="hover:bg-white/5 transition-colors">
      <td className="py-3 pl-4 border-b border-white/5">{keys}</td>
      <td className="py-3 border-b border-white/5 text-white/70">{action}</td>
    </tr>
  );
}

export function HelpModal() {
  const { showPage } = useNavigation();
  const keybinds = useMemo(getKeybinds, []);

  return (
    <ModalPage pageId="page-help">
      <ModalContainer>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
          <button onClick={() => showPage("page-play")} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white" aria-label={translateText("common.back")}>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">{translateText("main.help")}</h2>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-3 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
          {/* Video Tutorial */}
          <div className="flex items-center gap-3 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            <h3 className="text-xl font-bold uppercase tracking-widest text-white/90">{translateText("help_modal.video_tutorial")}</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent" />
          </div>
          <section className="bg-white/5 rounded-xl border border-white/10 overflow-hidden mb-8">
            <div className="relative w-full h-0 pb-[56.25%]">
              <iframe className="absolute top-0 left-0 w-full h-full" src={TUTORIAL_VIDEO_URL} title={translateText("help_modal.video_tutorial_title")} frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />
            </div>
          </section>

          {/* Troubleshooting */}
          <div className="flex items-center gap-3 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20 L12 0 L22 20 L2 20" /><line x1="12" y1="8" x2="12" y2="14" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            <h3 className="text-xl font-bold uppercase tracking-widest text-white/90">{translateText("main.troubleshooting")}</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent" />
          </div>
          <section className="mb-8">
            <div className="w-full flex flex-col items-center">
              <p className="mb-6 text-white/70 text-sm">{translateText("help_modal.troubleshooting_desc")}</p>
              <button onClick={() => showPage("page-troubleshooting")} className="hover:bg-white/5 px-6 py-2 text-xs font-bold transition-all duration-200 rounded-lg uppercase tracking-widest bg-blue-500/20 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                {translateText("main.go_to_troubleshooting")}
              </button>
            </div>
          </section>

          {/* Hotkeys */}
          <div className="flex items-center gap-3 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" ry="2" /><path d="M6 8h.001" /><path d="M10 8h.001" /><path d="M14 8h.001" /><path d="M18 8h.001" /><path d="M6 12h.001" /><path d="M10 12h.001" /><path d="M14 12h.001" /><path d="M18 12h.001" /><path d="M6 16h12" /></svg>
            <h3 className="text-xl font-bold uppercase tracking-widest text-white/90">{translateText("help_modal.hotkeys")}</h3>
            <div className="flex-1 h-px bg-gradient-to-r from-blue-500/50 to-transparent" />
          </div>
          <section className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <div className="pt-2 pb-4 px-4 overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-y-1">
                <thead>
                  <tr className="text-white/40 text-xs uppercase tracking-wider text-left">
                    <th className="pb-2 pl-4">{translateText("help_modal.table_key")}</th>
                    <th className="pb-2">{translateText("help_modal.table_action")}</th>
                  </tr>
                </thead>
                <tbody className="text-white/80">
                  <HotkeyRow keys={<KeyBadge code="Escape" />} action={translateText("help_modal.action_esc")} />
                  <HotkeyRow keys={<KeyBadge code="Enter" />} action={translateText("help_modal.action_enter")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.toggleView} />} action={translateText("help_modal.action_alt_view")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.coordinateGrid} />} action={translateText("help_modal.action_coordinate_grid")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.swapDirection} />} action={translateText("help_modal.bomb_direction")} />
                  <HotkeyRow keys={<div className="inline-flex items-center gap-2"><KeyBadge code={keybinds.shiftKey} /><span className="text-white/40 font-bold">+</span><MouseIcon /></div>} action={translateText("help_modal.action_attack_altclick")} />
                  <HotkeyRow keys={<div className="inline-flex items-center gap-2"><KeyBadge code={keybinds.modifierKey} /><span className="text-white/40 font-bold">+</span><MouseIcon /></div>} action={translateText("help_modal.action_build")} />
                  <HotkeyRow keys={<div className="inline-flex items-center gap-2"><KeyBadge code={keybinds.altKey} /><span className="text-white/40 font-bold">+</span><MouseIcon /></div>} action={translateText("help_modal.action_emote")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.centerCamera} />} action={translateText("help_modal.action_center")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.pauseGame} />} action={translateText("help_modal.action_pause_game")} />
                  <HotkeyRow keys={<div className="flex flex-wrap gap-2"><KeyBadge code={keybinds.gameSpeedDown} /><KeyBadge code={keybinds.gameSpeedUp} /></div>} action={translateText("help_modal.action_game_speed")} />
                  <HotkeyRow keys={<div className="flex flex-wrap gap-2"><KeyBadge code={keybinds.moveUp} /><KeyBadge code={keybinds.moveLeft} /><KeyBadge code={keybinds.moveDown} /><KeyBadge code={keybinds.moveRight} /></div>} action={translateText("help_modal.action_wasd")} />
                  <HotkeyRow keys={<div className="flex flex-wrap gap-2"><KeyBadge code={keybinds.zoomOut} /><KeyBadge code={keybinds.zoomIn} /></div>} action={translateText("help_modal.action_zoom")} />
                  <HotkeyRow keys={<div className="flex flex-wrap gap-2"><KeyBadge code={keybinds.attackRatioDown} /><KeyBadge code={keybinds.attackRatioUp} /></div>} action={translateText("help_modal.action_attack_ratio")} />
                  <HotkeyRow keys={<KeyBadge code={keybinds.resetGfx} />} action={translateText("help_modal.action_reset_gfx")} />
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </ModalContainer>
    </ModalPage>
  );
}
