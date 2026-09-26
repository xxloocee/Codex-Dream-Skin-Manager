import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const [requestPath,loaderPath]=process.argv.slice(2);
if(!requestPath||!loaderPath)throw Error('Missing batch request or runtime path.');
const request=JSON.parse(await fs.readFile(requestPath,'utf8'));
if(request?.schemaVersion!==1||!Array.isArray(request.items)||!request.items.length||request.items.length>50)throw Error('每批需包含 1–50 项。');
const run=promisify(execFile),results=[];
for(const item of request.items) {
  const temp=path.join(path.dirname(requestPath),'gui-item-'+randomUUID()+'.json');
  const name=typeof item?.name==='string'?item.name:'';
  try {
    if(typeof item?.imagePath!=='string'||!item.imagePath)throw Error('缺少媒体路径。');
    const art={focusX:item.focusX??0.5,focusY:item.focusY??0.5,safeArea:item.safeArea??'auto',taskMode:item.taskMode??'auto',bubbleOpacity:item.bubbleOpacity??0,surfaceOpacity:item.surfaceOpacity??0.8};
    const framing=item.framingEnabled??['positionX','positionY','zoom','positionMode'].some(k=>Object.hasOwn(item,k));
    if(typeof framing!=='boolean')throw Error('取景开关无效。');
    if(framing)Object.assign(art,{framingEnabled:true,positionX:item.positionX??0,positionY:item.positionY??0,zoom:item.zoom??1,positionMode:item.positionMode??'locked'});
    const config={name:name||path.basename(item.imagePath,path.extname(item.imagePath)),category:item.category??'custom',tags:item.tags??[],appearance:item.appearance??'auto',art,colors:item.accent?{accent:item.accent}:{}};
    await fs.writeFile(temp,JSON.stringify({mediaPath:item.imagePath,config}),{flag:'wx',mode:0o600});
    const {stdout}=await run('/bin/bash',[path.join(path.dirname(loaderPath),'gui-library.sh'),'create',temp],{maxBuffer:1024*1024,timeout:180000});
    const saved=JSON.parse(stdout);
    results.push({name,status:saved.duplicate?'skipped':'imported',message:saved.duplicate?'相同媒体和显示参数已存在。':'',themeDirectory:path.join(process.env.HOME,'Library/Application Support/CodexDreamSkinStudio/themes',saved.id)});
  }catch(error){results.push({name,status:'failed',message:error.stderr?.trim()||error.message});}
  finally{await fs.rm(temp,{force:true});}
}
const count=status=>results.filter(x=>x.status===status).length;
console.log(JSON.stringify({imported:count('imported'),skipped:count('skipped'),failed:count('failed'),results}));
