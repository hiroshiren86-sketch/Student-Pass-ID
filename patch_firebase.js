const fs = require('fs');
let content = fs.readFileSync('src/services/firebase.ts', 'utf8');

const target = `
      // 2. Students
      for (const st of data.students) {
        await setDoc(doc(db, 'students', st.code), st, { merge: true });
        count++;
      }
`;

const replacement = `
      // 2. Students
      for (const st of data.students) {
        // Strip large photoUrl to prevent Firestore 1MB document limit error
        const stData = { ...st };
        if (stData.photoUrl && stData.photoUrl.length > 700000) {
          console.warn(\`Student \${st.code} photoUrl exceeds size limit, stripping before sync.\`);
          delete stData.photoUrl;
        }
        await setDoc(doc(db, 'students', st.code), stData, { merge: true });
        count++;
      }
`;

content = content.replace(target, replacement);
fs.writeFileSync('src/services/firebase.ts', content);
