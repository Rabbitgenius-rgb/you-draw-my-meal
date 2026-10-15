#!/usr/bin/env node
'use strict';
// Original, code-native demo drawings. This script reads only the explicitly
// cleared stroke seed; it does not read browser history, backups or credentials.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const DATE='2026-10-15T00:00:00.000Z';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const colors={ink:'#342a25',red:'#d94335',yellow:'#f2b630',green:'#64836a'};
const line=(xy,color=colors.ink,width=.006)=>({color,width,erase:false,points:xy.map(([x,y])=>({x,y}))});
const oval=(cx,cy,rx,ry,color=colors.ink,width=.006,angle=0)=>line(Array.from({length:65},(_,i)=>{const t=i*Math.PI/32,x=rx*Math.cos(t),y=ry*Math.sin(t);return [cx+x*Math.cos(angle)-y*Math.sin(angle),cy+x*Math.sin(angle)+y*Math.cos(angle)];}),color,width);
function fries(){
  const s=[];
  // A paper cup grows overlarge fried-potato petals; no logo or character.
  s.push(line([[.33,.54],[.39,.79],[.66,.76],[.70,.52],[.33,.54]],colors.red));
  s.push(line([[.34,.55],[.50,.60],[.68,.53]],colors.red));
  for(const [x,y,a] of [[.28,.25,-.6],[.43,.18,-.2],[.60,.20,.3],[.74,.32,.8]]){
    s.push(oval(x,y,.048,.16,colors.yellow,.008,a));
    s.push(line([[.50,.55],[x,y+.08]],colors.green,.004));
  }
  s.push(oval(.50,.40,.085,.075,colors.red));
  s.push(line([[.475,.38],[.477,.39]],colors.ink,.009),line([[.525,.38],[.523,.39]],colors.ink,.009));
  s.push(line([[.46,.42],[.49,.44],[.53,.41]],colors.red));
  s.push(line([[.50,.59],[.49,.69],[.55,.65]],colors.ink));
  s.push(line([[.25,.53],[.18,.51],[.16,.47]],colors.red),line([[.76,.58],[.83,.54],[.86,.49]],colors.red));
  s.push(line([[.39,.80],[.34,.84],[.27,.83]],colors.ink),line([[.65,.78],[.71,.82],[.78,.80]],colors.ink));
  s.push(line([[.15,.26],[.11,.24]],colors.red),line([[.80,.18],[.83,.13]],colors.red));
  return s;
}
function cola(){
  const s=[];
  // A wonky drink cup as a small rocket, with its own impossible straw.
  s.push(line([[.36,.33],[.42,.66],[.66,.63],[.73,.29]],colors.ink));
  s.push(oval(.545,.31,.19,.045,colors.red,.007,-.12));
  s.push(line([[.40,.46],[.70,.43]],colors.red),line([[.42,.59],[.68,.56]],colors.red));
  s.push(line([[.57,.30],[.60,.21],[.54,.16],[.67,.10],[.78,.14]],colors.red,.009));
  s.push(oval(.54,.50,.055,.045,colors.ink));
  s.push(line([[.38,.49],[.25,.63],[.43,.59]],colors.red),line([[.69,.46],[.80,.58],[.67,.58]],colors.red));
  s.push(line([[.45,.67],[.37,.82],[.50,.75],[.53,.89],[.59,.74],[.65,.80],[.63,.65]],colors.yellow,.009));
  for(const [x,y,r] of [[.23,.34,.035],[.79,.26,.022],[.22,.75,.018],[.74,.82,.035]])s.push(oval(x,y,r,r,colors.red,.005));
  s.push(line([[.15,.58],[.11,.59]],colors.ink),line([[.84,.41],[.89,.38]],colors.ink));
  return s;
}
function buildPublicExamples(seed){
  if(seed.title!=='霸！'||!Array.isArray(seed.strokes)||seed.strokes.length!==8)throw new Error('需要获准公开的霸原笔迹种子');
  const store={id:'public-example-store-v1',name:'原创示例 · 今天这一桌',source:'example',area:'示例',address:'仅用于画册和餐纸演示'};
  const definitions=[['ba','霸！','汉堡（作品主题）',seed.strokes],['fries','薯条开花','薯条（作品主题）',fries()],['cola','可乐起飞','可乐（作品主题）',cola()]];
  const artworks=[],versions=[];
  for(const [key,title,mealName,strokes] of definitions){
    const id='public-example-art-'+key+'-v1',meal={id:'public-example-meal-'+key+'-v1',name:mealName,alias:[],source:'example',image:'',tag:'原创演示'};
    const payload={storeId:store.id,mealId:meal.id,mode:'solo',storeSnapshot:store,mealSnapshot:meal,title,createdAt:DATE,strokes:JSON.parse(JSON.stringify(strokes)),thumbnail:'',titleEmbedded:false};
    const digest=hash(payload),versionId='public-version-'+key+'-'+digest.slice(0,20);
    versions.push({id:versionId,artId:id,hash:digest,payload});
    artworks.push({id,currentVersionId:versionId,revision:1,albumOrder:artworks.length,isPublic:false,consentAt:null});
  }
  const ids=artworks.map(a=>a.id),plan={id:'public-example-paper-v1',version:2,revision:1,refs:artworks.map(a=>({artId:a.id,versionId:a.currentVersionId})),artIds:ids,templateId:'whitespace-v1',rendererVersion:'templates-v1',layout:0,title:'今天这桌，有点想象力',signature:'',scales:Object.fromEntries(ids.map(id=>[id,1.15])),artTitleStyles:Object.fromEntries(ids.map(id=>[id,{visible:true,scale:1}])),showArtworkTitles:true,showDate:false,showStore:false,createdAt:DATE,updatedAt:DATE};
  return {format:'draw-my-meal-backup',version:1,exportedAt:DATE,data:{settings:{storeId:'',mode:'solo'},catalog:{stores:[],menus:{}},artworks,versions,assets:[],plans:[plan],drafts:[],legacyArchives:[]},example:{id:'public-original-trio-v1',title:'原创三联 · 私密示例',description:'霸原笔迹与两幅新原创笔迹。无人物、影视或品牌图案参考；非实时菜单，默认私密。',sourceNotes:'霸按素材说明限本项目演示；薯条开花和可乐起飞为代码原生新创作，采用 MIT。详见 docs/MATERIAL_SOURCES.md。'}};
}
if(require.main===module){const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'../web/examples/ba-strokes.json'),'utf8'));fs.writeFileSync(path.join(__dirname,'../web/examples/original-trio.json'),JSON.stringify(buildPublicExamples(seed),null,2)+'\n');console.log('已生成 3 幅私密示例和 1 个餐纸方案。');}
module.exports={buildPublicExamples,hash,canonical};
