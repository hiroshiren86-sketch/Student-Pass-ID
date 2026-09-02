const fs = require('fs');
let content = fs.readFileSync('src/services/cloudflareSync.ts', 'utf8');

const wipeMethod = `
  static async wipeCloudflareData(): Promise<boolean> {
    const settings = AttendanceStorageService.getSettings();
    const schoolCode = settings.schoolCode || 'INAS_2026';

    // Try to delete via D1 REST API if available
    if (settings.cloudflareAccountId && settings.cloudflareApiToken && settings.cloudflareD1DatabaseId) {
      try {
        const d1Endpoint = \`https://api.cloudflare.com/client/v4/accounts/\${settings.cloudflareAccountId}/d1/database/\${settings.cloudflareD1DatabaseId}/query\`;
        
        await fetch(d1Endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: \`Bearer \${settings.cloudflareApiToken}\`
          },
          body: JSON.stringify({ sql: \`DELETE FROM students\` })
        });
        
        await fetch(d1Endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: \`Bearer \${settings.cloudflareApiToken}\`
          },
          body: JSON.stringify({ sql: \`DELETE FROM attendance_records\` })
        });
        
        await fetch(d1Endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: \`Bearer \${settings.cloudflareApiToken}\`
          },
          body: JSON.stringify({ sql: \`DELETE FROM sync_snapshots WHERE school_code = '\${schoolCode}'\` })
        });
        
      } catch (err) {
        console.warn('Failed to wipe D1 via REST API:', err);
      }
    }
    
    // Fallback: just push an empty snapshot
    try {
      await this.performCloudflareSync('push');
      return true;
    } catch {
      return false;
    }
  }
`;

if (!content.includes('wipeCloudflareData')) {
    content = content.replace('static async performCloudflareSync', wipeMethod + '\n  static async performCloudflareSync');
    fs.writeFileSync('src/services/cloudflareSync.ts', content);
    console.log("Cloudflare wipe method added");
}
