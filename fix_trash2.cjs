const fs = require('fs');
let str = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');

if (!str.includes('Trash2,')) {
    str = str.replace("Cloud,", "Cloud,\n  Trash2,");
    fs.writeFileSync('src/components/SettingsModal.tsx', str);
}
