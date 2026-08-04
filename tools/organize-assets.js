const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const root = process.cwd();
const assetsRoot = path.join(root, "assets");
const outputDirs = {
  image: path.join(assetsRoot, "images"),
  logo: path.join(assetsRoot, "logo"),
  hero: path.join(assetsRoot, "hero_images"),
  video: path.join(assetsRoot, "Video"),
};

for (const dir of Object.values(outputDirs)) fs.mkdirSync(dir, { recursive: true });

const manifestsRoot =
  "/var/folders/7r/np0pxpcj0kn7bp5gst7tx_m80000gn/T/browser-use/assets";
const manifests = fs
  .readdirSync(manifestsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(manifestsRoot, entry.name, "manifest.json"))
  .filter(fs.existsSync);

function cleanBase(name) {
  return decodeURIComponent(name.replace(/\+/g, " "))
    .replace(/\.(jpe?g|png|gif|webp)$/i, "")
    .replace(/-[a-f0-9]{8}$/i, "")
    .replace(/-\d+(?:w|h)$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function main() {
  const candidates = [];
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const asset of manifest.assets || []) {
      if (asset.kind !== "image" || asset.name === "i") continue;
      if (/transparent_background/i.test(asset.name)) continue;
      if (!fs.existsSync(asset.path)) continue;
      try {
        const metadata = await sharp(asset.path, { animated: true }).metadata();
        if (!metadata.width || !metadata.height) continue;
        candidates.push({
          ...asset,
          width: metadata.width,
          height: metadata.height,
          area: metadata.width * metadata.height,
          base: cleanBase(asset.name),
          alpha: Boolean(metadata.hasAlpha),
        });
      } catch {
        // Ignore non-content tracking pixels or malformed responses.
      }
    }
  }

  // Responsive variants share a normalized base name. Keep the largest source.
  const bestByBase = new Map();
  for (const candidate of candidates) {
    const current = bestByBase.get(candidate.base);
    if (!current || candidate.area > current.area) {
      bestByBase.set(candidate.base, candidate);
    }
  }

  const hashToOutput = new Map();
  const manifest = [];
  for (const candidate of [...bestByBase.values()].sort((a, b) =>
    a.base.localeCompare(b.base),
  )) {
    const isLogo = candidate.base.startsWith("hmv600200");
    const isHero =
      !isLogo &&
      candidate.width >= 1600 &&
      candidate.width / candidate.height >= 1.35;
    const category = isLogo ? "logo" : isHero ? "hero" : "image";
    const outputPath = path.join(outputDirs[category], `${candidate.base}.webp`);

    const pipeline = sharp(candidate.path, { animated: false }).rotate();
    if (candidate.width > 2400) {
      pipeline.resize({ width: 2400, withoutEnlargement: true });
    }
    pipeline.webp({
      quality: isLogo ? 94 : isHero ? 84 : 86,
      alphaQuality: 100,
      effort: 6,
      smartSubsample: true,
    });
    await pipeline.toFile(outputPath);

    const bytes = fs.readFileSync(outputPath);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    if (hashToOutput.has(hash)) {
      fs.unlinkSync(outputPath);
      continue;
    }
    hashToOutput.set(hash, outputPath);

    const optimized = await sharp(outputPath).metadata();
    manifest.push({
      file: path.relative(root, outputPath),
      category,
      width: optimized.width,
      height: optimized.height,
      bytes: bytes.length,
      source: candidate.url,
    });
  }

  fs.writeFileSync(
    path.join(assetsRoot, "asset-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const videoSources = `HMV Brokers video embeds

The live website embeds these videos from YouTube; it does not serve local video files.

https://www.youtube.com/watch?v=FBuc3gYyFK8
https://www.youtube.com/watch?v=53LBNbmXlGg
https://www.youtube.com/watch?v=4GpHuXKHf7g
https://www.youtube.com/watch?v=TOy6a2Mi4wM
https://www.youtube.com/watch?v=TgsiVhQwSXU
https://www.youtube.com/watch?v=4XRkiXwkaEk
`;
  fs.writeFileSync(path.join(outputDirs.video, "video-sources.txt"), videoSources);

  console.log(JSON.stringify({ files: manifest.length, manifest }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
