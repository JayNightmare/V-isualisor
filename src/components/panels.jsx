import { TEMPLATE_LAYOUT_BOXES } from "../utils/templateSlicer";

export const TABS = [
	{ id: "source", label: "Source", icon: "M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4" },
	{ id: "avatar", label: "Avatar", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
	{ id: "animate", label: "Animate", icon: "M13 2L4 14h7l-1 8 9-12h-7z" },
	{ id: "assets", label: "Assets", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
	{ id: "ai", label: "AI", icon: "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" },
	{ id: "rig", label: "Rig", icon: "M12 4v6M12 10l-6 4M12 10l6 4M6 14v6M18 14v6" },
	{ id: "output", label: "Output", icon: "M12 3v12M7 10l5 5 5-5M4 21h16" },
];
const SETTINGS_TAB = {
	id: "settings",
	label: "Settings",
	icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-4-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 2 1 1 2h4l1-2 2-1 2 1 2-4-2-1z",
};

function Icon({ d }) {
	return (
		<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
			<path d={d} />
		</svg>
	);
}

export function Rail({ active, open, onSelect }) {
	const btn = (t) => (
		<button
			key={t.id}
			title={t.label}
			onClick={() => onSelect(t.id)}
			className={`w-11 h-11 rounded-lg flex items-center justify-center transition ${
				active === t.id && open
					? "bg-indigo-600 text-white"
					: "text-slate-400 hover:text-white hover:bg-slate-800"
			}`}
		>
			<Icon d={t.icon} />
		</button>
	);
	return (
		<nav className="w-14 shrink-0 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-2 gap-1">
			{TABS.map(btn)}
			<div className="mt-auto">{btn(SETTINGS_TAB)}</div>
		</nav>
	);
}

function Group({ title, children }) {
	return (
		<section className="border-b border-slate-800 pb-4 mb-4 last:border-0 last:mb-0">
			<h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">{title}</h3>
			<div className="flex flex-col gap-3 text-xs">{children}</div>
		</section>
	);
}

function Slider({ label, value, display, ...props }) {
	return (
		<div>
			<label className="text-slate-400 flex justify-between">
				<span>{label}</span>
				<span>{display ?? value}</span>
			</label>
			<input type="range" value={value} className="w-full accent-indigo-500 disabled:opacity-40" {...props} />
		</div>
	);
}

function Check({ label, ...props }) {
	return (
		<label className="flex items-center gap-2 text-slate-300">
			<input type="checkbox" {...props} />
			{label}
		</label>
	);
}

function Btn({ tone = "neutral", className = "", ...props }) {
	const tones = {
		neutral: "bg-slate-800 hover:bg-slate-700 text-slate-100",
		primary: "bg-indigo-600 hover:bg-indigo-500 text-white",
		danger: "bg-rose-600 hover:bg-rose-500 text-white",
		ai: "bg-fuchsia-700 hover:bg-fuchsia-600 text-white",
		ok: "bg-emerald-600 hover:bg-emerald-500 text-white",
	};
	return (
		<button
			{...props}
			className={`px-3 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40 ${tones[tone]} ${className}`}
		/>
	);
}

function FileBtn({ label, accept, onChange }) {
	return (
		<label className="px-3 py-2 rounded-lg text-xs font-medium text-center cursor-pointer bg-slate-800 hover:bg-slate-700">
			{label}
			<input type="file" accept={accept} className="hidden" onChange={onChange} />
		</label>
	);
}

const boxStyle = (b) => ({
	left: `${b.x * 100}%`,
	top: `${b.y * 100}%`,
	width: `${b.w * 100}%`,
	height: `${b.h * 100}%`,
});

const VIEW_OPTIONS = [
	["both", "Both"],
	["front", "Front"],
	["back", "Back"],
	["face", "Face only"],
];
const VIEW_HINTS = {
	both: "Front and back textures on a full-body model.",
	front: "Full body from the front view only; the back side mirrors it.",
	back: "Full body from the back view only; the front side mirrors it.",
	face: "Head bust built from the face close-up.",
};
const USED_BOXES = {
	both: ["front", "back"],
	front: ["front"],
	back: ["back"],
	face: ["face"],
};

function SourcePanel({ c }) {
	const used = USED_BOXES[c.sheetView];
	return (
		<>
			<Group title="Reference sheet">
				<FileBtn label="Upload sheet image" accept="image/*" onChange={c.handleSheetUpload} />
				{c.sheetPreview && (
					<div className="relative rounded-lg overflow-hidden border border-slate-700 bg-slate-950">
						<img src={c.sheetPreview} alt="Reference sheet" className="w-full aspect-square object-contain" />
						{[
							["front", "FRONT", "border-emerald-400 bg-emerald-500/10 text-emerald-300"],
							["back", "BACK", "border-sky-400 bg-sky-500/10 text-sky-300"],
							["face", "FACE", "border-amber-400 bg-amber-500/10 text-amber-300"],
							["assets", "ASSETS", "border-violet-400 bg-violet-500/10 text-violet-300"],
						].map(([k, name, cls]) => (
							<div
								key={k}
								className={`absolute border text-[9px] px-1 transition-opacity ${cls} ${
									k === "assets" || used.includes(k) ? "" : "opacity-25"
								}`}
								style={boxStyle(TEMPLATE_LAYOUT_BOXES[k])}
							>
								{name}
							</div>
						))}
					</div>
				)}
				<div className="grid grid-cols-4 gap-1">
					{VIEW_OPTIONS.map(([id, label]) => (
						<Btn key={id} tone={c.sheetView === id ? "primary" : "neutral"} className="px-1" onClick={() => c.selectSheetView(id)}>
							{label}
						</Btn>
					))}
				</div>
				<p className="text-slate-500">{VIEW_HINTS[c.sheetView]}</p>
			</Group>
			<Group title="Model">
				<div className="grid grid-cols-2 gap-2">
					<Btn onClick={() => c.showModel("procedural")} tone={c.viewMode === "procedural" ? "primary" : "neutral"}>
						Template
					</Btn>
					<Btn disabled={!c.hasModel} onClick={() => c.showModel("model")} tone={c.viewMode === "model" ? "primary" : "neutral"}>
						Loaded model
					</Btn>
				</div>
				<FileBtn label="Load .glb / .vrm model" accept=".glb,.vrm" onChange={c.handleModelUpload} />
				{c.hasModel && (
					<div className="flex items-center justify-between text-slate-400">
						<span className="truncate">{c.modelInfo?.label || "Model"}</span>
						<button className="underline" onClick={c.removeModel}>
							Remove
						</button>
					</div>
				)}
				<p className="text-slate-500">Tip: drag a sheet image or a model file onto the viewport.</p>
			</Group>
			<Group title="Project">
				<div className="grid grid-cols-2 gap-2">
					<Btn onClick={c.saveProject} disabled={!c.sheetPreview}>
						Save project
					</Btn>
					<FileBtn label="Load project" accept="application/json" onChange={c.loadProject} />
				</div>
			</Group>
		</>
	);
}

function AssetsPanel({ c }) {
	if (!c.assets.length) {
		return (
			<p className="text-xs text-slate-400">
				No props found. Put loose items (badges, gloves, jewellery) in the violet ASSETS area below the face on the sheet.
			</p>
		);
	}
	const downloadAll = () =>
		c.assets.forEach((a, i) => setTimeout(() => downloadAsset(a), i * 200));
	return (
		<Group title={`${c.assets.length} sliced from the sheet`}>
			<div className="grid grid-cols-2 gap-2">
				{c.assets.map((a) => (
					<div key={a.name} className="bg-slate-950 border border-slate-800 rounded-lg p-2 flex flex-col gap-1">
						<img src={a.url} alt={a.name} className="w-full h-20 object-contain" />
						<div className="flex justify-between text-[10px] text-slate-500">
							<span>{a.name}</span>
							<span>
								{a.width}×{a.height}
							</span>
						</div>
						<button className="text-[11px] underline text-slate-300 text-left" onClick={() => downloadAsset(a)}>
							Download PNG
						</button>
					</div>
				))}
			</div>
			<Btn onClick={downloadAll}>Download all</Btn>
		</Group>
	);
}

function downloadAsset(a) {
	const link = document.createElement("a");
	link.href = a.url;
	link.download = `${a.name.toLowerCase().replace(/\s+/g, "-")}.png`;
	link.click();
}

function AvatarPanel({ c }) {
	const off = c.viewMode !== "procedural";
	return (
		<>
			{off && <p className="text-amber-400 text-xs mb-3">These apply to the template model. Switch to it in Source.</p>}
			<Group title="Cutout & volume">
				<Slider label="Background tolerance" min="10" max="110" step="2" value={c.bgTolerance} onChange={(e) => c.setBgTolerance(parseInt(e.target.value, 10))} />
				<Slider label="Body thickness" min="0.08" max="0.45" step="0.02" value={c.bodyThickness} onChange={(e) => c.setBodyThickness(parseFloat(e.target.value))} />
			</Group>
			<Group title="Depth">
				<Check label={c.depthBusy ? "Estimating depth..." : "AI depth relief"} checked={c.aiDepth} disabled={c.depthBusy} onChange={(e) => c.setAiDepth(e.target.checked)} />
				{c.aiDepth && <Slider label="Strength" min="0" max="1" step="0.05" value={c.depthStrength} display={c.depthStrength.toFixed(2)} onChange={(e) => c.setDepthStrength(parseFloat(e.target.value))} />}
			</Group>
			<Group title="Outfit">
				<Slider label="Hair hue" min="-180" max="180" step="5" value={c.hairHue} display={`${c.hairHue}°`} onChange={(e) => c.setHairHue(parseFloat(e.target.value))} />
				<Check label="Hide hood" checked={c.hideEars} onChange={(e) => c.setHideEars(e.target.checked)} />
			</Group>
		</>
	);
}

function AnimatePanel({ c }) {
	return (
		<>
			<Group title="Expression">
				<div className="grid grid-cols-2 gap-2">
					{c.presetNames.map((name, i) => (
						<Btn key={name} tone={c.preset === name ? "primary" : "neutral"} className="capitalize" onClick={() => c.setPreset(name)}>
							{i + 1} {name}
						</Btn>
					))}
				</div>
			</Group>
			<Group title="Motion">
				<Check label="Idle animation" checked={c.idleEnabled} onChange={(e) => c.setIdleEnabled(e.target.checked)} />
				<Check label="Hair physics" checked={c.springOn} onChange={(e) => c.setSpringOn(e.target.checked)} />
			</Group>
			<Group title="Live input">
				<Btn tone={c.isTracking ? "danger" : "primary"} disabled={!c.sheetPreview || c.isModelLoading} onClick={c.toggleWebcamTracking}>
					{c.isModelLoading ? "Loading MediaPipe..." : c.isTracking ? "Stop webcam tracking" : "Start webcam tracking"}
				</Btn>
				<Btn tone={c.micOn ? "ok" : "neutral"} onClick={c.toggleMic}>
					{c.micOn ? "Mic lip-sync on" : "Mic lip-sync"}
				</Btn>
			</Group>
			<Group title="Manual test">
				<Slider label="Head yaw" min="-0.6" max="0.6" step="0.02" disabled={c.isTracking} value={c.headYaw} display={`${Math.round((c.headYaw * 180) / Math.PI)}°`} onChange={(e) => c.setHeadYaw(e.target.value)} />
				<Slider label="Mouth open" min="0" max="1" step="0.01" disabled={c.isTracking} value={c.mouthOpen} display={`${Math.round(c.mouthOpen * 100)}%`} onChange={(e) => c.setMouthOpen(e.target.value)} />
			</Group>
		</>
	);
}

function AiPanel({ c }) {
	const noKey = c.serverKey === false && !c.hasOverrideKey;
	return (
		<>
			<Group title="Tripo image-to-3D">
				<Btn tone="ai" onClick={c.generateWithTripo} disabled={!c.sheetPreview || c.isAiRunning || noKey}>
					{c.isAiRunning ? "Generating with Tripo..." : "Generate 3D with Tripo"}
				</Btn>
				<Check label="Auto-rig (biped, VRM spec)" checked={c.aiRig} onChange={(e) => c.setAiRig(e.target.checked)} />
				{noKey && (
					<p className="text-amber-400">
						No API key. Add one in{" "}
						<button className="underline" onClick={() => c.setActiveTab("settings")}>
							Settings
						</button>
						.
					</p>
				)}
				{c.serverKey === "offline" && <p className="text-amber-400">Bridge server not reachable (run it from server/).</p>}
			</Group>
			<Group title="Cache">
				<Btn disabled={!c.tripoCached} onClick={c.clearTripoCache}>
					Clear cached Tripo model
				</Btn>
			</Group>
		</>
	);
}

function RigPanel({ c }) {
	const info = c.modelInfo;
	if (!info) {
		return (
			<p className="text-xs text-slate-400">
				Load a .glb/.vrm (Source tab) or generate one with Tripo to see how it is rigged.
			</p>
		);
	}
	const stat = (k, v) => (
		<div key={k} className="flex justify-between">
			<span className="text-slate-500">{k}</span>
			<span className="text-slate-200">{v}</span>
		</div>
	);
	return (
		<>
			<Group title="Model">
				{stat("Format", info.format)}
				{stat("Meshes", `${info.meshes} (${info.skinned} skinned)`)}
				{stat("Vertices", info.vertices.toLocaleString())}
				{stat("Bones", info.bones)}
				{stat("Materials / textures", `${info.materials} / ${info.textures}`)}
				<Check label="Show skeleton overlay" checked={c.skeletonOn} onChange={(e) => c.setSkeletonOn(e.target.checked)} />
				<Btn onClick={c.exportMapping}>Export mapping JSON</Btn>
			</Group>
			<Group title="Humanoid bone mapping">
				{info.missing.length > 0 && <p className="text-amber-400">Missing: {info.missing.join(", ")}</p>}
				<table className="w-full text-[11px]">
					<thead className="text-slate-500 text-left">
						<tr>
							<th>VRM bone</th>
							<th>Source node</th>
							<th className="text-right">Height</th>
						</tr>
					</thead>
					<tbody>
						{info.mapping.map((r) => (
							<tr key={r.vrm} className="border-t border-slate-800">
								<td className="py-0.5 text-slate-200">{r.vrm}</td>
								<td className="text-slate-400 truncate max-w-[90px]" title={r.source}>
									{r.source}
								</td>
								<td className="text-right text-slate-400">{Math.round(r.y * 100)}%</td>
							</tr>
						))}
					</tbody>
				</table>
				{info.mapping.length === 0 && <p className="text-slate-500">No humanoid bones recognised.</p>}
			</Group>
			<Group title="Expression targets">
				{Object.entries(info.drivers).map(([k, n]) => stat(k, n ? `${n} morph${n > 1 ? "s" : ""}` : "none"))}
				{info.morphs.length > 0 && (
					<details className="text-slate-400">
						<summary className="cursor-pointer">All morph targets</summary>
						{info.morphs.map((m) => (
							<p key={m.mesh} className="mt-1 break-words">
								<b className="text-slate-300">{m.mesh}:</b> {m.targets.join(", ")}
							</p>
						))}
					</details>
				)}
			</Group>
		</>
	);
}

function OutputPanel({ c }) {
	return (
		<>
			<Group title="Display">
				<Check label="Transparent background" checked={c.transparentBg} onChange={(e) => c.setTransparentBg(e.target.checked)} />
				<Btn onClick={c.openPopout}>Open capture popout (OBS)</Btn>
			</Group>
			<Group title="Export">
				<Btn onClick={() => c.exportAvatar("glb")} disabled={!c.sheetPreview || c.isExporting}>
					Export .GLB
				</Btn>
				<Btn tone="ok" onClick={() => c.exportAvatar("vrm")} disabled={!c.sheetPreview || c.isExporting}>
					Export .VRM (1.0)
				</Btn>
			</Group>
		</>
	);
}

function SettingsPanel({ c }) {
	const status =
		c.serverKey === null
			? "Checking server..."
			: c.serverKey === "offline"
				? "Bridge server not reachable"
				: c.serverKey
					? "Server key configured (.env)"
					: "No server key configured";
	return (
		<Group title="Tripo API key">
			<p className="text-slate-400">{status}</p>
			<input
				type="password"
				autoComplete="off"
				placeholder={c.serverKey ? "Optional override key" : "Paste your Tripo API key"}
				value={c.keyInput}
				onChange={(e) => c.setKeyInput(e.target.value)}
				className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-xs"
			/>
			<div className="grid grid-cols-2 gap-2">
				<Btn tone="primary" onClick={c.saveKey}>
					Save
				</Btn>
				<Btn
					onClick={() => {
						c.clearKey();
					}}
					disabled={!c.hasOverrideKey}
				>
					Clear
				</Btn>
			</div>
			{c.serverKey === true && (
				<Check label="Prefer my key over the server key" checked={c.preferOverride} onChange={(e) => c.togglePrefer(e.target.checked)} />
			)}
			<Btn onClick={c.checkBalance} disabled={c.serverKey === "offline"}>
				Check balance
			</Btn>
			{c.balance && <p className="text-slate-300">{c.balance}</p>}
			<p className="text-slate-500">
				The key is stored in this browser's localStorage and only sent to your local bridge server. The server's own
				key is used unless it has none (or you prefer yours).
			</p>
		</Group>
	);
}

const PANELS = {
	source: SourcePanel,
	avatar: AvatarPanel,
	assets: AssetsPanel,
	animate: AnimatePanel,
	ai: AiPanel,
	rig: RigPanel,
	output: OutputPanel,
	settings: SettingsPanel,
};

export function TabPanel({ active, ctx }) {
	const Panel = PANELS[active];
	const title = [...TABS, SETTINGS_TAB].find((t) => t.id === active)?.label;
	return (
		<aside className="w-80 shrink-0 bg-slate-900 border-r border-slate-800 overflow-y-auto p-4">
			<h2 className="text-sm font-semibold text-white mb-3">{title}</h2>
			<Panel c={ctx} />
		</aside>
	);
}
