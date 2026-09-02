const fs = require('fs');

function fixTable(file) {
  let content = fs.readFileSync(file, 'utf8');
  const original = content;

  // Let's find tr elements that are body rows (they have hover states usually)
  // Or just replace all <tr key={.*} className=".*"> 
  content = content.replace(/<tr key=\{([^}]+)\} className="([^"]*)"/g, (match, key, classNames) => {
    // If it's a table row with key
    // Remove old hover classes
    let newClasses = classNames.replace(/hover:bg-\S+/g, '').replace(/dark:hover:bg-\S+/g, '').replace(/transition-colors/g, '').trim();
    // Add our new elegant styles
    newClasses = `${newClasses} hover:bg-slate-100 dark:hover:bg-zinc-900/50 transition-colors group border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:shadow-sm`.trim();
    // Clean up multiple spaces
    newClasses = newClasses.replace(/\s+/g, ' ');
    return `<tr key={${key}} className="${newClasses}"`;
  });

  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Fixed tables in', file);
  }
}

fixTable('src/components/StudentsManagerView.tsx');
fixTable('src/components/AttendanceReportsView.tsx');
fixTable('src/components/TeacherClassroomView.tsx');
fixTable('src/components/ScheduleBuilderView.tsx');
fixTable('src/components/GradeAiSummaryView.tsx');
