// @ts-nocheck
/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
/* eslint-disable unicorn/prefer-number-properties */
/* eslint-disable unicorn/prefer-dom-node-text-content */
/* eslint-disable no-undef */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line import/no-extraneous-dependencies
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, 'spectra_data');
await fs.mkdir(outputDir, { recursive: true });

const spectrumIds = [1599831, 1599965, 1234807, 1234807, 1231524];

/**
 * @param {number} id - of the spectrum to scrape
 */
async function scrapeSpectrum(id) {
  const url = `https://chemdata.nist.gov/glycan/spectra/${id}`;
  const folder = path.join(outputDir, `spectra_${id}`);
  await fs.mkdir(folder, { recursive: true });

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });

  const result = await page.evaluate(() => {
    const titleBlock =
      // @ts-ignore
      document.querySelector('.spectrum-detail__title-section__name h3')
        ?.innerText || '';

    const name =
      // @ts-ignore
      [...document.querySelectorAll('dt')].find((dt) => dt.innerText === 'Name')
        ?.nextElementSibling?.innerText || '';

    const synonyms = [...document.querySelectorAll('dt')]
      .find((dt) => dt.innerText.toLowerCase().includes('synonym'))
      ?.nextElementSibling?.querySelectorAll('li');
    const synList = synonyms
      ? Array.from(synonyms).map((li) => li.innerText)
      : [];

    const peaks = Array.from(
      document.querySelectorAll(
        '.spectrum-detail__tabs-content__tab--peak-list .row',
      ),
    )
      .map((row) => {
        const cols = row.querySelectorAll('.small-4.columns');
        if (cols.length >= 2) {
          // @ts-ignore
          const mz = cols[0].innerText.trim();
          // @ts-ignore
          const abundance = cols[1].innerText.trim();
          if (
            !isNaN(Number.parseFloat(mz)) &&
            !isNaN(Number.parseFloat(abundance))
          ) {
            return { mz, abundance };
          }
        }
        return null;
      })
      .filter(Boolean);

    const svgImg =
      // @ts-ignore
      document.querySelector('img.spectrum-structure-image')?.src || '';

    const metadataBlock = {};
    const propsSection = document.querySelector(
      '.spectrum-detail__tabs-content__tab--properties',
    );
    if (propsSection) {
      const dtList = propsSection.querySelectorAll('dt');
      for (const dt of dtList) {
        const key = dt.innerText.trim();
        const dd = dt.nextElementSibling;
        if (dd) {
          if (dd.querySelectorAll('li').length > 0) {
            // @ts-ignore
            metadataBlock[key] = Array.from(dd.querySelectorAll('li')).map(
              (li) => li.innerText.trim(),
            );
          } else {
            // @ts-ignore
            metadataBlock[key] = dd.innerText.trim();
          }
        }
      }
    }

    return {
      titleBlock,
      name,
      synonyms: synList,
      peaks,
      svgUrl: svgImg,
      metadata: metadataBlock,
    };
  });

  const metadata = {
    spectrumId: id,
    url,
    ...result,
  };

  await fs.writeFile(
    path.join(folder, 'metadata.json'),
    JSON.stringify(metadata, null, 2),
  );

  // Save SVG
  if (result.svgUrl) {
    try {
      const svgPage = await browser.newPage();
      await svgPage.goto(result.svgUrl, { waitUntil: 'domcontentloaded' });
      const svgContent = await svgPage.$eval('svg', (el) => el.outerHTML);
      await fs.writeFile(path.join(folder, 'structure.svg'), svgContent);
    } catch (error) {
      // @ts-ignore
      console.warn(`⚠️ Failed to save SVG for ID ${id}: ${error.message}`);
    }
  }

  await browser.close();
  console.log(`✅ Done with spectrum ${id}`);
}

for (const id of spectrumIds) {
  try {
    await scrapeSpectrum(id);
  } catch (error) {
    // @ts-ignore
    console.error(`❌ Error scraping ID ${id}: ${error.message}`);
  }
}
