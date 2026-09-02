const fs = require('fs');

// Patch StudentsManagerView.tsx
let smv = fs.readFileSync('src/components/StudentsManagerView.tsx', 'utf8');
if (!smv.includes("import { compressImageFile }")) {
  smv = smv.replace("import { Download, Upload, UserPlus, FileUp, Trash2, Eye, Shield, Users, Search, Play, X, Pencil, Mail, FileText } from 'lucide-react';", 
    "import { Download, Upload, UserPlus, FileUp, Trash2, Eye, Shield, Users, Search, Play, X, Pencil, Mail, FileText } from 'lucide-react';\nimport { compressImageFile } from '../utils/imageCompressor';");
  
  const uploadLogic = `    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setFormData(prev => ({ ...prev, photoUrl: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }`;
  
  const compressedUpload = `    if (file) {
      compressImageFile(file).then(dataUrl => {
        setFormData(prev => ({ ...prev, photoUrl: dataUrl }));
      }).catch(err => console.error('Image compression failed:', err));
    }`;
    
  smv = smv.replace(uploadLogic, compressedUpload);
  fs.writeFileSync('src/components/StudentsManagerView.tsx', smv);
}

// Patch DocumentUploadModal.tsx
let dum = fs.readFileSync('src/components/DocumentUploadModal.tsx', 'utf8');
if (!dum.includes("import { compressImageFile }")) {
  dum = dum.replace("import { AiProviderMark } from './AiProviderMark';",
    "import { AiProviderMark } from './AiProviderMark';\nimport { compressImageFile } from '../utils/imageCompressor';");
    
  dum = dum.replace("const photoDataUrl = await readFileAsDataUrl(file);", "const photoDataUrl = await compressImageFile(file);");
  fs.writeFileSync('src/components/DocumentUploadModal.tsx', dum);
}

// Patch documentParser.ts
let dp = fs.readFileSync('src/utils/documentParser.ts', 'utf8');
if (!dp.includes("import { compressImageFile }")) {
  dp = dp.replace("import * as XLSX from 'xlsx';", "import * as XLSX from 'xlsx';\nimport { compressImageFile } from './imageCompressor';");
  dp = dp.replace("const photoDataUrl = await readFileAsDataUrl(file);", "const photoDataUrl = await compressImageFile(file);");
  fs.writeFileSync('src/utils/documentParser.ts', dp);
}

