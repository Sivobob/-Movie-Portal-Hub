import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const projectId = 'gen-lang-client-0267042672';
const app = getApps().length === 0 ? initializeApp({ projectId }) : getApp();
const db = getFirestore(app, 'ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f');

async function runRestDelete() {
  console.log('Fetching movies collection via Firestore REST API...');
  const url = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/movies?pageSize=300`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('Failed to fetch movies via REST:', await res.text());
    return;
  }
  const data = await res.json();
  const docs = Array.isArray(data.documents) ? data.documents : [];
  console.log(`Found ${docs.length} documents in movies collection.`);

  let deleted = 0;
  for (const doc of docs) {
    const name = doc.name; // projects/.../databases/.../documents/movies/DOC_ID
    const fields = doc.fields || {};
    const title = String(fields.title?.stringValue || '').toLowerCase();
    const cat = String(fields.category?.stringValue || '').toLowerCase();
    
    if (title.includes('mushoku') || title.includes('jobless reincarnation') || cat.includes('mushoku')) {
      console.log(`Deleting: ${name} (${fields.title?.stringValue})`);
      const delUrl = `https://firestore.googleapis.com/v1/${name}`;
      const delRes = await fetch(delUrl, { method: 'DELETE' });
      if (delRes.ok) {
        deleted++;
      } else {
        console.error(`Failed to delete ${name}:`, await delRes.text());
      }
    }
  }
  console.log(`Successfully deleted ${deleted} Mushoku Tensei documents.`);
}

runRestDelete().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
