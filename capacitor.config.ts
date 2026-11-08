import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moviebox.stream.app',
  appName: 'Movie Portal',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: 'https://ais-pre-abcn6s4zzgkysogvx2vu5v-828533060153.asia-northeast1.run.app',
    allowNavigation: [
      '*.google.com',
      'accounts.google.com',
      'apis.google.com',
      '*.firebaseauth.com',
      '*.firebaseapp.com',
      'movie-portal-32fd1.firebaseapp.com',
      'ais-pre-abcn6s4zzgkysogvx2vu5v-828533060153.asia-northeast1.run.app'
    ]
  }
};

export default config;
