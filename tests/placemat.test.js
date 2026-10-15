'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../web/placemat');
const artworks=['a','b','c','d'].map(id=>({id,isPublic:false,strokes:[{erase:false,color:'#d94335',width:.01,points:[{x:.2,y:.2}]}]}));
const adapter=()=>{const memory=new Map();return {memory,getItem:key=>memory.get(key),setItem:(key,value)=>memory.set(key,value)};};
test('餐纸保存与重读保留选图顺序和调整，不改变原画或公开状态',()=>{
  const storage=adapter(),original=JSON.stringify(artworks);storage.setItem('draw-my-meal-v1','original artwork data');
  let plans=P.savePlan(storage,[],{id:'paper',artIds:['c','a','b'],title:'我的餐纸',signature:'一起吃',scales:{a:1.1},artTitleStyles:{c:{visible:false,scale:1.3}},layout:2,showStore:false},artworks);
  assert.deepEqual(P.readPlans(storage),plans);assert.deepEqual(plans[0].artIds,['c','a','b']);assert.equal(plans[0].scales.a,1.1);
  assert.equal(JSON.stringify(artworks),original);assert.equal(storage.getItem('draw-my-meal-v1'),'original artwork data');
  assert.deepEqual(P.readPlans(storage)[0].artTitleStyles.c,{visible:false,scale:1.3});assert.equal(plans[0].showArtworkTitles,true);
  plans=P.savePlan(storage,plans,{...plans[0],title:'修改后的餐纸'},artworks);assert.equal(plans.length,1);assert.equal(plans[0].title,'修改后的餐纸');
});
test('不足三张、超过六张和丢失原画不能静默生成或覆盖方案',()=>{
  const storage=adapter(),plans=P.savePlan(storage,[],{artIds:['a','b','c']},artworks),saved=storage.getItem(P.STORAGE_KEY);
  for (const ids of [['a','b'],['a','b','missing'],['a','b','c','d','e','f','g']]) assert.throws(()=>P.savePlan(storage,plans,{artIds:ids},artworks));
  assert.equal(storage.getItem(P.STORAGE_KEY),saved);
  assert.deepEqual(P.resolve(plans[0],artworks.slice(0,2)).missing,['c']);
  assert.deepEqual(P.resolve(plans[0],artworks.slice(0,2)).artworks.map(a=>a.id),['a','b']);
});
test('交换位置保留全部选图，边界不变；损坏数据安全回退',()=>{
  const ids=['a','b','c'];assert.deepEqual(P.move(ids,0,1),['b','a','c']);assert.deepEqual(P.move(ids,0,-1),ids);assert.deepEqual(ids,['a','b','c']);
  const storage=adapter();storage.setItem(P.STORAGE_KEY,'broken');assert.deepEqual(P.readPlans(storage),[]);
  const p=P.makePlan({artIds:['a','a','b','c'],title:' ',scales:{a:8,b:-1},layout:100});assert.deepEqual(p.artIds,ids);assert.equal(p.scales.a,1.2);assert.equal(p.scales.b,1);assert.equal(p.title,P.DEFAULT_TITLE);assert.equal(p.layout,2);
  assert.equal(p.showArtworkTitles,true);assert.deepEqual(p.artTitleStyles.a,{visible:true,scale:1});
  const titles=P.makePlan({artIds:ids,showArtworkTitles:false,artTitleStyles:{a:{scale:9},b:{scale:.1,visible:false}}});
  assert.equal(titles.showArtworkTitles,false);assert.equal(titles.artTitleStyles.a.scale,1.4);assert.deepEqual(titles.artTitleStyles.b,{visible:false,scale:.8});
});
test('透明笔迹回放在独立图层擦除，裁切范围依据最终可见像素',()=>{
  const operations=[],ctx={save(){operations.push('save');},restore(){operations.push('restore');},beginPath(){},arc(){},fill(){operations.push(this.globalCompositeOperation);},moveTo(){},lineTo(){},stroke(){operations.push(this.globalCompositeOperation);}};
  P.replay(ctx,[...artworks[0].strokes,{...artworks[0].strokes[0],erase:true},...artworks[0].strokes],1000);
  assert.deepEqual(operations,['save','source-over','destination-out','source-over','restore']);
  const pixels=new Uint8ClampedArray(40*40*4);pixels[(12*40+8)*4+3]=255;pixels[(20*40+30)*4+3]=255;
  assert.deepEqual(P.pixelBounds(pixels,40),{x:5/40,y:9/40,width:29/40,height:15/40});
  assert.equal(P.pixelBounds(new Uint8ClampedArray(16),2),null);
});
test('图片作品等待载入后参与餐纸绘制，重复图片只载入一次并保留长宽比例',async()=>{
  const image={width:400,height:200},source='data:image/png;base64,cGFwZXI=';
  const items=['image-a','image-b','image-c'].map(id=>({id,title:'气泡画',kind:'image',imageSource:source,strokes:[]}));
  const draws=[];
  function createCanvas(width,height){return {width,height,getContext:()=>({clearRect(){},fillRect(){},strokeRect(){},setLineDash(){},save(){},restore(){},translate(){},rotate(){},fillText(){},measureText(){return {width:30};},drawImage(value,x,y,w,h){draws.push({value,width:w || value.width,height:h || value.height});}})};}
  const canvas=createCanvas(1000,707),plan={artIds:items.map(a=>a.id),showArtworkTitles:false},core={artStore:()=>({name:'门店'})};
  assert.throws(()=>P.render(canvas,plan,items,createCanvas,core),/尚未载入/);
  let loads=0;await P.prepareImages(items,async()=>{loads++;return image;});
  P.render(canvas,plan,items,createCanvas,core);
  const originalDraws=draws.filter(d=>d.value===image);
  assert.equal(loads,1);assert.equal(originalDraws.length,3);
  assert.ok(originalDraws.every(d=>Math.abs(d.width/d.height-2)<.03));
});
test('预览与高清渲染都包含作品原标题，长标题完整换行，开关不改动原画',()=>{
  const title='这个比较长的作品标题也要完整保留文字和标点！';
  const items=artworks.slice(0,3).map((art,index)=>({...art,title:['霸！',title,'隐藏这张标题'][index]})),original=JSON.stringify(items);
  function createCanvas(width,height) {
    const text=[],ctx={font:'',clearRect(){},fillRect(){},strokeRect(){},setLineDash(){},save(){},restore(){},translate(){},rotate(){},drawImage(){},beginPath(){},arc(){},fill(){},moveTo(){},lineTo(){},stroke(){},
      fillText(value){text.push({value,font:this.font});},measureText(value){const size=Number(/([\d.]+)px/.exec(this.font)?.[1] || 10);return {width:[...value].length*size};},
      getImageData(){const data=new Uint8ClampedArray(width*height*4);data[(90*width+90)*4+3]=255;data[(200*width+200)*4+3]=255;return {data};}};
    return {width,height,text,getContext:()=>ctx};
  }
  const core={artStore:()=>({name:'测试门店'})},plan={artIds:items.map(a=>a.id),artTitleStyles:{c:{visible:false}}};
  for(const width of [1000,P.EXPORT_WIDTH]){
    const canvas=createCanvas(width,Math.round(width*P.EXPORT_HEIGHT/P.EXPORT_WIDTH));P.render(canvas,plan,items,createCanvas,core);
    const end=canvas.text.findIndex(t=>t.value==='MY LITTLE MEAL · MY LITTLE ART'),labels=canvas.text.slice(0,end);
    assert.equal(labels[0].value,'霸！');assert.equal(labels.slice(1).map(t=>t.value).join(''),title);assert.ok(labels.length<=3);
    const hidden=createCanvas(width,canvas.height);P.render(hidden,{...plan,showArtworkTitles:false},items,createCanvas,core);
    assert.equal(hidden.text[0].value,'MY LITTLE MEAL · MY LITTLE ART');
  }
  assert.equal(JSON.stringify(items),original);
});
test('餐纸固定版本引用不回退到原画最新版；导出输入不随编辑变化',()=>{
  const originals=JSON.parse(JSON.stringify(artworks.slice(0,3))).map(art=>({...art,versionId:art.id+'-v1',title:art.id}));
  const plan=P.makePlan({id:'fixed',revision:4,artIds:originals.map(a=>a.id),refs:originals.map(a=>({artId:a.id,versionId:a.versionId})),layout:2});
  assert.equal(plan.templateId,'legacy-2');assert.equal(plan.rendererVersion,'legacy-v1');assert.equal(plan.revision,4);
  const newer=originals.map(a=>({...a,versionId:a.id+'-v2'}));
  assert.deepEqual(P.resolve(plan,newer).missing,['a','b','c']);
  const captured=P.captureExport(plan,originals);
  plan.title='另一个标题';plan.artIds.reverse();originals[0].title='已经替换';originals[0].strokes[0].points[0].x=.9;
  assert.equal(captured.filename,P.DEFAULT_TITLE+'-餐纸.png');assert.deepEqual(captured.plan.artIds,['a','b','c']);
  assert.equal(captured.artworks[0].title,'a');assert.equal(captured.artworks[0].strokes[0].points[0].x,.2);
});
test('三个候选模板有不同密度和位置，旧方案保持旧排版且不自动启用候选',()=>{
  const sparse=P.templatePositions(3,'whitespace-v1'),tile=P.templatePositions(3,'tile-v1'),collage=P.templatePositions(3,'collage-v1');
  assert.equal(sparse.length,3);assert.equal(tile.length,20);assert.equal(collage.length,10);
  assert.ok(tile.every(slot=>slot.angle===0));assert.ok(collage.some(slot=>Math.abs(slot.angle)>.2));
  assert.deepEqual(P.makePlan({version:1,layout:1,artIds:['a','b','c']}).templateId,'legacy-1');
  assert.deepEqual(P.CANDIDATE_TEMPLATES,['whitespace-v1','tile-v1','collage-v1']);
  assert.throws(()=>P.renderTemplate(null,{},[],null,null,'unknown'),/未知样张/);
});
test('三种正式模板保存重读并统一渲染，旧方案保留原版渲染规则',async()=>{
  const items=['template-a','template-b','template-c'].map(id=>({id,title:id,kind:'image',imageSource:'data:image/png;base64,dGVtcGxhdGU=',strokes:[]}));
  await P.prepareImages(items,async()=>({width:400,height:400}));
  const core={artStore:()=>({name:'模板测试店'})};
  function createCanvas(width,height){const canvas={width,height,slots:[],draws:[],texts:[]};const ctx={clearRect(){},fillRect(){},strokeRect(){},setLineDash(){},save(){},restore(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},translate(x,y){canvas.slots.push([x/width,y/height]);},fillText(text){canvas.texts.push(text);},measureText(text){return {width:text.length*10};},drawImage(image,x,y,w,h){canvas.draws.push({width:w || image.width,height:h || image.height});}};canvas.getContext=()=>ctx;return canvas;}
  const storage=adapter(),old=P.makePlan({id:'old-plan',artIds:items.map(a=>a.id),layout:2,title:'旧方案'}),oldRaw=JSON.stringify(old);
  let plans=P.savePlan(storage,[],old,items);
  for(const [index,template] of P.TEMPLATES.entries()){
    const plan=P.makePlan({id:'new-'+index,artIds:items.map(a=>a.id),templateId:template.id,showArtworkTitles:false});
    assert.equal(plan.rendererVersion,P.TEMPLATE_RENDERER_VERSION);
    plans=P.savePlan(storage,plans,plan,items);
    const read=P.readPlans(storage).find(p=>p.id===plan.id);assert.equal(read.templateId,template.id);assert.equal(read.rendererVersion,'templates-v1');
    const preview=createCanvas(1000,707),direct=createCanvas(1000,707),exported=createCanvas(P.EXPORT_WIDTH,P.EXPORT_HEIGHT);
    P.render(preview,read,items,createCanvas,core);P.renderTemplate(direct,read,items,createCanvas,core,template.id);P.render(exported,read,items,createCanvas,core);
    assert.deepEqual(preview.slots,direct.slots);assert.deepEqual(preview.draws,direct.draws);
    assert.equal(preview.slots.length,[3,20,10][index]);assert.ok(preview.slots.every((slot,i)=>slot.every((value,j)=>Math.abs(value-exported.slots[i][j])<1e-12)));
    const larger=createCanvas(1000,707);P.render(larger,{...read,scales:Object.fromEntries(items.map(a=>[a.id,1.2]))},items,createCanvas,core);
    assert.ok(larger.draws[0].width>preview.draws[0].width);
    const titled=createCanvas(1000,707);P.render(titled,{...read,showArtworkTitles:true,artTitleStyles:{'template-a':{visible:true,scale:1.2},'template-b':{visible:false},'template-c':{visible:false}}},items,createCanvas,core);
    assert.ok(titled.texts.includes('template-a'));assert.ok(!titled.texts.includes('template-b'));
  }
  const oldRead=P.readPlans(storage).find(p=>p.id==='old-plan');assert.equal(oldRead.templateId,'legacy-2');assert.equal(oldRead.rendererVersion,'legacy-v1');
  const before=createCanvas(1000,707),after=createCanvas(1000,707);P.render(before,old,items,createCanvas,core);P.render(after,oldRead,items,createCanvas,core);assert.deepEqual(before.slots,after.slots);assert.equal(before.slots.length,3);assert.equal(JSON.stringify(old),oldRaw);
});
