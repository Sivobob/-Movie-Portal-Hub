import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const projectId = process.env.FIREBASE_PROJECT_ID || (firebaseConfig as any).projectId || 'movie-portal-hub-apk';

// Initialize Firebase Admin
const app = getApps().length === 0 
  ? initializeApp({ projectId }) 
  : getApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export default app;

