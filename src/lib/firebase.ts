import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from './firebase-config';

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Configure robust multi-tab local cache persistence for offline resiliency
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
}, firebaseConfig.firestoreDatabaseId);

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();


// Default persistence is browserLocalPersistence, no need to set explicitly.
// Firestore offline persistence is handled automatically by modern SDKs or should be enabled carefully.

