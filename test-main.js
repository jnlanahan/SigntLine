console.log('electron version:', process.versions.electron);
console.log('ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE);
const e = require('electron');
console.log('type:', typeof e);
if (typeof e === 'string') {
  console.log('IS A STRING:', e.substring(0, 80));
} else if (e && typeof e === 'object') {
  console.log('has app:', typeof e.app);
  console.log('keys:', Object.keys(e).slice(0, 5));
}
process.exit(0);