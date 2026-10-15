(function (root, factory) {
  const paper = factory();
  if (typeof module === 'object' && module.exports) module.exports = paper;
  else root.MealPaper = paper;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STORAGE_KEY = 'draw-my-meal-papers-v1';
  const DEFAULT_TITLE = '今天的好吃，都是我画的';
  const EXPORT_WIDTH = 4961, EXPORT_HEIGHT = 3508;
  const TEMPLATE_RENDERER_VERSION='templates-v1';
  const TEMPLATES=[{id:'whitespace-v1',label:'留白'},{id:'tile-v1',label:'规则满铺'},{id:'collage-v1',label:'错落拼贴'}];
  const TEMPLATE_IDS=TEMPLATES.map(template=>template.id);
  const boundsCache = new WeakMap();
  const imageCache = new Map();
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function makePlan(value = {}) {
    const artIds = [...new Set((Array.isArray(value.artIds) ? value.artIds : []).filter(id => typeof id === 'string'))];
    const scales = {},artTitleStyles = {};
    artIds.forEach(id => {
      const n = Number(value.scales && value.scales[id]); scales[id] = Number.isFinite(n) && n > 0 ? clamp(n, .8, 1.2) : 1;
      const style=value.artTitleStyles && value.artTitleStyles[id],size=Number(style && style.scale);
      artTitleStyles[id]={visible:!style || style.visible !== false,scale:Number.isFinite(size) && size>0 ? clamp(size,.8,1.4) : 1};
    });
    const layout=clamp(Math.floor(Number(value.layout) || 0),0,2);
    const refs=artIds.map(artId=>{const ref=(Array.isArray(value.refs)?value.refs:[]).find(r=>r && r.artId===artId);return ref && typeof ref.versionId==='string' ? {artId,versionId:ref.versionId} : null;}).filter(Boolean);
    const templateId=typeof value.templateId==='string' ? value.templateId : 'legacy-'+layout;
    const legacyTemplateId=/^legacy-[0-2]$/.test(value.legacyTemplateId || '')?value.legacyTemplateId:(typeof value.id==='string' && templateId.startsWith('legacy-')?'legacy-'+layout:'');
    return {version:2,...(legacyTemplateId?{legacyTemplateId}:{}),...(Array.isArray(value.missingArtIds)?{missingArtIds:value.missingArtIds.filter(id=>artIds.includes(id))}:{}),revision:Number.isInteger(value.revision) && value.revision>=0 ? value.revision : 0,refs,
      templateId,rendererVersion:typeof value.rendererVersion==='string' ? value.rendererVersion : TEMPLATE_IDS.includes(templateId)?TEMPLATE_RENDERER_VERSION:'legacy-v1',id:typeof value.id === 'string' ? value.id : 'paper-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8),
      artIds,scales,artTitleStyles,showArtworkTitles:value.showArtworkTitles !== false,title:String(value.title || DEFAULT_TITLE).trim().slice(0,24) || DEFAULT_TITLE,
      signature:String(value.signature || '').trim().slice(0,16),layout,
      showDate:value.showDate !== false,showStore:value.showStore !== false,
      createdAt:value.createdAt || new Date().toISOString(),updatedAt:value.updatedAt || new Date().toISOString()};
  }
  function readPlans(adapter) {
    try { const plans = JSON.parse(adapter.getItem(STORAGE_KEY) || '[]'); return Array.isArray(plans) ? plans.filter(p => p && [1,2].includes(p.version) && typeof p.id === 'string' && Array.isArray(p.artIds)).map(makePlan) : []; }
    catch (_) { return []; }
  }
  function resolve(plan, artworks) {
    const byId = new Map(),refs=new Map((plan.refs || []).map(r=>[r.artId,r.versionId]));
    artworks.forEach(art=>{if(!refs.has(art.id) || refs.get(art.id)===art.versionId)byId.set(art.id,art);});
    return {artworks:plan.artIds.filter(id => byId.has(id)).map(id => byId.get(id)),missing:plan.artIds.filter(id => !byId.has(id))};
  }
  function validate(plan, artworks) {
    if (plan.artIds.length < 3 || plan.artIds.length > 6) throw new Error('请选择 3～6 张自己的画作');
    if (new Set(plan.artIds).size !== plan.artIds.length) throw new Error('请勿重复选择同一张画作');
    if (resolve(plan,artworks).missing.length) throw new Error('部分保存版本无法读取，请重新选画');
  }
  function savePlan(adapter, plans, value, artworks) {
    const plan = makePlan({...value,updatedAt:new Date().toISOString()}); validate(plan,artworks);
    const next = [plan,...plans.filter(p => p.id !== plan.id)];
    adapter.setItem(STORAGE_KEY,JSON.stringify(next)); return next;
  }
  function move(ids, index, direction) {
    const next = ids.slice(), target = index + direction;
    if (index >= 0 && target >= 0 && index < next.length && target < next.length) [next[index],next[target]] = [next[target],next[index]];
    return next;
  }
  function replay(ctx, strokes, size) {
    ctx.save();
    for (const stroke of strokes) {
      if (!stroke.points || !stroke.points.length) continue;
      ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = stroke.color; ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width * size; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const points = stroke.points; ctx.beginPath();
      if (points.length === 1) { ctx.arc(points[0].x*size,points[0].y*size,ctx.lineWidth/2,0,Math.PI*2); ctx.fill(); }
      else { ctx.moveTo(points[0].x*size,points[0].y*size); for (let i=1;i<points.length;i++) ctx.lineTo(points[i].x*size,points[i].y*size); ctx.stroke(); }
    }
    ctx.restore();
  }
  function pixelBounds(data, size) {
    let left=size,top=size,right=-1,bottom=-1;
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) if (data[(y*size+x)*4+3]>8) { left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y); }
    if (right<0) return null;
    const pad=3; left=Math.max(0,left-pad);top=Math.max(0,top-pad);right=Math.min(size,right+pad+1);bottom=Math.min(size,bottom+pad+1);
    return {x:left/size,y:top/size,width:(right-left)/size,height:(bottom-top)/size};
  }
  function drawingBounds(artwork, createCanvas) {
    if (artwork.kind === 'image') {
      const image=imageCache.get(artwork.imageSource)?.image;
      if (!image) throw new Error('图片作品尚未载入，请稍后重试');
      const side=Math.max(image.naturalWidth || image.width,image.naturalHeight || image.height);
      return {x:0,y:0,width:(image.naturalWidth || image.width)/side,height:(image.naturalHeight || image.height)/side};
    }
    if (boundsCache.has(artwork.strokes)) return boundsCache.get(artwork.strokes);
    const mask=createCanvas(384,384),ctx=mask.getContext('2d',{willReadFrequently:true});
    replay(ctx,artwork.strokes,384);
    const bounds=pixelBounds(ctx.getImageData(0,0,384,384).data,384);
    boundsCache.set(artwork.strokes,bounds); return bounds;
  }
  async function prepareImages(artworks, loader) {
    const load=loader || (source=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片作品读取失败，请重新打开画册'));image.src=source;}));
    await Promise.all(artworks.filter(a=>a.kind==='image').map(art=>{
      const source=art.imageSource;
      if (!imageCache.has(source)) {
        const entry={image:null,promise:null};
        entry.promise=Promise.resolve().then(()=>load(source)).then(image=>{entry.image=image;}).catch(error=>{imageCache.delete(source);throw error;});
        imageCache.set(source,entry);
      }
      return imageCache.get(source).promise;
    }));
  }
  function positions(count, variant) {
    const top = count >= 6 ? [[.17,.25,.22],[.50,.19,.21],[.83,.25,.22]] : [[.20,.27,.25],[.80,.27,.25]];
    const bottom = count === 3 ? [[.50,.76,.22]] : count === 4 ? [[.20,.74,.25],[.80,.74,.25]] : [[.18,.74,.22],[.50,.78,.21],[.82,.74,.22]];
    return top.concat(bottom).map(([x,y,size],i) => ({x:x + (variant===1 ? (i%2?.018:-.018) : 0),y:y + (variant===2 ? (i%2?.016:-.016) : 0),size:size*(variant===2?.94:1),angle:((i%2?1:-1)*(variant===1?9:variant===2?3:6))*Math.PI/180}));
  }
  function wrap(ctx, text, maxWidth) {
    const lines=[]; let line='';
    for (const character of text) { if (line && ctx.measureText(line+character).width>maxWidth) { lines.push(line);line=character; } else line+=character; }
    if (line) lines.push(line); return lines;
  }
  // Capture all export inputs before the first await. Later edits cannot change pixels or filename.
  function captureExport(value, artworks) {
    const plan=makePlan(JSON.parse(JSON.stringify(value)));
    const resolved=resolve(plan,artworks);validate(plan,resolved.artworks);
    return {plan,artworks:JSON.parse(JSON.stringify(resolved.artworks)),filename:plan.title+'-餐纸.png'};
  }
  // Kept as an alias for already-generated sample scripts and manifests.
  const CANDIDATE_TEMPLATES=TEMPLATE_IDS;
  function templatePositions(count,templateId) {
    if(templateId==='whitespace-v1')return positions(count,0).map((slot,i)=>({...slot,index:i}));
    if(templateId==='tile-v1')return Array.from({length:20},(_,i)=>({x:(i%5+.5)/5,y:(Math.floor(i/5)+.5)/4,size:.17,angle:0,index:i%count}));
    if(templateId==='collage-v1')return [[.10,.16,.23,-14],[.36,.17,.25,7],[.66,.16,.24,-8],[.91,.22,.22,15],[.18,.46,.30,12],[.78,.46,.31,-13],[.08,.78,.21,-7],[.36,.81,.26,14],[.64,.82,.25,-12],[.91,.77,.22,8]].map(([x,y,size,angle],i)=>({x,y,size,angle:angle*Math.PI/180,index:i%count}));
    return positions(count,Number(templateId?.slice(-1)) || 0).map((slot,i)=>({...slot,index:i}));
  }
  function renderTemplate(canvas,value,artworks,createCanvas,core,templateId) {
    if(!TEMPLATE_IDS.includes(templateId))throw new Error('未知样张模板');
    const plan=makePlan({...value,templateId,rendererVersion:TEMPLATE_RENDERER_VERSION});
    return renderComposition(canvas,plan,artworks,createCanvas,core,true);
  }
  function render(canvas,value,artworks,createCanvas,core) {
    const plan=makePlan(value),isTemplate=TEMPLATE_IDS.includes(plan.templateId);
    if(isTemplate && ![TEMPLATE_RENDERER_VERSION,'candidate-v1'].includes(plan.rendererVersion))throw new Error('餐纸排版版本暂不支持，请选择一种排版后重新保存');
    if(!isTemplate && (!/^legacy-[0-2]$/.test(plan.templateId) || plan.rendererVersion!=='legacy-v1'))throw new Error('餐纸排版版本暂不支持，请选择一种排版后重新保存');
    return renderComposition(canvas,plan,artworks,createCanvas,core,isTemplate);
  }
  function renderComposition(canvas,plan,artworks,createCanvas,core,isTemplate) {
    validate(plan,artworks);
    const items=resolve(plan,artworks).artworks,ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='#fffcf5';ctx.fillRect(0,0,w,h);
    ctx.strokeStyle='#e0d1b9';ctx.lineWidth=w*.001;ctx.setLineDash([w*.004,w*.006]);ctx.strokeRect(w*.035,h*.045,w*.93,h*.91);ctx.setLineDash([]);
    const dense=isTemplate && plan.templateId!=='whitespace-v1';
    const slots=isTemplate?templatePositions(items.length,plan.templateId):positions(items.length,plan.layout).map((slot,i)=>({...slot,index:i})),font='"PingFang SC","Microsoft YaHei",sans-serif';
    slots.forEach(slot=>{
      const art=items[slot.index],bounds=drawingBounds(art,createCanvas),style=plan.artTitleStyles[art.id],title=String(art.title || '').trim();
      const verticalSpace=dense ? h*.30 : h*(slot.y>.65?2*(.88-slot.y):.32);
      const maxSize=Math.min(w*slot.size,verticalSpace/1.2)*plan.scales[art.id],showTitle=plan.showArtworkTitles && style.visible && title;
      const short=[...title].length<=4,titleFont='"Kaiti SC",STKaiti,"Songti SC",'+font;
      let textSize=w*(short ? .038 : [...title].length<=10 ? .026 : .018)*style.scale,lines=[];
      if(showTitle){
        do {ctx.font=`${short?700:600} ${textSize}px ${titleFont}`;lines=wrap(ctx,title,maxSize*.98);if(lines.length<=(short?1:2))break;textSize*=.9;} while(textSize>w*.006);
      }
      const lineHeight=textSize*1.25,titleHeight=lines.length*lineHeight,gap=lines.length && bounds?w*.009:0;
      let layer=null;
      if(bounds){
        const ratio=Math.min(maxSize/bounds.width,Math.max(1,maxSize-titleHeight-gap)/bounds.height);
        layer=createCanvas(Math.max(1,Math.ceil(bounds.width*ratio)),Math.max(1,Math.ceil(bounds.height*ratio)));
        const layerCtx=layer.getContext('2d');
        if (art.kind === 'image') layerCtx.drawImage(imageCache.get(art.imageSource).image,0,0,layer.width,layer.height);
        else {layerCtx.translate(-bounds.x*ratio,-bounds.y*ratio);replay(layerCtx,art.strokes,ratio);}
      }
      const imageHeight=layer?layer.height:0,top=-(imageHeight+gap+titleHeight)/2;
      ctx.save();ctx.translate(w*slot.x,h*slot.y);ctx.rotate(slot.angle);
      if(layer)ctx.drawImage(layer,-layer.width/2,top);
      if(lines.length){
        ctx.fillStyle='#ce4335';ctx.font=`${short?700:600} ${textSize}px ${titleFont}`;ctx.textAlign='center';ctx.textBaseline='middle';
        lines.forEach((line,index)=>ctx.fillText(line,0,top+imageHeight+gap+lineHeight*(index+.5)));
      }
      ctx.restore();
    });
    if(dense){ctx.fillStyle='#fffcf5';ctx.fillRect(w*.25,h*.365,w*.5,h*.255);}
    ctx.fillStyle='#a58f6e';ctx.textAlign='center';ctx.font=`${w*.012}px ${font}`;ctx.fillText('MY LITTLE MEAL · MY LITTLE ART',w*.5,h*.36);
    ctx.fillStyle='#d94335';ctx.font=`${w*.032}px Georgia,serif`;
    if(isTemplate){
      // Use vector geometry so both browser exports and offline samples have the same ornament.
      ctx.save();ctx.strokeStyle='#d94335';ctx.lineWidth=w*.0013;ctx.beginPath();
      for(let i=0;i<8;i++){const angle=i*Math.PI/4;ctx.moveTo(w*.5+Math.cos(angle)*w*.003,h*.402+Math.sin(angle)*w*.003);ctx.lineTo(w*.5+Math.cos(angle)*w*.012,h*.402+Math.sin(angle)*w*.012);}ctx.stroke();ctx.restore();
    }else ctx.fillText('✳',w*.5,h*.415);
    ctx.fillStyle='#342a25';ctx.font=`600 ${w*.033}px ${font}`;
    const lines=wrap(ctx,plan.title,w*.45),lineHeight=w*.048,firstY=h*.50-(lines.length-1)*lineHeight/2;
    lines.forEach((line,i)=>ctx.fillText(line,w*.5,firstY+i*lineHeight));
    ctx.fillStyle='#a58f6e';ctx.font=`${w*.014}px ${font}`;ctx.fillText(plan.signature ? '画 / '+plan.signature : '一顿饭，一幅画，一点小快乐。',w*.5,h*.60);
    const notes=[];
    if (plan.showDate) { const d=new Date(plan.createdAt); if (!Number.isNaN(d.getTime())) notes.push(`${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`); }
    if (plan.showStore) { const stores=[...new Set(items.map(a=>core.artStore(a).name))]; notes.push(stores.length===1?stores[0]:`${stores.length} 家门店的餐品记忆`); }
    if(dense){ctx.fillStyle='#fffcf5';ctx.fillRect(w*.2,h*.902,w*.6,h*.045);ctx.fillStyle='#a58f6e';}
    ctx.font=`${w*.011}px ${font}`;ctx.fillText(notes.join('  ·  '),w*.5,h*.925,w*.8);
    return canvas;
  }
  return {STORAGE_KEY,DEFAULT_TITLE,EXPORT_WIDTH,EXPORT_HEIGHT,TEMPLATE_RENDERER_VERSION,TEMPLATES,makePlan,readPlans,resolve,validate,savePlan,move,replay,pixelBounds,prepareImages,captureExport,CANDIDATE_TEMPLATES,templatePositions,renderTemplate,render};
});
