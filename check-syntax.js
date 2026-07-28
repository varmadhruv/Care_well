const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'registration.html');
const content = fs.readFileSync(filePath, 'utf8');

// Find the script tag containing registration logic
const match = content.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
if (!match) {
  console.log("Could not find script tag before body close");
  process.exit(1);
}

const code = match[1];

try {
  const vm = require('vm');
  new vm.Script(code, { filename: 'registration_script.js' });
  console.log("SYNTAX OK");
} catch (e) {
  console.error("SYNTAX ERROR IN SCRIPT:");
  console.error(e.stack || e);
}
