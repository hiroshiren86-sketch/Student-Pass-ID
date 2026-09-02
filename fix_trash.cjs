const fs = require('fs');
let str = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');

if (!str.includes('import { Trash2 }')) {
    // Some lines might already have it, some might not depending on the replace order
    str = str.replace("import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock, Trash2 } from 'lucide-react';", 
    "import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock, Trash2 } from 'lucide-react';");
    
    // Just replace the main one if we missed it
    if(!str.includes('Trash2 } from \'lucide-react\'')) {
        str = str.replace("import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock } from 'lucide-react';", 
        "import { Settings, Save, AlertTriangle, Key, Cloud, CheckCircle2, RotateCcw, Monitor, FileSpreadsheet, Lock, Trash2 } from 'lucide-react';");
    }
}

fs.writeFileSync('src/components/SettingsModal.tsx', str);
