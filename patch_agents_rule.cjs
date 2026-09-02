const fs = require('fs');
let content = fs.readFileSync('AGENTS.md', 'utf8');

const target = `5. **Regla de Desarrollo Modular y Fases Verificables:**
   - La construcción se realiza por módulos auto-contenidos, testeados en entorno escolar y listos para transición directa a semiproducción y producción real.`;

const replacement = `5. **Regla de Desarrollo Modular y Fases Verificables:**
   - La construcción se realiza por módulos auto-contenidos, testeados en entorno escolar y listos para transición directa a semiproducción y producción real.
6. **Regla de Cero Fallbacks y Avance Continuo (Anti-Obsolescencia):**
   - Prohibido dejar "fallbacks" genéricos, simulaciones o respuestas vacías que no estén comprobadas para evolucionar o que degraden la experiencia.
   - Si una función falla o no puede integrarse, se investiga, se planifica, se calcula y se programa desde cero.
   - Siempre se busca escalar y mejorar. El código obsoleto o roto se reemplaza por soluciones reales y funcionales sin afectar la cadena operativa.`;

if (!content.includes('Regla de Cero Fallbacks')) {
    content = content.replace(target, replacement);
    fs.writeFileSync('AGENTS.md', content);
}
