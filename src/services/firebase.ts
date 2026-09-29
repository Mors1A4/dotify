import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: "AIzaSyBRlXTMDnpFBsbas9Gl4ECUZTbzF3NLfmE",
  authDomain: "dotify-11e01.firebaseapp.com",
  projectId: "dotify-11e01",
  storageBucket: "dotify-11e01.firebasestorage.app",
  messagingSenderId: "533066775942",
  appId: "1:533066775942:web:6ef28405b556f261960007",
  measurementId: "G-11GZ3XVP9G"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export const db = getFirestore(app);
