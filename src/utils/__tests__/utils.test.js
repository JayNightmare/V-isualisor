import { describe, it, expect } from "vitest";
import { buildVrmHumanoidRig, VRM10ExporterPlugin } from "../vrmExporterPlugin.js";
import { headLandmarksToFrameUV } from "../templateSlicer.js";
import { mapToVrmBone } from "../boneMapper.js";

describe("buildVrmHumanoidRig", () => {
  it("builds the 17 humanoid bones with head under neck", () => {
    const rig = buildVrmHumanoidRig();
    expect(rig.bonesList).toHaveLength(17);
    expect(rig.headBone.parent).toBe(rig.boneMap.neck);
    expect(rig.rootBone.name).toBe("hips");
  });

  it("adds five hair chains of four bones outside bonesList", () => {
    const rig = buildVrmHumanoidRig();
    const hair = Object.keys(rig.boneMap).filter((k) => k.startsWith("hair_"));
    expect(hair).toHaveLength(20);
    expect(rig.bonesList.some((b) => b.name.startsWith("hair_"))).toBe(false);
  });
});

describe("VRM10ExporterPlugin.afterParse", () => {
  const run = (nodes) => {
    const writer = { json: { nodes } };
    new VRM10ExporterPlugin(writer).afterParse();
    return writer.json;
  };

  it("maps humanoid bones and expressions", () => {
    const json = run([{ name: "hips" }, { name: "head" }, { name: "VTuberAvatarMesh" }]);
    const vrm = json.extensions.VRMC_vrm;
    expect(vrm.humanoid.humanBones.hips.node).toBe(0);
    expect(vrm.humanoid.humanBones.head.node).toBe(1);
    expect(json.extensionsUsed).toContain("VRMC_vrm");
    expect(vrm.expressions.preset.aa.morphTargetBinds[0].node).toBe(2);
    expect(Object.keys(vrm.expressions.preset)).toEqual(
      expect.arrayContaining(["happy", "angry", "surprised", "blink"]),
    );
    expect(vrm.expressions.preset.happy.morphTargetBinds[0]).toMatchObject({ index: 3, weight: 1 });
  });

  it("emits spring bones for hair chains", () => {
    const json = run([{ name: "hair_0_0" }, { name: "hair_0_1" }, { name: "hair_0_2" }, { name: "hair_0_3" }]);
    expect(json.extensions.VRMC_springBone.springs[0].joints).toHaveLength(4);
  });

  it("tolerates a missing mesh", () => {
    const json = run([{ name: "hips" }]);
    expect(json.extensions.VRMC_vrm.expressions).toEqual({});
  });
});

describe("headLandmarksToFrameUV", () => {
  it("converts head-crop landmarks to flipped frame UV", () => {
    const points = [];
    points[33] = { x: 0, y: 0 };
    points[263] = { x: 1, y: 1 };
    points[13] = { x: 0.5, y: 0.5 };
    const slices = { headRect: { x: 100, y: 50, size: 200 }, frameW: 400, frameH: 400 };
    const r = headLandmarksToFrameUV(points, slices);
    expect(r.leftEye).toEqual({ u: 0.25, v: 1 - 50 / 400 });
    expect(r.rightEye).toEqual({ u: 0.75, v: 1 - 250 / 400 });
    expect(r.mouth.u).toBeCloseTo(0.5);
  });
});

describe("mapToVrmBone", () => {
  it("maps VRM, Mixamo and Blender style names", () => {
    expect(mapToVrmBone("head")).toBe("head");
    expect(mapToVrmBone("mixamorig:Hips")).toBe("hips");
    expect(mapToVrmBone("mixamorig:Spine2")).toBe("chest");
    expect(mapToVrmBone("mixamorig:LeftArm")).toBe("leftUpperArm");
    expect(mapToVrmBone("mixamorig:LeftForeArm")).toBe("leftLowerArm");
    expect(mapToVrmBone("mixamorig:RightUpLeg")).toBe("rightUpperLeg");
    expect(mapToVrmBone("mixamorig:RightLeg")).toBe("rightLowerLeg");
    expect(mapToVrmBone("J_Bip_L_UpperArm")).toBe("leftUpperArm");
    expect(mapToVrmBone("J_Bip_C_Head")).toBe("head");
    expect(mapToVrmBone("upper_arm.R")).toBe("rightUpperArm");
    expect(mapToVrmBone("leftFoot")).toBe("leftFoot");
  });

  it("ignores unknown bones", () => {
    expect(mapToVrmBone("HeadTop_End")).toBeNull();
    expect(mapToVrmBone("hair_0_1")).toBeNull();
    expect(mapToVrmBone("LeftShoulder")).toBeNull();
  });
});
