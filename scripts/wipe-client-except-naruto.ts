import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function wipeMoviesExceptNarutoClient() {
  console.log('Connecting to Firestore (Client SDK) to wipe movies except Naruto Shippuden...');
  try {
    const moviesRef = collection(db, 'movies');
    const snapshot = await getDocs(moviesRef);

    console.log(`Found ${snapshot.size} documents in 'movies' collection.`);

    let deletedCount = 0;
    for (const documentSnapshot of snapshot.docs) {
      const data = documentSnapshot.data();
      const title = String(data.title || '').toLowerCase();
      const cat = String(data.category || '').toLowerCase();
      const isNaruto = title.includes('naruto') || cat.includes('naruto');

      if (isNaruto) {
        console.log(`Keeping Naruto Shippuden item: ${documentSnapshot.id} - ${data.title}`);
      } else {
        await deleteDoc(doc(db, 'movies', documentSnapshot.id));
        deletedCount++;
        console.log(`Deleted: ${documentSnapshot.id} - ${data.title}`);
      }
    }

    console.log(`Successfully deleted ${deletedCount} non-Naruto movies/series. Naruto Shippuden kept.`);
  } catch (error) {
    console.error('Error during client wipe:', error);
  }
}

wipeMoviesExceptNarutoClient().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
