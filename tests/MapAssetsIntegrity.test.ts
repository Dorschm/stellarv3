// @vitest-environment node
import fs from "fs";
import { globSync } from "glob";
import path from "path";

type MapSection = {
  width?: number;
  height?: number;
};

type Manifest = {
  map?: MapSection;
  map4x?: MapSection;
  map16x?: MapSection;
};

const REQUIRED_ASSETS = [
  "map.bin",
  "map4x.bin",
  "map16x.bin",
  "thumbnail.webp",
] as const;

const BINARY_SECTIONS: { file: "map.bin" | "map4x.bin" | "map16x.bin"; section: keyof Manifest }[] = [
  { file: "map.bin", section: "map" },
  { file: "map4x.bin", section: "map4x" },
  { file: "map16x.bin", section: "map16x" },
];

describe("Map assets integrity", () => {
  test("Every map manifest ships the required binary/thumbnail assets", () => {
    const manifestPaths = globSync("resources/maps/**/manifest.json");
    expect(manifestPaths.length).toBeGreaterThan(0);

    const errors: string[] = [];

    for (const manifestPath of manifestPaths) {
      const mapDir = path.dirname(manifestPath);

      for (const asset of REQUIRED_ASSETS) {
        const assetPath = path.join(mapDir, asset);
        if (!fs.existsSync(assetPath)) {
          errors.push(`${manifestPath} -> missing required asset "${asset}"`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Map asset presence violations:\n" + errors.join("\n"),
      );
    }
  });

  test("Each binary asset byte length equals width * height for its manifest section", () => {
    const manifestPaths = globSync("resources/maps/**/manifest.json");
    expect(manifestPaths.length).toBeGreaterThan(0);

    const errors: string[] = [];

    for (const manifestPath of manifestPaths) {
      const mapDir = path.dirname(manifestPath);
      let manifest: Manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
      } catch (err) {
        errors.push(
          `Failed to parse ${manifestPath}: ${(err as Error).message}`,
        );
        continue;
      }

      for (const { file, section } of BINARY_SECTIONS) {
        const meta = manifest[section];
        if (
          !meta ||
          typeof meta.width !== "number" ||
          typeof meta.height !== "number"
        ) {
          errors.push(
            `${manifestPath} -> section "${section}" is missing width/height`,
          );
          continue;
        }

        const binPath = path.join(mapDir, file);
        if (!fs.existsSync(binPath)) {
          // Presence is enforced by the other test; skip size comparison here.
          continue;
        }

        const expected = meta.width * meta.height;
        const actual = fs.statSync(binPath).size;
        if (actual !== expected) {
          errors.push(
            `${manifestPath} -> "${file}" size ${actual} != ${meta.width}*${meta.height}=${expected}`,
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        "Map binary size violations:\n" + errors.join("\n"),
      );
    }
  });
});
