import fs from 'fs';
import path from 'path';
import { adminDb } from '../src/server/firebaseAdmin';

async function removeMushokuTensei() {
  console.log('Connecting to Firestore to remove Mushoku Tensei...');
  try {
    const moviesRef = adminDb.collection('movies');
    const snapshot = await moviesRef.get();

    console.log(`Found ${snapshot.size} documents in 'movies' collection.`);

    const batch = adminDb.batch();
    let deletedCount = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const title = String(data.title || '').toLowerCase();
      const isMushoku = title.includes('mushoku') || title.includes('jobless reincarnation');

      if (isMushoku) {
        batch.delete(doc.ref);
        deletedCount++;
        console.log(`Marked for deletion: ${doc.id} - ${data.title}`);
      }
    });

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`Successfully deleted ${deletedCount} Mushoku Tensei documents from Firestore.`);
    } else {
      console.log('No Mushoku Tensei documents found in Firestore.');
    }

    // Also check seedCatalog.ts or movies-seed.json if present
    const seedPath = path.join(process.cwd(), 'public', 'movies-seed.json');
    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, 'utf-8');
      const catalog = JSON.parse(raw);
      if (Array.isArray(catalog)) {
        const filtered = catalog.filter((item: any) => {
          const t = String(item?.title || '').toLowerCase();
          return !t.includes('mushoku') && !t.includes('jobless reincarnation');
        });
        if (filtered.length < catalog.length) {
          fs.writeFileSync(seedPath, JSON.stringify(filtered, null, 2));
          console.log(`Removed Mushoku Tensei from movies-seed.json (removed ${catalog.length - filtered.length} items).`);
        }
      }
    }
  } catch (error) {
    console.error('Error removing Mushoku Tensei:', error);
  }
}

removeMushokuTensei().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
