// Compose the supplied screenshots without regenerating or retouching their UI.
// Usage: node scripts/render-ios-review-figures.mjs <screenshot-directory> [playwright-module]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceDirectory = process.argv[2];
if (!sourceDirectory) throw new Error('Supply the directory containing the four original screenshots.');
const { chromium } = await import(process.argv[3] ? pathToFileURL(resolve(process.argv[3])).href : 'playwright');
const output = new URL('../public/images/blog/ios-app-review-new-assets/', import.meta.url);
await mkdir(output, { recursive: true });
const inputs = [
  ['wristful-thinking', 'Wristful Thinking', 'mainbrella-app-store-connect-ios-1.0.0.png', 'mainbrella-admin-app-store-connect-ios-1.0.0.png'],
  ['mainbrella', 'Mainbrella', 'mainbrella-distribution-analytics.png', 'mainbrella-distribution-analytics-testflight.png'],
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [slug, title, headerFile, searchFile] of inputs) {
    const header = `data:image/png;base64,${(await readFile(resolve(sourceDirectory, headerFile))).toString('base64')}`;
    const search = `data:image/png;base64,${(await readFile(resolve(sourceDirectory, searchFile))).toString('base64')}`;
    for (const mobile of [false, true]) {
      const data = await page.evaluate(async ({ title, header, search, mobile }) => {
        const load = async src => {
          const image = new Image();
          image.src = src;
          await image.decode();
          if (image.naturalWidth !== 3424 || image.naturalHeight !== 1836) throw new Error('Unexpected source screenshot dimensions.');
          return image;
        };
        const [headerImage, searchImage] = await Promise.all([load(header), load(search)]);
        const canvas = document.createElement('canvas');
        canvas.width = mobile ? 900 : 2400;
        canvas.height = mobile ? 1200 : 940;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#171a1b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#e9e6e1';
        ctx.font = `600 ${mobile ? 42 : 54}px Helvetica, Arial, sans-serif`;
        ctx.fillText(title, 40, mobile ? 62 : 76);
        ctx.imageSmoothingQuality = 'high';
        // Crop coordinates use a 2048px-wide reference view of the 3424px captures.
        // Retain the actual Header/Search Results selector and the entire artwork.
        const scale = 3424 / 2048;
        const draw = (image, width, x, y, destinationWidth) => {
          ctx.drawImage(image, 508 * scale, 525 * scale, width * scale, 397 * scale,
            x, y, destinationWidth, destinationWidth * 397 / width);
        };
        if (mobile) {
          draw(headerImage, 700, 40, 100, 820);
          draw(searchImage, 450, 40, 605, 650);
        } else {
          ctx.fillStyle = '#b1b8bf';
          ctx.font = '32px Helvetica, Arial, sans-serif';
          ctx.fillText('Header · 3840 × 1646', 40, 130);
          ctx.fillText('Search results · 1920 × 1280', 1485, 130);
          draw(headerImage, 700, 40, 160, 1360);
          draw(searchImage, 450, 1485, 160, 875);
        }
        return canvas.toDataURL('image/png').split(',')[1];
      }, { title, header, search, mobile });
      const filename = `${slug}-placements${mobile ? '-mobile' : ''}.png`;
      await writeFile(new URL(filename, output), Buffer.from(data, 'base64'));
      console.log(filename);
    }
  }
} finally {
  await browser.close();
}
