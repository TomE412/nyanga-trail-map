// Draws the app icon (a mountain with a location dot).
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'node:fs';
for (const size of [192, 512]) {
  const c = createCanvas(size, size), x = c.getContext('2d'), s = size / 100;
  x.fillStyle = '#1f4d3a'; x.fillRect(0, 0, size, size);
  x.fillStyle = '#e9e2cf';
  x.beginPath(); x.moveTo(8 * s, 80 * s); x.lineTo(38 * s, 30 * s); x.lineTo(52 * s, 50 * s); x.lineTo(64 * s, 36 * s); x.lineTo(92 * s, 80 * s); x.closePath(); x.fill();
  x.fillStyle = '#1e88e5'; x.strokeStyle = '#fff'; x.lineWidth = 4 * s;
  x.beginPath(); x.arc(50 * s, 66 * s, 9 * s, 0, Math.PI * 2); x.fill(); x.stroke();
  writeFileSync(`icon-${size}.png`, await c.encode('png'));
}
