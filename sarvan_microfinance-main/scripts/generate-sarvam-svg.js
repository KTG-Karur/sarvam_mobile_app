const sharp = require('sharp');
const potrace = require('potrace');
const fs = require('fs');
const path = require('path');

async function generateSvg() {
  const imgPath = path.resolve('public/Sarvam_icon.png');
  const { data, info } = await sharp(imgPath).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;

  const visited = new Uint8Array(w * h);
  const components = [];

  function getPixel(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    const idx = (y * w + x) * 4;
    return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: data[idx + 3] };
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx]) continue;
      const p = getPixel(x, y);
      if (p.a < 50) {
        visited[idx] = 1;
        continue;
      }
      const isGreen = p.g > 80 && p.r < 50;
      const isYellow = p.r > 150 && p.g > 100 && p.b < 50;
      const type = isGreen ? 'green' : (isYellow ? 'yellow' : 'other');
      if (type === 'other') {
        visited[idx] = 1;
        continue;
      }

      const q = [x, y];
      visited[idx] = 1;
      let minX = x, maxX = x, minY = y, maxY = y;
      const pixels = [[x, y]];
      let head = 0;
      while (head < q.length) {
        const cx = q[head++];
        const cy = q[head++];
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1]
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nidx = ny * w + nx;
            if (!visited[nidx]) {
              const np = getPixel(nx, ny);
              if (np.a >= 50) {
                const nIsGreen = np.g > 80 && np.r < 50;
                const nIsYellow = np.r > 150 && np.g > 100 && np.b < 50;
                const nType = nIsGreen ? 'green' : (nIsYellow ? 'yellow' : 'other');
                if (nType === type) {
                  visited[nidx] = 1;
                  q.push(nx, ny);
                  pixels.push([nx, ny]);
                }
              }
            }
          }
        }
      }
      if (pixels.length > 200) {
        components.push({
          index: components.length,
          type,
          count: pixels.length,
          minX, maxX, minY, maxY,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          pixels
        });
      }
    }
  }

  console.log('Found components count:', components.length);

  async function traceMask(pixels) {
    // 2x upscaling for ultra-crisp curve resolution
    const scale = 2;
    const sw = w * scale, sh = h * scale;
    const maskBuffer = Buffer.alloc(sw * sh * 4, 0);
    for (const [x, y] of pixels) {
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = ((y * scale + dy) * sw + (x * scale + dx)) * 4;
          maskBuffer[idx] = 0;
          maskBuffer[idx + 1] = 0;
          maskBuffer[idx + 2] = 0;
          maskBuffer[idx + 3] = 255;
        }
      }
    }
    const pngBuf = await sharp(maskBuffer, { raw: { width: sw, height: sh, channels: 4 } }).png().toBuffer();
    return new Promise((resolve, reject) => {
      potrace.trace(pngBuf, {
        turdSize: 2,
        optTolerance: 0.1,
        optCurve: true,
        threshold: 128
      }, (err, svg) => {
        if (err) reject(err);
        else resolve(svg);
      });
    });
  }

  // Exact component index map from connected component analysis:
  // Component 0: Green Body (top)
  // Component 1: Yellow Head (top-right)
  // Component 2: Green Head (top)
  // Component 3: Yellow Body (top-right)
  // Component 4: Yellow Body (left)
  // Component 5: Green Body (right)
  // Component 6: Yellow Arrow (center)
  // Component 7: Green Graph (center)
  // Component 8: Green Head (right)
  // Component 9: Yellow Head (left)
  // Component 10: Green Body (bottom-left)
  // Component 11: Yellow Body (bottom-right)
  // Component 12: Yellow Head (bottom-right)
  // Component 13: Green Head (bottom-left)

  const groupDefs = [
    {
      id: 'green-person-1',
      description: 'Top-left Green Person',
      color: '#037F35',
      components: [0, 2] // Body 0 + Head 2
    },
    {
      id: 'yellow-person-1',
      description: 'Top-right Yellow Person',
      color: '#FEBA02',
      components: [3, 1] // Body 3 + Head 1
    },
    {
      id: 'green-person-2',
      description: 'Right Green Person',
      color: '#037F35',
      components: [5, 8] // Body 5 + Head 8
    },
    {
      id: 'yellow-person-2',
      description: 'Bottom-right Yellow Person',
      color: '#FEBA02',
      components: [11, 12] // Body 11 + Head 12
    },
    {
      id: 'green-person-3',
      description: 'Bottom-left Green Person',
      color: '#037F35',
      components: [10, 13] // Body 10 + Head 13
    },
    {
      id: 'yellow-person-3',
      description: 'Left Yellow Person',
      color: '#FEBA02',
      components: [4, 9] // Body 4 + Head 9
    },
    {
      id: 'center-icon',
      description: 'Center Growth Graph and Arrow',
      multi: [
        { color: '#037F35', components: [7] }, // Green Graph base
        { color: '#FEBA02', components: [6] }  // Yellow Arrow
      ]
    }
  ];

  let svgElements = [];
  for (const g of groupDefs) {
    if (g.multi) {
      let paths = [];
      for (const m of g.multi) {
        const pix = [];
        for (const cIdx of m.components) pix.push(...components[cIdx].pixels);
        const svg = await traceMask(pix);
        const match = svg.match(/<path\s+d="([^"]+)"/);
        if (match) {
          paths.push(`<path d="${match[1]}" fill="${m.color}" transform="scale(0.5)" />`);
        }
      }
      svgElements.push(`  <g id="${g.id}">\n    ${paths.join('\n    ')}\n  </g>`);
    } else {
      const pix = [];
      for (const cIdx of g.components) pix.push(...components[cIdx].pixels);
      const svg = await traceMask(pix);
      const match = svg.match(/<path\s+d="([^"]+)"/);
      if (match) {
        svgElements.push(`  <g id="${g.id}">\n    <path d="${match[1]}" fill="${g.color}" transform="scale(0.5)" />\n  </g>`);
      }
    }
  }

  const finalSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" fill="none">
  <!-- Sarvam Microfinance Logo - Vector Components for Login Animation -->
  <!-- 6 Human Figures (3 Green, 3 Yellow) + Center Growth Icon (No Outer Ring) -->
${svgElements.join('\n')}
</svg>
`;

  fs.mkdirSync('public/images', { recursive: true });
  const outputPath = path.resolve('public/images/sarvam-login-animation.svg');
  fs.writeFileSync(outputPath, finalSvg);
  console.log('Saved SVG to:', outputPath);

  // Render to PNG and compare visual fidelity
  const renderedBuffer = await sharp(Buffer.from(finalSvg)).png().toBuffer();
  fs.writeFileSync('scratch_rendered.png', renderedBuffer);
  console.log('Rendered SVG to PNG (scratch_rendered.png) successfully.');
}

generateSvg().catch(console.error);
