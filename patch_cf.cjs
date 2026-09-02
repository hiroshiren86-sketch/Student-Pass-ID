const fs = require('fs');
let content = fs.readFileSync('src/services/cloudflareSync.ts', 'utf8');

const target = `    const students = AttendanceStorageService.getStudents();`;
const replacement = `    let students = AttendanceStorageService.getStudents();
    // Strip large photoUrls to keep payload fast and avoid D1 limits
    students = students.map(st => {
      if (st.photoUrl && st.photoUrl.length > 700000) {
        const { photoUrl, ...rest } = st;
        return rest as any;
      }
      return st;
    });`;

content = content.replace(target, replacement);
fs.writeFileSync('src/services/cloudflareSync.ts', content);
