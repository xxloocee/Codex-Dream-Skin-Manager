import fs from 'node:fs/promises';
import path from 'node:path';
import {createPublicKey} from 'node:crypto';
const [engine,versionPath]=process.argv.slice(2);
const repository=process.env.DREAMSKIN_UPDATE_REPOSITORY||process.env.GITHUB_REPOSITORY;
const keyPath=process.env.DREAMSKIN_GUI_PUBLIC_KEY;
const privatePath=process.env.DREAMSKIN_GUI_SIGNING_KEY_FILE;
if(!repository||(!keyPath&&!privatePath)) {
  const version=(await fs.readFile(versionPath,'utf8')).trim();
  await fs.mkdir(path.join(engine,'updater'),{recursive:true});
  await fs.writeFile(path.join(engine,'updater/channel.json'),JSON.stringify({enabled:false,version,channel:'macos-gui-stable',repository:repository||'',bundleIdentifier:'cc.dreamskin.menubar'},null,2)+'\n');
  console.log('GUI updater disabled: publisher repository/signing key not configured.');
  process.exit(0);
}
if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw Error('Invalid update repository.');
const material=await fs.readFile(keyPath||privatePath,'utf8');
const key=createPublicKey(material);
if(key.asymmetricKeyType!=='ed25519')throw Error('The updater requires an Ed25519 key.');
const version=(await fs.readFile(versionPath,'utf8')).trim();
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid GUI version.');
await fs.mkdir(path.join(engine,'updater'),{recursive:true});
await fs.writeFile(path.join(engine,'updater/public-key.pem'),key.export({type:'spki',format:'pem'}));
await fs.writeFile(path.join(engine,'updater/channel.json'),JSON.stringify({repository,version,channel:'macos-gui-stable',bundleIdentifier:'cc.dreamskin.menubar'},null,2)+'\n');
