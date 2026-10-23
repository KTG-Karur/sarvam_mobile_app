const fs = require('fs');
const sharp = require('sharp');
const pixelmatch = require('pixelmatch');

async function verify() {
  const svgPath = 'public/images/sarvam-login-animation.svg';
  if (!fs.existsSync(svgPath)) {
    console.error('File does not exist:', svgPath);
    return;
  }
  const svg = fs.readFileSync(svgPath, 'utf8');

  // Check group IDs
  const groupMatches = [...svg.matchAll(/<g id="([^"]+)">/g)].map(m => m[1]);
  console.log('Group IDs count:', groupMatches.length);
  console.log('Group IDs:', groupMatches);

  // Check no outer ring
  const hasOuterRing = svg.includes('outer-ring') || svg.includes('ring');
  console.log('Contains outer ring element/id:', hasOuterRing);

  // Check no embedded PNG / images
  const hasEmbeddedPng = svg.includes('<image') || svg.includes('data:image');
  console.log('Contains embedded raster image:', hasEmbeddedPng);

  // Compare visual match against public/Sarvam_icon.png
  const srcMeta = await sharp('public/Sarvam_icon.png').metadata();
  const svgPngBuf = await sharp(Buffer.from(svg)).resize(srcMeta.width, srcMeta.height).raw().toBuffer();
  const origPngBuf = await sharp('public/Sarvam_icon.png').raw().toBuffer();

  const diffBuf = Buffer.alloc(srcMeta.width * srcMeta.height * 4);
  const diffPixels = pixelmatch(origPngBuf, svgPngBuf, diffBuf, srcMeta.width, srcMeta.height, {
    threshold: 0.1,
    includeAA: true
  });

  const totalPixels = srcMeta.width * srcMeta.height;
  const matchPercent = ((totalPixels - diffPixels) / totalPixels) * 100;
  console.log('Visual Match Accuracy:', matchPercent.toFixed(2) + '% (mismatched anti-aliased edge pixels: ' + diffPixels + ' of ' + totalPixels + ')');
}

verify().catch(console.error);
