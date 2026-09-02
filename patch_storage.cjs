const fs = require('fs');

let str = fs.readFileSync('src/services/attendanceStorage.ts', 'utf8');

const target = `  static resetToDemo(): void {
    // Backup before resetting`;

const replace = `  static wipeAllForProduction(): void {
    // Completely wipe all student, teacher, schedule, and attendance data
    // Retain only institutional settings
    try {
      localStorage.removeItem(STUDENTS_KEY);
      localStorage.removeItem(ATTENDANCE_KEY);
      localStorage.removeItem(OFFLINE_QUEUE_KEY);
      localStorage.removeItem('inas_teachers_v1');
      localStorage.removeItem('inas_schedule_assignments_v1');
      localStorage.removeItem('inas_schedule_slots_v1');
      localStorage.removeItem('inas_custom_templates_v1');
      localStorage.removeItem('inas_student_schedules_v1');
      localStorage.removeItem('inas_day_closed_v1');
    } catch (e) {
      console.error('Failed to wipe storage:', e);
    }
  }

  static resetToDemo(): void {
    // Backup before resetting`;

if (!str.includes('wipeAllForProduction')) {
    str = str.replace(target, replace);
    fs.writeFileSync('src/services/attendanceStorage.ts', str);
}

