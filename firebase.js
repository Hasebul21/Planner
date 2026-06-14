// ============================================================
// firebase.js — Firebase init + auth + Firestore sync helpers
// Uses ESM CDN so no build step is required.
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js';
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signOut as fbSignOut,
    onAuthStateChanged,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
    doc,
    setDoc,
    getDoc,
    onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

const firebaseConfig = {
    apiKey: 'AIzaSyD3IqAVAotPmJtO5qcSukM0yQLenrHzAUE',
    authDomain: 'planner-54bd0.firebaseapp.com',
    projectId: 'planner-54bd0',
    storageBucket: 'planner-54bd0.firebasestorage.app',
    messagingSenderId: '639626892899',
    appId: '1:639626892899:web:fd57d02630eef1b4618a56',
    measurementId: 'G-VWQSX7CEDE',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ============== AUTH ==============
export function watchAuth(cb) {
    return onAuthStateChanged(auth, (user) => cb(user));
}

export function currentUser() {
    return auth.currentUser;
}

export async function signInGoogle() {
    const provider = new GoogleAuthProvider();
    const res = await signInWithPopup(auth, provider);
    return res.user;
}

const EMAIL_LINK_KEY = 'planner.emailForSignIn';
const EMAIL_LINK_REDIRECT = window.location.origin + window.location.pathname;

export async function sendEmailLink(email) {
    await sendSignInLinkToEmail(auth, email, {
        url: EMAIL_LINK_REDIRECT,
        handleCodeInApp: true,
    });
    try { localStorage.setItem(EMAIL_LINK_KEY, email); } catch (e) { }
}

export async function completeEmailLinkIfPresent() {
    if (!isSignInWithEmailLink(auth, window.location.href)) return null;
    let email = '';
    try { email = localStorage.getItem(EMAIL_LINK_KEY) || ''; } catch (e) { }
    if (!email) {
        email = window.prompt('Please confirm your email to finish signing in') || '';
    }
    if (!email) return null;
    const res = await signInWithEmailLink(auth, email, window.location.href);
    try { localStorage.removeItem(EMAIL_LINK_KEY); } catch (e) { }
    // Clean the URL so the link can't be re-used
    history.replaceState({}, '', EMAIL_LINK_REDIRECT);
    return res.user;
}

export function signOut() {
    return fbSignOut(auth);
}

// ============== FIRESTORE: one doc per user ==============
function stateRef(uid) {
    return doc(db, 'users', uid, 'data', 'state');
}

export async function loadCloudState(uid) {
    try {
        const snap = await getDoc(stateRef(uid));
        return snap.exists() ? snap.data() : null;
    } catch (e) {
        console.warn('[firebase] loadCloudState failed', e);
        return null;
    }
}

export async function saveCloudState(uid, payload) {
    try {
        await setDoc(stateRef(uid), {
            ...payload,
            updatedAt: Date.now(),
        }, { merge: true });
    } catch (e) {
        console.warn('[firebase] saveCloudState failed', e);
    }
}

export function watchCloudState(uid, cb) {
    return onSnapshot(stateRef(uid), (snap) => {
        if (snap.exists()) cb(snap.data());
    }, (err) => console.warn('[firebase] watchCloudState error', err));
}
