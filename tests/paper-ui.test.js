'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../web/placemat'),UI=require('../web/paper-ui');
const createDeferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(t,overrides={}) {
  const listeners={},downloads=[],renders=[],toasts=[],savedDrafts=[],fonts=createDeferred();
  const previous={document:global.document,requestAnimationFrame:global.requestAnimationFrame,cancelAnimationFrame:global.cancelAnimationFrame,URL:global.URL};
  global.document={visibilityState:'visible',fonts:{ready:fonts.promise},addEventListener(type,listener){listeners[type]=listener;},querySelector(){return null;},createElement(type){if(type==='a')return {click(){downloads.push(this.download);}};return {width:0,height:0,toBlob(callback){callback({type:'image/png'});}};}};
  global.requestAnimationFrame=()=>0;global.cancelAnimationFrame=()=>{};global.URL={createObjectURL:()=> 'blob:test',revokeObjectURL(){}};
  t.after(()=>Object.assign(global,previous));
  const arts=['a','b','c'].map(id=>({id,versionId:id+'-v1',title:id,strokes:[],storeSnapshot:{name:'示例店'}}));
  let screen='history';const root={scrollTop:60,addEventListener(){},querySelectorAll:()=>[]};
  const repo={resolvePaper:async plan=>P.resolve(plan,arts),saveDraft:async(draft,options)=>{savedDrafts.push({draft,options});return {plans:[],drafts:[{...draft,revision:(options.expectedRevision || 0)+1}],savedDraftId:draft.id};},...overrides};
  const host={repo,paper:{...P,prepareImages:async()=>{},render(canvas,plan,items){renders.push({width:canvas.width,height:canvas.height,plan,items});}},core:{dateLabel:()=>'',artStore:a=>a.storeSnapshot},button:(action,label,klass,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`,esc:String,thumbnail:()=>'',root,modalRoot:{},toast:message=>toasts.push(message),artworks:()=>arts,screen:()=>screen,historyFilters:()=>({query:'',store:'all',meal:'all',privacy:'all'}),show:value=>{screen=value;},showModal(){},closeModal(){},refreshDock(){},returnTo:value=>{screen=value;}};
  const ui=UI.create(host);
  const draft=(id,title)=>({id,kind:'paper',revision:3,payload:{plan:P.makePlan({id:'paper-'+id,title,artIds:['a','b','c'],refs:arts.map(a=>({artId:a.id,versionId:a.versionId})),revision:2}),filters:{query:'原始筛选',store:'all',meal:'all',privacy:'private'},activeId:'b',screen:'paper-edit',scroll:241,baseRevision:2}});
  return {ui,root,draft,fonts,downloads,renders,toasts,savedDrafts,listeners,host};
}
test('导出等待字体时切换餐纸，仍下载点击时的画面和标题',async t=>{
  const h=harness(t);await h.ui.resumeDraft(h.draft('first','原来的餐纸'));
  const exportPromise=h.ui.download();await h.ui.resumeDraft(h.draft('second','后来的餐纸'));
  h.fonts.resolve();await exportPromise;
  assert.deepEqual(h.downloads,['原来的餐纸-餐纸.png']);assert.equal(h.renders[0].plan.title,'原来的餐纸');
  assert.equal(h.renders[0].width,4961);assert.equal(h.renders[0].height,3508);
});
test('餐纸草稿恢复筛选和编辑位置，按独立草稿 ID 与修订号保存',async t=>{
  const h=harness(t);assert.equal(await h.ui.resumeDraft(h.draft('first','草稿餐纸')),true);
  assert.equal(h.root.scrollTop,241);await h.ui.flushDraft();
  assert.equal(h.savedDrafts[0].draft.id,'first');assert.equal(h.savedDrafts[0].options.expectedRevision,3);
  assert.equal(h.savedDrafts[0].draft.payload.filters.query,'原始筛选');assert.equal(h.savedDrafts[0].draft.payload.activeId,'b');
  assert.equal(h.savedDrafts[0].draft.payload.baseRevision,2);assert.deepEqual(h.savedDrafts[0].draft.payload.plan.refs,[{artId:'a',versionId:'a-v1'},{artId:'b',versionId:'b-v1'},{artId:'c',versionId:'c-v1'}]);
  assert.equal(h.ui.hasUnsaved(),true);
});
test('草稿保存失败仍保留当前编辑，不将失败误报为已保存',async t=>{
  const error=Object.assign(new Error('容量不足'),{name:'QuotaExceededError'}),h=harness(t,{saveDraft:async()=>{throw error;}});
  await h.ui.resumeDraft(h.draft('first','还在页面上'));await assert.rejects(h.ui.flushDraft(),/容量不足/);
  assert.equal(h.ui.hasUnsaved(),true);assert.match(h.ui.dock(),/草稿保存失败/);assert.ok(h.toasts.some(message=>message.includes('设备空间不足')));
});
test('保存已恢复餐纸使用原选版本和基线修订号，成功后才清除草稿',async t=>{
  let saved;
  const h=harness(t,{savePaper:async(plan,options)=>{saved={plan,options};return {plans:[{...plan,revision:3}],drafts:[]};}});
  await h.ui.resumeDraft(h.draft('first','固定原画'));
  h.host.artworks=()=>['a','b','c'].map(id=>({id,versionId:id+'-v2',title:'新版'+id,strokes:[]}));
  await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{action:'paper-save'}})}});
  assert.equal(saved.options.expectedRevision,2);assert.equal(saved.options.draftId,'first');assert.equal(saved.options.draftRevision,4);
  assert.deepEqual(saved.plan.refs.map(ref=>ref.versionId),['a-v1','b-v1','c-v1']);assert.equal(h.ui.hasUnsaved(),false);
});
test('新建餐纸默认留白；旧方案可切换三种模板并保留原版入口',async t=>{
  const h=harness(t);
  const click=action=>h.listeners.click({target:{closest:()=>({disabled:false,dataset:action})}});
  await click({action:'paper-new'});
  assert.match(h.ui.editorView(),/<small>留白<\/small>/);assert.doesNotMatch(h.ui.editorView(),/保留原版/);
  await h.ui.resumeDraft(h.draft('old','原版方案'));
  assert.match(h.ui.editorView(),/保留原版 · 排版 1/);
  global.document.querySelector=()=>({innerHTML:''});
  for(const template of P.TEMPLATES){
    await click({action:'paper-template',template:template.id});await h.ui.flushDraft();
    const last=h.savedDrafts.at(-1).draft.payload.plan;
    assert.equal(last.templateId,template.id);assert.equal(last.rendererVersion,'templates-v1');
    assert.match(h.ui.editorView(),/保留原版 · 排版 1/);
  }
  await click({action:'paper-template',template:'legacy-0'});await h.ui.flushDraft();
  assert.equal(h.savedDrafts.at(-1).draft.payload.plan.templateId,'legacy-0');assert.equal(h.savedDrafts.at(-1).draft.payload.plan.rendererVersion,'legacy-v1');
});
test('另一页更新原画与餐纸时局部提示，保留当前输入、焦点、滚动和固定版本',async t=>{
  const h=harness(t),draft=h.draft('first','本页原始标题');await h.ui.resumeDraft(draft);
  const before=h.ui.editorView(),initial=/data-version-status="([^"]+)"/.exec(before)[1];
  let writes=0,content='';
  const container={dataset:{versionStatus:initial},contains:()=>false,get innerHTML(){return content;},set innerHTML(value){content=value;writes++;h.root.scrollTop=999;}};
  const titleInput={id:'paper-title',value:'正在输入的本页标题',selectionStart:4,selectionEnd:7};
  global.document.activeElement=titleInput;
  h.root.querySelector=selector=>selector==='#paper-version-tools'?container:selector==='#paper-title'?titleInput:null;
  h.host.show=()=>assert.fail('跨标签同步不应重渲染编辑器');
  h.host.refreshDock=()=>{h.root.scrollTop=777;};
  h.listeners.input({target:titleInput});h.root.scrollTop=346;
  h.host.artworks=()=>['a','b','c'].map(id=>({id,versionId:id==='a'?'a-v2':id+'-v1',title:id,strokes:[]}));
  h.ui.sync({plans:[draft.payload.plan],drafts:[]});
  assert.match(container.innerHTML,/更新为最新版本/);assert.doesNotMatch(container.innerHTML,/另一页更新了此方案/);
  assert.equal(h.root.scrollTop,346);assert.equal(titleInput.value,'正在输入的本页标题');assert.equal(global.document.activeElement,titleInput);assert.equal(titleInput.selectionStart,4);assert.equal(titleInput.selectionEnd,7);
  const remote={...draft.payload.plan,revision:3,title:'另一页保存的标题'};
  h.ui.sync({plans:[remote],drafts:[]});assert.match(container.innerHTML,/另一页更新了此方案/);assert.match(h.ui.dock(),/另一页更新了此方案/);
  assert.equal(h.root.scrollTop,346);const count=writes;h.ui.sync({plans:[remote],drafts:[]});assert.equal(writes,count,'相同状态无需重复替换提示 DOM');
  await h.ui.flushDraft();const preserved=h.savedDrafts.at(-1).draft.payload;
  assert.equal(preserved.plan.title,'正在输入的本页标题');assert.equal(preserved.baseRevision,2);assert.equal(preserved.plan.refs[0].versionId,'a-v1');
});
test('自己的方案保存成功后移除远程变更提示，不残留虚假冲突状态',async t=>{
  const h=harness(t,{savePaper:async(plan)=>({plans:[{...plan,revision:3}],drafts:[]})});await h.ui.resumeDraft(h.draft('first','保存成功'));
  const container={dataset:{versionStatus:'same-current'},contains:()=>false,innerHTML:''};h.root.querySelector=()=>container;
  await h.listeners.click({target:{closest:()=>({disabled:false,dataset:{action:'paper-save'}})}});
  assert.equal(container.dataset.versionStatus,'same-current');assert.doesNotMatch(container.innerHTML,/另一页更新了此方案/);assert.doesNotMatch(h.ui.dock(),/另一页更新了此方案/);
});
