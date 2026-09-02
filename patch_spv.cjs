const fs = require('fs');

let spv = fs.readFileSync('src/components/StudentPortalView.tsx', 'utf8');
if (!spv.includes("import { compressImageFile }")) {
  spv = spv.replace("import { AttendanceStorageService } from '../services/attendanceStorage';", 
    "import { AttendanceStorageService } from '../services/attendanceStorage';\nimport { compressImageFile } from '../utils/imageCompressor';");
    
  const oldLogic = `  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: dataUrl });
      const updated = { ...activeStudent, photoUrl: dataUrl };
      setActiveStudent(updated);
    };
    reader.readAsDataURL(file);
  };`;
  
  const newLogic = `  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await compressImageFile(file, 400, 500, 0.8);
      AttendanceStorageService.updateStudent(activeStudent.code, { photoUrl: dataUrl });
      const updated = { ...activeStudent, photoUrl: dataUrl };
      setActiveStudent(updated);
    } catch (err) {
      console.error('Error compressing photo:', err);
    }
  };`;
  
  spv = spv.replace(oldLogic, newLogic);
  fs.writeFileSync('src/components/StudentPortalView.tsx', spv);
}
