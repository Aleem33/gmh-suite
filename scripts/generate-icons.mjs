/**
 * Generate app icons from src/assets/logo.png
 */
import { mkdir, copyFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import toIco from 'to-ico';

const SOURCE = 'src/assets/logo.png';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const pngBuffers = await Promise.all(
  SIZES.map((size) => sharp(SOURCE).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
);

writeFileSync('icon.ico', await toIco(pngBuffers));
await sharp(SOURCE).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('icon.png');

await mkdir('build', { recursive: true });
await mkdir('assets', { recursive: true });
await copyFile('icon.png', 'build/icon.png');
await copyFile('icon.png', 'assets/icon.png');
await copyFile('src/assets/logo.png', 'public/logo.png');

const ANDROID_MIPMAPS = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

if (existsSync('android/app/src/main/res')) {
  for (const [folder, size] of ANDROID_MIPMAPS) {
    const outputDir = `android/app/src/main/res/${folder}`;
    await mkdir(outputDir, { recursive: true });
    const icon = await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 15, g: 37, b: 68, alpha: 1 } })
      .png()
      .toBuffer();
    await sharp(icon).toFile(`${outputDir}/ic_launcher.png`);
    await sharp(icon).toFile(`${outputDir}/ic_launcher_round.png`);
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(`${outputDir}/ic_launcher_foreground.png`);
  }
}

console.log('Generated desktop, web, and Android icons');
