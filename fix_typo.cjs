const fs = require('fs');
const files = [
  'src/components/StudentsManagerView.tsx',
  'src/components/AttendanceReportsView.tsx',
  'src/components/TeacherClassroomView.tsx',
  'src/components/ScheduleBuilderView.tsx',
  'src/components/GradeAiSummaryView.tsx'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/className="dark: /g, 'className="');
  fs.writeFileSync(file, content);
});
