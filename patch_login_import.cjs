const fs = require('fs');
let str = fs.readFileSync('src/components/LoginScreen.tsx', 'utf8');

if (!str.includes("import { DevFloatingMenu }")) {
    str = str.replace("import { FirebaseService } from '../services/firebase';", "import { FirebaseService } from '../services/firebase';\nimport { DevFloatingMenu } from './DevFloatingMenu';");
    fs.writeFileSync('src/components/LoginScreen.tsx', str);
}
