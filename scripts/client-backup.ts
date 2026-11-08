import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import fs from 'fs';
import path from 'path';

const app = initializeApp(firebaseConfig);
const db = firebaseConfig.firestoreDatabaseId 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

async function checkAndBackup() {
  console.log('Querying Firestore client for movies collection...');
  try {
    const col = collection(db, 'movies');
    const snap = await getDocs(col);
    console.log(`Found ${snap.size} documents in 'movies'`);
    const backupData: any[] = [];
    snap.forEach((d) => {
      backupData.push({ id: d.id, ...d.data() });
    });
    const backupPath = path.join(process.cwd(), 'scripts', 'movies-backup.json');
    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');
    console.log(`Saved backup to ${backupPath}`);
  } catch (err) {
    console.error('Error querying client Firestore:', err);
  }
}

checkAndBackup().then(() => process.exit(0)).catch(() => process.exit(1));
