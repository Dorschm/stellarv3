import { useFrame } from "@react-three/fiber";
import React, { useCallback, useEffect, useRef } from "react";
import {
  CanvasTexture,
  Group,
  LinearFilter,
  Sprite,
  SpriteMaterial,
} from "three";
import { AllPlayers, GameUpdates } from "../../core/game/Game";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { useGameView } from "../bridge/GameViewContext";
import { SceneTickEvent } from "../InputHandler";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Height above the map plane where the emoji bubble starts. */
const EMOJI_FX_HEIGHT = 6;
/** Total visible lifetime of an emoji bubble, in milliseconds. */
const EMOJI_DURATION_MS = 3000;
/** World units the bubble floats up over its lifetime. */
const EMOJI_RISE_DISTANCE = 30;
/** Sprite world-space size (square). Tuned to read at default zoom. */
const EMOJI_BASE_SCALE = 22;
/** Canvas pixel resolution for the rasterised emoji glyph. */
const EMOJI_CANVAS_PX = 256;
/** Font size used inside the canvas. Slightly less than canvas size to
 *  leave room for descender / accent overflow. */
const EMOJI_FONT_PX = 200;

// ─── Effect state ──────────────────────────────────────────────────────────

interface ActiveEmoji {
  sprite: Sprite;
  texture: CanvasTexture;
  startWorldY: number;
  elapsed: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a CanvasTexture containing the rasterised emoji glyph, centered.
 *
 * Each emoji bubble owns its texture/canvas (the glyph string differs per
 * bubble, so a shared texture would not work). Disposed alongside the
 * sprite when the bubble's lifetime ends.
 */
function createEmojiTexture(emoji: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = EMOJI_CANVAS_PX;
  canvas.height = EMOJI_CANVAS_PX;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, EMOJI_CANVAS_PX, EMOJI_CANVAS_PX);
    // Prefer the OS-native colour-emoji font on each platform; fall back
    // through a few common names so headless / Linux test environments can
    // still rasterise *something*.
    ctx.font =
      `${EMOJI_FONT_PX}px "Apple Color Emoji", "Segoe UI Emoji", ` +
      `"Noto Color Emoji", "Twemoji Mozilla", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(emoji, EMOJI_CANVAS_PX / 2, EMOJI_CANVAS_PX / 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * EmojiRenderer — floating emoji bubble overlay above the sender's territory.
 *
 * When a player sends an emoji (broadcast or directed), this component
 * spawns a Three.js {@link Sprite} at the sender's `nameLocation()`. The
 * sprite floats upward and fades out over ~3 seconds, then is disposed.
 *
 * Why this exists: `EmojiExecution` calls `Player.sendEmoji()`, which queues
 * an `EmojiUpdate` on the next tick. The legacy 2D HUD consumed that update
 * via `PlayerIcons.outgoingEmojis()` and rendered a sticker on top of the
 * player name. The R3F migration deleted that consumer; without this
 * component, sending an emoji has no visible effect (events-panel feedback
 * exists but is easy to miss). This restores the visual signal.
 *
 * Visibility filter: only emojis that involve the local player are shown
 * (broadcasts, ones I sent, ones I received). Other players' private
 * emojis are not surfaced — matches the legacy `PlayerIcons` behavior.
 */
export function EmojiRenderer(): React.JSX.Element {
  const { gameView: game, eventBus } = useGameView();

  const groupRef = useRef<Group>(null);
  const activeRef = useRef<ActiveEmoji[]>([]);

  // ── Spawn a single bubble at the given map-space location ─────────────
  const spawnEmojiBubble = useCallback(
    (emojiText: string, mapX: number, mapY: number) => {
      if (!groupRef.current) return;
      const texture = createEmojiTexture(emojiText);
      const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 1,
        // Always draw on top of the map plane / units. Without this,
        // the bubble can z-fight with stuff at similar height.
        depthTest: false,
        depthWrite: false,
      });
      const sprite = new Sprite(material);

      // Convert map coords → world coords (FxRenderer uses the same
      // transform; keeping it inline here so EmojiRenderer is independent).
      const halfW = game.width() / 2;
      const halfH = game.height() / 2;
      const worldX = mapX - halfW;
      const worldY = -(mapY - halfH);
      sprite.position.set(worldX, worldY, EMOJI_FX_HEIGHT);
      sprite.scale.set(EMOJI_BASE_SCALE, EMOJI_BASE_SCALE, 1);
      // High renderOrder + depthTest:false → bubble paints last and
      // ignores depth, so it's always visible above terrain & units.
      sprite.renderOrder = 999;
      groupRef.current.add(sprite);

      activeRef.current.push({
        sprite,
        texture,
        startWorldY: worldY,
        elapsed: 0,
      });
    },
    [game],
  );

  // ── Process EmojiUpdate entries from one tick's update batch ──────────
  const processTickUpdates = useCallback(
    (updates: GameUpdates) => {
      const userSettings = game.config().userSettings();
      // Match PlayerIcons' "off by default" stance — if the setting is
      // missing, fall back to enabled so new installs see emojis.
      const emojisEnabled = userSettings?.emojis() ?? true;
      if (!emojisEnabled) return;

      const emojiUpdates = updates[GameUpdateType.Emoji];
      if (!emojiUpdates || emojiUpdates.length === 0) return;

      const myPlayer = game.myPlayer();
      const mySmallID = myPlayer?.smallID();

      for (const update of emojiUpdates) {
        if (!update) continue;
        const { senderID, recipientID, message } = update.emoji;

        // Visibility filter: show if I sent it, I received it, or it was
        // a broadcast. Skip private emojis between two other players.
        const isVisible =
          recipientID === AllPlayers ||
          (mySmallID !== undefined &&
            (senderID === mySmallID || recipientID === mySmallID));
        if (!isVisible) continue;

        // Resolve sender by smallID. `playerBySmallID` THROWS if the id is
        // unknown (rare race during disconnect/cleanup) — wrap so a single
        // missing player can't crash the renderer.
        let sender;
        try {
          sender = game.playerBySmallID(senderID);
        } catch {
          continue;
        }
        if (!sender || !sender.isPlayer()) continue;

        const loc = sender.nameLocation();
        // nameLocation can be (0, 0) for not-yet-named players. That's a
        // legit map coordinate but visually useless — skip degenerate.
        if (loc.x === 0 && loc.y === 0) continue;

        spawnEmojiBubble(message, loc.x, loc.y);
      }
    },
    [game, spawnEmojiBubble],
  );

  // ── Single-bubble teardown (used on completion + on unmount) ──────────
  const disposeEmoji = useCallback((fx: ActiveEmoji) => {
    if (groupRef.current) groupRef.current.remove(fx.sprite);
    (fx.sprite.material as SpriteMaterial).dispose();
    fx.texture.dispose();
  }, []);

  // ── Subscribe to per-tick updates via the EventBus ────────────────────
  useEffect(() => {
    const handler = (event: SceneTickEvent) => {
      processTickUpdates(event.updates);
    };
    eventBus.on(SceneTickEvent, handler);

    return () => {
      eventBus.off(SceneTickEvent, handler);
      // Drain any in-flight bubbles so repeated session transitions do
      // not leak GPU memory (canvases hold backing buffers).
      for (const fx of activeRef.current) {
        disposeEmoji(fx);
      }
      activeRef.current = [];
    };
  }, [eventBus, processTickUpdates, disposeEmoji]);

  // ── Per-frame animation: float up + fade out ──────────────────────────
  useFrame((_, delta) => {
    const deltaMs = delta * 1000;
    const list = activeRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const fx = list[i];
      fx.elapsed += deltaMs;
      const t = Math.min(1, fx.elapsed / EMOJI_DURATION_MS);
      if (t >= 1) {
        disposeEmoji(fx);
        list.splice(i, 1);
        continue;
      }

      // Float upward (in world space; world Y = -map Y so "up on screen"
      // is +world Y from the camera's default orientation).
      fx.sprite.position.y = fx.startWorldY + EMOJI_RISE_DISTANCE * t;

      // Hold full opacity for the first 60% of lifetime, fade out the
      // remaining 40%. Gives the player time to actually read the emoji.
      const fadeStart = 0.6;
      const opacity = t < fadeStart ? 1 : 1 - (t - fadeStart) / (1 - fadeStart);
      (fx.sprite.material as SpriteMaterial).opacity = Math.max(0, opacity);

      // Subtle scale-up gives the bubble a "rising" feel without
      // overwhelming the surrounding HUD.
      const scale = EMOJI_BASE_SCALE * (1 + 0.15 * t);
      fx.sprite.scale.set(scale, scale, 1);
    }
  });

  return <group ref={groupRef} />;
}
