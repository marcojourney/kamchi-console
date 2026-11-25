import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import appletConfig from '../../../firebase-applet-config.json';

interface FirebaseConfigShape {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
  recaptchaSiteKey?: string;
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const firebaseConfig: FirebaseConfigShape = env.VITE_FIREBASE_API_KEY
  ? {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
      projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: env.VITE_FIREBASE_APP_ID ?? '',
      firestoreDatabaseId: env.VITE_FIREBASE_DATABASE_ID,
      recaptchaSiteKey: env.VITE_RECAPTCHA_SITE_KEY,
    }
  : (appletConfig as FirebaseConfigShape);

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FUNCTIONS_REGION = env.VITE_FUNCTIONS_REGION || 'asia-southeast1';

export const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

export const functions = getFunctions(app, FUNCTIONS_REGION);

// Initialize Firebase App Check if a reCAPTCHA v3 site key is configured
const recaptchaSiteKey = env.VITE_RECAPTCHA_SITE_KEY || firebaseConfig.recaptchaSiteKey;
let appCheckInitialized = false;
if (typeof window !== 'undefined' && recaptchaSiteKey && !appCheckInitialized) {
  appCheckInitialized = true;
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

// Required startup connectivity check per Firebase integration guide
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firebase connection check failed: client appears offline. Verify Firebase configuration.');
    }
  }
}
void testConnection();
