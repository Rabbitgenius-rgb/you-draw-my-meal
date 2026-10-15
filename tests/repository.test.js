'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory,IDBObjectStore}=require('fake-indexeddb');
const R=require('../web/repository');
const image='data:image/png;base64,aGVsbG8=',image2='data:image/png;base64,d29ybGQ=';
const store={id:'test-store',name:'测试门店',source:'mcd'},meal={id:'test-meal',name:'测试汉堡',alias:['汉堡'],source:'mcd'};
const strokes=[{color:'#d94335',width:.011,erase:false,points:[{x:.1,y:.2},{x:.8,y:.7}]}];
const artwork=(id,extras={})=>({id,storeId:store.id,mealId:meal.id,storeSnapshot:store,mealSnapshot:meal,mode:'solo',title:id,createdAt:'2026-10-11T04:00:00Z',strokes,...extras});
const drawPayload=(extras={})=>({draft:{storeId:store.id,mealId:meal.id,storeSnapshot:store,mealSnapshot:meal,mode:'solo',strokes,redo:[],attempts:0,savedId:null},...extras});
function memory(values={}){const map=new Map(Object.entries(values));return {map,getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
function setup(t,values={},factory=new IDBFactory(),name='repository-test'){
  const storage=memory(values),repo=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>repo.close());return {repo,storage,factory,name};
}
async function trio(repo){for(const id of ['a','b','c'])await repo.createArtwork(artwork(id));return (await repo.readSnapshot()).state.artworks;}
const plan=(extra={})=>({id:'paper',version:1,artIds:['a','b','c'],title:'原来的餐纸',signature:'我',layout:2,showDate:true,showStore:false,scales:{a:1.1,b:1,c:.9},artTitleStyles:{a:{visible:true,scale:1.2}},createdAt:'2026-10-11T04:00:00Z',...extra});
const copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?'['+value.map(v=>canonical(v===undefined?null:v)).join(',')+']':value && typeof value==='object'?'{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const rehash=version=>version.hash=require('node:crypto').createHash('sha256').update(canonical(version.payload)).digest('hex');

test('旧画册和餐纸无损、幂等迁移，保留 ID、许可、布局及原 key',async t=>{
  const state={version:2,storeId:store.id,mode:'duo',catalog:{stores:[store],menus:{[store.id]:[meal]}},artworks:['a','b','c'].map(id=>artwork(id,{isPublic:id==='a',consentAt:id==='a'?'2026-10-11T04:00:00Z':null,customNote:'原字段'}))};
  const legacyPlan=plan({updatedAt:'2026-10-11T05:00:00Z',customPlanField:'保留'}),raw=JSON.stringify(state),rawPlans=JSON.stringify([legacyPlan]);
  const {repo,storage,factory,name}=setup(t,{[R.LEGACY_KEYS[0]]:raw,[R.LEGACY_KEYS[1]]:rawPlans});await repo.open();
  const first=await repo.readSnapshot();assert.equal(first.state.storeId,store.id);assert.equal(first.state.mode,'duo');assert.equal(first.state.artworks.length,3);
  const a=first.state.artworks.find(a=>a.id==='a');assert.deepEqual(a.strokes,strokes);assert.equal(a.isPublic,true);assert.equal(a.consentAt,state.artworks[0].consentAt);assert.equal(a.customNote,undefined);
  const p=first.plans[0];assert.equal(p.id,'paper');assert.equal(p.layout,2);assert.equal(p.templateId,'legacy-2');assert.equal(p.rendererVersion,'legacy-v1');assert.equal(p.customPlanField,undefined);assert.equal(p.createdAt,legacyPlan.createdAt);assert.equal(p.updatedAt,legacyPlan.updatedAt);assert.deepEqual(p.scales,legacyPlan.scales);assert.deepEqual(p.artTitleStyles,legacyPlan.artTitleStyles);
  assert.deepEqual(first.state.artworks.map(a=>a.id),state.artworks.map(a=>a.id));assert.deepEqual(JSON.parse((await repo.exportBackup()).data.legacyArchives[0].raw[0]).artworks.map(a=>a.strokes),state.artworks.map(a=>a.strokes));
  assert.equal(storage.getItem(R.LEGACY_KEYS[0]),raw);assert.equal(storage.getItem(R.LEGACY_KEYS[1]),rawPlans);
  const second=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>second.close());await second.open();assert.deepEqual(await second.readSnapshot(),first);
});

test('两个标签同时迁移只导入一次；损坏旧数据不会被空画册覆盖',async t=>{
  const values={[R.LEGACY_KEYS[0]]:JSON.stringify({version:1,storeId:'demo-anfu',mode:'solo',artworks:[artwork('legacy',{storeId:'demo-anfu',mealId:'burger',storeSnapshot:undefined,mealSnapshot:undefined})]})};
  const {repo,storage,factory,name}=setup(t,values),other=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>other.close());await Promise.all([repo.open(),other.open()]);
  assert.equal((await repo.readSnapshot()).state.artworks.length,1);assert.equal((await repo.readSnapshot()).state.artworks[0].mealSnapshot.name,'板烧鸡腿堡');
  const broken=setup(t,{[R.LEGACY_KEYS[0]]:'{broken'},new IDBFactory(),'broken');await assert.rejects(broken.repo.open(),e=>e.code==='MIGRATION_FAILED');assert.equal(broken.storage.getItem(R.LEGACY_KEYS[0]),'{broken');
  broken.storage.setItem(R.LEGACY_KEYS[0],JSON.stringify({version:2,artworks:[],catalog:{stores:[],menus:{}}}));await broken.repo.open();assert.equal((await broken.repo.readSnapshot()).state.artworks.length,0);
});

test('旧标签迁移后修改原 key 时明确告警，不覆盖新画册',async t=>{
  const {repo,storage}=setup(t);await repo.open();await repo.createArtwork(artwork('saved'));storage.setItem(R.LEGACY_KEYS[0],JSON.stringify({version:2,artworks:[]}));const current=await repo.readSnapshot();assert.equal(current.state.artworks.length,1);assert.equal(current.warnings[0].code,'LEGACY_CHANGED');
});

test('不同标签的画作、模式、菜单和门店筛选偏好不会互相覆盖',async t=>{
  const {repo,storage,factory,name}=setup(t),other=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>other.close());await Promise.all([repo.open(),other.open()]);
  await repo.createArtwork(artwork('from-a'));await other.setSettings({mode:'duo',galleryPreferences:{a:true}});await repo.setSettings({galleryPreferences:{b:false}});await other.setMenu(store,[meal]);
  await Promise.all([repo.createArtwork(artwork('concurrent-a')),other.createArtwork(artwork('concurrent-b'))]);
  const current=await repo.readSnapshot();assert.equal(current.state.artworks.length,3);assert.equal(current.state.mode,'duo');assert.deepEqual(current.state.galleryPreferences,{a:true,b:false});assert.equal(current.state.catalog.menus[store.id].length,1);
});

test('同一画作的旧修订写入被拒绝，不影响其他作品',async t=>{
  const {repo}=setup(t);await repo.createArtwork(artwork('a'));const old=(await repo.readSnapshot()).state.artworks[0];await repo.setConsent('a',true,{expectedRevision:old.revision});await assert.rejects(repo.deleteArtwork('a',{expectedRevision:old.revision}),e=>e.code==='CONFLICT');assert.equal((await repo.readSnapshot()).state.artworks[0].isPublic,true);
});

test('画作可用历史快照离线保存，本地当次许可保留',async t=>{
  const {repo}=setup(t);const saved=await repo.createArtwork(artwork('offline',{isPublic:true,consentAt:'2026-10-11T06:00:00Z'}));assert.equal(saved.state.catalog.stores.length,0);assert.equal(saved.state.artworks[0].isPublic,true);assert.equal(saved.state.artworks[0].mealSnapshot.name,meal.name);
});

test('图片素材按内容去重、替换建立不可变版本，旧餐纸及删除后仍可解析',async t=>{
  const {repo}=setup(t);await repo.createArtwork(artwork('a',{kind:'image',imageSource:image,thumbnail:image,strokes:[],titleEmbedded:true}));for(const id of ['b','c'])await repo.createArtwork(artwork(id,{kind:'image',imageSource:image,strokes:[]}));
  let saved=await repo.savePaper(plan()),p=saved.plans[0],oldVersion=p.refs.find(r=>r.artId==='a').versionId;assert.equal((await repo.exportBackup()).data.assets.length,1);
  const a=saved.state.artworks.find(a=>a.id==='a');saved=await repo.replaceImage('a',image2,{expectedRevision:a.revision});assert.notEqual(saved.state.artworks.find(a=>a.id==='a').versionId,oldVersion);assert.equal((await repo.resolvePaper(p)).artworks[0].imageSource,image);
  assert.equal((await repo.exportBackup()).data.assets.length,2);assert.equal((await repo.exportBackup()).data.versions.length,4);
  await repo.deleteArtwork('a');assert.equal((await repo.readSnapshot()).state.artworks.length,2);assert.equal((await repo.resolvePaper(p)).artworks[0].imageSource,image);assert.deepEqual((await repo.resolvePaper(p)).missing,[]);
});

test('餐纸旧版引用仅在显式更新后改变；旧修订不能覆盖新编辑',async t=>{
  const {repo}=setup(t);await repo.createArtwork(artwork('a',{kind:'image',imageSource:image,strokes:[]}));for(const id of ['b','c'])await repo.createArtwork(artwork(id));const p=(await repo.savePaper(plan())).plans[0];const a=(await repo.readSnapshot()).state.artworks.find(a=>a.id==='a');await repo.replaceImage('a',image2,{expectedRevision:a.revision});
  await repo.savePaper({...p,title:'只改标题'},{expectedRevision:p.revision});let current=(await repo.readSnapshot()).plans[0];assert.equal(current.refs[0].versionId,p.refs[0].versionId);await assert.rejects(repo.savePaper({...p,title:'过期修改'},{expectedRevision:p.revision}),e=>e.code==='CONFLICT');
  const latest=(await repo.readSnapshot()).state.artworks.find(a=>a.id==='a');await repo.updatePaperVersions(current.id,current.refs.map(r=>r.artId==='a'?{artId:r.artId,versionId:latest.versionId}:r),{expectedRevision:current.revision});assert.equal((await repo.resolvePaper((await repo.readSnapshot()).plans[0])).artworks[0].imageSource,image2);
});

test('新餐纸首次冻结引用，不同方案并发保存都保留',async t=>{
  const {repo,storage,factory,name}=setup(t);await trio(repo);const other=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>other.close());await Promise.all([repo.savePaper(plan({id:'paper-a'})),other.savePaper(plan({id:'paper-b'}))]);const current=await repo.readSnapshot();assert.equal(current.plans.length,2);assert.ok(current.plans.every(p=>p.refs.length===3 && p.refs.every(r=>r.versionId)));
});

test('修订号 0 明确表示新方案或尚未落盘的草稿',async t=>{
  const {repo}=setup(t);await trio(repo);const saved=await repo.savePaper(plan({revision:0}),{expectedRevision:0});assert.equal(saved.plans[0].revision,1);await repo.deleteDraft('not-saved-yet',{expectedRevision:0});await assert.rejects(repo.savePaper(plan({revision:0}),{expectedRevision:0}),e=>e.code==='CONFLICT');
});

test('草稿保存刷新可恢复；并发冲突另存；保存作品/餐纸与清除草稿同事务',async t=>{
  const {repo,storage,factory,name}=setup(t);let saved=await repo.saveDraft({id:'draw-draft',kind:'draw',payload:drawPayload()});const revision=saved.draftRevision;
  saved=await repo.saveDraft({id:'draw-draft',kind:'draw',payload:drawPayload({screen:'draw'})},{expectedRevision:revision});const conflict=await repo.saveDraft({id:'draw-draft',kind:'draw',payload:drawPayload({screen:'handoff'})},{expectedRevision:revision});assert.equal(conflict.conflicted,true);assert.notEqual(conflict.savedDraftId,'draw-draft');assert.equal(conflict.drafts.length,2);
  const other=R.create({indexedDB:factory,storage,name,broadcast:false});t.after(()=>other.close());assert.equal((await other.readSnapshot()).drafts.length,2);await repo.createArtwork(artwork('a'),{draftId:'draw-draft'});assert.equal((await repo.readSnapshot()).drafts.some(d=>d.id==='draw-draft'),false);
  for(const id of ['b','c'])await repo.createArtwork(artwork(id));await repo.saveDraft({id:'paper-draft',kind:'paper',payload:{plan:plan(),filters:{query:'汉堡'}}});await repo.savePaper(plan(),{draftId:'paper-draft'});assert.equal((await repo.readSnapshot()).drafts.some(d=>d.id==='paper-draft'),false);
});

test('容量故障回滚图片、版本、header和草稿，不能报告成功',async t=>{
  const {repo}=setup(t);await repo.open();await repo.saveDraft({id:'draft',kind:'draw',payload:drawPayload()});const before=(await repo.exportBackup()).data,put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value){if(this.name==='artworks')throw new DOMException('full','QuotaExceededError');return put.apply(this,arguments);};
  try{await assert.rejects(repo.createArtwork(artwork('a',{kind:'image',imageSource:image,strokes:[]}),{draftId:'draft'}),e=>e.code==='STORAGE');}finally{IDBObjectStore.prototype.put=put;}
  assert.deepEqual((await repo.exportBackup()).data,before);
});

test('保存作品或方案不能删除其他标签已更新的同一草稿',async t=>{
  const {repo}=setup(t);let saved=await repo.saveDraft({id:'draw-draft',kind:'draw',payload:drawPayload()},{expectedRevision:0});const oldRevision=saved.draftRevision;await repo.saveDraft({id:'draw-draft',kind:'draw',payload:drawPayload({screen:'handoff'})},{expectedRevision:oldRevision});
  await assert.rejects(repo.createArtwork(artwork('blocked'),{draftId:'draw-draft',draftRevision:oldRevision}),e=>e.code==='CONFLICT');assert.equal((await repo.readSnapshot()).state.artworks.length,0);assert.equal((await repo.readSnapshot()).drafts[0].payload.screen,'handoff');
  await trio(repo);saved=await repo.saveDraft({id:'paper-draft',kind:'paper',payload:{plan:plan()}},{expectedRevision:0});await repo.saveDraft({id:'paper-draft',kind:'paper',payload:{plan:plan({title:'another-tab'})}},{expectedRevision:saved.draftRevision});await assert.rejects(repo.savePaper(plan(),{expectedRevision:0,draftId:'paper-draft',draftRevision:saved.draftRevision}),e=>e.code==='CONFLICT');assert.equal((await repo.readSnapshot()).plans.length,0);assert.equal((await repo.readSnapshot()).drafts.find(d=>d.id==='paper-draft').payload.plan.title,'another-tab');
});

test('完整备份安全合并：新增私密、已有许可不变、重复导入去重且不替换实时目录',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await trio(source);await source.setConsent('a',true);await source.setMenu(store,[meal]);await source.savePaper(plan());await source.saveDraft({id:'draft',kind:'draw',payload:drawPayload()});await source.setSettings({galleryPreferences:{[store.id]:true}});const backup=await source.exportBackup();
  const target=setup(t,{},new IDBFactory(),'target').repo;await target.setSettings({mode:'duo',galleryPreferences:{local:false}});const inspected=await target.inspectBackup(backup);assert.equal(inspected.summary.addedArtworks,3);assert.equal(inspected.summary.addedPlans,1);let merged=await target.mergeBackup(inspected);assert.equal(merged.state.artworks.length,3);assert.ok(merged.state.artworks.every(a=>!a.isPublic && !a.consentAt));assert.equal(merged.plans.length,1);assert.equal(merged.drafts.length,1);assert.equal(merged.state.mode,'duo');assert.deepEqual(merged.state.galleryPreferences,{local:false});assert.deepEqual(merged.state.catalog,{stores:[],menus:{}});
  await target.setConsent('a',true);merged=await target.mergeBackup(await target.inspectBackup(backup));assert.equal(merged.state.artworks.length,3);assert.equal(merged.plans.length,1);assert.equal(merged.drafts.length,1);assert.equal(merged.state.artworks.find(a=>a.id==='a').isPublic,true);assert.equal(merged.summary.addedArtworks,0);
});

test('备份 ID 冲突另存且引用正确，重复导入同一冲突备份不继续复制',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await source.createArtwork(artwork('a',{title:'外部画',kind:'image',imageSource:image,strokes:[]}));for(const id of ['b','c'])await source.createArtwork(artwork(id));await source.savePaper(plan());const backup=await source.exportBackup();
  const target=setup(t,{},new IDBFactory(),'target').repo;await target.createArtwork(artwork('a',{title:'本机原画'}));let merged=await target.mergeBackup(await target.inspectBackup(backup));assert.equal(merged.state.artworks.length,4);assert.equal(merged.state.artworks.find(a=>a.id==='a').title,'本机原画');const copy=merged.state.artworks.find(a=>a.title==='外部画');assert.notEqual(copy.id,'a');assert.equal(merged.plans[0].refs[0].artId,copy.id);assert.equal((await target.resolvePaper(merged.plans[0])).artworks[0].title,'外部画');
  merged=await target.mergeBackup(await target.inspectBackup(backup));assert.equal(merged.state.artworks.length,4);assert.equal(merged.plans.length,1);
});

test('冲突导入同步映射餐纸与草稿的尺寸和标题样式，本机原方案不变',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await source.createArtwork(artwork('a',{title:'外部画',kind:'image',imageSource:image,strokes:[]}));for(const id of ['b','c'])await source.createArtwork(artwork(id));
  const sourcePlan=(await source.savePaper(plan({title:'外部布局',scales:{a:1.6,b:.7,c:1.4},artTitleStyles:{a:{visible:false,scale:1.8},b:{visible:true,scale:.6},c:{visible:true,scale:1.4}}}))).plans[0];const draftPlan={...copy(sourcePlan),scales:{a:1.9,b:.9,c:1.2},artTitleStyles:{a:{visible:true,scale:2},b:{visible:false,scale:.8},c:{visible:true,scale:1.3}}};await source.saveDraft({id:'paper-draft',kind:'paper',payload:{plan:draftPlan,activeId:'a',originId:sourcePlan.id,baseRevision:sourcePlan.revision}});const backup=await source.exportBackup(),originalBackup=copy(backup);
  const target=setup(t,{},new IDBFactory(),'target').repo;await trio(target);const localPlan=(await target.savePaper(plan({title:'本机布局'}))).plans[0];let merged=await target.mergeBackup(await target.inspectBackup(backup));const imported=merged.plans.find(p=>p.title==='外部布局'),mappedA=imported.artIds[0],draft=merged.drafts[0].payload;
  assert.notEqual(mappedA,'a');assert.deepEqual(imported.scales,{[mappedA]:1.6,b:.7,c:1.4});assert.deepEqual(imported.artTitleStyles,{[mappedA]:{visible:false,scale:1.8},b:{visible:true,scale:.6},c:{visible:true,scale:1.4}});assert.equal(imported.scales.a,undefined);assert.equal(imported.artTitleStyles.a,undefined);
  assert.deepEqual(draft.plan.scales,{[mappedA]:1.9,b:.9,c:1.2});assert.deepEqual(draft.plan.artTitleStyles,{[mappedA]:{visible:true,scale:2},b:{visible:false,scale:.8},c:{visible:true,scale:1.3}});assert.equal(draft.activeId,mappedA);assert.equal(draft.originId,imported.id);assert.deepEqual(merged.plans.find(p=>p.id===localPlan.id),localPlan);assert.deepEqual(backup,originalBackup);
  await target.inspectBackup(await target.exportBackup());merged=await target.mergeBackup(await target.inspectBackup(backup));assert.equal(merged.plans.length,2);assert.equal(merged.drafts.length,1);assert.deepEqual(merged.plans.find(p=>p.id===imported.id).scales,imported.scales);assert.deepEqual(merged.drafts[0].payload.plan.artTitleStyles,draft.plan.artTitleStyles);
});

test('冲突导入保留历史缺图标记及各幅画的版式字段',async t=>{
  const legacy={version:2,artworks:[artwork('a',{title:'外部原画'}),artwork('b')],catalog:{stores:[store],menus:{[store.id]:[meal]}}},source=setup(t,{[R.LEGACY_KEYS[0]]:JSON.stringify(legacy),[R.LEGACY_KEYS[1]]:JSON.stringify([plan()])},new IDBFactory(),'source').repo;const sourcePlan=(await source.readSnapshot()).plans[0];await source.saveDraft({id:'legacy-paper',kind:'paper',payload:{plan:sourcePlan}});const backup=await source.exportBackup(),target=setup(t,{},new IDBFactory(),'target').repo;await target.createArtwork(artwork('a',{title:'本机原画'}));const merged=await target.mergeBackup(await target.inspectBackup(backup)),imported=merged.plans[0],mappedA=imported.artIds[0],draft=merged.drafts[0].payload.plan;
  assert.notEqual(mappedA,'a');assert.deepEqual(imported.missingArtIds,['c']);assert.deepEqual(draft.missingArtIds,['c']);assert.equal(imported.refs[2].versionId,'legacy-missing-c');assert.equal(imported.scales[mappedA],sourcePlan.scales.a);assert.equal(draft.scales[mappedA],sourcePlan.scales.a);assert.deepEqual(imported.artTitleStyles[mappedA],sourcePlan.artTitleStyles.a);assert.deepEqual(draft.artTitleStyles[mappedA],sourcePlan.artTitleStyles.a);assert.deepEqual((await target.resolvePaper(imported)).missing,['c']);await target.inspectBackup(await target.exportBackup());
});

test('备份校验、引用错误和预检后数据变化均无部分写入',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await trio(source);await source.savePaper(plan());const backup=await source.exportBackup(),target=setup(t,{},new IDBFactory(),'target').repo;await target.open();
  const bad=JSON.parse(JSON.stringify(backup));bad.data.versions[0].payload.title='被修改';await assert.rejects(target.inspectBackup(bad),e=>e.code==='INVALID_DATA');const missing=JSON.parse(JSON.stringify(backup));missing.data.plans[0].refs[0].versionId='missing';await assert.rejects(target.inspectBackup(missing),e=>e.code==='INVALID_DATA');assert.equal((await target.readSnapshot()).state.artworks.length,0);
  const inspection=await target.inspectBackup(backup);await target.setSettings({mode:'duo'});await assert.rejects(target.mergeBackup(inspection),e=>e.code==='CONFLICT');assert.equal((await target.readSnapshot()).state.artworks.length,0);
});

test('完整备份带回不可变旧版本，餐纸草稿冲突后关联另存方案而非本机旧方案',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await source.createArtwork(artwork('a',{kind:'image',imageSource:image,strokes:[]}));for(const id of ['b','c'])await source.createArtwork(artwork(id));const oldPlan=(await source.savePaper(plan())).plans[0];await source.replaceImage('a',image2);await source.saveDraft({id:'paper-draft',kind:'paper',payload:{plan:oldPlan,baseRevision:oldPlan.revision,activeId:'a',originId:oldPlan.id}});const backup=await source.exportBackup();
  const target=setup(t,{},new IDBFactory(),'target').repo;await trio(target);await target.savePaper(plan({title:'本机原方案'}));const merged=await target.mergeBackup(await target.inspectBackup(backup)),imported=merged.plans.find(p=>p.title==='原来的餐纸'),draft=merged.drafts[0];assert.notEqual(imported.id,'paper');assert.equal(draft.payload.plan.id,imported.id);assert.equal(draft.payload.originId,imported.id);assert.equal(draft.payload.baseRevision,imported.revision);assert.equal((await target.resolvePaper(imported)).artworks[0].imageSource,image);assert.equal(merged.state.artworks.find(a=>a.id===imported.artIds[0]).imageSource,image2);
  const repeat=await target.mergeBackup(await target.inspectBackup(backup));assert.equal(repeat.drafts.length,1);assert.equal(repeat.plans.length,2);
});

test('旧原文留本机，随完整备份保留业务归档且不会回写本机旧 key',async t=>{
  const raw=JSON.stringify({version:2,artworks:[artwork('a')],catalog:{stores:[],menus:{}},extraLegacySetting:'未知字段不导出'}),source=setup(t,{[R.LEGACY_KEYS[0]]:raw},new IDBFactory(),'source');const backup=await source.repo.exportBackup();assert.equal(source.storage.getItem(R.LEGACY_KEYS[0]),raw);const target=setup(t,{},new IDBFactory(),'target');await target.repo.mergeBackup(await target.repo.inspectBackup(backup));assert.equal(target.storage.getItem(R.LEGACY_KEYS[0]),null);const archive=JSON.parse((await target.repo.exportBackup()).data.legacyArchives[0].raw[0]);assert.equal(archive.extraLegacySetting,undefined);assert.deepEqual(archive.artworks[0].strokes,strokes);
});

test('迁移时已缺失的原画明确保留缺失标识，可完整备份但不静默生成',async t=>{
  const state={version:2,artworks:[artwork('a')],catalog:{stores:[store],menus:{[store.id]:[meal]}}};const {repo}=setup(t,{[R.LEGACY_KEYS[0]]:JSON.stringify(state),[R.LEGACY_KEYS[1]]:JSON.stringify([plan()])});const current=await repo.readSnapshot();assert.deepEqual((await repo.resolvePaper(current.plans[0])).missing,['b','c']);assert.equal(current.plans[0].artIds.length,3);await repo.inspectBackup(await repo.exportBackup());await assert.rejects(repo.savePaper(current.plans[0],{expectedRevision:1}),e=>e.code==='INVALID_DATA');
});

test('通知在提交之后发出；关闭监听不影响数据，频道失效不影响事务',async t=>{
  const events=[],channel={postMessage(){throw new Error('offline channel');},close(){}};const {factory,storage,name}=setup(t),repo=R.create({indexedDB:factory,storage,name,broadcast:channel});t.after(()=>repo.close());const unsubscribe=repo.subscribe(event=>events.push(event));await repo.createArtwork(artwork('a'));assert.equal(events.length,1);assert.equal(events[0].external,false);assert.equal((await repo.readSnapshot()).state.artworks.length,1);unsubscribe();await repo.setSettings({mode:'duo'});assert.equal(events.length,1);
});

test('笔迹结构校验拒绝损坏数据，保留有限原坐标与允许空恢复草稿',async t=>{
  const {repo}=setup(t),badStrokes=[null,{...strokes[0],points:null},{...strokes[0],points:[{x:'0.1',y:.2}]},{...strokes[0],points:[{x:Infinity,y:.2}]},{...strokes[0],width:0},{...strokes[0],width:NaN},{...strokes[0],color:'red'}];
  for(const [i,stroke] of badStrokes.entries())await assert.rejects(repo.createArtwork(artwork('bad-'+i,{strokes:[stroke]})),e=>e.code==='INVALID_DATA');
  await assert.rejects(repo.createArtwork(artwork('blank',{strokes:[]})),e=>e.code==='INVALID_DATA');assert.equal((await repo.readSnapshot()).state.artworks.length,0);
  const original=[{color:'#d94335',width:.011,points:[{x:-.3,y:1.5},{x:2,y:-1}]}];await repo.createArtwork(artwork('finite',{strokes:original}));assert.deepEqual((await repo.readSnapshot()).state.artworks[0].strokes,original);
  const payload=drawPayload();payload.draft.strokes=[];await repo.saveDraft({id:'empty',kind:'draw',payload});assert.deepEqual((await repo.readSnapshot()).drafts[0].payload.draft.strokes,[]);
});

test('重算内容哈希也无法导入损坏笔迹，失败不会写入部分备份',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await trio(source);await source.savePaper(plan());const backup=await source.exportBackup(),target=setup(t,{},new IDBFactory(),'target').repo;await target.createArtwork(artwork('local'));const before=(await target.exportBackup()).data;
  for(const mutate of [v=>v.payload.strokes[0].points=null,v=>v.payload.strokes[0].points[0].x='0.1',v=>v.payload.strokes[0].width=-1,v=>v.payload.strokes[0].color={token:'not-a-color'}]){const broken=copy(backup);mutate(broken.data.versions[0]);rehash(broken.data.versions[0]);await assert.rejects(target.mergeBackup(broken),e=>e.code==='INVALID_DATA');assert.deepEqual((await target.exportBackup()).data,before);}
});

test('备份预检检查真实绘画草稿快照、重做笔迹和餐纸草稿版本归属',async t=>{
  const source=setup(t,{},new IDBFactory(),'source').repo;await trio(source);const saved=(await source.savePaper(plan())).plans[0];await source.saveDraft({id:'draw',kind:'draw',payload:drawPayload()});await source.saveDraft({id:'paper',kind:'paper',payload:{plan:saved,filters:{query:'汉堡'}}});const backup=await source.exportBackup(),target=setup(t,{},new IDBFactory(),'target').repo,before=(await target.exportBackup()).data;
  for(const mutate of [b=>b.data.drafts.find(d=>d.kind==='draw').payload.draft.strokes[0].points=null,b=>b.data.drafts.find(d=>d.kind==='draw').payload.draft.redo=[{...strokes[0],width:0}],b=>b.data.drafts.find(d=>d.kind==='draw').payload.draft.mealSnapshot.id='other-meal',b=>delete b.data.drafts.find(d=>d.kind==='draw').payload.draft.storeSnapshot,b=>b.data.drafts.find(d=>d.kind==='paper').payload.plan.refs[0].versionId=saved.refs[1].versionId,b=>b.data.drafts.find(d=>d.kind==='paper').payload.plan.refs[0]=null]){const broken=copy(backup);mutate(broken);await assert.rejects(target.mergeBackup(broken),e=>e.code==='INVALID_DATA');assert.deepEqual((await target.exportBackup()).data,before);}
});

test('业务字段白名单阻止未知凭据字段经新作品、草稿、目录或旧归档扩散',async t=>{
  const marker='unknown-secret-marker-123',extra={mcpToken:marker,apiKey:marker},legacy={version:2,mode:'solo',storeId:store.id,...extra,catalog:{stores:[{...store,...extra}],menus:{[store.id]:[{...meal,...extra}]}},artworks:[artwork('a',{...extra,storeSnapshot:{...store,...extra},mealSnapshot:{...meal,...extra}})]};
  const original=JSON.stringify(legacy),{repo,storage}=setup(t,{[R.LEGACY_KEYS[0]]:original});await repo.createArtwork(artwork('b',extra));await repo.createArtwork(artwork('c',extra));await repo.setSettings(extra);await repo.setMenu({...store,...extra},[{...meal,...extra}]);await repo.savePaper(plan({...extra,artTitleStyles:{a:{visible:true,scale:1,...extra}}}));const payload=drawPayload(extra);Object.assign(payload.draft,extra);payload.draft.storeSnapshot={...store,...extra};await repo.saveDraft({id:'draw',kind:'draw',...extra,payload});
  const backup=await repo.exportBackup();assert.equal(JSON.stringify(backup).includes(marker),false);assert.equal(storage.getItem(R.LEGACY_KEYS[0]),original);await repo.inspectBackup(backup);
  const forged=copy(backup);forged.data.versions[0].payload.mcpToken=marker;rehash(forged.data.versions[0]);await assert.rejects(repo.inspectBackup(forged),e=>e.code==='INVALID_DATA');
});

test('获认可示例的霸八笔原坐标通过迁移与完整备份保持一致',async t=>{
  const pack=require('../web/examples/original-trio.json'),version=pack.data.versions.find(v=>v.artId==='public-example-art-ba-v1'),original=version.payload.strokes;assert.equal(original.length,8);
  const {repo}=setup(t,{[R.LEGACY_KEYS[0]]:JSON.stringify({version:2,artworks:[{...version.payload,id:version.artId}],catalog:pack.data.catalog})});const migrated=(await repo.readSnapshot()).state.artworks[0];assert.deepEqual(migrated.strokes,original);assert.deepEqual((await repo.exportBackup()).data.versions[0].payload.strokes,original);await repo.inspectBackup(pack);
});
