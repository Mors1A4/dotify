import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBRlXTMDnpFBsbas9Gl4ECUZTbzF3NLfmE',
  authDomain: 'dotify-11e01.firebaseapp.com',
  projectId: 'dotify-11e01',
  storageBucket: 'dotify-11e01.firebasestorage.app',
  messagingSenderId: '533066775942',
  appId: '1:533066775942:web:6ef28405b556f261960007',
  measurementId: 'G-11GZ3XVP9G',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

const testUid = 'test_user_123';
try {
  console.log('Testing getDoc on users/' + testUid);
  const snap = await getDoc(doc(db, 'users', testUid));
  console.log('getDoc success, exists:', snap.exists());
} catch (err) {
  console.log('getDoc error:', err.message);
}

try {
  console.log('Testing setDoc on users/' + testUid);
  await setDoc(doc(db, 'users', testUid), { test: true, updatedAt: Date.now() }, { merge: true });
  console.log('setDoc success!');
} catch (err) {
  console.log('setDoc error:', err.message);
}

// Also test via REST API
try {
  const restRes = await fetch(`https://firestore.googleapis.com/v1/projects/dotify-11e01/databases/(default)/documents/users/${testUid}`);
  console.log('REST get status:', restRes.status);
  const restData = await restRes.json();
  console.log('REST get response:', restData);
} catch (err) {
  console.log('REST error:', err.message);
}

process.exit(0);
