// Optional monocular depth estimation (Depth Anything, runs in-browser via transformers.js).

let pipePromise = null;

function getPipeline(onStatus) {
  if (!pipePromise) {
    onStatus?.("Downloading depth model (first run only)...");
    pipePromise = import("@huggingface/transformers")
      .then(({ pipeline }) => pipeline("depth-estimation", "Xenova/depth-anything-small-hf"))
      .catch((err) => {
        pipePromise = null;
        throw err;
      });
  }
  return pipePromise;
}

// Returns a frame-sized grayscale canvas: 1 = nearest to the viewer, 0 = farthest, within the silhouette.
export async function estimateDepthCanvas(viewCanvas, onStatus) {
  const pipe = await getPipeline(onStatus);
  const { width: w, height: h } = viewCanvas;

  const input = document.createElement("canvas");
  input.width = w;
  input.height = h;
  const ictx = input.getContext("2d");
  ictx.fillStyle = "#808080";
  ictx.fillRect(0, 0, w, h);
  ictx.drawImage(viewCanvas, 0, 0);
  const blob = await new Promise((r) => input.toBlob(r, "image/png"));
  const url = URL.createObjectURL(blob);

  onStatus?.("Estimating depth...");
  let out;
  try {
    out = await pipe(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const src = document.createElement("canvas");
  src.width = out.depth.width;
  src.height = out.depth.height;
  const sctx = src.getContext("2d");
  const sdata = sctx.createImageData(src.width, src.height);
  const channels = out.depth.channels || 1;
  for (let i = 0; i < src.width * src.height; i++) {
    const v = out.depth.data[i * channels];
    sdata.data.set([v, v, v, 255], i * 4);
  }
  sctx.putImageData(sdata, 0, 0);

  const dst = document.createElement("canvas");
  dst.width = w;
  dst.height = h;
  const dctx = dst.getContext("2d", { willReadFrequently: true });
  dctx.drawImage(src, 0, 0, w, h);
  const depth = dctx.getImageData(0, 0, w, h);
  const alpha = viewCanvas.getContext("2d").getImageData(0, 0, w, h).data;

  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (alpha[i * 4 + 3] > 100) {
      hist[depth.data[i * 4]]++;
      count++;
    }
  }
  const percentile = (p) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= count * p) return v;
    }
    return 255;
  };
  const lo = percentile(0.02);
  const hi = Math.max(lo + 1, percentile(0.98));
  for (let i = 0; i < w * h; i++) {
    const n = Math.min(1, Math.max(0, (depth.data[i * 4] - lo) / (hi - lo)));
    const g = Math.round(n * 255);
    depth.data.set([g, g, g, 255], i * 4);
  }
  dctx.putImageData(depth, 0, 0);
  return dst;
}
