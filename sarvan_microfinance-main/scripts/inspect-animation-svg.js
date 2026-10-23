const fs = require('fs');
const path = require('path');

function inspectSvg() {
  const svgPath = path.resolve('public/images/sarvam-login-animation.svg');
  if (!fs.existsSync(svgPath)) {
    console.error('File not found:', svgPath);
    process.exit(1);
  }

  const content = fs.readFileSync(svgPath, 'utf8');

  const requiredGroups = [
    'green-person-1',
    'yellow-person-1',
    'green-person-2',
    'yellow-person-2',
    'green-person-3',
    'yellow-person-3',
    'center-icon'
  ];

  console.log('=== SVG File Info ===');
  console.log('Path:', svgPath);
  console.log('Size:', content.length, 'bytes');

  // Root attributes
  const svgTagMatch = content.match(/<svg([^>]+)>/);
  console.log('SVG tag attributes:', svgTagMatch ? svgTagMatch[1].trim() : 'none');

  // Check group IDs
  const foundGroups = [...content.matchAll(/<g\s+id="([^"]+)">/g)].map(m => m[1]);
  console.log('\n=== Group Verification ===');
  console.log('Found groups count:', foundGroups.length);
  console.log('Found groups list:', foundGroups);

  const missingGroups = requiredGroups.filter(g => !foundGroups.includes(g));
  console.log('Missing required groups:', missingGroups.length > 0 ? missingGroups : 'None (All present)');

  // Group Details
  console.log('\n=== Group Contents & Shapes ===');
  foundGroups.forEach(gid => {
    const regex = new RegExp('<g\\s+id="' + gid + '">([\\s\\S]*?)<\\/g>');
    const match = content.match(regex);
    if (match) {
      const inner = match[1];
      const paths = [...inner.matchAll(/<path([^>]+)>/g)];
      console.log(`\nGroup [${gid}]:`);
      console.log(`  - Number of path elements: ${paths.length}`);
      paths.forEach((p, idx) => {
        const fillMatch = p[1].match(/fill="([^"]+)"/);
        const transformMatch = p[1].match(/transform="([^"]+)"/);
        const dMatch = p[1].match(/d="([^"]+)"/);
        const subpaths = dMatch ? (dMatch[1].match(/M\s/g) || []).length : 0;
        console.log(`  - Path #${idx + 1}: fill=${fillMatch ? fillMatch[1] : 'none'}, transform=${transformMatch ? transformMatch[1] : 'none'}, sub-shapes (M commands): ${subpaths}`);
      });
    }
  });

  // Raster & Background checks
  console.log('\n=== Purity Verification ===');
  const hasImages = content.includes('<image') || content.includes('data:image');
  const hasRectBg = content.includes('<rect');
  const hasOuterRing = content.includes('ring');
  console.log('Contains raster/embedded images:', hasImages);
  console.log('Contains background rect:', hasRectBg);
  console.log('Contains outer ring element:', hasOuterRing);
}

inspectSvg();
