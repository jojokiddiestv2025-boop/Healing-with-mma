import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCXaAMm-aJf6Di0kjNXPGz304uDwrhtK9A",
  authDomain: "healing-with-mma.firebaseapp.com",
  projectId: "healing-with-mma",
  storageBucket: "healing-with-mma.firebasestorage.app",
  messagingSenderId: "178830791174",
  appId: "1:178830791174:web:e96d63aa9bb4345b3ce987",
  measurementId: "G-4SY65B0H7K"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
