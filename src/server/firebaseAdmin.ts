import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin
const app = getApps().length === 0 
  ? initializeApp({ projectId: 'movie-portal-32fd1' }) 
  : getApp();

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export default app;
