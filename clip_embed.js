/* Run the exported OpenCLIP image tower. The graph already L2-normalizes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ClipEmbed = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const pre = typeof require === "function" ? require("./clip_preprocess.js") : root.ClipPreprocess;

  async function embedRGBA(ort, session, rgba, width, height) {
    const input = pre.preprocessRGBA(rgba, width, height);
    const tensor = new ort.Tensor("float32", input, [1, 3, pre.SIZE, pre.SIZE]);
    const output = await session.run({ pixel_values: tensor });
    const embedding = output.embedding || output[Object.keys(output)[0]];
    return embedding.data;
  }

  return { embedRGBA: embedRGBA };
});
