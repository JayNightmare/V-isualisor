// Maps arbitrary skeleton bone names (VRM, Mixamo, Blender, Tripo) to VRM humanoid names.

const IGNORED = new Set(["j", "bip", "adj", "sec", "c", "mixamorig", "armature"]);

const CENTER = {
  hips: "hips",
  hip: "hips",
  pelvis: "hips",
  spine: "spine",
  spine1: "spine",
  chest: "chest",
  spine2: "chest",
  neck: "neck",
  head: "head",
};

const SIDED = {
  upperarm: "UpperArm",
  arm: "UpperArm",
  forearm: "LowerArm",
  lowerarm: "LowerArm",
  hand: "Hand",
  upperleg: "UpperLeg",
  upleg: "UpperLeg",
  thigh: "UpperLeg",
  leg: "LowerLeg",
  lowerleg: "LowerLeg",
  calf: "LowerLeg",
  shin: "LowerLeg",
  foot: "Foot",
};

export function mapToVrmBone(rawName) {
  if (!rawName) return null;
  const tokens = rawName
    .replace(/^.*:/, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_.\-\s]+/)
    .filter(Boolean);

  let side = null;
  const rest = [];
  for (const t of tokens) {
    if (t === "left" || t === "l") side = "left";
    else if (t === "right" || t === "r") side = "right";
    else if (!IGNORED.has(t)) rest.push(t);
  }
  const key = rest.join("");
  if (!side) return CENTER[key] || null;
  return SIDED[key] ? side + SIDED[key] : null;
}

export const REQUIRED_BONES = [
  "hips", "spine", "chest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
];

// Returns { vrmName: Object3D } using the file's own VRM humanoid (1.0 or 0.x) if present, else names.
export async function resolveHumanoid(gltf) {
  const result = {};
  const ext = gltf.parser?.json?.extensions || {};
  const v1 = ext.VRMC_vrm?.humanoid?.humanBones;
  // VRM 0.x stores an array of { bone, node } instead of a keyed object.
  const v0 = ext.VRM?.humanoid?.humanBones;
  const entries = v1
    ? Object.entries(v1).map(([name, def]) => [name, def.node])
    : Array.isArray(v0)
      ? v0.map((def) => [def.bone, def.node])
      : [];
  for (const [name, index] of entries) {
    const node = await gltf.parser.getDependency("node", index);
    if (node) result[name] = node;
  }
  if (result.head) return result;
  gltf.scene.traverse((o) => {
    if (!o.isBone) return;
    const name = mapToVrmBone(o.name);
    if (name && !result[name]) result[name] = o;
  });
  return result;
}
