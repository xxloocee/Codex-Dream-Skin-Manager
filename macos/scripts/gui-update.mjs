import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const channel=JSON.parse(await fs.readFile(path.join(root,'updater/channel.json'),'utf8'));
if(channel.enabled===false){console.log(JSON.stringify({configured:false,currentVersion:channel.version,latestVersion:channel.version,updateAvailable:false,releaseUrl:''}));process.exit(0);}
const publicKey=await fs.readFile(path.join(root,'updater/public-key.pem'),'utf8');
const [action,argument]=process.argv.slice(2);
const MB=1024*1024;
const stateRoot=path.join(process.env.HOME,'Library/Application Support/CodexDreamSkinStudio');
const semver=v=>typeof v==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v);
const compare=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]?1:-1;}return 0;};
const hosts=new Set(['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
async function download(url,limit) {
  for(let i=0;i<6;i++){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||!hosts.has(parsed.hostname))throw Error('更新地址不在允许的 GitHub 服务中。');
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(limit>MB?180000:20000),headers:{'User-Agent':'CodexDreamSkinGUI-Updater','Accept':parsed.hostname==='api.github.com'?'application/vnd.github+json':'application/octet-stream'}});
    if(response.status>=300&&response.status<400){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('更新地址重定向无效。');url=new URL(location,url).href;continue;}
    if(!response.ok)throw Error(`更新服务返回 HTTP ${response.status}。`);
    if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('更新文件超过限制。');}
    const parts=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('更新文件超过限制。');parts.push(chunk);}
    return Buffer.concat(parts);
  }
  throw Error('更新地址重定向过多。');
}
async function latest() {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(channel.repository)||!semver(channel.version))throw Error('本地更新配置无效。');
  const releases=JSON.parse((await download(`https://api.github.com/repos/${channel.repository}/releases?per_page=30`,MB)).toString('utf8'));
  if(!Array.isArray(releases))throw Error('更新服务返回无效发布列表。');
  const release=releases.filter(r=>!r.draft&&!r.prerelease&&/^gui-v\d+\.\d+\.\d+$/.test(r.tag_name)).sort((a,b)=>compare(b.tag_name.slice(5),a.tag_name.slice(5)))[0];
  if(!release)throw Error('该仓库尚未发布 Mac GUI 更新。');
  const base=`https://github.com/${channel.repository}/releases/download/${release.tag_name}/`;
  const [bytes,signature]=await Promise.all([download(base+'gui-manifest.json',65536),download(base+'gui-manifest.sig',1024)]);
  if(!verify(null,bytes,publicKey,Buffer.from(signature.toString('utf8').trim(),'base64')))throw Error('更新清单签名无效，已拒绝安装。');
  const manifest=JSON.parse(bytes);
  if(manifest.version!==release.tag_name.slice(5)||manifest.channel!==channel.channel||manifest.bundleIdentifier!==channel.bundleIdentifier||!semver(manifest.version)||!Array.isArray(manifest.assets))throw Error('更新清单不兼容。');
  const arch=process.arch==='arm64'?'arm64':'x64';
  const name=`CodexDreamSkinGUI-${manifest.version}-${arch}.zip`;
  const asset=manifest.assets.find(a=>a.arch===arch);
  if(!asset||asset.name!==name||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>512*MB||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('没有兼容本机的安装包。');
  const url=`https://github.com/${channel.repository}/releases/download/gui-v${manifest.version}/${asset.name}`;
  return {manifest,asset,url,bytes,signature};
}
try {
  const release=await latest();
  const result={currentVersion:channel.version,latestVersion:release.manifest.version,updateAvailable:compare(release.manifest.version,channel.version)>0,releaseUrl:`https://github.com/${channel.repository}/releases/tag/gui-v${release.manifest.version}`};
  if(action==='check'){console.log(JSON.stringify(result));}
  else if(action==='prepare'){
    if(!result.updateAvailable||argument!==release.manifest.version)throw Error('更新版本已改变或不是新版本，请重新检查。');
    const updates=path.join(stateRoot,'updates');await fs.mkdir(updates,{recursive:true,mode:0o700});
    if((await fs.lstat(updates)).isSymbolicLink())throw Error('更新目录不安全。');
    const stage=await fs.mkdtemp(path.join(updates,'download-'));
    try {
      const zip=await download(release.url,release.asset.bytes);
      if(zip.length!==release.asset.bytes||createHash('sha256').update(zip).digest('hex')!==release.asset.sha256)throw Error('安装包 SHA-256 校验失败。');
      const archive=path.join(stage,'app.zip');await fs.writeFile(archive,zip,{flag:'wx',mode:0o600});
      // The archive is signed by this channel's publisher before extraction.
      const extracted=path.join(stage,'payload');await fs.mkdir(extracted,{mode:0o700});
      await run('/usr/bin/ditto',['-x','-k',archive,extracted],{timeout:120000,maxBuffer:MB});
      const app=path.join(extracted,'Codex Dream Skin GUI.app');
      if((await fs.lstat(app)).isSymbolicLink())throw Error('安装包应用无效。');
      await run('/usr/bin/codesign',['--verify','--deep','--strict',app],{timeout:120000,maxBuffer:MB});
      const plist=path.join(app,'Contents/Info.plist');
      const {stdout:identifier}=await run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',plist]);
      const {stdout:version}=await run('/usr/libexec/PlistBuddy',['-c','Print :DreamSkinGUIVersion',plist]);
      if(identifier.trim()!==channel.bundleIdentifier||version.trim()!==release.manifest.version)throw Error('安装包身份或版本不匹配。');
      const candidateChannel=JSON.parse(await fs.readFile(path.join(app,'Contents/Resources/engine/updater/channel.json'),'utf8'));
      const candidateKey=await fs.readFile(path.join(app,'Contents/Resources/engine/updater/public-key.pem'),'utf8');
      if(candidateChannel.repository!==channel.repository||candidateChannel.version!==release.manifest.version||candidateKey.trim()!==publicKey.trim())throw Error('安装包更新源不匹配。');
      console.log(JSON.stringify({...result,stagedApp:app,stage}));
    }catch(error){await fs.rm(stage,{recursive:true,force:true});throw error;}
  }else throw Error('Unknown update action.');
}catch(error){console.error(error.message);process.exitCode=1;}
