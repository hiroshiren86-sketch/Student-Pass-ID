const fs = require('fs');
let content = fs.readFileSync('src/services/cloudflareSync.ts', 'utf8');

const pullRegex = /(static async pullFromCloudflare\(\): Promise<\{ success: boolean; message: string; data\?: any \}> \{)([\s\S]*?)(const result = await res\.json\(\);)/;

const newPullStart = `static async pullFromCloudflare(): Promise<{ success: boolean; message: string; data?: any }> {
    const settings = AttendanceStorageService.getSettings();
    const cleanBaseUrl = (settings.cloudflareWorkerUrl || '').trim().replace(/\\/+$/, '');
    const schoolCode = settings.schoolCode || 'INAS_2026';

    let result: any = null;

    if (cleanBaseUrl) {
      try {
        const pullUrl = cleanBaseUrl.endsWith('/api/sync/pull') 
          ? \`\${cleanBaseUrl}?schoolCode=\${encodeURIComponent(schoolCode)}\`
          : \`\${cleanBaseUrl}/api/sync/pull?schoolCode=\${encodeURIComponent(schoolCode)}\`;

        const res = await fetch(pullUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.cloudflareApiToken ? { Authorization: \`Bearer \${settings.cloudflareApiToken.trim()}\` } : {})
          }
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(\`Worker HTTP \${res.status}: \${errText}\`);
        }
        result = await res.json();
      } catch (err: any) {
        console.warn('Fallo pull del Worker, intentando fallback REST:', err);
      }
    }

    if (!result && settings.cloudflareAccountId && settings.cloudflareApiToken && settings.cloudflareD1DatabaseId) {
       try {
         const d1Endpoint = \`https://api.cloudflare.com/client/v4/accounts/\${settings.cloudflareAccountId}/d1/database/\${settings.cloudflareD1DatabaseId}/query\`;
         const d1Res = await fetch(d1Endpoint, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               Authorization: \`Bearer \${settings.cloudflareApiToken}\`
            },
            body: JSON.stringify({ sql: \`SELECT data_json, updated_at FROM sync_snapshots WHERE school_code = '\${schoolCode}' OR id = 'snapshot_\${schoolCode}' LIMIT 1\` })
         });
         if (d1Res.ok) {
            const d1Result = await d1Res.json();
            if (d1Result.success && d1Result.result && d1Result.result[0]?.results?.length > 0) {
               const row = d1Result.result[0].results[0];
               if (row && row.data_json) {
                 result = {
                    success: true,
                    data: JSON.parse(row.data_json),
                    source: 'Cloudflare D1 REST API'
                 };
               }
            }
         }
       } catch(err: any) {
         console.warn('Fallo al conectar con Cloudflare D1 REST API (Pull):', err);
       }
    }

    if (!result) {
       return { success: false, message: 'No se pudo conectar con el Worker ni con la API REST de Cloudflare. Verifica la URL o las credenciales.' };
    }
`;

content = content.replace(pullRegex, newPullStart);
fs.writeFileSync('src/services/cloudflareSync.ts', content);
