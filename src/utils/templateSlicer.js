/**
 * FILE: src/utils/templateSlicer.js
 * PURPOSE:
 * Slices a Front / Back / Face reference sheet, builds per-view alpha cutouts,
 * and inflates the character into a double-sided, skinned volumetric mesh.
 *
 * Silhouettes are rendered with per-pixel alpha (alphaTest) instead of removing
 * mesh cells, so edges stay crisp. Sheets with a transparent background use their
 * own alpha; opaque sheets fall back to a border flood-fill cutout.
 */

import * as THREE from 'three';

export const TEMPLATE_LAYOUT_BOXES = {
  front: { x: 0.1, y: 0.0, w: 0.36, h: 1.0 },
  back: { x: 0.46, y: 0.0, w: 0.35, h: 1.0 },
  face: { x: 0.73, y: 0.0, w: 0.27, h: 0.368 },
  // Reserved below the face for loose props (badge, gloves, cross...). Starts right of the back view's sleeve.
  assets: { x: 0.82, y: 0.37, w: 0.18, h: 0.3 },
};

// Which reference views build the 3D model.
export const SHEET_VIEWS = ['both', 'front', 'back', 'face'];

// Face close-up overlaps the back view's bounding box; clear it from the back ROI.
const BACK_EXCLUDE = { x: 0.73, y: 0.0, w: 0.27, h: 0.38 };

const FRAME_H = 1024;
const ALPHA_VISIBLE = 40;
// Share of the frame height occupied by the head in the full-body rig (see boneWeights).
const HEAD_FRAC = 0.2;

// Groups set cells of a w*h mask into 8-connected regions after dilating by `gap` cells,
// so pieces of one prop (e.g. a glove and its bunny) stay together. Returns tight cell boxes.
export function findRegions(mask, w, h, gap = 0) {
  const grown = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) grown[ny * w + nx] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(w * h);
  const regions = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      if (mask[i]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (grown[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
    }
    if (x1 >= 0) regions.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // Reading order: top to bottom, then left to right.
  return regions.sort((a, b) => a.y - b.y || a.x - b.x);
}

// Cuts each separate prop out of the (already background-cleared) assets region.
function extractAssets(roi) {
  const { width: w, height: h } = roi;
  if (w < 8 || h < 8) return [];
  const data = roi.getContext('2d').getImageData(0, 0, w, h).data;
  const cell = 2;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_VISIBLE) mask[((y / cell) | 0) * gw + ((x / cell) | 0)] = 1;
    }
  }
  const pad = 2;
  const assets = [];
  for (const r of findRegions(mask, gw, gh, 0)) {
    const px = Math.max(0, r.x * cell - pad);
    const py = Math.max(0, r.y * cell - pad);
    const pw = Math.min(w - px, r.w * cell + pad * 2);
    const ph = Math.min(h - py, r.h * cell + pad * 2);
    // Ignore specks left over from the cutout.
    if (pw < 12 || ph < 12) continue;
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    canvas.getContext('2d').drawImage(roi, px, py, pw, ph, 0, 0, pw, ph);
    assets.push({ name: `Asset ${assets.length + 1}`, canvas, width: pw, height: ph });
  }
  return assets;
}

// Clears everything not connected to the largest opaque blob (after bridging small gaps), e.g. the
// neighbouring back-view sleeve that bleeds into the face crop. Edits `canvas` in place.
function keepMainComponent(canvas, cell = 2, gap = 2) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] <= ALPHA_VISIBLE) continue;
      const cx = (x / cell) | 0;
      const cy = (y / cell) | 0;
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) grown[ny * gw + nx] = 1;
        }
      }
    }
  }
  const label = new Int32Array(gw * gh);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  for (let s = 0; s < grown.length; s++) {
    if (!grown[s] || label[s]) continue;
    const id = ++next;
    const stack = [s];
    label[s] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % gw;
      const y = (i / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (grown[n] && !label[n]) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = id;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (label[((y / cell) | 0) * gw + ((x / cell) | 0)] !== best) d[(y * w + x) * 4 + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Clone-stamp fill: where `other` has pixels but `canvas` is transparent, copies the nearest opaque
// colour of `canvas` into the gap (and makes it opaque) so the two sides of the mesh meet without a hole.
function stitchGaps(canvas, other) {
  const { width: w, height: h } = canvas;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const od = other.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const queue = [];
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (d[i * 4 + 3] > ALPHA_VISIBLE) {
      filled[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const x = i % w;
    const y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0) - (k === 1);
      const ny = y + (k === 2) - (k === 3);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (filled[n] || od[n * 4 + 3] <= ALPHA_VISIBLE) continue;
      filled[n] = 1;
      d[n * 4] = d[i * 4];
      d[n * 4 + 1] = d[i * 4 + 1];
      d[n * 4 + 2] = d[i * 4 + 2];
      d[n * 4 + 3] = 255;
      queue.push(n);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function floodCutout(canvas, tolerance) {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  const stack = [];
  const ref = [d[0], d[1], d[2]];
  const push = (x, y) => {
    const i = y * w + x;
    if (seen[i]) return;
    const p = i * 4;
    if (Math.hypot(d[p] - ref[0], d[p + 1] - ref[1], d[p + 2] - ref[2]) > tolerance) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    d[i * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  ctx.putImageData(img, 0, 0);
}

function alphaBounds(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > ALPHA_VISIBLE) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function sliceReferenceSheet(
  sourceImage,
  { bgTolerance = 40, layout = TEMPLATE_LAYOUT_BOXES, view = 'both' } = {},
) {
  const sw = sourceImage.naturalWidth || sourceImage.width;
  const sh = sourceImage.naturalHeight || sourceImage.height;

  const sheet = document.createElement('canvas');
  sheet.width = sw;
  sheet.height = sh;
  const sheetCtx = sheet.getContext('2d', { willReadFrequently: true });
  sheetCtx.drawImage(sourceImage, 0, 0);

  const px = sheetCtx.getImageData(0, 0, sw, sh).data;
  let hasAlpha = false;
  for (let i = 3; i < px.length; i += 4 * 97) {
    if (px[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  if (!hasAlpha) floodCutout(sheet, bgTolerance);

  const crop = (box, exclude) => {
    const c = document.createElement('canvas');
    const rw = Math.round(box.w * sw);
    const rh = Math.round(box.h * sh);
    c.width = rw;
    c.height = rh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sheet, Math.round(box.x * sw), Math.round(box.y * sh), rw, rh, 0, 0, rw, rh);
    if (exclude) {
      ctx.clearRect((exclude.x - box.x) * sw, (exclude.y - box.y) * sh, exclude.w * sw, exclude.h * sh);
    }
    return c;
  };

  const frontRoi = crop(layout.front);
  const backRoi = crop(layout.back, BACK_EXCLUDE);
  const faceRoi = crop(layout.face);
  keepMainComponent(faceRoi);
  const frontBox = alphaBounds(frontRoi);
  const backBox = alphaBounds(backRoi);
  const faceBox = alphaBounds(faceRoi);

  const needs = { both: [frontBox, backBox], front: [frontBox], back: [backBox], face: [faceBox] }[view];
  if (!needs || needs.some((b) => !b)) {
    throw new Error(
      view === 'both'
        ? 'Could not find the character silhouettes in the sheet.'
        : `Could not find the ${view} view in the sheet.`,
    );
  }

  const scaleF = frontBox ? FRAME_H / frontBox.h : 0;
  const scaleB = backBox ? FRAME_H / backBox.h : 0;
  // Draws `box` of `roi` centred horizontally, top-aligned, into a fw x fh canvas.
  const place = (roi, box, fw, fh, dw, dh) => {
    const c = document.createElement('canvas');
    c.width = fw;
    c.height = fh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(roi, box.x, box.y, box.w, box.h, (fw - dw) / 2, 0, dw, dh);
    return c;
  };

  // The full-body front frame (both views share one width) is always built: Tripo and its cache use it.
  const bothW = Math.ceil(Math.max(frontBox ? frontBox.w * scaleF : 0, backBox ? backBox.w * scaleB : 0)) + 8;
  const tripoCanvas = frontBox ? place(frontRoi, frontBox, bothW, FRAME_H, frontBox.w * scaleF, FRAME_H) : null;

  let frameW;
  let frameH = FRAME_H;
  let frontCanvas;
  let backCanvas;
  if (view === 'face') {
    // Bust mode: the close-up sits in the head region of an otherwise empty body frame,
    // so the same rig, landmark scan and morphs apply unchanged.
    frameH = FRAME_H * 2;
    frameW = frameH / 2;
    const dh = Math.round(frameH * HEAD_FRAC);
    frontCanvas = place(faceRoi, faceBox, frameW, frameH, (faceBox.w * dh) / faceBox.h, dh);
    backCanvas = frontCanvas;
  } else {
    const pick = (roi, box, scale) => place(roi, box, frameW, FRAME_H, box.w * scale, FRAME_H);
    if (view === 'both') {
      frameW = bothW;
      frontCanvas = tripoCanvas;
      backCanvas = pick(backRoi, backBox, scaleB);
    } else if (view === 'front') {
      frameW = Math.ceil(frontBox.w * scaleF) + 8;
      frontCanvas = pick(frontRoi, frontBox, scaleF);
      backCanvas = frontCanvas;
    } else {
      frameW = Math.ceil(backBox.w * scaleB) + 8;
      frontCanvas = pick(backRoi, backBox, scaleB);
      backCanvas = frontCanvas;
    }
  }

  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = frameW * 2;
  atlasCanvas.height = frameH;
  const atlasCtx = atlasCanvas.getContext('2d');
  const singleSide = view !== 'both';
  // Both sides share one silhouette, so fill each side's missing pixels from its own edge colours.
  atlasCtx.drawImage(singleSide ? frontCanvas : stitchGaps(frontCanvas, backCanvas), 0, 0);
  atlasCtx.drawImage(singleSide ? backCanvas : stitchGaps(backCanvas, frontCanvas), frameW, 0);

  const faceCanvas = faceRoi;
  const assets = extractAssets(crop(layout.assets));

  // Square head crop of the front view, used for the landmark scan.
  const headSize = Math.round(frameH * HEAD_FRAC);
  const headCanvas = document.createElement('canvas');
  headCanvas.width = 512;
  headCanvas.height = 512;
  const headCtx = headCanvas.getContext('2d');
  const top = frontCanvas.getContext('2d').getImageData(0, 0, frameW, headSize).data;
  let sum = 0;
  let count = 0;
  for (let y = 0; y < headSize; y++) {
    for (let x = 0; x < frameW; x++) {
      if (top[(y * frameW + x) * 4 + 3] > ALPHA_VISIBLE) {
        sum += x;
        count++;
      }
    }
  }
  const cx = count ? sum / count : frameW / 2;
  const headRect = { x: Math.max(0, Math.min(frameW - headSize, cx - headSize / 2)), y: 0, size: headSize };
  headCtx.fillStyle = '#ffffff';
  headCtx.fillRect(0, 0, 512, 512);
  headCtx.drawImage(frontCanvas, headRect.x, 0, headSize, headSize, 0, 0, 512, 512);

  return {
    frontCanvas, backCanvas, atlasCanvas, faceCanvas, headCanvas, headRect, tripoCanvas, assets, view, frameW, frameH,
  };
}

// Converts MediaPipe landmarks (0..1 in headCanvas) to frame UVs (v up).
export function headLandmarksToFrameUV(points, slices) {
  const { headRect, frameW, frameH } = slices;
  const map = (p) => ({
    u: (headRect.x + p.x * headRect.size) / frameW,
    v: 1 - (headRect.y + p.y * headRect.size) / frameH,
  });
  return { leftEye: map(points[33]), rightEye: map(points[263]), mouth: map(points[13]) };
}

// Chamfer distance transform of the mask, normalised to 0..1 over `reach` cells.
function insideDistance(mask, w, h, reach) {
  const INF = 1e6;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const S = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + 1);
      if (y > 0) {
        m = Math.min(m, d[i - w] + 1);
        if (x > 0) m = Math.min(m, d[i - w - 1] + S);
        if (x < w - 1) m = Math.min(m, d[i - w + 1] + S);
      }
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
      if (y < h - 1) {
        m = Math.min(m, d[i + w] + 1);
        if (x < w - 1) m = Math.min(m, d[i + w + 1] + S);
        if (x > 0) m = Math.min(m, d[i + w - 1] + S);
      }
      d[i] = m;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(1, d[i] / reach);
  return d;
}

function sampleAlpha(canvas, gridW, gridH) {
  const t = document.createElement('canvas');
  t.width = gridW;
  t.height = gridH;
  const ctx = t.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, gridW, gridH);
  const d = ctx.getImageData(0, 0, gridW, gridH).data;
  const a = new Uint8Array(gridW * gridH);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  return a;
}

function sampleGray(canvas, gridW, gridH) {
  const t = document.createElement('canvas');
  t.width = gridW;
  t.height = gridH;
  const ctx = t.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, gridW, gridH);
  const d = ctx.getImageData(0, 0, gridW, gridH).data;
  const g = new Float32Array(gridW * gridH);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] / 255;
  return g;
}

// Bone indices follow the order of buildVrmHumanoidRig().bonesList.
const B = {
  hips: 0, spine: 1, chest: 2, neck: 3, head: 4,
  lUpArm: 5, lLoArm: 6, lHand: 7, rUpArm: 8, rLoArm: 9, rHand: 10,
  lUpLeg: 11, lLoLeg: 12, lFoot: 13, rUpLeg: 14, rLoLeg: 15, rFoot: 16,
};

function boneWeights(u, v) {
  if (v > 0.86) return { idx: [B.head, 0, 0, 0], w: [1, 0, 0, 0] };
  if (v > 0.82) {
    const t = (v - 0.82) / 0.04;
    return { idx: [B.head, B.neck, 0, 0], w: [t, 1 - t, 0, 0] };
  }
  const armSide = u < 0.27 ? 'l' : u > 0.73 ? 'r' : null;
  if (v > 0.4 && armSide) {
    const up = armSide === 'l' ? B.lUpArm : B.rUpArm;
    const lo = armSide === 'l' ? B.lLoArm : B.rLoArm;
    const hand = armSide === 'l' ? B.lHand : B.rHand;
    if (v > 0.66) return { idx: [up, B.chest, 0, 0], w: [0.75, 0.25, 0, 0] };
    if (v > 0.5) return { idx: [lo, up, 0, 0], w: [0.7, 0.3, 0, 0] };
    return { idx: [hand, lo, 0, 0], w: [0.7, 0.3, 0, 0] };
  }
  if (v > 0.68) return { idx: [B.chest, B.spine, 0, 0], w: [0.8, 0.2, 0, 0] };
  if (v > 0.5) return { idx: [B.spine, B.hips, 0, 0], w: [0.6, 0.4, 0, 0] };
  const [up, lo, foot] = u < 0.5 ? [B.lUpLeg, B.lLoLeg, B.lFoot] : [B.rUpLeg, B.rLoLeg, B.rFoot];
  if (v > 0.4) return { idx: [B.hips, up, 0, 0], w: [0.6, 0.4, 0, 0] };
  if (v > 0.25) return { idx: [up, lo, 0, 0], w: [0.7, 0.3, 0, 0] };
  if (v > 0.08) return { idx: [lo, up, foot, 0], w: [0.7, 0.2, 0.1, 0] };
  return { idx: [foot, lo, 0, 0], w: [0.8, 0.2, 0, 0] };
}

// Hair bone indices start after the 17 humanoid bones: 17 + chain * 4 + joint.
// Vertices on the back of the head (and the front sides / fringe) follow the nearest hair chains.
function hairWeights(hair, x, y, front, lm, width) {
  const { topY, seg, xs } = hair;
  const s = (topY - y) / seg;
  if (s < 0 || s > 3) return null;
  const faceX = (lm.mouth.u - 0.5) * width;
  const eyeY = (lm.leftEye.v - 0.5) * 2;
  if (front && Math.abs(x - faceX) < 0.06 && y < eyeY + 0.03) return null;

  let k = 0;
  while (k < xs.length - 2 && x > xs[k + 1]) k++;
  const t = Math.min(1, Math.max(0, (x - xs[k]) / (xs[k + 1] - xs[k])));
  const j = Math.min(1, Math.floor(Math.min(s, 2)));
  const f = s >= 2 ? 1 : s - j;
  const a = 17 + k * 4;
  const b = 17 + (k + 1) * 4;
  if (s >= 2) return { idx: [a + 2, b + 2, 0, 0], w: [1 - t, t, 0, 0] };
  return {
    idx: [a + j, a + j + 1, b + j, b + j + 1],
    w: [(1 - t) * (1 - f), (1 - t) * f, t * (1 - f), t * f],
  };
}

export function buildVolumetricCharacterRig({
  frontCanvas,
  backCanvas,
  frameW,
  frameH,
  atlasTexture,
  bonesList,
  thickness = 0.22,
  depthMaps = null,
  depthStrength = 0.7,
  singleSide = false,
  hair = null,
  headLandmarks = {
    leftEye: { u: 0.47, v: 0.91 },
    rightEye: { u: 0.57, v: 0.91 },
    mouth: { u: 0.52, v: 0.885 },
  },
}) {
  const height = 2.0;
  const width = (height * frameW) / frameH;
  const rows = 256;
  const cols = Math.max(32, Math.round((rows * frameW) / frameH));
  const stride = cols + 1;

  const frontA = sampleAlpha(frontCanvas, stride, rows + 1);
  const backA = sampleAlpha(backCanvas, stride, rows + 1);
  const union = frontA.map((a, i) => (a || (!singleSide && backA[i]) ? 1 : 0));
  const sideCount = singleSide ? 1 : 2;
  const dist = insideDistance(union, stride, rows + 1, 10);

  const depthGrids = depthMaps
    ? [sampleGray(depthMaps.front, stride, rows + 1), sampleGray(depthMaps.back, stride, rows + 1)]
    : null;

  const fuvs = [];
  const positions = [];
  const uvs = [];
  const skinIndices = [];
  const skinWeights = [];
  const mouthMorph = [];
  const blinkLeftMorph = [];
  const blinkRightMorph = [];
  const smileMorph = [];
  const browUpMorph = [];
  const browDownMorph = [];
  const indices = [];

  // Features are tiny on a full-body frame, so falloff radii are in frame UV units.
  const eyeRx = 0.03;
  const eyeRy = 0.0075;
  const mouthRx = 0.04;
  const mouthRy = 0.01;

  const sideVerts = stride * (rows + 1);
  for (let side = 0; side < sideCount; side++) {
    const zSign = side === 0 ? 1 : -1;
    for (let r = 0; r <= rows; r++) {
      const v = 1 - r / rows;
      const y = (v - 0.5) * height;
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const x = (u - 0.5) * width;
        const t = dist[r * stride + c];
        const shape = Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
        // Depth modulates the inflated profile; edges stay at 0 so front and back meet.
        const relief = depthGrids ? 1 - depthStrength + depthStrength * (0.3 + 1.4 * depthGrids[side][r * stride + c]) : 1;
        const z = shape * relief * thickness * zSign;
        positions.push(x, y, z);

        uvs.push(side === 0 ? u * 0.5 : 0.5 + (1 - u) * 0.5, v);

        fuvs.push(u, v);
        let { idx, w } = boneWeights(u, v);
        if (hair) {
          const hw = hairWeights(hair, x, y, side === 0, headLandmarks, width);
          if (hw) ({ idx, w } = hw);
        }
        skinIndices.push(...idx);
        skinWeights.push(...w);

        let mY = y;
        let mZ = z;
        let lY = y;
        let rY = y;
        let sX = x;
        let sY = y;
        let bY = y;
        let bdY = y;
        if (side === 0 && v > 0.8) {
          const dM = Math.hypot((u - headLandmarks.mouth.u) / mouthRx, (v - headLandmarks.mouth.v) / mouthRy);
          if (dM < 1) {
            mY -= (1 - dM) * 0.035;
            mZ += (1 - dM) * 0.01;
          }
          const dL = Math.hypot((u - headLandmarks.leftEye.u) / eyeRx, (v - headLandmarks.leftEye.v) / eyeRy);
          if (dL < 1) lY -= (1 - dL) * 0.012;
          const dR = Math.hypot((u - headLandmarks.rightEye.u) / eyeRx, (v - headLandmarks.rightEye.v) / eyeRy);
          if (dR < 1) rY -= (1 - dR) * 0.012;

          // Smile lifts and widens the mouth corners; brows lift the area above each eye.
          const du = (u - headLandmarks.mouth.u) / mouthRx;
          const dS = Math.hypot(du / 1.5, (v - headLandmarks.mouth.v) / (mouthRy * 2));
          if (dS < 1) {
            sY += (1 - dS) * Math.min(1, Math.abs(du)) * 0.02;
            sX += (1 - dS) * Math.sign(du) * 0.008;
          }
          for (const eye of [headLandmarks.leftEye, headLandmarks.rightEye]) {
            const dB = Math.hypot((u - eye.u) / (eyeRx * 1.2), (v - (eye.v + eyeRy * 3)) / (eyeRy * 2.5));
            if (dB < 1) {
              bY += (1 - dB) * 0.02;
              bdY -= (1 - dB) * 0.016;
            }
          }
        }
        mouthMorph.push(x, mY, mZ);
        blinkLeftMorph.push(x, lY, z);
        blinkRightMorph.push(x, rY, z);
        smileMorph.push(sX, sY, z);
        browUpMorph.push(x, bY, z);
        browDownMorph.push(x, bdY, z);
      }
    }
  }

  for (let side = 0; side < sideCount; side++) {
    const off = side * sideVerts;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = off + r * stride + c;
        const i1 = i0 + 1;
        const i2 = i0 + stride;
        const i3 = i2 + 1;
        if (side === 0) indices.push(i0, i2, i1, i1, i2, i3);
        else indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('fuv', new THREE.Float32BufferAttribute(fuvs, 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.morphAttributes.position = [
    new THREE.Float32BufferAttribute(mouthMorph, 3),
    new THREE.Float32BufferAttribute(blinkLeftMorph, 3),
    new THREE.Float32BufferAttribute(blinkRightMorph, 3),
    new THREE.Float32BufferAttribute(smileMorph, 3),
    new THREE.Float32BufferAttribute(browUpMorph, 3),
    new THREE.Float32BufferAttribute(browDownMorph, 3),
  ];
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: atlasTexture,
    alphaTest: 0.5,
    roughness: 0.8,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const faceU = headLandmarks.mouth.u;
  const eyeV = (headLandmarks.leftEye.v + headLandmarks.rightEye.v) / 2;
  const outfit = {
    uHueShift: { value: 0 },
    uHideEars: { value: 0 },
    uHeadMinV: { value: 0.8 },
    uEarMinV: { value: eyeV + 0.04 },
    uFaceU: { value: faceU },
    uEarHalf: { value: 0.04 },
  };
  material.userData.outfit = outfit;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, outfit);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fuv;\nvarying vec2 vFuv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFuv = fuv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vFuv;
uniform float uHueShift, uHideEars, uHeadMinV, uEarMinV, uFaceU, uEarHalf;
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float eu = abs(vFuv.x - uFaceU);
if (uHideEars > 0.5 && ((vFuv.y > uEarMinV - 0.135 && eu > 0.12) || (vFuv.y > uEarMinV + 0.025 && eu > uEarHalf))) discard;
if (uHueShift != 0.0 && vFuv.y > uHeadMinV) {
  float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
  float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
  float sat = (mx - mn) / max(mx, 0.001);
  diffuseColor.rgb = mix(diffuseColor.rgb, hueRotate(diffuseColor.rgb, uHueShift), smoothstep(0.18, 0.4, sat));
}`,
      );
  };

  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = 'VTuberAvatarMesh';
  skinnedMesh.frustumCulled = false;
  skinnedMesh.morphTargetDictionary = { aa: 0, blinkLeft: 1, blinkRight: 2, smile: 3, browUp: 4, browDown: 5 };
  skinnedMesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0];

  const skeleton = new THREE.Skeleton(bonesList);
  skinnedMesh.add(bonesList[0]);
  skinnedMesh.bind(skeleton);
  return skinnedMesh;
}
