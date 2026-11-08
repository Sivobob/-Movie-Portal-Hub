const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const adminEmail = 'movieboxproapk007711@gmail.com';

async function removeAdmin() {
  const auth = admin.auth();
  try {
    const user = await auth.getUserByEmail(adminEmail);
    await auth.setCustomUserClaims(user.uid, { admin: false });
    console.log(`Admin privileges removed from ${adminEmail}`);
  } catch (error) {
    console.error('Error removing admin:', error);
  }
}

removeAdmin();
