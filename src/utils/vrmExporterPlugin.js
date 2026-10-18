/**
 * FILE: src/utils/vrmExporterPlugin.js
 * PURPOSE:
 * Builds a full-body 17-bone VRM humanoid armature aligned to A-pose reference sheets
 * and injects VRMC_vrm 1.0 metadata into the exported glTF/VRM binary.
 *
 * WHAT WILL BE ACHIEVED:
 * 1. Creates a full-body humanoid bone hierarchy scaled to the character mesh bounds.
 * 2. Exports an indexed bonesList array matching the SkinnedMesh vertex weight bindings.
 * 3. Serializes humanoid bone node indices and morph target expressions into VRMC_vrm 1.0.
 */

import * as THREE from 'three';

export function buildVrmHumanoidRig(hair = {}) {
  const boneDefinitions = [
    { name: 'hips', parent: null, pos: [0, -0.05, 0] },
    { name: 'spine', parent: 'hips', pos: [0, 0.18, 0] },
    { name: 'chest', parent: 'spine', pos: [0, 0.22, 0] },
    { name: 'neck', parent: 'chest', pos: [0, 0.2, 0] },
    { name: 'head', parent: 'neck', pos: [0, 0.12, 0] },
    { name: 'leftUpperArm', parent: 'chest', pos: [-0.18, 0.16, 0] },
    { name: 'leftLowerArm', parent: 'leftUpperArm', pos: [-0.12, -0.22, 0] },
    { name: 'leftHand', parent: 'leftLowerArm', pos: [-0.08, -0.2, 0] },
    { name: 'rightUpperArm', parent: 'chest', pos: [0.18, 0.16, 0] },
    { name: 'rightLowerArm', parent: 'rightUpperArm', pos: [0.12, -0.22, 0] },
    { name: 'rightHand', parent: 'rightLowerArm', pos: [0.08, -0.2, 0] },
    { name: 'leftUpperLeg', parent: 'hips', pos: [-0.12, -0.08, 0] },
    { name: 'leftLowerLeg', parent: 'leftUpperLeg', pos: [0, -0.38, 0] },
    { name: 'leftFoot', parent: 'leftLowerLeg', pos: [0, -0.38, 0] },
    { name: 'rightUpperLeg', parent: 'hips', pos: [0.12, -0.08, 0] },
    { name: 'rightLowerLeg', parent: 'rightUpperLeg', pos: [0, -0.38, 0] },
    { name: 'rightFoot', parent: 'rightLowerLeg', pos: [0, -0.38, 0] },
  ];

  const boneMap = {};
  const bonesList = [];

  boneDefinitions.forEach((def) => {
    const bone = new THREE.Bone();
    bone.name = def.name;
    bone.position.set(...def.pos);
    boneMap[def.name] = bone;
    bonesList.push(bone);
    if (def.parent && boneMap[def.parent]) {
      boneMap[def.parent].add(bone);
    }
  });

  // Hair chains hang off the head, positioned in mesh space via `hair`.
  const HEAD_WORLD_Y = 0.67;
  const { topY = 0.92, seg = 0.07, xs = [-0.13, -0.065, 0, 0.065, 0.13] } = hair;
  const hairBones = [];
  xs.forEach((x, c) => {
    let parent = boneMap.head;
    for (let j = 0; j < 4; j++) {
      const bone = new THREE.Bone();
      bone.name = `hair_${c}_${j}`;
      bone.position.set(j === 0 ? x : 0, j === 0 ? topY - HEAD_WORLD_Y : -seg, 0);
      parent.add(bone);
      boneMap[bone.name] = bone;
      hairBones.push(bone);
      parent = bone;
    }
  });

  return {
    rootBone: boneMap.hips,
    headBone: boneMap.head,
    spineBone: boneMap.spine,
    bonesList,
    hairBones,
    boneMap,
  };
}

const EXPRESSION_DEFS = {
  aa: [[0, 1]],
  blinkLeft: [[1, 1]],
  blinkRight: [[2, 1]],
  blink: [[1, 1], [2, 1]],
  happy: [[3, 1], [1, 0.35], [2, 0.35]],
  angry: [[5, 1]],
  surprised: [[0, 0.5], [4, 1]],
};

export function buildPresets(node) {
  const presets = {};
  for (const [name, binds] of Object.entries(EXPRESSION_DEFS)) {
    presets[name] = {
      isBinary: false,
      overrideBlink: 'none',
      overrideLookAt: 'none',
      overrideMouth: 'none',
      morphTargetBinds: binds.map(([index, weight]) => ({ node, index, weight })),
    };
  }
  return presets;
}

export class VRM10ExporterPlugin {
  constructor(writer) {
    this.writer = writer;
    this.name = 'VRMC_vrm';
  }

  afterParse() {
    const json = this.writer.json;
    json.extensionsUsed = json.extensionsUsed || [];
    if (!json.extensionsUsed.includes('VRMC_vrm')) {
      json.extensionsUsed.push('VRMC_vrm');
    }

    const humanBones = {};
    const hairNodes = {};
    let meshNodeIndex = -1;

    if (json.nodes) {
      json.nodes.forEach((node, index) => {
        if (node.name === 'VTuberAvatarMesh') {
          meshNodeIndex = index;
        }
        const vrmBoneNames = [
          'hips', 'spine', 'chest', 'neck', 'head',
          'leftUpperArm', 'leftLowerArm', 'leftHand',
          'rightUpperArm', 'rightLowerArm', 'rightHand',
          'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
          'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
        ];
        const hair = /^hair_(\d+)_(\d+)$/.exec(node.name || '');
        if (hair) {
          (hairNodes[hair[1]] = hairNodes[hair[1]] || [])[Number(hair[2])] = index;
        }
        if (vrmBoneNames.includes(node.name)) {
          humanBones[node.name] = { node: index };
        }
      });
    }

    json.extensions = json.extensions || {};
    const hairChains = Object.values(hairNodes);
    if (hairChains.length) {
      json.extensionsUsed.push('VRMC_springBone');
      json.extensions.VRMC_springBone = {
        specVersion: '1.0',
        springs: hairChains.map((joints, i) => ({
          name: `hair_${i}`,
          joints: joints.map((node) => ({
            node,
            hitRadius: 0.02,
            stiffness: 0.8,
            gravityPower: 0.1,
            gravityDir: [0, -1, 0],
            dragForce: 0.4,
          })),
        })),
      };
    }
    json.extensions.VRMC_vrm = {
      specVersion: '1.0',
      meta: {
        name: 'ReferenceSheetVTuber',
        version: '1.0.0',
        authors: ['VTuberGeneratorApp'],
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        allowExcessivelyViolentUsage: false,
        allowExcessivelySexualUsage: false,
        commercialUsage: 'personalNonProfit',
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: 'optional',
        allowRedistribution: true,
        modification: 'allowModification',
      },
      humanoid: { humanBones },
      expressions: meshNodeIndex < 0 ? {} : { preset: buildPresets(meshNodeIndex) },
    };
  }
}
