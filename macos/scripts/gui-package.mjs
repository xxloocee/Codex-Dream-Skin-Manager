// Windows .cdskin formatVersion 1 ZIP codec. No shell extraction or dependencies.
import { inflateRawSync, deflateRawSync } from 'node:zlib';
const MB = 1024 * 1024;
const table = Array.from({length: 256}, (_, n) => { for (let k=0;k<8;k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc(bytes) { let n=0xffffffff; for (const b of bytes) n=table[(n^b)&255]^(n>>>8); return (n^0xffffffff)>>>0; }
function nameOK(name) { return /^[^\x00-\x1f\x7f/\\:]+$/.test(name) && name!=='.' && name!=='..' && !/\.(zip|cdskin)$/i.test(name); }
export function readPackage(bytes) {
  if (bytes.length>160*MB || bytes.length<22) throw Error('主题包大小无效（上限 160 MiB）。');
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) {
    if(bytes.readUInt32LE(p)===0x06054b50 && p+22+bytes.readUInt16LE(p+20)===bytes.length){end=p;break;}
  }
  if(end<0) throw Error('找不到 ZIP 文件目录。');
  const count=bytes.readUInt16LE(end+10), centralSize=bytes.readUInt32LE(end+12), centralStart=bytes.readUInt32LE(end+16);
  if(bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||bytes.readUInt16LE(end+8)!==count||count<2||count>4||centralStart+centralSize!==end) throw Error('只支持包含 2–4 个文件的单卷主题包。');
  const files=new Map(), spans=[]; let pos=centralStart,total=0;
  for(let i=0;i<count;i++) {
    if(pos+46>end||bytes.readUInt32LE(pos)!==0x02014b50) throw Error('ZIP 文件目录损坏。');
    const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10), checksum=bytes.readUInt32LE(pos+16), compressed=bytes.readUInt32LE(pos+20), expanded=bytes.readUInt32LE(pos+24), nl=bytes.readUInt16LE(pos+28),el=bytes.readUInt16LE(pos+30),cl=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42),mode=bytes.readUInt32LE(pos+38)>>>16;
    if(pos+46+nl+el+cl>end || (flags & ~0x0808) || ![0,8].includes(method) || bytes.readUInt16LE(pos+34)!==0 || ((mode&0xf000)!==0 && (mode&0xf000)!==0x8000)) throw Error('不支持加密、链接或目录条目。');
    const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(pos+46,pos+46+nl));
    if(!nameOK(name)||[...files.keys()].some(x=>x.toLowerCase()===name.toLowerCase())) throw Error('主题包路径或重复文件名无效。');
    total+=expanded;
    const cap=name.toLowerCase()==='manifest.json'?MB:name.toLowerCase()==='theme.css'?256*1024:name.toLowerCase()==='license.txt'?64*1024:128*MB;
    if(expanded<1||expanded>cap||total>192*MB||offset+30>centralStart||bytes.readUInt32LE(offset)!==0x04034b50) throw Error('主题包文件大小或偏移无效。');
    const localNL=bytes.readUInt16LE(offset+26), localEL=bytes.readUInt16LE(offset+28),start=offset+30+localNL+localEL;
    if(start+compressed>centralStart||bytes.readUInt16LE(offset+6)!==flags||bytes.readUInt16LE(offset+8)!==method || !bytes.subarray(offset+30,offset+30+localNL).equals(bytes.subarray(pos+46,pos+46+nl))) throw Error('ZIP 本地记录与目录不一致。');
    if(!(flags&8) && (bytes.readUInt32LE(offset+14)!==checksum||bytes.readUInt32LE(offset+18)!==compressed||bytes.readUInt32LE(offset+22)!==expanded)) throw Error('ZIP 长度记录不一致。');
    const stop=start+compressed;
    if(spans.some(([a,b])=>offset<b&&stop>a)) throw Error('ZIP 包含重叠条目。');
    spans.push([offset,stop]);
    const raw=bytes.subarray(start,stop),data=method===8?inflateRawSync(raw,{maxOutputLength:expanded}):Buffer.from(raw);
    if(data.length!==expanded||crc(data)!==checksum) throw Error('主题包内容校验失败。');
    files.set(name,data);pos+=46+nl+el+cl;
  }
  if(pos!==end) throw Error('ZIP 目录长度不一致。');
  const manifestKey=[...files.keys()].find(x=>x.toLowerCase()==='manifest.json');
  if(!manifestKey) throw Error('缺少 manifest.json。');
  const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get(manifestKey)));
  if(manifest.formatVersion!==1) throw Error('只支持 Windows formatVersion 1 主题包。');
  if(typeof manifest.image!=='string'||!nameOK(manifest.image)||! /\.(png|apng|jpe?g|webp|gif|mp4)$/i.test(manifest.image)) throw Error('主题媒体名称无效。');
  const mediaKey=[...files.keys()].find(x=>x.toLowerCase()===manifest.image.toLowerCase());
  if(!mediaKey) throw Error('主题背景缺失。');
  const allowed=new Set([manifestKey.toLowerCase(),mediaKey.toLowerCase(),'theme.css','license.txt']);
  if([...files.keys()].some(x=>!allowed.has(x.toLowerCase()))) throw Error('主题包包含未注册文件。');
  return {manifest,media:files.get(mediaKey),css:files.get([...files.keys()].find(x=>x.toLowerCase()==='theme.css')),license:files.get([...files.keys()].find(x=>x.toLowerCase()==='license.txt'))};
}
export function writePackage(files) {
  const local=[],central=[];let offset=0;
  for(const [name,data] of files) {
    if(!nameOK(name)) throw Error('导出文件名无效。');
    const nameBytes=Buffer.from(name),compressed=deflateRawSync(data), checksum=crc(data);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt32LE(checksum,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(nameBytes.length,26);
    local.push(header,nameBytes,compressed);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(nameBytes.length,28);directory.writeUInt32LE(offset,42);
    central.push(directory,nameBytes);offset+=30+nameBytes.length+compressed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  const output=Buffer.concat([...local,directory,end]);
  if(output.length>160*MB) throw Error('导出包超过 160 MiB。');
  return output;
}
