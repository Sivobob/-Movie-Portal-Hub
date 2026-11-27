import fs from 'fs';
import path from 'path';
import { adminDb } from '../src/server/firebaseAdmin';

async function backupAndWipeMovies() {
  console.log('Connecting to Firestore to backup and wipe movies...');
  try {
    const moviesRef = adminDb.collection('movies');
    const snapshot = await moviesRef.get();

    console.log(`Found ${snapshot.size} documents in 'movies' collection.`);

    const backupData: any[] = [];
    snapshot.forEach((doc) => {
      backupData.push({ id: doc.id, ...doc.data() });
    });

    const backupPath = path.join(process.cwd(), 'scripts', 'movies-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`Backup saved to ${backupPath} (${backupData.length} items).`);

    if (snapshot.size > 0) {
      console.log('Deleting documents from movies collection...');
      const batch = adminDb.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`Successfully deleted ${snapshot.size} documents from 'movies' collection.`);
    } else {
      console.log('No existing documents to delete in movies collection.');
    }

    console.log('Backup and wipe completed successfully.');
  } catch (error) {
    console.error('Error during backup and wipe:', error);
  }
}

backupAndWipeMovies().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
