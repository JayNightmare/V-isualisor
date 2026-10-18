import * as THREE from "three";
import { REQUIRED_BONES } from "./boneMapper.js";

// Tracking channels the app drives, and the morph names commonly used for each
// (ARKit, VRM presets, VRoid "Fcl_*"). Names are compared after stripping non-alphanumerics.
export const MORPH_ALIASES = {
  jawOpen: ["jawOpen", "aa", "mouthOpen", "Fcl_MTH_A", "A"],
  blinkLeft: ["eyeBlinkLeft", "blinkLeft", "blink_l", "Fcl_EYE_Close_L"],
  blinkRight: ["eyeBlinkRight", "blinkRight", "blink_r", "Fcl_EYE_Close_R"],
  smile: ["mouthSmile", "smile", "happy", "joy", "Fcl_ALL_Joy", "mouthSmileLeft", "mouthSmileRight"],
  browUp: ["browInnerUp", "browUp", "browOuterUpLeft", "browOuterUpRight", "Fcl_BRW_Surprised"],
  browDown: ["browDownLeft", "browDownRight", "angry", "Fcl_BRW_Angry"],
};

// VRM expression preset -> tracking channel.
const PRESET_TO_KEY = {
  aa: "jawOpen",
  blinkLeft: "blinkLeft",
  blinkRight: "blinkRight",
  happy: "smile",
  angry: "browDown",
};

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const ALIAS_LOOKUP = Object.fromEntries(
  Object.entries(MORPH_ALIASES).map(([key, names]) => [key, new Set(names.map(norm))]),
);

// Maps a list of morph target names to tracking channels.
export function matchMorphNames(names) {
  const out = {};
  for (const name of names) {
    for (const [key, set] of Object.entries(ALIAS_LOOKUP)) {
      if (set.has(norm(name))) (out[key] = out[key] || []).push(name);
    }
  }
  return out;
}

const emptyDrivers = () => Object.fromEntries(Object.keys(MORPH_ALIASES).map((k) => [k, []]));

function meshesUnder(node) {
  const meshes = [];
  node?.traverse?.((o) => {
    if (o.isMesh && o.morphTargetInfluences?.length) meshes.push(o);
  });
  return meshes;
}

// Builds { channel: [{ mesh, index, weight }] }. VRM expression bindings win over name matching.
export async function buildMorphDrivers(gltf) {
  const drivers = emptyDrivers();

  const presets = gltf.parser?.json?.extensions?.VRMC_vrm?.expressions?.preset || {};
  for (const [preset, def] of Object.entries(presets)) {
    const key = PRESET_TO_KEY[preset];
    if (!key) continue;
    for (const bind of def.morphTargetBinds || []) {
      const node = await gltf.parser.getDependency("node", bind.node);
      for (const mesh of meshesUnder(node)) {
        drivers[key].push({ mesh, index: bind.index, weight: bind.weight ?? 1 });
      }
    }
  }

  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary) return;
    const matches = matchMorphNames(Object.keys(o.morphTargetDictionary));
    for (const [key, names] of Object.entries(matches)) {
      if (drivers[key].length) continue;
      for (const name of names) {
        drivers[key].push({ mesh: o, index: o.morphTargetDictionary[name], weight: 1 });
      }
    }
  });
  return drivers;
}

export function detectFormat(json) {
  const ext = json?.extensions || {};
  if (ext.VRMC_vrm) return "VRM 1.0";
  if (ext.VRM) return "VRM 0.x";
  return "glTF / GLB";
}

// Summarises how a loaded model is rigged. `humanoid` maps VRM names to bones and
// `sources` holds the original bone names, captured before they were renamed.
export function inspectModel(gltf, humanoid, sources, box) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const materials = new Set();
  const textures = new Set();
  const morphs = [];
  let meshes = 0;
  let skinned = 0;
  let vertices = 0;
  let bones = 0;

  gltf.scene.traverse((o) => {
    if (o.isBone) bones++;
    if (!o.isMesh) return;
    meshes++;
    if (o.isSkinnedMesh) skinned++;
    vertices += o.geometry.attributes.position?.count || 0;
    for (const m of [].concat(o.material)) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
    if (o.morphTargetDictionary) {
      morphs.push({ mesh: o.name || "(unnamed)", targets: Object.keys(o.morphTargetDictionary) });
    }
  });

  const pos = new THREE.Vector3();
  const mapping = Object.entries(humanoid).map(([vrm, bone]) => {
    bone.getWorldPosition(pos);
    return {
      vrm,
      source: sources[vrm] || bone.name,
      parent: bone.parent?.isBone ? bone.parent.name : null,
      // Height as a fraction of the body (0 = feet, 1 = top); x is sideways offset in body heights.
      y: (pos.y - box.min.y) / (size.y || 1),
      x: (pos.x - center.x) / (size.y || 1),
    };
  });

  return {
    format: detectFormat(gltf.parser?.json),
    meshes,
    skinned,
    vertices,
    bones,
    materials: materials.size,
    textures: textures.size,
    morphs,
    mapping,
    missing: REQUIRED_BONES.filter((b) => !humanoid[b]),
  };
}
