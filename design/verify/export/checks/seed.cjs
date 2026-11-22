// Seeds the kitchen-sink notes (and real attachments) into the open demo DB, from inside the page via the dev server's modules.
module.exports = async function seed(p) {
  return p.evaluate(async () => {
    const fx = await import("/scripts/fixtures/kitchen-sink.ts");
    const act = await import("/src/lib/actions.ts");
    const att = await import("/src/lib/attachments.ts");
    const png = async (w, h, photo) => {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d");
      if (!photo) { g.fillStyle = "#c0392b"; g.fillRect(0, 0, w, h); return new Promise((r) => cv.toBlob(r, "image/png")); }
      const lg = g.createLinearGradient(0, 0, w, h); lg.addColorStop(0, "#1b6ca8"); lg.addColorStop(0.5, "#f4d35e"); lg.addColorStop(1, "#c0392b"); g.fillStyle = lg; g.fillRect(0, 0, w, h);
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${(rnd() * 255) | 0},${(rnd() * 255) | 0},${(rnd() * 255) | 0},0.12)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 20 + rnd() * 160, 0, 6.3); g.fill(); }
      const im = g.getImageData(0, 0, w, h); for (let i = 0; i < im.data.length; i += 4) { const n = (rnd() * 14 - 7) | 0; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; } g.putImageData(im, 0, 0);
      return new Promise((r) => cv.toBlob(r, "image/png"));
    };
    const red = await att.storeBlob(await png(120, 80, false), "red.png", { shrink: false });
    const huge = await att.storeBlob(await png(4200, 3000, true), "huge.png", { shrink: false });
    const [ks, inc] = fx.kitchenSink();
    const body = ks.body.replace("att:img-red", "att:" + red.id).replace("![Missing attachment]", `![Huge photo](att:${huge.id})\n\n![Missing attachment]`);
    const incN = await act.createNote({ title: inc.title, body: inc.body, spaceId: "inbox" });
    const ksN = await act.createNote({ title: ks.title, body, spaceId: "inbox" });
    return { ks: ksN.id, inc: incN.id, hugeBytes: huge.blob.size };
  });
};
