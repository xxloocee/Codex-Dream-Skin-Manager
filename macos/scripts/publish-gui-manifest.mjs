import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,createPrivateKey,sign} from 'node:crypto';
const [version,directory]=process.argv.slice(2),keyFile=process.env.DREAMSKIN_GUI_SIGNING_KEY_FILE;
if(!/^\d+\.\d+\.\d+$/.test(version)||!keyFile)throw Error('Version and DREAMSKIN_GUI_SIGNING_KEY_FILE are required.');
const key=createPrivateKey(await fs.readFile(keyFile));if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 signing key required.');
const assets=[];
for(const arch of ['arm64','x64']){
 const name=`CodexDreamSkinGUI-${version}-${arch}.zip`;
 try{const data=await fs.readFile(path.join(directory,name));assets.push({arch,name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
 catch(e){if(e.code!=='ENOENT')throw e;}
}
if(!assets.length)throw Error('No release archives.');
const data=Buffer.from(JSON.stringify({channel:'macos-gui-stable',version,bundleIdentifier:'cc.dreamskin.menubar',assets},null,2)+'\n');
await fs.writeFile(path.join(directory,'gui-manifest.json'),data);
await fs.writeFile(path.join(directory,'gui-manifest.sig'),sign(null,data,key).toString('base64')+'\n');
console.log(`Signed GUI ${version}: ${assets.map(x=>x.arch).join(', ')}`);
