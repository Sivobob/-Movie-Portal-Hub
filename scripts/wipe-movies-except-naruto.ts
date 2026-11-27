import fs from 'fs';
import path from 'path';
import { adminDb } from '../src/server/firebaseAdmin';

async function wipeMoviesExceptNaruto() {
  console.log('Connecting to Firestore to wipe movies except Naruto Shippuden...');
  try {
    const moviesRef = adminDb.collection('movies');
    const snapshot = await moviesRef.get();

    console.log(`Found ${snapshot.size} documents in 'movies' collection.`);

    const batch = adminDb.batch();
    let deletedCount = 0;

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const title = String(data.title || '').toLowerCase();
      const cat = String(data.category || '').toLowerCase();
      const isNaruto = title.includes('naruto') || cat.includes('naruto');

      if (isNaruto) {
        console.log(`Keeping Naruto Shippuden item: ${doc.id} - ${data.title}`);
      } else {
        batch.delete(doc.ref);
        deletedCount++;
        console.log(`Marked for deletion: ${doc.id} - ${data.title}`);
      }
    });

    if (deletedCount > 0) {
      await batch.commit();
      console.log(`Successfully deleted ${deletedCount} movies/series (kept Naruto Shippuden).`);
    } else {
      console.log('No matching non-Naruto documents found to delete.');
    }
  } catch (error) {
    console.error('Error during selective wipe:', error);
  }
}

wipeMoviesExceptNaruto().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
