/**
 * generate-favicon.js
 * Run: node generate-favicon.js
 * Creates a sharp, circular favicon.png at 256x256 using jimp v1
 */

const { Jimp } = require('jimp');
const path = require('path');

const INPUT  = path.join(__dirname, 'Main_logo_transparent_img_screen7.png');
const OUTPUT = path.join(__dirname, 'favicon.png');
const SIZE   = 256; // high res for crisp favicon rendering

async function buildCircularFavicon() {
  console.log('Loading logo...');
  const img = await Jimp.read(INPUT);

  // Resize/crop to a perfect square at target size
  img.resize({ w: SIZE, h: SIZE });

  // Apply circular mask — make pixels outside the circle transparent
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r  = SIZE / 2;

  img.scan(function(x, y, idx) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > r * r) {
      // Outside circle → fully transparent alpha
      this.bitmap.data[idx + 3] = 0;
    }
  });

  await img.write(OUTPUT);
  console.log(`✅ favicon.png created at ${SIZE}x${SIZE}px with circular mask`);
  console.log(`   Output → ${OUTPUT}`);
}

buildCircularFavicon().catch(err => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});


