import { test } from "@playwright/test";
import { startSingleplayerGame } from "./fixtures/game-fixtures";

/**
 * One-shot diagnostic: dump nation list and camera state to find why
 * only one planet shows a label. Not part of the regular suite.
 */
test.setTimeout(120_000);

test("dump nations and camera", async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warn") {
      console.log(`[browser ${msg.type()}]`, msg.text());
    }
  });
  await startSingleplayerGame(page);

  // Give R3F Suspense time to resolve textures + fonts so the screenshot
  // captures the planets and labels rather than an empty fallback frame.
  await page.waitForTimeout(2500);

  const dump = await page.evaluate(() => {
    const w = window as unknown as {
      __gameView: {
        nations(): unknown[];
        width(): number;
        height(): number;
      };
      __threeCamera?: {
        position: { x: number; y: number; z: number };
        fov?: number;
      };
    };
    const nations = w.__gameView.nations();
    return {
      mapWidth: w.__gameView.width(),
      mapHeight: w.__gameView.height(),
      nationCount: nations.length,
      nations: nations.map((n: unknown) => {
        const nn = n as Record<string, unknown>;
        return {
          keys: Object.keys(nn),
          name: nn.name,
          coordinates: nn.coordinates,
          flag: nn.flag,
          spawnCell: nn.spawnCell,
          playerInfo: nn.playerInfo,
        };
      }),
      camera: w.__threeCamera
        ? {
            x: w.__threeCamera.position.x,
            y: w.__threeCamera.position.y,
            z: w.__threeCamera.position.z,
            fov: w.__threeCamera.fov,
          }
        : null,
    };
  });

  console.log("\n=== NATION DUMP ===");
  console.log(JSON.stringify(dump, null, 2));
  console.log("=== END NATION DUMP ===\n");

  // Probe the THREE scene graph via __threeScene exposed by CameraController.
  const textInfo = await page.evaluate(() => {
    interface Obj3D {
      type?: string;
      name?: string;
      text?: string;
      visible?: boolean;
      matrixWorld?: { elements: number[] };
      children?: Obj3D[];
      geometry?: { type?: string; constructor?: { name?: string } };
      material?: unknown;
      isMesh?: boolean;
      isGroup?: boolean;
    }
    const w = window as unknown as { __threeScene?: Obj3D };
    if (!w.__threeScene) return { error: "no __threeScene global" };
    const scene = w.__threeScene;

    const found: {
      text: string;
      wx: number;
      wy: number;
      wz: number;
      visible: boolean;
      fontSize?: number;
    }[] = [];
    const walk = (obj: Obj3D) => {
      const ctorName =
        (obj as { constructor?: { name?: string } }).constructor?.name ?? "";
      if (ctorName === "Text" && typeof obj.text === "string") {
        const e = obj.matrixWorld?.elements ?? [];
        // Compute parent visibility chain
        let visible = obj.visible ?? true;
        let p: Obj3D | undefined = (obj as { parent?: Obj3D }).parent;
        while (p && visible) {
          if (p.visible === false) visible = false;
          p = (p as { parent?: Obj3D }).parent;
        }
        found.push({
          text: obj.text,
          wx: e[12] ?? 0,
          wy: e[13] ?? 0,
          wz: e[14] ?? 0,
          visible,
          fontSize: (obj as { fontSize?: number }).fontSize,
        });
      }
      if (obj.children) {
        for (const c of obj.children) walk(c);
      }
    };
    walk(scene);
    return { total: found.length, found };
  });

  console.log("\n=== TEXT MESHES IN SCENE ===");
  console.log(JSON.stringify(textInfo, null, 2));
  console.log("=== END TEXT MESHES ===\n");

  // Take a screenshot for visual comparison. Resize the viewport so the
  // captured image has enough pixel density to actually see the labels —
  // the default 1280x720 viewport scales the screenshot down too far.
  // R3F Suspense needs time to re-resolve textures/fonts after resize,
  // hence the generous wait.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(3500);
  await page.screenshot({
    path: "test-results/debug-planets-fullpage.png",
    fullPage: false,
  });
  // Also capture a tight crop of the central planet region so the display
  // thumbnail has enough resolution to verify label legibility.
  await page.screenshot({
    path: "test-results/debug-planets-crop-center.png",
    clip: { x: 660, y: 340, width: 600, height: 400 },
  });
  // And a wider crop covering the upper row of planets to verify their labels.
  await page.screenshot({
    path: "test-results/debug-planets-crop-top.png",
    clip: { x: 300, y: 50, width: 1320, height: 450 },
  });
  // And the lower row.
  await page.screenshot({
    path: "test-results/debug-planets-crop-bottom.png",
    clip: { x: 100, y: 600, width: 1720, height: 480 },
  });
});
