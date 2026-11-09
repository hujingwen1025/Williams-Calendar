import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('.env')) {
  console.error('.env already exists; it was not changed.');
  process.exitCode = 1;
} else {
  const contents = `APP_ORIGIN=http://localhost:3000\nOWNER_PASSWORD=${randomBytes(24).toString('base64url')}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nDATABASE_PATH=data/calendar.sqlite\nBIND_ADDRESS=127.0.0.1\nPORT=3000\nALLOW_PRIVATE_SOURCES=false\n`;
  writeFileSync('.env', contents, { mode: 0o600 });
  console.log('Created .env with a random owner password and encryption key. Open it locally to retrieve your owner password. Keep this file private and preserve the encryption key.');
}
