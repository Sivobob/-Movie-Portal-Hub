import { adminAuth } from '../src/server/firebaseAdmin.ts';

/**
 * Script to securely provision admin custom claims for the master admin email.
 * Usage: npx tsx scripts/setAdmin.ts <email>
 */

const email = process.argv[2] || 'movieboxproapk007711@gmail.com';

async function setAdmin() {
  console.log(`[setAdmin] Attempting to set admin=true for ${email}...`);
  try {
    const user = await adminAuth.getUserByEmail(email);
    await adminAuth.setCustomUserClaims(user.uid, { admin: true });
    console.log(`[setAdmin] SUCCESS: Custom claim 'admin=true' set for ${email} (${user.uid}).`);
    console.log(`[setAdmin] Note: The user must sign out and sign in again for the claim to take effect.`);
    process.exit(0);
  } catch (err: any) {
    console.error(`[setAdmin] ERROR: ${err.message}`);
    if (err.code === 'auth/user-not-found') {
      console.error(`[setAdmin] TIP: The user ${email} must sign in with Google once before you can set their claims.`);
    }
    process.exit(1);
  }
}

setAdmin();
