import fs from 'node:fs/promises';
import path from 'node:path';
import {createPrivateKey, createPublicKey, sign, verify} from 'node:crypto';

const [directory] = process.argv.slice(2);
if (!directory || !process.env.DREAMSKIN_GUI_SIGNING_KEY_FILE) throw Error('Release directory and signing key are required.');
const key = createPrivateKey(await fs.readFile(process.env.DREAMSKIN_GUI_SIGNING_KEY_FILE));
const pinned = createPublicKey(await fs.readFile(new URL('../packaging/update-public-key.pem', import.meta.url)));
if (key.asymmetricKeyType !== 'ed25519' || !createPublicKey(key).export({type:'spki',format:'der'}).equals(pinned.export({type:'spki',format:'der'}))) {
  throw Error('Release signing key does not match the pinned update public key.');
}
if (directory === '--check-key') process.exit(0);
const bytes = await fs.readFile(path.join(directory, 'update.json'));
const signaturePath = path.join(directory, 'update.json.sig');
await fs.writeFile(signaturePath, sign(null, bytes, key).toString('base64') + '\n');
// Re-read both files and verify with the pinned key before anything is uploaded.
const written = Buffer.from((await fs.readFile(signaturePath, 'ascii')).trim(), 'base64');
if (!verify(null, await fs.readFile(path.join(directory, 'update.json')), pinned, written)) throw Error('update.json.sig does not verify with the pinned public key.');
