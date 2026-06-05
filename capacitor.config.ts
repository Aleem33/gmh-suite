import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.gmh.suite',
  appName: 'GMH Suite',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0f2544',
      showSpinner: false,
    },
    StatusBar: {
      backgroundColor: '#0f2544',
      style: 'DARK',
    },
  },
};

export default config;
