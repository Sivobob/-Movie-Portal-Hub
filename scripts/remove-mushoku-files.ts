import fs from 'fs';
import path from 'path';

async function removeMushokuFromFiles() {
  console.log('Searching and removing Mushoku Tensei from local seed files...');
  
  const seedJsonPath = path.join(process.cwd(), 'public', 'movies-seed.json');
  if (fs.existsSync(seedJsonPath)) {
    try {
      const raw = fs.readFileSync(seedJsonPath, 'utf-8');
      const catalog = JSON.parse(raw);
      if (Array.isArray(catalog)) {
        const filtered = catalog.filter((item: any) => {
          const t = String(item?.title || '').toLowerCase();
          const orig = String(item?.originalTitle || '').toLowerCase();
          return !t.includes('mushoku') && !t.includes('jobless reincarnation') && !orig.includes('mushoku');
        });
        if (filtered.length < catalog.length) {
          fs.writeFileSync(seedJsonPath, JSON.stringify(filtered, null, 2));
          console.log(`Removed ${catalog.length - filtered.length} items from movies-seed.json`);
        }
      }
    } catch (e) {
      console.error('Error processing movies-seed.json:', e);
    }
  }

  const seedCatalogPath = path.join(process.cwd(), 'src', 'services', 'seedCatalog.ts');
  if (fs.existsSync(seedCatalogPath)) {
    try {
      const raw = fs.readFileSync(seedCatalogPath, 'utf-8');
      // Parse BUNDLED_SEED_CATALOG array
      const match = raw.match(/export const BUNDLED_SEED_CATALOG:\s*MovieData\[\]\s*=\s*(\[[\s\S]*\]);?/);
      if (match) {
        const catalog = JSON.parse(match[1]);
        if (Array.isArray(catalog)) {
          const filtered = catalog.filter((item: any) => {
            const t = String(item?.title || '').toLowerCase();
            const orig = String(item?.originalTitle || '').toLowerCase();
            return !t.includes('mushoku') && !t.includes('jobless reincarnation') && !orig.includes('mushoku');
          });
          if (filtered.length < catalog.length) {
            const newContent = `import type { MovieData } from './movieStorage';\n\nexport const BUNDLED_SEED_CATALOG: MovieData[] = ${JSON.stringify(filtered)};\n`;
            fs.writeFileSync(seedCatalogPath, newContent);
            console.log(`Removed ${catalog.length - filtered.length} items from seedCatalog.ts`);
          }
        }
      }
    } catch (e) {
      console.error('Error processing seedCatalog.ts:', e);
    }
  }
}

removeMushokuFromFiles().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
