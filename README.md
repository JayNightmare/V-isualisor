# V-isualisor

Browser studio that turns a Front / Back / Face character reference sheet into a rigged 3D VTuber avatar, drives it with webcam tracking (MediaPipe) and exports `.glb` / `.vrm` (VRMC_vrm 1.0 + VRMC_springBone).

## Setup

```bash
npm install
npm run dev        # http://localhost:5173
```

A sample sheet is auto-loaded from `public/images/`. Upload your own from the UI.

## Optional: Tripo AI image-to-3D

1. Provide a key: either `TRIPO_API_KEY=...` in `.env` (git-ignored), or paste one in the app's **Settings** tab. The `.env` key is used unless it is missing or "Prefer my key" is ticked; the browser key is stored in localStorage and only sent to the local server.
2. `cd server && npm install && npm start` (port 3001; Vite proxies `/api`).
3. Use "Generate 3D with Tripo" in the **AI** tab. Results are cached in IndexedDB per sheet.

Generation and auto-rig cost Tripo credits (Settings → Check balance).

## UI

A Photoshop-style tab rail (click the active tab to collapse): **Source** (sheet, template vs loaded model, project), **Avatar**, **Animate**, **Assets**, **AI**, **Rig**, **Output**, and **Settings**.

**Sheet view** (Source tab): build from **Both**, **Front**, **Back**, or **Face only** (a head bust with the camera framed on it). Switching view re-slices the sheet; Front/Back/Face only build a single-sided shell (no mirrored second side), while Both stitches the two sides: gaps where only one side has pixels are clone-filled from that side's nearest edge colours. Face only masks out neighbouring-figure bleed (keeps the main connected blob). The Tripo upload and cache always use the full front view.

**Assets** tab: the area below the face on the sheet (badge, glove, cross) is reserved for props. They are sliced into separate transparent PNGs, downloadable individually or all at once. The region is shown as a violet box on the sheet preview.

Load your own `.glb`/`.vrm` (Source tab, or drag onto the viewport). The **Rig** tab shows its format, counts, how each VRM humanoid bone maps to the source nodes (with a skeleton overlay and JSON export), and which morph targets drive each expression.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm test` | Vitest unit tests |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run build` | Production build |

## Layout

- `src/components/VtuberGeneratorApp.jsx` – UI, scene, tracking loop
- `src/utils/templateSlicer.js` – sheet slicing, mesh and morph synthesis
- `src/utils/vrmExporterPlugin.js` – rig and VRM exporter plugin
- `src/utils/storage.js` – IndexedDB helpers
- `src/utils/depthEstimator.js` – optional in-browser AI depth (Depth Anything, downloaded on first use)
- `src/utils/springSim.js` – hair spring-bone preview (same parameters as the exported VRMC_springBone)
- `src/utils/boneMapper.js` – maps Tripo/Mixamo/VRM skeleton names to VRM humanoid bones
- `server/` – Tripo bridge
