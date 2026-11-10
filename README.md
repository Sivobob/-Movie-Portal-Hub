# MOVIE PORTAL

A complete, professional movie streaming portal.

## Setup Instructions

### Firebase
1. Create a Firebase project at [https://console.firebase.google.com/](https://console.firebase.google.com/).
2. Enable Google Authentication in the Firebase Console (Authentication > Sign-in method).
3. Create a Firestore database.
4. Copy the Firebase configuration to `firebase-applet-config.json`.

### Authorized Administrator
1. The authorized admin is `movieboxproapk007711@gmail.com`.
2. **Option A (Easy)**: Log in as this user and click "Initialize Admin" in the Admin Dashboard to register in Firestore.
3. **Option B (Secure Custom Claims)**: For production-grade security using Custom Claims:
   - Ensure you have a Firebase Service Account key file (`serviceAccountKey.json`).
   - Run `export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"`
   - Run `node scripts/set-admin.js` to assign `admin: true` claim to the user.


### Deployment (Vercel)
1. Push code to GitHub.
2. Connect the repository to Vercel.
3. Configure environment variables in Vercel.
