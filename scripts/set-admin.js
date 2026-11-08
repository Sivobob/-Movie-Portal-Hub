const admin = require('firebase-admin');

// Initialize with service account (user must set GOOGLE_APPLICATION_CREDENTIALS)
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const adminEmail = 'movieboxproapk007711@gmail.com';

async function setAdmin() {
  const auth = admin.auth();
  try {
    const user = await auth.getUserByEmail(adminEmail);
    await auth.setCustomUserClaims(user.uid, { admin: true });
    console.log(`Admin privileges assigned to ${adminEmail}`);
  } catch (error) {
    console.error('Error setting admin:', error);
  }
}

setAdmin();
