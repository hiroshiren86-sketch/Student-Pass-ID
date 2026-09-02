const fs = require('fs');

function addImport(file, importStr) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes("import { compressImageFile }")) {
    const lines = content.split('\n');
    const lastImportIndex = lines.map((l, i) => l.startsWith('import ') ? i : -1).reduce((max, curr) => Math.max(max, curr), -1);
    
    if (lastImportIndex !== -1) {
      lines.splice(lastImportIndex + 1, 0, importStr);
    } else {
      lines.unshift(importStr);
    }
    fs.writeFileSync(file, lines.join('\n'));
  }
}

addImport('src/components/DocumentUploadModal.tsx', "import { compressImageFile } from '../utils/imageCompressor';");
addImport('src/components/StudentsManagerView.tsx', "import { compressImageFile } from '../utils/imageCompressor';");
addImport('src/utils/documentParser.ts', "import { compressImageFile } from './imageCompressor';");

