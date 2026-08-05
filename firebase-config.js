const firebaseConfig = {
  apiKey: "AIzaSyCXcHT4dFy4w_hVwhGk4WOcQujduJYusZ4",
  authDomain: "nf-reception.firebaseapp.com",
  databaseURL: "https://nf-reception-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "nf-reception",
  storageBucket: "nf-reception.firebasestorage.app",
  messagingSenderId: "64440957261",
  appId: "1:64440957261:web:ea0de56a0b7cf0ede8df04"
};

// Firebaseの初期化
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const dbRef = database.ref('moneyLogs');
