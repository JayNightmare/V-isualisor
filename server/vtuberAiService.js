// Optional bridge to the Tripo image-to-3D API. Requires TRIPO_API_KEY (Node 20.6+).
//
//   POST /api/reconstruct?rig=true      multipart "image" -> { jobId }
//   GET  /api/reconstruct/:jobId        -> { status, stage, progress, error?, warning? }
//   GET  /api/reconstruct/:jobId/model  -> the finished GLB
//
// Tripo model URLs expire after ~5 minutes, so the server downloads the GLB as
// soon as the job succeeds and serves it from memory.
import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";

const BASE = process.env.TRIPO_BASE_URL || "https://openapi.tripo3d.ai/v3";
const ENV_KEY = process.env.TRIPO_API_KEY;
const POLL_MS = 2000;
const MAX_POLLS = 300;

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });
app.use(cors());

const jobs = new Map();

// The server's .env key wins unless the client prefers its own override (or the server has none).
function keyFor(req) {
	const header = req.get("x-tripo-key");
	if (header && (!ENV_KEY || req.get("x-tripo-prefer") === "1")) return header;
	return ENV_KEY || null;
}

async function tripo(key, path, { json, form } = {}) {
	const KEY = key;
	const res = await fetch(`${BASE}${path}`, {
		method: json || form ? "POST" : "GET",
		headers: {
			Authorization: `Bearer ${KEY}`,
			...(json ? { "Content-Type": "application/json" } : {}),
		},
		body: json ? JSON.stringify(json) : form,
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.code !== 0) {
		throw new Error(
			`Tripo ${path} failed: ${body.message || body.msg || res.status}`,
		);
	}
	return body.data;
}

async function waitForTask(job, taskId, stage) {
	job.stage = stage;
	for (let i = 0; i < MAX_POLLS; i++) {
		const task = await tripo(job.key, `/tasks/${taskId}`);
		job.progress = task.progress ?? job.progress;
		if (task.status === "success") return task.output;
		if (["failed", "cancelled", "banned", "expired"].includes(task.status)) {
			throw new Error(`Tripo ${stage} task ended with status ${task.status}`);
		}
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
	throw new Error(`Tripo ${stage} task timed out`);
}

async function runJob(job, file, rig) {
	try {
		job.stage = "upload";
		const form = new FormData();
		form.append(
			"file",
			new Blob([file.buffer], { type: file.mimetype }),
			file.originalname || "image.png",
		);
		const { file_token } = await tripo(job.key, "/files", { form });

		const gen = await tripo(job.key, "/generation/image-to-model", {
			json: { input: file_token, model: "v3.1-20260211", pbr: false },
		});
		let output = await waitForTask(job, gen.task_id, "generate");

		if (rig) {
			const check = await tripo(job.key, "/animations/rig-check", {
				json: { input: gen.task_id },
			});
			const checked = await waitForTask(job, check.task_id, "rig-check");
			if (!checked.riggable || checked.rig_type !== "biped") {
				job.warning =
					"Model is not a riggable biped; returning the unrigged mesh.";
			} else {
				const rigTask = await tripo(job.key, "/animations/rig", {
					json: {
						input: gen.task_id,
						model: "v3.0-20260909",
						rig_type: "biped",
						spec: "vrm",
						out_format: "glb",
					},
				});
				output = await waitForTask(job, rigTask.task_id, "rig");
			}
		}

		job.stage = "download";
		const res = await fetch(output.model_url);
		if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
		job.glb = Buffer.from(await res.arrayBuffer());
		job.status = "success";
		job.progress = 100;
	} catch (err) {
		job.status = "failed";
		job.error = err.message;
	}
}

app.post("/api/reconstruct", upload.single("image"), (req, res) => {
	const key = keyFor(req);
	if (!key) {
		return res
			.status(401)
			.json({ error: "No Tripo API key set. Add one in Settings." });
	}
	if (!req.file) return res.status(400).json({ error: "image field required" });
	const jobId = randomUUID();
	const job = { status: "running", stage: "queued", progress: 0, key };
	jobs.set(jobId, job);
	runJob(job, req.file, req.query.rig === "true");
	res.status(202).json({ jobId });
});

app.get("/api/config", (req, res) => {
	res.json({ serverKey: Boolean(ENV_KEY) });
});

app.get("/api/balance", async (req, res) => {
	const key = keyFor(req);
	if (!key) return res.status(401).json({ error: "No Tripo API key set." });
	try {
		res.json(await tripo(key, "/account/balance"));
	} catch (err) {
		res.status(502).json({ error: err.message });
	}
});

app.get("/api/reconstruct/:id", (req, res) => {
	const job = jobs.get(req.params.id);
	if (!job) return res.status(404).json({ error: "unknown job" });
	const { status, stage, progress, error, warning } = job;
	res.json({ status, stage, progress, error, warning });
});

app.get("/api/reconstruct/:id/model", (req, res) => {
	const job = jobs.get(req.params.id);
	if (!job?.glb) return res.status(404).json({ error: "model not ready" });
	res.type("model/gltf-binary").send(job.glb);
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Tripo service on :${port}`));
