const fs = require('fs');
let content = fs.readFileSync('src/services/firebase.ts', 'utf8');

if (!content.includes('deleteDoc')) {
    content = content.replace('setDoc,', 'setDoc,\n  deleteDoc,');
}

const wipeMethod = `
  static async wipeProductionData(): Promise<boolean> {
    try {
      const db = getFirebaseFirestore();
      
      // Delete all students
      const studentsSnap = await getDocs(collection(db, 'students'));
      const studentPromises = studentsSnap.docs.map(d => deleteDoc(d.ref));
      
      // Delete all attendance records
      const recordsSnap = await getDocs(collection(db, 'attendance_records'));
      const recordsPromises = recordsSnap.docs.map(d => deleteDoc(d.ref));
      
      await Promise.all([...studentPromises, ...recordsPromises]);
      return true;
    } catch (e) {
      console.error('Firebase wipe failed:', e);
      return false;
    }
  }
`;

if (!content.includes('wipeProductionData')) {
    content = content.replace('static async saveSchoolSettings', wipeMethod + '\n  static async saveSchoolSettings');
    fs.writeFileSync('src/services/firebase.ts', content);
    console.log("Firebase wiped method added");
}
