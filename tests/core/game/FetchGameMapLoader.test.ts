import { describe, expect, test, vi } from "vitest";
import { FetchGameMapLoader } from "../../../src/core/game/FetchGameMapLoader";
import { GameMapType } from "../../../src/core/game/Game";

describe("FetchGameMapLoader", () => {
  test("resolves each map file through the provided path resolver", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.SolSystem);

    expect(mapData.webpPath).toBe(
      "/_assets/maps/solsystem/thumbnail.webp.hashed",
    );

    await mapData.manifest();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/solsystem/manifest.json.hashed",
    );
  });
});
