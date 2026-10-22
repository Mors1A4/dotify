import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, deleteDoc, updateDoc } from 'firebase/firestore';

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

try {
  console.log('Fetching upgrade_requests from Firestore...');
  const snap = await getDocs(collection(db, 'upgrade_requests'));
  console.log('Found', snap.size, 'requests.');
  snap.forEach(d => {
    const data = d.data();
    console.log(`- ID: ${d.id} | Status: ${data.status} | Title: ${data.title} | Type: ${data.type} | Created: ${new Date(data.createdAt || 0).toLocaleString()}`);
  });
} catch (err) {
  console.error('Error fetching upgrade_requests:', err);
}
process.exit(0);
