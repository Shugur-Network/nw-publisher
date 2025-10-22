import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

console.log('CWD:', process.cwd());
console.log('.env path:', process.cwd() + '/.env');

// Try approach 1: explicit path with cwd
const result1 = dotenv.config({ path: process.cwd() + '/.env' });
console.log('\nApproach 1 (cwd):', result1.error ? result1.error.message : 'Success');
console.log('NOSTR_SK_HEX present:', !!process.env.NOSTR_SK_HEX);

// Reset env
delete process.env.NOSTR_SK_HEX;

// Try approach 2: using path.join
const result2 = dotenv.config({ path: path.join(process.cwd(), '.env') });
console.log('\nApproach 2 (path.join):', result2.error ? result2.error.message : 'Success');
console.log('NOSTR_SK_HEX present:', !!process.env.NOSTR_SK_HEX);

// Reset env
delete process.env.NOSTR_SK_HEX;

// Try approach 3: default (no options)
const result3 = dotenv.config();
console.log('\nApproach 3 (default):', result3.error ? result3.error.message : 'Success');
console.log('NOSTR_SK_HEX present:', !!process.env.NOSTR_SK_HEX);
