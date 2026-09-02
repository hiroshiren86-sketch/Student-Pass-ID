const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const files = walk('./src');

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Global AMOLED Dark Theme Replacements
  content = content.replace(/dark:bg-slate-950/g, 'dark:bg-black');
  content = content.replace(/dark:bg-slate-900/g, 'dark:bg-zinc-950');
  content = content.replace(/dark:border-slate-800/g, 'dark:border-zinc-800/50');
  content = content.replace(/dark:border-slate-700/g, 'dark:border-zinc-800');
  
  // Table Styling (Light theme highlights)
  // We want to target <tr> rows in tables.
  content = content.replace(/className="border-b border-slate-100 dark:border-slate-800 last:border-0"/g, 
    'className="border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:bg-slate-50/80 dark:hover:bg-zinc-900/50 transition-colors group"');
  
  content = content.replace(/className="border-b border-slate-100 dark:border-zinc-800\/50 last:border-0"/g, 
    'className="border-b border-slate-100 dark:border-zinc-800/50 last:border-0 hover:bg-slate-50/80 dark:hover:bg-zinc-900/50 transition-colors group"');

  // Change Primary Buttons in Dark Mode to White AMOLED style
  // E.g. bg-indigo-600 hover:bg-indigo-500 text-white ...
  // We'll look for common indigo button patterns and inject dark mode white button styles
  const btnPattern = /bg-indigo-600 hover:bg-indigo-500 text-white(.*?)transition-all/g;
  content = content.replace(btnPattern, "bg-indigo-600 dark:bg-white hover:bg-indigo-500 dark:hover:bg-zinc-200 text-white dark:text-black$1transition-all");

  const btnPattern2 = /bg-indigo-600 text-white hover:bg-indigo-700/g;
  content = content.replace(btnPattern2, "bg-indigo-600 dark:bg-white text-white dark:text-black hover:bg-indigo-700 dark:hover:bg-zinc-200");

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated theme in:', file);
  }
});
