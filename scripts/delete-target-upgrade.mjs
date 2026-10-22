import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, deleteDoc, setDoc } from 'firebase/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const reqId = 'req_1790852018349_1rrtc';

console.log('Attempting to delete from Firestore...');
try {
  await deleteDoc(doc(db, 'upgrade_requests', reqId));
  console.log('Successfully deleted doc from Firestore!');
} catch (err) {
  console.log('deleteDoc error:', err.message);
  try {
    console.log('Attempting to mark status as cancelled/deleted...');
    await setDoc(doc(db, 'upgrade_requests', reqId), { status: 'cancelled', updatedAt: Date.now() }, { merge: true });
    console.log('Successfully marked as cancelled in Firestore!');
  } catch (err2) {
    console.log('setDoc error:', err2.message);
  }
}

// Remove local file
const localFile = path.resolve(__dirname, '../server/data/upgrades', `${reqId}.json`);
if (fs.existsSync(localFile)) {
  fs.unlinkSync(localFile);
  console.log('Removed local file:', localFile);
} else {
  console.log('Local file not found:', localFile);
}

process.exit(0);
