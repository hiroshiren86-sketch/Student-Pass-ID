const fs = require('fs');
let content = fs.readFileSync('src/services/cloudflareSync.ts', 'utf8');
content = content.replace("await this.performCloudflareSync('push');", "await this.performCloudflareSync();");
fs.writeFileSync('src/services/cloudflareSync.ts', content);
