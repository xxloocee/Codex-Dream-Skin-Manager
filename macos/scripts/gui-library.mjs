import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {readPackage,writePackage} from './gui-package.mjs';
import {decodeAndValidateSafeCss} from '../assets/safe-css-validator.mjs';
const [stateRoot,action,...args]=process.argv.slice(2),root=path.join(stateRoot,'themes'),scripts=path.dirname(fileURLToPath(import.meta.url));
const run=promisify(execFile),MB=1024*1024;
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id);
async function read(file,limit=MB) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const stat=await handle.stat();if(!stat.isFile()||stat.size<1||stat.size>limit) throw Error('文件大小或类型无效。');return await handle.readFile(); } finally {await handle.close();}
}
async function json(file) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await read(file)));}
async function optional(file,limit) {try{return await read(file,limit);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function directory(id) {
  if(!idOK(id)) throw Error('主题 ID 无效。');
  const dir=path.join(root,id),stat=await fs.lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(dir)!==path.join(await fs.realpath(root),id)) throw Error('主题目录不安全。');
  return dir;
}
function normalized(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw Error('主题配置无效。');
  const theme=structuredClone(raw);
  if(typeof theme.name!=='string'||!theme.name.trim()||theme.name.length>80||/[\x00-\x1f\x7f]/.test(theme.name)) throw Error('名称须为 1–80 个字符。');
  if(!['dream','nature','cyber','minimal','dark','warm','custom','uncategorized'].includes(theme.category??'custom')) throw Error('分类无效。');
  theme.category??='custom';theme.tags??=[];
  if(!Array.isArray(theme.tags)||theme.tags.length>8||theme.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>20)) throw Error('最多 8 个标签，每个 1–20 个字符。');
  theme.appearance??='auto';if(!['auto','light','dark'].includes(theme.appearance)) throw Error('外观参数无效。');
  theme.art??={};const a=theme.art;
  if(!a||typeof a!=='object'||Array.isArray(a)) throw Error('取景参数无效。');
  for(const [key,min,max] of [['focusX',0,1],['focusY',0,1],['positionX',-1,1],['positionY',-1,1],['zoom',1,2],['bubbleOpacity',0,1],['surfaceOpacity',0,1]]) {
    if(a[key]!==undefined && (typeof a[key]!=='number'||!Number.isFinite(a[key])||a[key]<min||a[key]>max)) throw Error(`${key} 超出范围。`);
  }
  for(const [key,values] of [['positionMode',['locked','free']],['safeArea',['auto','left','right','center','none']],['taskMode',['auto','ambient','banner','full','off']]]) if(a[key]!==undefined&&!values.includes(a[key])) throw Error(`${key} 无效。`);
  if(a.framingEnabled===false) for(const key of ['positionX','positionY','zoom','positionMode']) delete a[key];
  if(theme.colors!==undefined&&(!theme.colors||typeof theme.colors!=='object'||Array.isArray(theme.colors))) throw Error('颜色参数无效。');
  if(theme.colors?.accent && !/^#[0-9a-f]{6}$/i.test(theme.colors.accent)) throw Error('强调色须为 #RRGGBB。');
  if(typeof theme.image!=='string'||path.basename(theme.image)!==theme.image||!/\.(png|apng|jpe?g|webp|gif|mp4)$/i.test(theme.image)) throw Error('支持 PNG/APNG/JPEG/WebP/GIF/MP4；HEIC/TIFF 请先转换为 PNG。');
  if(theme.originalImage!==undefined && (typeof theme.originalImage!=='string'||!theme.originalImage||path.basename(theme.originalImage)!==theme.originalImage||/[\\\x00-\x1f\x7f]/.test(theme.originalImage)||['.','..','theme.json','theme.css','license.txt',theme.image.toLowerCase()].includes(theme.originalImage.toLowerCase()))) throw Error('原始素材文件名无效。');
  theme.schemaVersion=1;
  delete theme.managerFingerprint;delete theme.managerFingerprintVersion;
  return theme;
}
async function atomic(file,bytes) {const tmp=path.join(path.dirname(file),'.gui-write-'+randomUUID());try{await fs.writeFile(tmp,bytes,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}}
async function readTheme(id) {const dir=await directory(id),theme=await json(path.join(dir,'theme.json'));if(theme.id!==id)throw Error('主题 ID 不匹配。');return {dir,theme:normalized(theme)};}
async function protectedIDs() {
  const ids=new Set(['preset-gothic-void-crusade']);
  for(const file of [path.join(stateRoot,'theme/theme.json'),path.join(stateRoot,'state.json')]) {
    try {const value=await json(file);for(const key of ['id','themeId','appliedThemeId']) if(value[key])ids.add(value[key]);}
    catch(e){if(e.code!=='ENOENT')throw Error('无法确认当前主题，已取消删除。');}
  }
  return ids;
}
function encode(value) {return Buffer.from(JSON.stringify(value,null,2)+'\n');}
function fingerprint(theme,media,css) {
  const a=theme.art??{}, framing=a.framingEnabled===true||['positionX','positionY','zoom','positionMode'].some(k=>Object.hasOwn(a,k));
  // Stable, explicitly ordered rendering fields. Names/categories/tags are labels.
  // Missing focus uses renderer image analysis, not an explicit centered crop.
  const render={appearance:theme.appearance??'auto',focusX:a.focusX??null,focusY:a.focusY??null,
    framing,positionX:framing?(a.positionX??0):0,positionY:framing?(a.positionY??0):0,
    zoom:framing?(a.zoom??1):1,positionMode:framing?(a.positionMode??'locked'):'locked',
    safeArea:a.safeArea??'auto',taskMode:a.taskMode??'auto',bubbleOpacity:a.bubbleOpacity??0,
    surfaceOpacity:a.surfaceOpacity??0.8,accent:(theme.colors?.accent??'').toUpperCase()};
  return createHash('sha256').update(JSON.stringify(render)).update(media).update(css??'').digest('hex');
}
async function duplicate(theme,media,css) {
  const hash=fingerprint(theme,media,css);
  for(const id of await fs.readdir(root)) {
    if(!idOK(id))continue;
    try {
      const old=await readTheme(id),bytes=await read(path.join(old.dir,old.theme.image),128*MB),oldCSS=await optional(path.join(old.dir,'theme.css'),256*1024);
      if(fingerprint(old.theme,bytes,oldCSS)===hash)return {id,name:old.theme.name,duplicate:true};
    } catch { /* Invalid existing themes cannot suppress a valid import. */ }
  }
  return null;
}
async function publish(theme,media,css,license,originalMedia=null) {
  const id='custom-'+randomUUID(),stage=path.join(stateRoot,'.gui-import-'+randomUUID());
  await fs.mkdir(stage,{mode:0o700});
  try {
    theme.id=id;await fs.writeFile(path.join(stage,theme.image),media,{mode:0o600});
    await run(process.execPath,[path.join(scripts,'validate-image-macos.mjs'),path.join(stage,theme.image)],{timeout:120000,maxBuffer:MB});
    if(css){decodeAndValidateSafeCss(css);await fs.writeFile(path.join(stage,'theme.css'),css);}
    if(license)await fs.writeFile(path.join(stage,'LICENSE.txt'),license);
    if(theme.originalImage!==undefined) {
      if(!originalMedia)throw Error('原始素材缺失，已取消另存。');
      await fs.writeFile(path.join(stage,theme.originalImage),originalMedia,{flag:'wx',mode:0o600});
    }
    await fs.writeFile(path.join(stage,'theme.json'),encode(theme));
    await fs.rename(stage,path.join(root,id));
    return {id,name:theme.name};
  } finally {await fs.rm(stage,{recursive:true,force:true});}
}
let result;
try {
  await fs.mkdir(root,{recursive:true,mode:0o700});
  if((await fs.lstat(root)).isSymbolicLink())throw Error('主题库不能是链接。');
  if(action==='delete') {
    const {dir,theme}=await readTheme(args[0]);
    if((await protectedIDs()).has(theme.id))throw Error('当前主题和默认恢复主题不能删除，请先切换其他主题。');
    const retired=path.join(stateRoot,'.gui-deleted-'+randomUUID());
    let marker;
    if(theme.id.startsWith('preset-')) {
      const markers=path.join(stateRoot,'deleted-presets');await fs.mkdir(markers,{recursive:true,mode:0o700});
      if((await fs.lstat(markers)).isSymbolicLink())throw Error('删除记录目录不安全。');
      marker=path.join(markers,theme.id);await atomic(marker,encode({id:theme.id,deletedAt:new Date().toISOString()}));
    }
    try {await fs.rename(dir,retired);}catch(error){if(marker)await fs.rm(marker,{force:true});throw error;}
    if(theme.id.startsWith('preset-')) result={trashPath:retired,name:theme.name};
    else {await fs.rm(retired,{recursive:true,force:true});result={deleted:true,name:theme.name};}
  } else if(action==='save') {
    const {dir,theme}=await readTheme(args[0]),request=await json(args[1]);
    if(request.expectedHash!==createHash('sha256').update(await read(path.join(dir,'theme.json'))).digest('hex'))throw Error('主题已被其他操作修改，请刷新后再保存。');
    const next=normalized({...theme,...request.config,id:theme.id,image:theme.image,originalImage:theme.originalImage});
    if(request.copy) {
      const original=theme.originalImage===undefined?null:await read(path.join(dir,theme.originalImage),128*MB);
      result=await publish(next,await read(path.join(dir,theme.image),128*MB),await optional(path.join(dir,'theme.css'),256*1024),await optional(path.join(dir,'LICENSE.txt'),65536),original);
    }
    else {await atomic(path.join(dir,'theme.json'),encode(next));result={id:theme.id,name:next.name};}
  } else if(action==='create') {
    const request=await json(args[0]);
    if(typeof request.mediaPath!=='string')throw Error('缺少媒体路径。');
    const theme=normalized({...request.config,image:'background'+path.extname(request.mediaPath).toLowerCase()});
    const media=await read(request.mediaPath,128*MB);
    result=await duplicate(theme,media,null)??await publish(theme,media,null,null);
  } else if(action==='import') {
    const pkg=readPackage(await read(args[0],160*MB)),m=pkg.manifest;
    const theme=normalized({schemaVersion:1,name:m.name,category:m.category,tags:m.tags,appearance:m.appearance,image:'background'+path.extname(m.image).toLowerCase(),art:m.art,colors:m.palette?.accent?{accent:m.palette.accent}:{}});
    if(pkg.css)decodeAndValidateSafeCss(pkg.css);
    result=await duplicate(theme,pkg.media,pkg.css)??await publish(theme,pkg.media,pkg.css,pkg.license);
  } else if(action==='export') {
    const {dir,theme}=await readTheme(args[0]),name='art'+path.extname(theme.image).toLowerCase();
    if(!/\.(png|apng|jpe?g|webp|gif|mp4)$/.test(name))throw Error('Windows 主题包不支持 HEIC/TIFF，请先使用 PNG/JPEG。');
    const manifest={formatVersion:1,id:theme.id,name:theme.name,image:name,category:theme.category,tags:theme.tags,appearance:theme.appearance,art:theme.art,palette:theme.colors?.accent?{accent:theme.colors.accent}:{}};
    const files=new Map([['manifest.json',encode(manifest)],[name,await read(path.join(dir,theme.image),128*MB)]]);
    const css=await optional(path.join(dir,'theme.css'),256*1024),license=await optional(path.join(dir,'LICENSE.txt'),65536);
    if(css){decodeAndValidateSafeCss(css);files.set('theme.css',css);}if(license)files.set('LICENSE.txt',license);
    const target=path.resolve(args[1]),stateReal=await fs.realpath(stateRoot),targetParent=await fs.realpath(path.dirname(target));
    if(targetParent===stateReal||targetParent.startsWith(stateReal+path.sep))throw Error('请将导出包保存到主题库之外。');
    await atomic(target,writePackage(files));result={exported:target};
  } else throw Error('未知主题管理操作。');
  console.log(JSON.stringify(result));
} catch(error) {console.error(error.stderr?.trim()||error.message);process.exitCode=1;}
