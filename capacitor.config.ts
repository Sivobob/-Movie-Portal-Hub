import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.moviebox.stream.app',
  appName: 'Movie Portal',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 0
    },
    SafeArea: {
      enabled: true
    }
  },
  server: {
    androidScheme: 'https'
  }
};


export default config;
