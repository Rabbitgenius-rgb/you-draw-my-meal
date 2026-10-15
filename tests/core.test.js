const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../miniprogram/lib/core');
const catalog={stores:[{id:'mcd:test-a:1',name:'测试门店 A',source:'mcd'},{id:'mcd:test-b:1',name:'测试门店 B',source:'mcd'}],menus:{'mcd:test-a:1':[{id:'mcd:test-a:burger',name:'板烧鸡腿堡',alias:['汉堡'],image:'',source:'mcd'},{id:'mcd:test-a:fries',name:'薯条',alias:['炸薯条'],source:'mcd'}],'mcd:test-b:1':[{id:'mcd:test-b:burger',name:'板烧鸡腿堡',alias:['汉堡'],source:'mcd'}]}};
test.beforeEach(()=>C.setCatalog(catalog));
const strokes=[{color:'#d94335',width:.011,erase:false,points:[{x:.1,y:.2},{x:.8,y:.7}]}];
const art=(id,opts={})=>C.makeArtwork({id,storeId:'mcd:test-a:1',mealId:'mcd:test-a:burger',strokes,...opts});
test('新画作始终默认私密，调用者不能绕过公开许可',()=>{
  const a=art('private',{isPublic:true,consentAt:'2026-10-11'});
  assert.equal(a.isPublic,false);assert.equal(a.consentAt,null);
  assert.deepEqual(C.eligible([a],'mcd:test-a:1','mcd:test-a:burger'),[]);
});
test('公开只关联对应门店和餐品，撤回立即退出候选池',()=>{
  const source=[art('target'),art('other-meal',{mealId:'mcd:test-a:fries'}),art('other-store',{storeId:'mcd:test-b:1',mealId:'mcd:test-b:burger'})];
  let list=source;
  for(const a of list)list=C.setPublic(list,a.id,true,'2026-10-11T04:00:00Z');
  assert.deepEqual(C.eligible(list,'mcd:test-a:1','mcd:test-a:burger').map(a=>a.id),['target']);
  list=C.setPublic(list,'target',false);
  assert.equal(C.eligible(list,'mcd:test-a:1','mcd:test-a:burger').length,0);
  assert.equal(list[0].consentAt,null);
  assert.equal(source[0].isPublic,false);
});
test('没有明确许可时间的记录不会被展示',()=>{
  assert.equal(C.eligible([{...art('legacy'),isPublic:true}],'mcd:test-a:1','mcd:test-a:burger').length,0);
});
test('随机换画可到达不同画作，不包含私密画作',()=>{
  const list=C.setPublic(C.setPublic([art('a'),art('b'),art('private')],'a',true),'b',true);
  assert.equal(C.pickArtwork(list,'mcd:test-a:1','mcd:test-a:burger',null,()=>0).id,'a');
  assert.equal(C.pickArtwork(list,'mcd:test-a:1','mcd:test-a:burger',null,()=>.99).id,'b');
  assert.equal(C.pickArtwork(list,'mcd:test-a:1','mcd:test-a:burger','a',()=>0).id,'b');
  assert.equal(C.pickArtwork(list,'mcd:test-b:1','mcd:test-a:burger'),null);
});
test('作品墙按创作时间倒序，预览和全部作品均排除其他门店、餐品及未获许可记录',()=>{
  let list=[art('old',{createdAt:'2026-10-09T08:00:00Z'}),art('new',{createdAt:'2026-10-11T08:00:00Z'}),art('middle',{createdAt:'2026-10-10T08:00:00Z'}),art('private'),art('wrong-meal',{mealId:'mcd:test-a:fries'}),art('wrong-store',{storeId:'mcd:test-b:1',mealId:'mcd:test-b:burger'}),{...art('missing-consent'),isPublic:true}];
  for(const id of ['old','new','middle','wrong-meal','wrong-store'])list=C.setPublic(list,id,true);
  const original=list.map(a=>a.id);
  const ordered=C.galleryArtworks(list,'mcd:test-a:1','mcd:test-a:burger','latest');
  assert.deepEqual(ordered.map(a=>a.id),['new','middle','old']);
  assert.deepEqual(list.map(a=>a.id),original);
  const revoked=C.setPublic(list,'new',false);
  assert.deepEqual(C.galleryArtworks(revoked,'mcd:test-a:1','mcd:test-a:burger','latest').map(a=>a.id),['middle','old']);
});
test('随机浏览完整覆盖候选池且不重复，三张预览不改变全部作品数',()=>{
  let list=Array.from({length:15},(_,i)=>art('public-'+i)).concat(art('private'));
  for(let i=0;i<15;i++)list=C.setPublic(list,'public-'+i,true);
  for(const rng of [()=>0,()=>.5,()=>.999]){
    const items=C.galleryArtworks(list,'mcd:test-a:1','mcd:test-a:burger','random',rng);
    assert.equal(items.length,15);assert.equal(new Set(items.map(a=>a.id)).size,15);
    assert.equal(items.some(a=>a.id==='private'),false);
    assert.equal(items.slice(0,3).length,3);
    assert.deepEqual(items.map(a=>a.id).sort(),list.filter(a=>a.isPublic).map(a=>a.id).sort());
  }
  assert.equal(C.galleryArtworks(list,'mcd:test-b:1','mcd:test-a:burger','random').length,0);
  assert.equal(C.galleryArtworks(list.slice(0,2),'mcd:test-a:1','mcd:test-a:burger','random').length,2);
});
test('保存后读回历史及公开状态，损坏存储有安全回退',()=>{
  const memory=new Map();const adapter={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const state={...C.initialState(),catalog,artworks:C.setPublic([art('saved')],'saved',true)};
  C.persist(adapter,state);assert.deepEqual(C.readState(adapter),state);
  memory.set(C.STORAGE_KEY,'broken-json');assert.deepEqual(C.readState(adapter),C.initialState());
});
test('双人猜画支持餐品别称，但不会把其他餐品判为正确',()=>{
  assert.equal(C.isCorrect(' 炸薯条！ ','mcd:test-a:fries'),true);
  assert.equal(C.isCorrect('板烧鸡腿堡','mcd:test-a:burger'),true);
  assert.equal(C.isCorrect('可乐','mcd:test-a:burger'),false);
  assert.equal(C.isCorrect('','mcd:test-a:burger'),false);
});
test('没有笔迹或选择当前店不售的餐品时阻止保存',()=>{
  assert.throws(()=>art('blank',{strokes:[]}),/留下一笔/);
  assert.throws(()=>art('eraser',{strokes:[{...strokes[0],erase:true}]}),/留下一笔/);
  assert.throws(()=>art('unavailable',{mealId:'mcd:test-a:fries',storeId:'mcd:test-b:1'}),/请选择/);
});
test('笔迹保存为独立副本，空白标题使用默认名称',()=>{
  const source=JSON.parse(JSON.stringify(strokes));const a=art('copy',{strokes:source,title:'   '});
  source[0].points[0].x=.9;assert.equal(a.strokes[0].points[0].x,.1);assert.equal(a.title,'今天的板烧鸡腿堡');
});
test('图片作品保留餐品快照并默认私密，重读后仍可通过公开许可筛选',()=>{
  C.setCatalog(catalog);
  const imageSource='data:image/png;base64,aGVsbG8=';
  const image=art('image',{kind:'image',imageSource,title:'气泡画',titleEmbedded:true,isPublic:true});
  assert.deepEqual(image.strokes,[]);assert.equal(image.imageSource,imageSource);assert.equal(image.thumbnail,'');
  assert.equal(image.isPublic,false);assert.equal(image.consentAt,null);assert.equal(image.titleEmbedded,true);
  const state={...C.initialState(),catalog,artworks:[image]};
  const restored=C.readState({getItem:()=>JSON.stringify(state)}).artworks[0];
  assert.equal(restored.kind,'image');assert.equal(restored.title,'气泡画');assert.equal(C.artMeal(restored).name,'板烧鸡腿堡');
  assert.equal(C.eligible([restored],restored.storeId,restored.mealId).length,0);
  assert.equal(C.eligible(C.setPublic([restored],restored.id,true),restored.storeId,restored.mealId).length,1);
  for(const source of ['https://example.com/image.png','data:image/svg+xml;base64,aGVsbG8=','broken'])assert.throws(()=>art('invalid',{kind:'image',imageSource:source}),/有效/);
});

test('旧演示画作完整迁移，原许可与名字保留且不混入真实菜单',()=>{
  const legacy={version:1,storeId:'demo-anfu',mode:'duo',artworks:[{id:'legacy',storeId:'demo-anfu',mealId:'burger',strokes,title:'旧画',isPublic:true,consentAt:'2026-10-10',thumbnail:'data:image/png;base64,test'},{id:'unknown',storeId:'old-store',mealId:'old-meal',strokes,isPublic:false}]};
  const adapter={getItem:()=>JSON.stringify(legacy)};const state=C.readState(adapter);
  assert.equal(state.version,2);assert.equal(state.storeId,'');assert.equal(state.artworks.length,2);
  assert.equal(C.artStore(state.artworks[0]).name,'安福路示例店');assert.equal(C.artMeal(state.artworks[0]).name,'板烧鸡腿堡');
  assert.equal(state.artworks[0].isPublic,true);assert.equal(state.artworks[0].consentAt,'2026-10-10');assert.equal(state.artworks[0].thumbnail,legacy.artworks[0].thumbnail);
  C.setCatalog(catalog);assert.equal(C.eligible(state.artworks,'mcd:test-a:1','mcd:test-a:burger').length,0);
});
test('真实餐品快照不会随菜单改名或下架丢失，重启缓存不含演示菜单',()=>{
  const a=art('snapshot');const next=C.withMenu({...C.initialState(),artworks:[a]},catalog.stores[0],[]);C.setCatalog(next.catalog);
  assert.equal(C.artMeal(a).name,'板烧鸡腿堡');assert.equal(C.artStore(a).name,'测试门店 A');assert.equal(C.menu('demo-anfu').length,0);
  assert.equal(C.eligible(C.setPublic([a],a.id,true),a.storeId,a.mealId).length,0);
});
