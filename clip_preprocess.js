/* Match OpenCLIP ViT-B-32 laion2b preprocess closely enough for retrieval.
   Resize the shorter edge with a Catmull-Rom bicubic kernel, then center-crop
   to 224 and normalize with the LAION / OpenAI mean and std. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClipPreprocess = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MEAN = [0.48145466, 0.4578275, 0.40821073];
  const STD = [0.26862954, 0.26130258, 0.27577711];
  const SIZE = 224;

  function cubic(x) {
    x = Math.abs(x);
    if (x < 1) return (1.5 * x - 2.5) * x * x + 1;
    if (x < 2) return ((-0.5 * x + 2.5) * x - 4) * x + 2;
    return 0;
  }

  function roundHalfEven(x) {
    const f = Math.floor(x);
    const frac = x - f;
    if (Math.abs(frac - 0.5) > 1e-10) return Math.round(x);
    return (f % 2 === 0) ? f : f + 1;
  }

  function targetSize(width, height) {
    const scale = SIZE / Math.min(width, height);
    return [roundHalfEven(width * scale), roundHalfEven(height * scale)];
  }

  function sample(src, width, height, x, y, c) {
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x >= width) x = width - 1;
    if (y >= height) y = height - 1;
    return src[(y * width + x) * 4 + c];
  }

  function axisWeights(inSize, outSize) {
    const scale = inSize / outSize;
    const filterscale = Math.max(1, scale);
    const support = 2 * filterscale;
    const weights = new Array(outSize);
    const bounds = new Array(outSize);
    for (let xx = 0; xx < outSize; xx++) {
      const center = (xx + 0.5) * scale;
      let xmin = Math.floor(center - support + 0.5);
      let xmax = Math.floor(center + support + 0.5);
      if (xmin < 0) xmin = 0;
      if (xmax > inSize) xmax = inSize;
      const row = [];
      let total = 0;
      for (let x = xmin; x < xmax; x++) {
        const w = cubic((x + 0.5 - center) / filterscale);
        row.push(w);
        total += w;
      }
      const inv = total ? 1 / total : 0;
      for (let i = 0; i < row.length; i++) row[i] *= inv;
      bounds[xx] = [xmin, xmax];
      weights[xx] = row;
    }
    return { bounds: bounds, weights: weights };
  }

  function resize(src, width, height, nw, nh) {
    const horiz = axisWeights(width, nw);
    const vert = axisWeights(height, nh);
    const tmp = new Float32Array(height * nw * 3);
    const dst = new Float32Array(nw * nh * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < nw; x++) {
        const xmin = horiz.bounds[x][0];
        const w = horiz.weights[x];
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let i = 0; i < w.length; i++) acc += w[i] * sample(src, width, height, xmin + i, y, c);
          tmp[(y * nw + x) * 3 + c] = acc;
        }
      }
    }
    for (let y = 0; y < nh; y++) {
      const ymin = vert.bounds[y][0];
      const w = vert.weights[y];
      for (let x = 0; x < nw; x++) {
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let i = 0; i < w.length; i++) {
            const yy = ymin + i;
            const clamped = yy < 0 ? 0 : (yy >= height ? height - 1 : yy);
            acc += w[i] * tmp[(clamped * nw + x) * 3 + c];
          }
          dst[(y * nw + x) * 3 + c] = acc;
        }
      }
    }
    return { data: dst, width: nw, height: nh };
  }

  function preprocessRGBA(src, width, height) {
    const [nw, nh] = targetSize(width, height);
    const resized = (nw === width && nh === height)
      ? { data: rgbFromRGBA(src, width, height), width: width, height: height }
      : resize(src, width, height, nw, nh);
    const left = Math.floor((resized.width - SIZE) / 2);
    const top = Math.floor((resized.height - SIZE) / 2);
    const out = new Float32Array(1 * 3 * SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const base = ((y + top) * resized.width + (x + left)) * 3;
        for (let c = 0; c < 3; c++) {
          const v = resized.data[base + c] / 255;
          out[c * SIZE * SIZE + y * SIZE + x] = (v - MEAN[c]) / STD[c];
        }
      }
    }
    return out;
  }

  function rgbFromRGBA(src, width, height) {
    const dst = new Float32Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      dst[i * 3] = src[i * 4];
      dst[i * 3 + 1] = src[i * 4 + 1];
      dst[i * 3 + 2] = src[i * 4 + 2];
    }
    return dst;
  }

  return {
    MEAN: MEAN,
    STD: STD,
    SIZE: SIZE,
    preprocessRGBA: preprocessRGBA,
    targetSize: targetSize,
  };
});
