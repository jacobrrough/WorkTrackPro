/**
 * Generate self-signed key.pem and cert.pem for Vite HTTPS dev server.
 * Run: npm run generate-cert
 */
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

async function main() {
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const opts = { keySize: 2048, days: 365, algorithm: 'sha256' };
  const pems = await selfsigned.generate(attrs, opts);

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'key.pem'), pems.private);
  fs.writeFileSync(path.join(root, 'cert.pem'), pems.cert);

  console.log('Generated key.pem and cert.pem in project root.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
