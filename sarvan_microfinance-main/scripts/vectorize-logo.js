const sharp = require('sharp');
const potrace = require('potrace');
const fs = require('fs');

async function tracePieces() {
  const { data, info } = await sharp('public/Sarvam_icon.png').raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  
  const visited = new Uint8Array(w * h);
  const components = [];
  
  function getPixel(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return null;
    const idx = (y * w + x) * 4;
    return { r: data[idx], g: data[idx+1], b: data[idx+2], a: data[idx+3] };
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

        const neighbors = [[cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]];
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
      if (pixels.length > 500) {
        components.push({ type, count: pixels.length, minX, maxX, minY, maxY, cx: (minX+maxX)/2, cy: (minY+maxY)/2, pixels });
      }
    }
  }

  console.log('Found components count:', components.length);

  async function traceMask(pixels) {
    const maskBuffer = Buffer.alloc(w * h * 4, 0);
    for (const [x, y] of pixels) {
      const idx = (y * w + x) * 4;
      maskBuffer[idx] = 0;
      maskBuffer[idx+1] = 0;
      maskBuffer[idx+2] = 0;
      maskBuffer[idx+3] = 255;
    }
    const pngBuf = await sharp(maskBuffer, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    return new Promise((resolve, reject) => {
      potrace.trace(pngBuf, {
        turdSize: 1,
        optTolerance: 0.2,
        optCurve: true,
        threshold: 128
      }, (err, svg) => {
        if (err) reject(err);
        else resolve(svg);
      });
    });
  }

  const groups = [
    { id: 'green-person-1', label: 'Top Green Figure', color: '#037F35', components: [0, 2] },
    { id: 'yellow-person-1', label: 'Top-Right Yellow Figure', color: '#FEBA02', components: [3, 1] },
    { id: 'green-person-2', label: 'Right Green Figure', color: '#037F35', components: [5, 8] },
    { id: 'yellow-person-2', label: 'Bottom-Right Yellow Figure', color: '#FEBA02', components: [11, 12] },
    { id: 'green-person-3', label: 'Bottom-Left Green Figure', color: '#037F35', components: [10, 13] },
    { id: 'yellow-person-3', label: 'Left Yellow Figure', color: '#FEBA02', components: [4, 9] },
    { id: 'center-graph-green', label: 'Center Green Graph', color: '#037F35', components: [7] },
    { id: 'center-arrow-yellow', label: 'Center Yellow Arrow', color: '#FEBA02', components: [6] }
  ];

  let svgElements = [];
  for (const g of groups) {
    const allPixels = [];
    for (const cIdx of g.components) {
      allPixels.push(...components[cIdx].pixels);
    }
    const svg = await traceMask(allPixels);
    const match = svg.match(/<path\s+d="([^"]+)"/);
    if (match) {
      svgElements.push({ id: g.id, label: g.label, color: g.color, d: match[1] });
    }
  }

  console.log('Successfully vectorized', svgElements.length, 'groups');

  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%" fill="none">
  <!-- Sarvam Microfinance Animated Logo -->
  <!-- 6 Human Figures (3 Green, 3 Yellow) + Center Growth Arrow & Graph -->
${svgElements.map(e => `  <g id="${e.id}">
    <path d="${e.d}" fill="${e.color}" />
  </g>`).join('\n')}
</svg>`;

  fs.mkdirSync('public/images', { recursive: true });
  fs.writeFileSync('public/images/sarvam-login-animation.svg', svgContent);
  console.log('Written to public/images/sarvam-login-animation.svg');
}

tracePieces().catch(console.error);
