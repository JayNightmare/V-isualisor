/**
 * FILE: src/components/VtuberGeneratorApp.jsx
 * PURPOSE:
 * Full-body VTuber character generator that ingests a standardized 3-zone character
 * reference sheet (Front, Back, Face Close-Up), slices and removes the background,
 * synthesizes a double-sided SkinnedMesh rigged to a VRM 1.0 skeleton, and drives
 * both facial blendshapes and skeletal joints via MediaPipe webcam tracking.
 *
 * WHAT WILL BE ACHIEVED:
 * 1. Slices the uploaded reference sheet into Front, Back, and Face views with a live
 *    bounding-box preview overlay.
 * 2. Runs MediaPipe FaceLandmarker on the cropped Front view to pinpoint the character's
 *    eyes and mouth on the full-body UV map.
 * 3. Generates a double-sided volumetric 3D character mesh with front and back textures
 *    and automatic bone weight skinning.
 * 4. Exports a single-draw-call .glb or .vrm binary ready for VSeeFace/Warudo.
 */

import { SpringChain } from "../utils/springSim.js";
import { estimateDepthCanvas } from "../utils/depthEstimator.js";
import { resolveHumanoid } from "../utils/boneMapper.js";
import { buildMorphDrivers, inspectModel } from "../utils/modelInspector.js";
import {
  tripoHeaders,
  getTripoKey,
  setTripoKey,
  getPreferOverride,
  setPreferOverride,
} from "../utils/settings.js";
import { Rail, TabPanel } from "./panels.jsx";
import { kvGet, kvSet, kvDelete, hashBlob } from "../utils/storage.js";
import React, { useState, useRef, useEffect } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { buildVrmHumanoidRig, VRM10ExporterPlugin } from "../utils/vrmExporterPlugin";
import {
  sliceReferenceSheet,
  buildVolumetricCharacterRig,
  headLandmarksToFrameUV,
} from "../utils/templateSlicer";

const IDENTITY_Q = new THREE.Quaternion();
const spineQ = new THREE.Quaternion();
const eulerQ = new THREE.Quaternion();
const eulerTmp = new THREE.Euler();
const MORPH_KEYS = ["jawOpen", "blinkLeft", "blinkRight", "smile", "browUp", "browDown"];
const EXPRESSION_PRESETS = {
  neutral: {},
  happy: { smile: 1, blinkLeft: 0.35, blinkRight: 0.35 },
  angry: { browDown: 1 },
  surprised: { jawOpen: 0.5, browUp: 1 },
};
const PRESET_HOTKEYS = { 1: "neutral", 2: "happy", 3: "angry", 4: "surprised" };

function setBoneEuler(bone, x, y, z) {
  eulerQ.setFromEuler(eulerTmp.set(x, y, z));
  bone.quaternion.copy(bone.userData.rest || IDENTITY_Q).multiply(eulerQ);
}

export default function VtuberGeneratorApp() {
  const manualRef = useRef({ mouth: 0, blinkL: 0, blinkR: 0, yaw: 0 });
  const presetRef = useRef("neutral");
  const idleRef = useRef(true);
  const micRef = useRef({ analyser: null, data: null, level: 0, stream: null });
  const gridRef = useRef(null);
  const rendererRef = useRef(null);
  const depthMapsRef = useRef(null);
  const aiDepthRef = useRef(false);
  const depthStrengthRef = useRef(0.7);
  const springOnRef = useRef(true);
  const outfitRef = useRef({ hue: 0, hideEars: false });
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const sheetViewRef = useRef("both");
  const videoRef = useRef(null);
  const sceneRef = useRef(null);
  const avatarGroupRef = useRef(null);
  // Cached models: sliders rebuild only the procedural one; the Tripo model is kept as-is.
  const proceduralRef = useRef(null);
  // Imported model: from Tripo ("tripo") or a user-loaded file ("file").
  const modelRef = useRef(null);
  const driversRef = useRef(null);
  const skeletonRef = useRef(null);
  const viewModeRef = useRef("procedural");
  const meshRef = useRef(null);
  const headBoneRef = useRef(null);
  const spineBoneRef = useRef(null);
  const landmarkerRef = useRef(null);
  const trackingActiveRef = useRef(false);
  const slicedCanvasesRef = useRef(null);
  const sheetImgRef = useRef(null);
  const landmarksRef = useRef(undefined);

  const [sheetPreview, setSheetPreview] = useState(null);
  const [bodyThickness, setBodyThickness] = useState(0.22);
  const [bgTolerance, setBgTolerance] = useState(40);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [eyeBlinkLeft, setEyeBlinkLeft] = useState(0);
  const [eyeBlinkRight, setEyeBlinkRight] = useState(0);
  const [headYaw, setHeadYaw] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiRig, setAiRig] = useState(false);
  const [viewMode, setViewMode] = useState("procedural");
  const [idleEnabled, setIdleEnabled] = useState(true);
  const [micOn, setMicOn] = useState(false);
  const [transparentBg, setTransparentBg] = useState(false);
  const [aiDepth, setAiDepth] = useState(false);
  const [depthStrength, setDepthStrength] = useState(0.7);
  const [depthBusy, setDepthBusy] = useState(false);
  const [springOn, setSpringOn] = useState(true);
  const [hairHue, setHairHue] = useState(0);
  const [hideEars, setHideEars] = useState(false);
  const [preset, setPreset] = useState("neutral");
  const [sheetView, setSheetView] = useState("both");
  const [assets, setAssets] = useState([]);
  const [hasModel, setHasModel] = useState(false);
  const [modelInfo, setModelInfo] = useState(null);
  const [skeletonOn, setSkeletonOn] = useState(false);
  const [tripoCached, setTripoCached] = useState(false);
  const [activeTab, setActiveTab] = useState("source");
  const [panelOpen, setPanelOpen] = useState(true);
  const [serverKey, setServerKey] = useState(null);
  const [keyInput, setKeyInput] = useState(getTripoKey());
  const [hasOverrideKey, setHasOverrideKey] = useState(Boolean(getTripoKey()));
  const [preferOverride, setPreferOverrideState] = useState(getPreferOverride());
  const [balance, setBalance] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [rigVersion, setRigVersion] = useState(0);
  const [statusMessage, setStatusMessage] = useState(
    "Upload a character reference sheet (Front / Back / Face layout) to generate a 3D model.",
  );

  const smoothedWeightsRef = useRef({
    jawOpen: 0,
    blinkLeft: 0,
    blinkRight: 0,
    smile: 0,
    browUp: 0,
    browDown: 0,
    headQuat: new THREE.Quaternion(),
  });

  useEffect(() => {
    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f19);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      40,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    camera.position.set(0, 0.1, 3.6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0.1, 0);
    cameraRef.current = camera;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const frontLight = new THREE.DirectionalLight(0xffffff, 1.5);
    frontLight.position.set(2, 3, 4);
    scene.add(frontLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 1.2);
    backLight.position.set(-2, 3, -4);
    scene.add(backLight);

    const grid = new THREE.GridHelper(4, 16, 0x334155, 0x1e293b);
    grid.position.y = -1.0;
    scene.add(grid);
    gridRef.current = grid;
    rendererRef.current = renderer;

    let lastVideoTime = -1;
    let animationFrameId;
    const tempMatrix = new THREE.Matrix4();
    const tempPos = new THREE.Vector3();
    const tempQuat = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const eulerFix = new THREE.Euler();

    let lastFrameT = performance.now() / 1000;
    let nextBlink = 2;
    let blinkStart = -1;
    const applyAvatarState = (t) => {
      const mesh = meshRef.current;
      const tracking = trackingActiveRef.current;
      const state = smoothedWeightsRef.current;
      const m = manualRef.current;
      const w = tracking ? MORPH_KEYS.map((k) => state[k]) : [m.mouth, m.blinkL, m.blinkR, 0, 0, 0];

      if (!tracking) {
        const mic = micRef.current;
        if (mic.analyser) {
          mic.analyser.getByteTimeDomainData(mic.data);
          let sum = 0;
          for (const v of mic.data) sum += ((v - 128) / 128) ** 2;
          const target = Math.min(1, Math.max(0, Math.sqrt(sum / mic.data.length) - 0.02) * 8);
          mic.level = mic.level * 0.6 + target * 0.4;
          w[0] = Math.max(w[0], mic.level);
        }
        if (idleRef.current) {
          if (blinkStart < 0 && t > nextBlink) blinkStart = t;
          if (blinkStart >= 0) {
            const p = (t - blinkStart) / 0.16;
            if (p >= 1) {
              blinkStart = -1;
              nextBlink = t + 2 + Math.random() * 3;
            } else {
              const b = 1 - Math.abs(p * 2 - 1);
              w[1] = Math.max(w[1], b);
              w[2] = Math.max(w[2], b);
            }
          }
        }
      }

      const preset = EXPRESSION_PRESETS[presetRef.current] || {};
      const drivers = driversRef.current;
      MORPH_KEYS.forEach((k, i) => {
        if (preset[k] !== undefined) w[i] = Math.max(w[i], preset[k]);
        if (mesh) mesh.morphTargetInfluences[i] = w[i];
        else if (drivers) {
          for (const d of drivers[k] || []) d.mesh.morphTargetInfluences[d.index] = w[i] * d.weight;
        }
      });

      if (!tracking) {
        const idle = idleRef.current;
        if (headBoneRef.current) {
          setBoneEuler(
            headBoneRef.current,
            idle ? Math.sin(t * 0.4) * 0.03 : 0,
            m.yaw + (idle ? Math.sin(t * 0.6) * 0.05 : 0),
            idle ? Math.sin(t * 0.5) * 0.02 : 0,
          );
        }
        if (spineBoneRef.current) {
          setBoneEuler(spineBoneRef.current, idle ? Math.sin(t * 1.6) * 0.012 : 0, 0, 0);
        }
      }
    };

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (trackingActiveRef.current && landmarkerRef.current && videoRef.current?.readyState >= 2) {
        const now = performance.now();
        if (videoRef.current.currentTime !== lastVideoTime) {
          lastVideoTime = videoRef.current.currentTime;
          const result = landmarkerRef.current.detectForVideo(videoRef.current, now);

          if (result.faceBlendshapes?.length > 0) {
            const categories = result.faceBlendshapes[0].categories;
            const getScore = (name) => categories.find((c) => c.categoryName === name)?.score || 0;

            const avg = (a, b) => (getScore(a) + getScore(b)) / 2;
            const raw = {
              jawOpen: Math.min(1, getScore("jawOpen") * 1.4),
              blinkLeft: Math.min(1, getScore("eyeBlinkLeft") * 1.3),
              blinkRight: Math.min(1, getScore("eyeBlinkRight") * 1.3),
              smile: Math.min(1, avg("mouthSmileLeft", "mouthSmileRight") * 1.4),
              browUp: Math.min(
                1,
                Math.max(getScore("browInnerUp"), avg("browOuterUpLeft", "browOuterUpRight")) * 1.3,
              ),
              browDown: Math.min(1, avg("browDownLeft", "browDownRight") * 1.5),
            };
            const alpha = 0.35;
            const state = smoothedWeightsRef.current;
            for (const k in raw) {
              state[k] = state[k] * (1 - alpha) + raw[k] * alpha;
            }
          }

          if (result.facialTransformationMatrixes?.length > 0 && headBoneRef.current) {
            tempMatrix.fromArray(result.facialTransformationMatrixes[0].data);
            tempMatrix.decompose(tempPos, tempQuat, tempScale);
            eulerFix.setFromQuaternion(tempQuat);
            eulerFix.y = -eulerFix.y;
            eulerFix.z = -eulerFix.z;
            tempQuat.setFromEuler(eulerFix);

            smoothedWeightsRef.current.headQuat.slerp(tempQuat, 0.25);
            headBoneRef.current.quaternion
              .copy(headBoneRef.current.userData.rest || IDENTITY_Q)
              .multiply(smoothedWeightsRef.current.headQuat);

            if (spineBoneRef.current) {
              spineQ.copy(IDENTITY_Q).slerp(smoothedWeightsRef.current.headQuat, 0.08);
              spineBoneRef.current.quaternion
                .copy(spineBoneRef.current.userData.rest || IDENTITY_Q)
                .multiply(spineQ);
            }
          }
        }
      }

      const nowS = performance.now() / 1000;
      applyAvatarState(nowS);
      const dt = Math.min(0.05, nowS - lastFrameT);
      lastFrameT = nowS;
      if (viewModeRef.current === "procedural" && proceduralRef.current?.chains) {
        for (const chain of proceduralRef.current.chains) {
          if (springOnRef.current) chain.update(dt);
          else chain.reset();
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      observer.disconnect();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const getLandmarker = async () => {
    if (landmarkerRef.current) return landmarkerRef.current;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm",
    );
    const lm = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "IMAGE",
      numFaces: 1,
    });
    landmarkerRef.current = lm;
    return lm;
  };

  const assembleFullCharacter = (slices, thicknessVal, detectedLandmarks) => {
    if (proceduralRef.current) {
      sceneRef.current.remove(proceduralRef.current.group);
      proceduralRef.current.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.map?.dispose();
        o.material?.dispose();
      });
    }

    const avatarGroup = new THREE.Group();
    avatarGroup.name = "VRMRoot";

    const eyeV = detectedLandmarks?.leftEye?.v ?? 0.91;
    const hair = {
      topY: (eyeV + 0.05 - 0.5) * 2,
      seg: 0.07,
      xs: [-0.13, -0.065, 0, 0.065, 0.13],
    };
    const { headBone, spineBone, bonesList, hairBones, boneMap } = buildVrmHumanoidRig(hair);
    const chains = hair.xs.map(
      (_, c) => new SpringChain([0, 1, 2, 3].map((j) => boneMap[`hair_${c}_${j}`])),
    );
    const atlasTexture = new THREE.CanvasTexture(slices.atlasCanvas);
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    atlasTexture.anisotropy = 8;

    const skinnedMesh = buildVolumetricCharacterRig({
      frontCanvas: slices.frontCanvas,
      backCanvas: slices.backCanvas,
      frameW: slices.frameW,
      frameH: slices.frameH,
      atlasTexture,
      bonesList: [...bonesList, ...hairBones],
      hair,
      thickness: thicknessVal,
      depthMaps: aiDepthRef.current ? depthMapsRef.current : null,
      depthStrength: depthStrengthRef.current,
      singleSide: slices.view !== "both",
      headLandmarks: detectedLandmarks,
    });

    avatarGroup.add(skinnedMesh);
    proceduralRef.current = {
      group: avatarGroup,
      mesh: skinnedMesh,
      head: headBone,
      spine: spineBone,
      chains,
    };
    applyOutfit();
    if (viewModeRef.current === "procedural") showModel("procedural");
    setRigVersion((v) => v + 1);
  };

  const showModel = (mode) => {
    const target = mode === "model" ? modelRef.current : proceduralRef.current;
    if (!target || !sceneRef.current) return;
    [proceduralRef.current, modelRef.current].forEach((m) => {
      if (m && m !== target) sceneRef.current.remove(m.group);
    });
    if (skeletonRef.current) {
      sceneRef.current.remove(skeletonRef.current);
      skeletonRef.current = null;
    }
    if (target.group.parent !== sceneRef.current) {
      sceneRef.current.add(target.group);
    }
    avatarGroupRef.current = target.group;
    meshRef.current = target.mesh;
    driversRef.current = target.drivers || null;
    headBoneRef.current = target.head;
    spineBoneRef.current = target.spine;
    viewModeRef.current = mode;
    setViewMode(mode);
    setModelInfo(mode === "model" ? target.info : null);
  };

  // Skeleton overlay helps compare the rig against the image.
  useEffect(() => {
    const scene = sceneRef.current;
    if (skeletonRef.current) {
      scene.remove(skeletonRef.current);
      skeletonRef.current = null;
    }
    const target = viewMode === "model" ? modelRef.current : proceduralRef.current;
    if (!skeletonOn || !target) return;
    const helper = new THREE.SkeletonHelper(target.group);
    helper.material.depthTest = false;
    helper.material.linewidth = 2;
    helper.renderOrder = 10;
    scene.add(helper);
    skeletonRef.current = helper;
  }, [skeletonOn, viewMode, hasModel, rigVersion]);

  const processSheet = async (img, toleranceVal, thicknessVal, rescan = true) => {
    let slices;
    try {
      slices = sliceReferenceSheet(img, {
        bgTolerance: toleranceVal,
        view: sheetViewRef.current,
      });
    } catch (err) {
      setStatusMessage(err.message);
      return;
    }
    slicedCanvasesRef.current = slices;
    setAssets(
      slices.assets.map((a) => ({
        name: a.name,
        width: a.width,
        height: a.height,
        url: a.canvas.toDataURL("image/png"),
      })),
    );
    if (rescan) frameCamera(sheetViewRef.current);
    if (rescan) depthMapsRef.current = null;

    let landmarks = landmarksRef.current;
    if (rescan) {
      try {
        const lm = await getLandmarker();
        await lm.setOptions({ runningMode: "IMAGE" });
        const scan = lm.detect(slices.headCanvas);
        if (scan.faceLandmarks?.length > 0) {
          landmarks = headLandmarksToFrameUV(scan.faceLandmarks[0], slices);
          setStatusMessage("Template sliced & facial landmarks calibrated on full-body rig!");
        } else {
          landmarks = undefined;
          setStatusMessage("Template sliced! No face found, using standard head bounds.");
        }
      } catch {
        landmarks = undefined;
        setStatusMessage("Template sliced! Built 3D full-body rig.");
      }
      landmarksRef.current = landmarks;
    }
    assembleFullCharacter(slices, thicknessVal, landmarks);
    if (rescan) {
      restoreTripoFromCache();
      if (aiDepthRef.current) runDepth();
    }
  };

  // Face-only builds a head bust, so move in on it; other views use the full-body framing.
  const frameCamera = (view) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const face = view === "face";
    controls.target.set(0, face ? 0.8 : 0.1, 0);
    camera.position.set(0, face ? 0.8 : 0.1, face ? 1.3 : 3.6);
    controls.update();
  };

  const selectSheetView = (view) => {
    if (view === sheetViewRef.current) return;
    sheetViewRef.current = view;
    setSheetView(view);
    if (sheetImgRef.current) processSheet(sheetImgRef.current, bgTolerance, bodyThickness);
  };

  const loadSheetFromUrl = (url) => {
    setSheetPreview(url);
    setStatusMessage("Slicing Front, Back, and Face views from reference sheet...");
    const img = new Image();
    img.onload = () => {
      sheetImgRef.current = img;
      processSheet(img, bgTolerance, bodyThickness);
    };
    img.src = url;
  };

  const handleSheetUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) loadSheetFromUrl(URL.createObjectURL(file));
  };

  useEffect(() => {
    loadSheetFromUrl("/images/character-Photoroom.png");
  }, []);

  useEffect(() => {
    if (!slicedCanvasesRef.current) return;
    assembleFullCharacter(slicedCanvasesRef.current, bodyThickness, landmarksRef.current);
  }, [bodyThickness]);

  const rebuildProcedural = () => {
    if (!slicedCanvasesRef.current) return;
    assembleFullCharacter(slicedCanvasesRef.current, bodyThickness, landmarksRef.current);
  };

  const runDepth = async () => {
    const slices = slicedCanvasesRef.current;
    if (!slices || depthMapsRef.current) return;
    setDepthBusy(true);
    try {
      const front = await estimateDepthCanvas(slices.frontCanvas, setStatusMessage);
      const back = await estimateDepthCanvas(slices.backCanvas, setStatusMessage);
      if (slicedCanvasesRef.current !== slices) return;
      depthMapsRef.current = { front, back };
      setStatusMessage("AI depth applied.");
      rebuildProcedural();
    } catch (err) {
      aiDepthRef.current = false;
      setAiDepth(false);
      setStatusMessage(`AI depth failed: ${err.message}`);
    } finally {
      setDepthBusy(false);
    }
  };

  useEffect(() => {
    aiDepthRef.current = aiDepth;
    if (!slicedCanvasesRef.current) return;
    if (aiDepth) runDepth();
    rebuildProcedural();
  }, [aiDepth]);

  useEffect(() => {
    depthStrengthRef.current = depthStrength;
    if (aiDepthRef.current) rebuildProcedural();
  }, [depthStrength]);

  useEffect(() => {
    if (!sheetImgRef.current) return;
    processSheet(sheetImgRef.current, bgTolerance, bodyThickness, false);
  }, [bgTolerance]);

  useEffect(() => {
    manualRef.current = {
      mouth: parseFloat(mouthOpen),
      blinkL: parseFloat(eyeBlinkLeft),
      blinkR: parseFloat(eyeBlinkRight),
      yaw: parseFloat(headYaw),
    };
  }, [mouthOpen, eyeBlinkLeft, eyeBlinkRight, headYaw]);

  useEffect(() => {
    springOnRef.current = springOn;
  }, [springOn]);

  useEffect(() => {
    idleRef.current = idleEnabled;
  }, [idleEnabled]);

  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (PRESET_HOTKEYS[e.key]) setPreset(PRESET_HOTKEYS[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.background = transparentBg ? null : new THREE.Color(0x0b0f19);
    if (gridRef.current) gridRef.current.visible = !transparentBg;
  }, [transparentBg]);

  // Mirrors the canvas into a clean window that OBS can capture.
  const openPopout = () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    const win = window.open("", "visualisor-popout", "width=600,height=900");
    if (!win) {
      setStatusMessage("Popout blocked by the browser.");
      return;
    }
    const video = win.document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.srcObject = canvas.captureStream(60);
    win.document.title = "V-isualisor output";
    win.document.body.style.cssText = "margin:0;background:transparent;overflow:hidden";
    video.style.cssText = "width:100vw;height:100vh;object-fit:contain";
    win.document.body.replaceChildren(video);
  };

  const applyOutfit = () => {
    const u = proceduralRef.current?.mesh.material.userData.outfit;
    if (!u) return;
    u.uHueShift.value = (outfitRef.current.hue * Math.PI) / 180;
    u.uHideEars.value = outfitRef.current.hideEars ? 1 : 0;
  };

  useEffect(() => {
    outfitRef.current = { hue: hairHue, hideEars };
    applyOutfit();
  }, [hairHue, hideEars]);

  const toggleMic = async () => {
    const mic = micRef.current;
    if (mic.analyser) {
      mic.stream.getTracks().forEach((t) => t.stop());
      mic.ctx.close();
      micRef.current = { analyser: null, data: null, level: 0, stream: null };
      setMicOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      micRef.current = {
        analyser,
        ctx,
        stream,
        data: new Uint8Array(analyser.fftSize),
        level: 0,
      };
      setMicOn(true);
    } catch (err) {
      setStatusMessage(`Mic error: ${err.message}`);
    }
  };

  const toggleWebcamTracking = async () => {
    if (isTracking) {
      trackingActiveRef.current = false;
      setIsTracking(false);
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      }
      setStatusMessage("Webcam tracking paused.");
      return;
    }

    try {
      setIsModelLoading(true);
      const lm = await getLandmarker();
      await lm.setOptions({ runningMode: "VIDEO" });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: "user",
        },
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      trackingActiveRef.current = true;
      setIsTracking(true);
      setIsModelLoading(false);
      setStatusMessage("Live full-body head & spine tracking active.");
    } catch (err) {
      setIsModelLoading(false);
      setStatusMessage(`Webcam error: ${err.message}`);
    }
  };

  const sheetKey = async () => {
    const source = slicedCanvasesRef.current?.tripoCanvas;
    if (!source) return null;
    const blob = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
    return hashBlob(blob);
  };

  const removeModel = () => {
    const m = modelRef.current;
    if (!m) return;
    sceneRef.current.remove(m.group);
    m.group.traverse((o) => {
      o.geometry?.dispose();
    });
    modelRef.current = null;
    setHasModel(false);
    showModel("procedural");
  };

  const installModel = async (buffer, label, source) => {
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    const info = {};
    const group = new THREE.Group();
    group.name = "VRMRoot";
    group.add(gltf.scene);
    // VRM 0.x models face -Z; turn them to face the camera like everything else.
    if (gltf.parser?.json?.extensions?.VRM) group.rotation.y = Math.PI;
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2 / (size.y || 1);
    group.scale.setScalar(scale);
    group.position.y = -box.min.y * scale - 1;
    group.updateMatrixWorld(true);
    const humanoid = await resolveHumanoid(gltf);
    const sources = Object.fromEntries(
      Object.entries(humanoid).map(([name, bone]) => [name, bone.name]),
    );
    Object.assign(
      info,
      inspectModel(gltf, humanoid, sources, new THREE.Box3().setFromObject(group)),
    );
    const drivers = await buildMorphDrivers(gltf);
    info.drivers = Object.fromEntries(Object.entries(drivers).map(([k, v]) => [k, v.length]));
    info.label = label;
    info.source = source;
    // Canonical names let the exporter emit the humanoid map for this skeleton.
    Object.entries(humanoid).forEach(([name, bone]) => {
      bone.name = name;
    });
    Object.values(humanoid).forEach((bone) => {
      bone.userData.rest = bone.quaternion.clone();
    });
    const head = humanoid.head || null;
    const spine = humanoid.chest || humanoid.spine || null;
    const rigged = Boolean(head);
    if (modelRef.current) {
      sceneRef.current.remove(modelRef.current.group);
    }
    modelRef.current = { group, mesh: null, head, spine, drivers, info, source };
    setHasModel(true);
    showModel("model");
    return rigged;
  };

  const loadModelFile = async (file) => {
    if (!/\.(glb|vrm)$/i.test(file.name)) {
      setStatusMessage("Models must be .glb or .vrm files.");
      return;
    }
    try {
      setStatusMessage(`Loading ${file.name}...`);
      const rigged = await installModel(await file.arrayBuffer(), file.name, "file");
      setActiveTab("rig");
      setStatusMessage(
        rigged
          ? `Loaded ${file.name}. See the Rig tab for how it maps.`
          : `Loaded ${file.name}; no humanoid rig found (static).`,
      );
    } catch (err) {
      setStatusMessage(`Could not load model: ${err.message}`);
    }
  };

  const handleModelUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) loadModelFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (/\.(glb|vrm)$/i.test(file.name)) loadModelFile(file);
    else if (file.type.startsWith("image/")) loadSheetFromUrl(URL.createObjectURL(file));
    else setStatusMessage("Drop an image sheet or a .glb/.vrm model.");
  };

  const exportMapping = () => {
    if (!modelInfo) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(modelInfo, null, 2)], { type: "application/json" }),
    );
    link.download = "rig-mapping.json";
    link.click();
  };

  const saveKey = () => {
    setTripoKey(keyInput);
    setHasOverrideKey(Boolean(keyInput.trim()));
    setBalance(null);
    setStatusMessage(keyInput.trim() ? "Tripo key saved in this browser." : "Tripo key cleared.");
  };

  const clearKey = () => {
  	setTripoKey("");
  	setKeyInput("");
  	setHasOverrideKey(false);
  	setBalance(null);
  	setStatusMessage("Tripo key cleared.");
  };

  const togglePrefer = (on) => {
    setPreferOverride(on);
    setPreferOverrideState(on);
  };

  const checkBalance = async () => {
    setBalance("checking...");
    try {
      const res = await fetch("/api/balance", { headers: tripoHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
      setBalance(`${body.balance ?? "?"} credits`);
    } catch (err) {
      setBalance(err.message);
    }
  };

  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c) => setServerKey(Boolean(c.serverKey)))
      .catch(() => setServerKey("offline"));
  }, []);

  const restoreTripoFromCache = async () => {
    try {
      const key = await sheetKey();
      const hit = key && (await kvGet(`tripo:${key}`));
      setTripoCached(Boolean(hit));
      if (!hit) {
        // Only drop a Tripo-sourced model; never a file the user loaded.
        if (modelRef.current?.source === "tripo") removeModel();
        return;
      }
      if (modelRef.current?.source === "file") return;
      await installModel(hit.buffer, "Tripo (cached)", "tripo");
      setStatusMessage("Restored cached Tripo model.");
    } catch {
      /* cache is best-effort */
    }
  };

  const clearTripoCache = async () => {
    const key = await sheetKey();
    if (key) await kvDelete(`tripo:${key}`);
    setTripoCached(false);
    if (modelRef.current?.source === "tripo") removeModel();
    setStatusMessage("Cleared cached Tripo model.");
  };

  // Optional: send the front view to the Tripo backend (server/) and show the returned GLB.
  const generateWithTripo = async () => {
    const slices = slicedCanvasesRef.current;
    if (!slices?.tripoCanvas || isAiRunning) return;
    setIsAiRunning(true);
    try {
      setStatusMessage("Uploading front view to Tripo...");
      const blob = await new Promise((resolve) => slices.tripoCanvas.toBlob(resolve, "image/png"));
      const form = new FormData();
      form.append("image", blob, "front.png");
      const start = await fetch(`/api/reconstruct?rig=${aiRig}`, {
        method: "POST",
        body: form,
        headers: tripoHeaders(),
      });
      const startBody = await start.json();
      if (!start.ok) throw new Error(startBody.error || `Server error ${start.status}`);

      let job;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/reconstruct/${startBody.jobId}`);
        job = await res.json();
        if (!res.ok) throw new Error(job.error || `Server error ${res.status}`);
        if (job.status === "failed") throw new Error(job.error || "Tripo job failed");
        if (job.status === "success") break;
        setStatusMessage(`Tripo: ${job.stage} ${Math.round(job.progress || 0)}%`);
      }

      const model = await fetch(`/api/reconstruct/${startBody.jobId}/model`);
      const buffer = await model.arrayBuffer();
      const rigged = await installModel(buffer, "Tripo model", "tripo");
      const key = await sheetKey();
      if (key) {
        kvSet(`tripo:${key}`, {
          buffer,
          rigged: aiRig,
        }).catch(() => {});
        setTripoCached(true);
      }
      setStatusMessage(
        job.warning
          ? `Tripo model loaded. ${job.warning}`
          : rigged
            ? "Tripo model loaded with rig; head tracking mapped."
            : "Tripo 3D model loaded (no rig found; static).",
      );
    } catch (err) {
      setStatusMessage(`Tripo failed: ${err.message}`);
    } finally {
      setIsAiRunning(false);
    }
  };

  const saveProject = () => {
    const img = sheetImgRef.current;
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const project = {
      version: 1,
      settings: { bodyThickness, bgTolerance, sheetView },
      sheet: c.toDataURL("image/png"),
    };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([JSON.stringify(project)], {
        type: "application/json",
      }),
    );
    link.download = "vtuber-project.json";
    link.click();
    setStatusMessage("Project saved.");
  };

  const loadProject = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const project = JSON.parse(await file.text());
      if (!project.sheet) throw new Error("no sheet in project");
      const { bodyThickness: t, bgTolerance: b, sheetView: v } = project.settings || {};
      if (["both", "front", "back", "face"].includes(v)) {
        sheetViewRef.current = v;
        setSheetView(v);
      }
      if (typeof t === "number") setBodyThickness(t);
      if (typeof b === "number") setBgTolerance(b);
      loadSheetFromUrl(project.sheet);
    } catch (err) {
      setStatusMessage(`Could not load project: ${err.message}`);
    }
  };

  const exportAvatar = (extension) => {
    if (!avatarGroupRef.current) return;
    setIsExporting(true);
    setStatusMessage(`Exporting full-body SkinnedMesh .${extension}...`);

    const exporter = new GLTFExporter();
    exporter.register((writer) => new VRM10ExporterPlugin(writer));

    exporter.parse(
      avatarGroupRef.current,
      (result) => {
        const blob = new Blob([result], {
          type: "model/gltf-binary",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `vtuber-fullbody.${extension}`;
        link.click();
        setIsExporting(false);
        setStatusMessage(`Exported vtuber-fullbody.${extension} successfully.`);
      },
      () => {
        setIsExporting(false);
        setStatusMessage("Export failed.");
      },
      { binary: true, includeCustomExtensions: true },
    );
  };

  const ctx = {
    sheetView, selectSheetView, assets, sheetPreview, handleSheetUpload, showModel, viewMode, hasModel, modelInfo,
    handleModelUpload, removeModel, saveProject, loadProject,
    bgTolerance, setBgTolerance, bodyThickness, setBodyThickness,
    depthBusy, aiDepth, setAiDepth, depthStrength, setDepthStrength,
    hairHue, setHairHue, hideEars, setHideEars,
    presetNames: Object.keys(EXPRESSION_PRESETS), preset, setPreset,
    idleEnabled, setIdleEnabled, springOn, setSpringOn,
    isTracking, isModelLoading, toggleWebcamTracking, micOn, toggleMic,
    headYaw, setHeadYaw, mouthOpen, setMouthOpen,
    serverKey, hasOverrideKey, setActiveTab, generateWithTripo, isAiRunning,
    aiRig, setAiRig, tripoCached, clearTripoCache,
    skeletonOn, setSkeletonOn, exportMapping,
    transparentBg, setTransparentBg, openPopout, exportAvatar, isExporting,
    keyInput, setKeyInput, saveKey, clearKey, preferOverride, togglePrefer,
    checkBalance, balance,
  };

  const selectTab = (id) => {
    if (id === activeTab) setPanelOpen((o) => !o);
    else {
      setActiveTab(id);
      setPanelOpen(true);
    }
  };

  return (
    <div className="h-screen flex bg-slate-950 text-slate-100 font-sans overflow-hidden">
      <Rail active={activeTab} open={panelOpen} onSelect={selectTab} />
      {panelOpen && <TabPanel active={activeTab} ctx={ctx} />}
      <main
        className="flex-1 relative min-w-0"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <div ref={mountRef} className="absolute inset-0" />
        <div className="absolute top-3 left-3 right-3 pointer-events-none">
          <span className="inline-block max-w-full bg-slate-900/80 border border-slate-700 text-indigo-300 text-xs px-3 py-1.5 rounded-full">
            {statusMessage}
          </span>
        </div>
        {dragging && (
          <div className="absolute inset-0 border-2 border-dashed border-indigo-400 bg-indigo-500/10 flex items-center justify-center text-indigo-200 pointer-events-none">
            Drop a sheet image or a .glb/.vrm model
          </div>
        )}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute bottom-4 right-4 w-44 h-32 object-cover rounded-lg border border-slate-700 shadow-lg scale-x-[-1] transition-opacity ${
            isTracking ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />
      </main>
    </div>
  );
}
