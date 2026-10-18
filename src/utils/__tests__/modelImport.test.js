import { describe, it, expect, beforeEach, vi } from "vitest";
import { matchMorphNames } from "../modelInspector.js";
import { resolveHumanoid } from "../boneMapper.js";

const fakeGltf = (extensions, nodes) => ({
  parser: {
    json: { extensions },
    getDependency: async (_type, i) => nodes[i],
  },
  scene: { traverse: () => {} },
});

describe("matchMorphNames", () => {
  it("maps ARKit, VRM and VRoid names to tracking channels", () => {
    const m = matchMorphNames(["eyeBlinkLeft", "Fcl_MTH_A", "mouthSmile", "browDownRight", "unrelated"]);
    expect(m.blinkLeft).toEqual(["eyeBlinkLeft"]);
    expect(m.jawOpen).toEqual(["Fcl_MTH_A"]);
    expect(m.smile).toEqual(["mouthSmile"]);
    expect(m.browDown).toEqual(["browDownRight"]);
  });
});

describe("resolveHumanoid", () => {
  const nodes = [{ name: "a" }, { name: "b" }];

  it("reads VRM 1.0 keyed humanBones", async () => {
    const h = await resolveHumanoid(
      fakeGltf({ VRMC_vrm: { humanoid: { humanBones: { head: { node: 0 }, hips: { node: 1 } } } } }, nodes),
    );
    expect(h.head).toBe(nodes[0]);
    expect(h.hips).toBe(nodes[1]);
  });

  it("reads VRM 0.x array humanBones", async () => {
    const h = await resolveHumanoid(
      fakeGltf({ VRM: { humanoid: { humanBones: [{ bone: "head", node: 1 }] } } }, nodes),
    );
    expect(h.head).toBe(nodes[1]);
  });
});

describe("settings", () => {
  beforeEach(() => {
    const store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });
    vi.resetModules();
  });

  it("sends no headers without a key, and key + prefer when set", async () => {
    const s = await import("../settings.js");
    expect(s.tripoHeaders()).toEqual({});
    s.setTripoKey("  abc ");
    expect(s.tripoHeaders()).toEqual({ "x-tripo-key": "abc" });
    s.setPreferOverride(true);
    expect(s.tripoHeaders()["x-tripo-prefer"]).toBe("1");
    s.setTripoKey("");
    expect(s.tripoHeaders()).toEqual({});
  });
});

describe("findRegions", () => {
  const grid = (rows) => {
    const h = rows.length;
    const w = rows[0].length;
    return { w, h, mask: Uint8Array.from(rows.join("").split("").map((c) => (c === "#" ? 1 : 0))) };
  };

  it("separates distant props and keeps reading order", async () => {
    const { findRegions } = await import("../templateSlicer.js");
    const { w, h, mask } = grid([
      "##........",
      "##........",
      "..........",
      "..........",
      "......###.",
      "......###.",
    ]);
    expect(findRegions(mask, w, h, 0)).toEqual([
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 6, y: 4, w: 3, h: 2 },
    ]);
  });

  it("merges pieces closer than the gap but keeps tight boxes", async () => {
    const { findRegions } = await import("../templateSlicer.js");
    const { w, h, mask } = grid(["##..##", "##..##"]);
    expect(findRegions(mask, w, h, 1)).toEqual([{ x: 0, y: 0, w: 6, h: 2 }]);
    expect(findRegions(mask, w, h, 0)).toHaveLength(2);
  });
});
