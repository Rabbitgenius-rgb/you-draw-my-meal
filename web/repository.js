(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MealRepository = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const DB_VERSION=1, FORMAT='draw-my-meal-backup', BACKUP_VERSION=1;
  const LEGACY_KEYS=['draw-my-meal-v1','draw-my-meal-papers-v1'];
  const STORES=['meta','artworks','versions','assets','plans','drafts','catalog'];
  const STORE_FIELDS=['id','source','storeCode','beCode','name','area','address','note','businessStatus'];
  const MEAL_FIELDS=['id','code','source','name','alias','tag','image','stores'];
  const ART_FIELDS=['id','storeId','mealId','mode','storeSnapshot','mealSnapshot','title','createdAt','strokes','thumbnail','kind','imageSource','titleEmbedded','isPublic','consentAt','revision','versionId','currentVersionId','deletedAt'];
  const VERSION_FIELDS=ART_FIELDS.filter(key=>!['id','isPublic','consentAt','revision','versionId','currentVersionId','deletedAt'].includes(key)).concat(['imageAssetId','thumbnailAssetId']);
  const PLAN_FIELDS=['id','version','revision','refs','artIds','templateId','legacyTemplateId','rendererVersion','missingArtIds','title','signature','layout','scales','artTitleStyles','showArtworkTitles','showDate','showStore','createdAt','updatedAt','importedFrom'];
  const imagePattern=/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const uid=prefix=>prefix+'-'+(root.crypto && root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  function error(code,message,cause){const e=new Error(message);e.code=code;if(cause)e.cause=cause;return e;}
  function storageError(e){return e && typeof e.code==='string'?e:error('STORAGE',e && e.name==='QuotaExceededError'?'设备空间不足，内容未保存':'本机存储未完成，请重试',e);}
  function assert(ok,message){if(!ok)throw error('INVALID_DATA',message);}
  function pick(value,fields){const out={};if(!value || typeof value!=='object')return out;for(const key of fields)if(Object.prototype.hasOwnProperty.call(value,key))out[key]=clone(value[key]);return out;}
  function validateStrokes(strokes){
    assert(Array.isArray(strokes),'画作笔迹格式无效');
    for(const stroke of strokes){assert(stroke && typeof stroke==='object' && Array.isArray(stroke.points),'画作笔画缺少有效 points');assert(Number.isFinite(stroke.width) && stroke.width>0,'画笔宽度必须是正的有限数');assert((stroke.erase===true && stroke.color===undefined) || (typeof stroke.color==='string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(stroke.color)),'画笔颜色格式无效');assert(stroke.erase===undefined || typeof stroke.erase==='boolean','橡皮擦标记无效');for(const point of stroke.points)assert(point && typeof point==='object' && Number.isFinite(point.x) && Number.isFinite(point.y),'笔画坐标必须是有限数');}
  }
  function cleanStrokes(strokes){return strokes.map(stroke=>({...pick(stroke,['color','width','erase']),points:stroke.points.map(point=>pick(point,['x','y']))}));}
  function validateSnapshots(store,meal){
    assert(store && meal && identifier(store.id) && identifier(meal.id) && typeof store.name==='string' && typeof meal.name==='string','门店或餐品快照无效');
    for(const [value,fields] of [[store,STORE_FIELDS],[meal,MEAL_FIELDS]])for(const key of fields)if(value[key]!==undefined && !['alias','stores','businessStatus'].includes(key))assert(typeof value[key]==='string','门店或餐品快照字段无效');
    if(store.businessStatus!==undefined)assert(typeof store.businessStatus==='boolean','门店营业状态无效');for(const key of ['alias','stores'])if(meal[key]!==undefined)assert(Array.isArray(meal[key]) && meal[key].every(v=>typeof v==='string'),'餐品别称或门店列表无效');
  }
  function validateCatalog(catalog){assert(catalog && Array.isArray(catalog.stores) && catalog.menus && typeof catalog.menus==='object' && !Array.isArray(catalog.menus),'门店目录格式无效');uniqueRows(catalog.stores,'门店目录');for(const store of catalog.stores)validateSnapshots(store,{id:'validation',name:''});for(const [id,meals] of Object.entries(catalog.menus)){assert(identifier(id),'门店菜单 ID 无效');uniqueRows(meals,'门店菜单');for(const meal of meals)validateSnapshots(catalog.stores.find(s=>s.id===id) || legacyStore(id),meal);}}
  function cleanArtwork(value,fields=ART_FIELDS){const a=pick(value,fields);if(a.storeSnapshot)a.storeSnapshot=pick(a.storeSnapshot,STORE_FIELDS);if(a.mealSnapshot)a.mealSnapshot=pick(a.mealSnapshot,MEAL_FIELDS);if(a.strokes)a.strokes=cleanStrokes(a.strokes);return a;}
  function cleanPlan(value){const p=pick(value,PLAN_FIELDS);if(p.refs)p.refs=p.refs.map(ref=>pick(ref,['artId','versionId']));if(p.scales)p.scales=Object.fromEntries((p.artIds || []).filter(id=>Object.prototype.hasOwnProperty.call(p.scales,id)).map(id=>[id,p.scales[id]]));if(p.artTitleStyles)p.artTitleStyles=Object.fromEntries((p.artIds || []).filter(id=>Object.prototype.hasOwnProperty.call(p.artTitleStyles,id)).map(id=>[id,pick(p.artTitleStyles[id],['visible','scale'])]));return p;}
  function cleanDraft(value){const d=pick(value,['id','kind','revision','updatedAt','conflictOf','importedFrom']);if(value.kind==='draw'){d.payload=pick(value.payload,['screen','color','brush','erase','referenceVisible','feedback','guessValue','revealedCorrect','scroll']);const raw=value.payload?.draft;d.payload.draft={...cleanArtwork(raw),...pick(raw,['redo','attempts','savedId'])};if(d.payload.draft.redo)d.payload.draft.redo=cleanStrokes(d.payload.draft.redo);}else{d.payload=pick(value.payload,['activeId','screen','scroll','originScroll','originId','baseRevision']);d.payload.plan=cleanPlan(value.payload?.plan);d.payload.filters=pick(value.payload?.filters,['query','store','meal','privacy']);}return d;}
  function cleanSettings(value){const settings={};if(typeof value?.storeId==='string')settings.storeId=value.storeId;if(['solo','duo'].includes(value?.mode))settings.mode=value.mode;if(value?.galleryPreferences)settings.galleryPreferences=Object.fromEntries(Object.entries(value.galleryPreferences).filter(([,v])=>typeof v==='boolean'));return settings;}
  function validatePlanShape(plan,versions,headers,complete=false){
    assert(plan && identifier(plan.id) && Array.isArray(plan.artIds) && plan.artIds.length<=6 && plan.artIds.every(identifier) && new Set(plan.artIds).size===plan.artIds.length,'餐纸选图格式无效');if(complete)assert(plan.artIds.length>=3,'餐纸少于三张画作');
    assert(Array.isArray(plan.refs || []) && (plan.refs || []).every(ref=>ref && typeof ref==='object'),'餐纸版本引用格式无效');const refs=plan.refs || [];assert(new Set(refs.map(r=>r.artId)).size===refs.length,'餐纸版本引用重复');assert(plan.missingArtIds===undefined || (Array.isArray(plan.missingArtIds) && plan.missingArtIds.every(identifier)),'餐纸缺失引用格式无效');for(const ref of refs){assert(plan.artIds.includes(ref.artId) && identifier(ref.versionId),'餐纸版本引用无效');const version=versions.get(ref.versionId);if(version)assert(version.artId===ref.artId,'餐纸版本归属不匹配');else assert((plan.missingArtIds || []).includes(ref.artId) && ref.versionId==='legacy-missing-'+ref.artId,'餐纸引用了丢失版本');}
    for(const id of plan.artIds)if(!refs.some(ref=>ref.artId===id))assert(headers.has(id) || (plan.missingArtIds || []).includes(id),'餐纸草稿缺少原画');
    if(plan.scales!==undefined){assert(plan.scales && typeof plan.scales==='object' && !Array.isArray(plan.scales),'餐纸大小格式无效');for(const scale of Object.values(plan.scales))assert(Number.isFinite(scale) && scale>0,'餐纸大小必须是正的有限数');}
    if(plan.artTitleStyles!==undefined){assert(plan.artTitleStyles && typeof plan.artTitleStyles==='object' && !Array.isArray(plan.artTitleStyles),'餐纸标题样式无效');for(const style of Object.values(plan.artTitleStyles))assert(style && typeof style==='object' && (style.scale===undefined || (Number.isFinite(style.scale) && style.scale>0)) && (style.visible===undefined || typeof style.visible==='boolean'),'餐纸标题样式无效');}
    if(plan.layout!==undefined)assert(Number.isInteger(plan.layout) && plan.layout>=0 && plan.layout<=2,'餐纸布局无效');for(const key of ['title','signature','templateId','legacyTemplateId','rendererVersion','createdAt','updatedAt','importedFrom'])if(plan[key]!==undefined)assert(typeof plan[key]==='string' || (key==='rendererVersion' && plan[key]===1),'餐纸文字或模板字段无效');for(const key of ['showArtworkTitles','showDate','showStore'])if(plan[key]!==undefined)assert(typeof plan[key]==='boolean','餐纸显示设置无效');for(const key of ['version','revision'])if(plan[key]!==undefined)assert(Number.isInteger(plan[key]) && plan[key]>=0,'餐纸修订号无效');
  }
  function validateDraft(value,maps){
    assert(value && ['draw','paper'].includes(value.kind) && value.payload && typeof value.payload==='object' && !Array.isArray(value.payload),'草稿类型或内容无效');
    for(const key of ['updatedAt','conflictOf','importedFrom'])if(value[key]!==undefined)assert(typeof value[key]==='string','草稿元数据无效');
    const p=value.payload;for(const key of ['screen','color','feedback','guessValue','activeId','originId'])if(p[key]!==undefined)assert(typeof p[key]==='string','草稿文字字段无效');
    for(const key of ['scroll','originScroll','baseRevision','brush'])if(p[key]!==undefined)assert(Number.isFinite(p[key]) && p[key]>=0,'草稿位置或画笔字段无效');
    for(const key of ['erase','referenceVisible','revealedCorrect'])if(p[key]!==undefined)assert(typeof p[key]==='boolean','草稿状态无效');
    if(value.kind==='draw'){
      const draft=p.draft;assert(draft && identifier(draft.storeId) && identifier(draft.mealId) && draft.storeSnapshot && draft.mealSnapshot,'绘画草稿缺少餐品快照');
      normalizeArtwork({...draft,id:draft.id || 'draft-validation'},{stores:[],menus:{}});if(draft.redo!==undefined)validateStrokes(draft.redo);
      if(draft.attempts!==undefined)assert(Number.isInteger(draft.attempts) && draft.attempts>=0,'草稿猜画次数无效');if(draft.savedId!==undefined && draft.savedId!==null)assert(identifier(draft.savedId),'草稿作品关联无效');
    }else{
      validatePlanShape(p.plan,maps.versions,maps.artworks);if(p.filters!==undefined){assert(p.filters && typeof p.filters==='object' && !Array.isArray(p.filters),'草稿筛选格式无效');for(const key of ['query','store','meal','privacy'])if(p.filters[key]!==undefined)assert(typeof p.filters[key]==='string','草稿筛选字段无效');}
    }
  }
  function cleanArchives(archives){const out=[];for(const archive of archives || []){try{const raw=archive.raw.map((text,index)=>{if(text===null)return null;const value=JSON.parse(text);if(index===0){assert(value && [1,2].includes(value.version),'旧归档版本无效');const catalog=value.catalog || {stores:[],menus:{}};validateCatalog(catalog);const state={version:value.version,...cleanSettings(value)};state.artworks=(value.artworks || []).map(a=>normalizeArtwork(a,catalog));state.catalog={stores:catalog.stores.map(s=>pick(s,STORE_FIELDS)),menus:Object.fromEntries(Object.entries(catalog.menus).map(([id,meals])=>[id,meals.map(m=>pick(m,MEAL_FIELDS))]))};return JSON.stringify(state);}return JSON.stringify(value.map(plan=>{const refs=plan.refs || [],versions=new Map(refs.map(ref=>[ref?.versionId,{artId:ref?.artId}])),headers=new Map((plan.artIds || []).map(id=>[id,{}]));validatePlanShape(plan,versions,headers);return cleanPlan(plan);}));});out.push({keys:LEGACY_KEYS.slice(),raw});}catch(_){/* The untouched local archive remains available; malformed foreign raw data is not exported. */}}return out;}
  async function cleanBackupData(value){
    const data={settings:cleanSettings(value.settings),catalog:{stores:value.catalog.stores.map(s=>pick(s,STORE_FIELDS)),menus:Object.fromEntries(Object.entries(value.catalog.menus).map(([id,meals])=>[id,meals.map(m=>pick(m,MEAL_FIELDS))]))},artworks:value.artworks.map(h=>{const header=pick(h,['id','currentVersionId','revision','albumOrder','isPublic','consentAt','deletedAt','importedFrom']);if(h.importedConsent)header.importedConsent=pick(h.importedConsent,['isPublic','consentAt']);return header;}),versions:[],assets:value.assets.map(a=>pick(a,['id','hash','source','mimeType'])),plans:value.plans.map(cleanPlan),drafts:value.drafts.map(cleanDraft),legacyArchives:cleanArchives(value.legacyArchives)};
    for(const version of value.versions){const payload=cleanArtwork(version.payload,VERSION_FIELDS);data.versions.push({id:version.id,artId:version.artId,hash:await digest(payload),payload});}return data;
  }
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(v=>canonical(v===undefined?null:v)).join(',')+']';
    if(value && typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  async function digest(value){
    const text=typeof value==='string'?value:canonical(value);
    if(root.crypto && root.crypto.subtle){const bytes=new TextEncoder().encode(text),hash=await root.crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');}
    if(typeof require==='function')return require('node:crypto').createHash('sha256').update(text).digest('hex');
    throw error('UNAVAILABLE','当前浏览器无法校验本机数据，请使用本机 HTTP 预览');
  }
  const identifier=value=>typeof value==='string' && value.length>0 && value.length<=300;
  function uniqueRows(rows,label){assert(Array.isArray(rows),label+'格式无效');const ids=new Set();for(const row of rows){assert(row && identifier(row.id),label+'缺少有效 ID');assert(!ids.has(row.id),label+'存在重复 ID');ids.add(row.id);}return rows;}
  function matchesRevision(row,expected,label){if(expected!==undefined && expected!==null && (row?.revision || 0)!==expected)throw error('CONFLICT',label+'已在其他标签更新，请重新载入或另存副本');}
  function defaultSettings(){return {storeId:'',mode:'solo'};}
  function legacyStore(id){const names={'demo-anfu':'安福路示例店','demo-riverside':'滨江示例店'};return {id,name:names[id] || '历史门店',source:'demo'};}
  function legacyMeal(id){const names={burger:'板烧鸡腿堡',fries:'薯条',cola:'可口可乐',nuggets:'麦乐鸡'};return {id,name:names[id] || '历史餐品',alias:[],source:'demo'};}
  function normalizeArtwork(value,catalog,creating=false){
    const a=clone(value);assert(a && typeof a==='object','画作格式无效');
    a.id=a.id || uid('art');assert(identifier(a.id) && identifier(a.storeId) && identifier(a.mealId),'画作缺少门店、餐品或 ID');
    validateStrokes(a.strokes);
    a.storeSnapshot=a.storeSnapshot || (catalog.stores || []).find(s=>s.id===a.storeId) || legacyStore(a.storeId);
    a.mealSnapshot=a.mealSnapshot || Object.values(catalog.menus || {}).flat().find(m=>m.id===a.mealId) || legacyMeal(a.mealId);
    assert(a.storeSnapshot.id===a.storeId && a.mealSnapshot.id===a.mealId,'画作快照与门店餐品不匹配');
    validateSnapshots(a.storeSnapshot,a.mealSnapshot);
    for(const key of ['title','createdAt','imageSource','thumbnail','consentAt'])if(a[key]!==undefined && a[key]!==null)assert(typeof a[key]==='string','画作文字、时间或图片字段无效');for(const key of ['titleEmbedded','isPublic'])if(a[key]!==undefined)assert(typeof a[key]==='boolean','画作状态无效');assert(a.mode===undefined || ['solo','duo'].includes(a.mode),'画作模式无效');assert(a.kind===undefined || a.kind==='image','画作类型无效');
    if(a.kind==='image')assert(imagePattern.test(a.imageSource || ''),'图片作品必须包含有效的 PNG 或 JPG');
    else if(creating)assert(a.strokes.some(s=>s && !s.erase && Array.isArray(s.points) && s.points.length),'先在画布上留下一笔吧');
    a.createdAt=a.createdAt || now();a.title=String(a.title || '今天的'+a.mealSnapshot.name).slice(0,30);
    a.mode=a.mode==='duo'?'duo':'solo';return cleanArtwork(a);
  }
  async function prepareVersion(art){
    const payload=clone(art),assets=[];
    for(const key of ['id','isPublic','consentAt','revision','versionId','currentVersionId','deletedAt'])delete payload[key];
    for(const [field,assetField] of [['imageSource','imageAssetId'],['thumbnail','thumbnailAssetId']]){
      if(typeof payload[field]==='string' && imagePattern.test(payload[field])){
        const source=payload[field],hash=await digest(source),id='asset-'+hash;
        assets.push({id,hash,source,mimeType:source.startsWith('data:image/png;')?'image/png':'image/jpeg'});payload[assetField]=id;delete payload[field];
      }
    }
    return {assets,version:{id:uid('version'),artId:art.id,hash:await digest(payload),payload}};
  }
  function normalizedPlan(value,refs){
    const p=cleanPlan(value || {});p.id=p.id || uid('paper');assert(identifier(p.id),'餐纸 ID 无效');
    p.version=p.version || 1;p.refs=clone(refs || p.refs || []);p.artIds=p.refs.length?p.refs.map(r=>r.artId):clone(p.artIds || []);
    p.templateId=p.templateId || 'legacy-'+Math.max(0,Math.min(2,Math.floor(Number(p.layout) || 0)));
    p.rendererVersion=p.rendererVersion || 'legacy-v1';p.createdAt=p.createdAt || now();p.updatedAt=p.updatedAt || p.createdAt;return p;
  }
  function materialize(version,header,assets){
    if(!version)return null;const a=clone(version.payload);
    if(a.imageAssetId){a.imageSource=assets.get(a.imageAssetId)?.source || '';delete a.imageAssetId;}
    if(a.thumbnailAssetId){a.thumbnail=assets.get(a.thumbnailAssetId)?.source || '';delete a.thumbnailAssetId;}
    return {...a,id:header?.id || version.artId,versionId:version.id,revision:header?.revision || 1,isPublic:header?.isPublic===true,consentAt:header?.consentAt || null};
  }
  function catalogFrom(ctx){const rows=[...ctx.maps.catalog.values()];return {stores:rows.map(r=>clone(r.store)),menus:Object.fromEntries(rows.map(r=>[r.id,clone(r.meals)]))};}
  function rawData(ctx){const legacyArchives=clone(ctx.maps.meta.get('backupArchives')?.value || []),local=ctx.maps.meta.get('legacyArchive');if(local?.raw.some(value=>value!==null && value!==undefined) && !legacyArchives.some(a=>canonical(a.raw)===canonical(local.raw)))legacyArchives.push({keys:LEGACY_KEYS.slice(),raw:clone(local.raw)});return {settings:clone(ctx.maps.meta.get('settings')?.value || defaultSettings()),catalog:catalogFrom(ctx),artworks:[...ctx.maps.artworks.values()].map(clone),versions:[...ctx.maps.versions.values()].map(clone),assets:[...ctx.maps.assets.values()].map(clone),plans:[...ctx.maps.plans.values()].map(clone),drafts:[...ctx.maps.drafts.values()].map(clone),legacyArchives};}
  function snapshot(ctx,warnings=[]){
    const settings=ctx.maps.meta.get('settings')?.value || defaultSettings();
    const headers=[...ctx.maps.artworks.values()].filter(h=>!h.deletedAt).sort((a,b)=>(a.albumOrder ?? Number.MAX_SAFE_INTEGER)-(b.albumOrder ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
    const artworks=headers.map(h=>materialize(ctx.maps.versions.get(h.currentVersionId),h,ctx.maps.assets)).filter(Boolean);
    const plans=[...ctx.maps.plans.values()].map(clone).sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0) || a.id.localeCompare(b.id));
    return {state:{version:2,...clone(settings),catalog:catalogFrom(ctx),artworks},plans,drafts:[...ctx.maps.drafts.values()].map(clone),revision:ctx.maps.meta.get('revision')?.value || 0,warnings};
  }
  function create(options={}){
    const idb=options.indexedDB || root.indexedDB;let storage=options.storage;
    if(storage===undefined){try{storage=root.localStorage;}catch(e){storage=null;}}
    const name=options.name || 'draw-my-meal-web-v1',instance=uid('client'),listeners=new Set();
    let db=null,opening=null,ready=false,channel=null,closed=false;
    function notify(event){for(const listener of listeners){try{listener(event);}catch(_){}}}
    function getLegacy(){try{return LEGACY_KEYS.map(k=>storage?storage.getItem(k):null);}catch(e){throw error('MIGRATION_FAILED','无法读取旧画册，旧数据未改动',e);}}
    function warningsFor(ctx){const archive=ctx.maps.meta.get('legacyArchive');if(!archive)return [];try{const current=getLegacy();return current.some((raw,i)=>raw!==archive.raw[i])?[{code:'LEGACY_CHANGED',message:'另一个旧版标签修改了旧画册；当前新画册未被覆盖，请备份并合并该分支。'}]:[];}catch(e){return [{code:'LEGACY_UNREADABLE',message:e.message}];}}
    function run(mode,handler){
      if(!db)return Promise.reject(error('CLOSED','存储连接已关闭，请重新加载页面'));
      return new Promise((resolve,reject)=>{
        let tx,result,problem,remaining=STORES.length;const maps={};
        try{tx=db.transaction(STORES,mode);}catch(e){reject(storageError(e));return;}
        const ctx={maps,put(store,row){maps[store].set(row.id,clone(row));tx.objectStore(store).put(clone(row));},remove(store,id){maps[store].delete(id);tx.objectStore(store).delete(id);}};
        tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(problem || storageError(tx.error));tx.onerror=()=>{};
        for(const store of STORES){
          const request=tx.objectStore(store).getAll();
          request.onsuccess=()=>{maps[store]=new Map(request.result.map(row=>[row.id,row]));if(--remaining)return;try{result=handler(ctx);}catch(e){problem=storageError(e);tx.abort();}};
        }
      });
    }
    async function write(handler){
      await open();const result=await run('readwrite',ctx=>{const extra=handler(ctx) || {};const revision=(ctx.maps.meta.get('revision')?.value || 0)+1;ctx.put('meta',{id:'revision',value:revision});return {...snapshot(ctx,warningsFor(ctx)),...extra};});
      const event={type:'changed',revision:result.revision,external:false,source:instance};notify(event);try{channel?.postMessage(event);}catch(_){}return result;
    }
    function addAssets(ctx,rows){for(const asset of rows){const previous=ctx.maps.assets.get(asset.id);if(previous){assert(previous.source===asset.source,'图片素材指纹冲突');}else ctx.put('assets',asset);}}
    async function prepareMigration(raw){
      let state={version:2,...defaultSettings(),artworks:[],catalog:{stores:[],menus:{}}},plans=[];
      try{
        if(raw[0]!==null && raw[0]!==undefined){state=JSON.parse(raw[0]);assert(state && [1,2].includes(state.version) && Array.isArray(state.artworks),'旧画册版本或格式无效');}
        if(raw[1]!==null && raw[1]!==undefined){plans=JSON.parse(raw[1]);assert(Array.isArray(plans),'旧餐纸格式无效');}
        uniqueRows(state.artworks,'旧画册');uniqueRows(plans,'旧餐纸');
        const catalog=state.catalog || {stores:[],menus:{}};validateCatalog(catalog);
        const rows=[],versions=[],assets=[];
        for(const value of state.artworks){const art=normalizeArtwork(value,catalog),prepared=await prepareVersion(art);versions.push(prepared.version);assets.push(...prepared.assets);rows.push({id:art.id,currentVersionId:prepared.version.id,revision:1,albumOrder:rows.length,isPublic:art.isPublic===true,consentAt:art.consentAt || null,deletedAt:null});}
        const headers=new Map(rows.map(h=>[h.id,h]));
        const migratedPlans=plans.map(value=>{assert([1,2].includes(value.version) && Array.isArray(value.artIds),'旧餐纸版本或选图无效');const missing=[];const refs=value.artIds.map(id=>{assert(identifier(id),'旧餐纸选图 ID 无效');const header=headers.get(id);if(!header)missing.push(id);return {artId:id,versionId:header?header.currentVersionId:'legacy-missing-'+id};});return {...normalizedPlan(value,refs),revision:1,...(missing.length?{missingArtIds:missing}:{})};});
        return {settings:{storeId:typeof state.storeId==='string'?state.storeId:'',mode:state.mode==='duo'?'duo':'solo',...(state.galleryPreferences?{galleryPreferences:clone(state.galleryPreferences)}:{})},catalog,artworks:rows,versions,assets,plans:migratedPlans,drafts:[]};
      }catch(e){throw error('MIGRATION_FAILED','旧画册无法完整迁移，原数据保留；请先导出旧数据再重试。'+(e.message?' '+e.message:''),e);}
    }
    function putCatalog(ctx,catalog){validateCatalog(catalog);for(const store of catalog.stores){const meals=catalog.menus[store.id] || [];ctx.put('catalog',{id:store.id,store:pick(store,STORE_FIELDS),meals:meals.map(m=>pick(m,MEAL_FIELDS)),queriedAt:now()});}}
    async function migrate(){
      const migrated=await run('readonly',ctx=>ctx.maps.meta.has('migration'));
      if(migrated)return;const raw=getLegacy(),data=await prepareMigration(raw);
      await run('readwrite',ctx=>{
        if(ctx.maps.meta.has('migration'))return;
        const latest=getLegacy();if(latest.some((value,i)=>value!==raw[i]))throw error('MIGRATION_FAILED','迁移期间旧画册发生变化，原数据保留，请重试');
        addAssets(ctx,data.assets);for(const row of data.artworks)ctx.put('artworks',row);for(const row of data.versions)ctx.put('versions',row);for(const row of data.plans)ctx.put('plans',row);putCatalog(ctx,data.catalog);
        ctx.put('meta',{id:'settings',value:data.settings});ctx.put('meta',{id:'revision',value:1});ctx.put('meta',{id:'legacyArchive',raw:clone(raw)});ctx.put('meta',{id:'migration',version:1,completedAt:now()});
      });
    }
    async function open(){
      if(closed)throw error('CLOSED','存储仓库已关闭');if(ready)return;if(opening)return opening;
      opening=(async()=>{
        if(!idb)throw error('UNAVAILABLE','当前浏览器不支持本机 IndexedDB 存储');
        db=await new Promise((resolve,reject)=>{const request=idb.open(name,DB_VERSION);request.onupgradeneeded=()=>{for(const store of STORES)if(!request.result.objectStoreNames.contains(store))request.result.createObjectStore(store,{keyPath:'id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(storageError(request.error));request.onblocked=()=>notify({type:'blocked',code:'BLOCKED',message:'请关闭其他旧版标签后重试'});});
        db.onversionchange=()=>{db.close();db=null;ready=false;notify({type:'versionchange',code:'VERSION_CHANGED',message:'本机数据结构已更新，请重新加载页面'});};
        try{await migrate();}catch(e){db.close();db=null;throw e;}
        if(options.broadcast!==false){try{channel=typeof options.broadcast==='function'?options.broadcast(name):options.broadcast && typeof options.broadcast==='object'?options.broadcast:typeof window!=='undefined' && root.BroadcastChannel?new root.BroadcastChannel(name+'-changes'):null;
          if(channel){const receive=e=>{const event=e.data || e;if(event.source!==instance)notify({...event,external:true});};if(channel.addEventListener)channel.addEventListener('message',receive);else channel.onmessage=receive;}
        }catch(_){channel=null;}}
        ready=true;
      })();try{await opening;}finally{opening=null;}
    }
    async function readSnapshot(){await open();return run('readonly',ctx=>snapshot(ctx,warningsFor(ctx)));}
    async function createArtwork(payload,opts={}){
      await open();const initial=await readSnapshot(),art=normalizeArtwork(payload,initial.state.catalog,true),prepared=await prepareVersion(art);
      return write(ctx=>{if(ctx.maps.artworks.has(art.id))throw error('CONFLICT','画作 ID 已存在，请另存为新作品');if(opts.draftId)matchesRevision(ctx.maps.drafts.get(opts.draftId),opts.draftRevision,'草稿');addAssets(ctx,prepared.assets);ctx.put('versions',prepared.version);ctx.put('artworks',{id:art.id,currentVersionId:prepared.version.id,revision:1,albumOrder:Math.min(0,...[...ctx.maps.artworks.values()].map(a=>a.albumOrder || 0))-1,isPublic:art.isPublic===true && !!art.consentAt,consentAt:art.isPublic===true && art.consentAt?art.consentAt:null,deletedAt:null});if(opts.draftId)ctx.remove('drafts',opts.draftId);return {savedArtworkId:art.id};});
    }
    async function replaceImage(artId,imageSource,opts={}){
      const initial=await readSnapshot(),art=initial.state.artworks.find(a=>a.id===artId);if(!art)throw error('NOT_FOUND','没有找到这张图片作品');assert(art.kind==='image','这张画不能替换图片');
      const next={...art,imageSource,thumbnail:'',...(opts.titleEmbedded!==undefined?{titleEmbedded:opts.titleEmbedded}:{})},prepared=await prepareVersion(normalizeArtwork(next,initial.state.catalog));
      return write(ctx=>{const header=ctx.maps.artworks.get(artId);if(!header || header.deletedAt)throw error('NOT_FOUND','没有找到这张图片作品');matchesRevision(header,opts.expectedRevision===undefined?art.revision:opts.expectedRevision,'画作');const current=ctx.maps.versions.get(header.currentVersionId);if(current.hash===prepared.version.hash)return {savedArtworkId:artId};addAssets(ctx,prepared.assets);ctx.put('versions',prepared.version);ctx.put('artworks',{...header,currentVersionId:prepared.version.id,revision:header.revision+1});return {savedArtworkId:artId};});
    }
    async function setConsent(artId,allow,opts={}){return write(ctx=>{const header=ctx.maps.artworks.get(artId);if(!header || header.deletedAt)throw error('NOT_FOUND','没有找到这张画');matchesRevision(header,opts.expectedRevision,'画作');ctx.put('artworks',{...header,revision:header.revision+1,isPublic:allow===true,consentAt:allow===true?(opts.consentAt || now()):null});});}
    async function deleteArtwork(artId,opts={}){return write(ctx=>{const header=ctx.maps.artworks.get(artId);if(!header || header.deletedAt)throw error('NOT_FOUND','没有找到这张画');matchesRevision(header,opts.expectedRevision,'画作');ctx.put('artworks',{...header,revision:header.revision+1,isPublic:false,consentAt:null,deletedAt:now()});});}
    function planRefs(ctx,plan){
      assert(plan && typeof plan==='object' && (plan.artIds===undefined || Array.isArray(plan.artIds)) && (plan.refs===undefined || Array.isArray(plan.refs)),'餐纸选图格式无效');
      const refs=Array.isArray(plan.refs) && plan.refs.length?clone(plan.refs):(plan.artIds || []).map(artId=>{const header=ctx.maps.artworks.get(artId);return {artId,versionId:header?.currentVersionId};});
      assert(refs.length>=3 && refs.length<=6 && refs.every(ref=>ref && typeof ref==='object'),'请选择 3～6 张自己的画作');assert(new Set(refs.map(r=>r.artId)).size===refs.length,'请勿重复选择同一张画作');
      for(const ref of refs){const version=ctx.maps.versions.get(ref.versionId);assert(version && version.artId===ref.artId,'餐纸引用的画作版本已丢失，请重新选画');}return refs;
    }
    async function savePaper(value,opts={}){assert(value && typeof value==='object','餐纸格式无效');return write(ctx=>{const previous=value.id?ctx.maps.plans.get(value.id):null;matchesRevision(previous,opts.expectedRevision===undefined?value.revision:opts.expectedRevision,'餐纸');if(previous && opts.expectedRevision===undefined && value.revision===undefined)throw error('CONFLICT','餐纸已存在，请重新载入或另存副本');if(opts.draftId)matchesRevision(ctx.maps.drafts.get(opts.draftId),opts.draftRevision,'草稿');const plan={...normalizedPlan(value,planRefs(ctx,value)),revision:(previous?.revision || 0)+1,updatedAt:now()};delete plan.missingArtIds;validatePlanShape(plan,ctx.maps.versions,ctx.maps.artworks,true);ctx.put('plans',plan);if(opts.draftId)ctx.remove('drafts',opts.draftId);return {savedPaperId:plan.id};});}
    async function resolvePaper(plan){await open();return run('readonly',ctx=>{const refs=plan.refs?.length?plan.refs:(plan.artIds || []).map(artId=>({artId,versionId:ctx.maps.artworks.get(artId)?.currentVersionId})),artworks=[],missing=[];for(const ref of refs){const version=ctx.maps.versions.get(ref.versionId);if(!version || version.artId!==ref.artId)missing.push(ref.artId);else artworks.push(materialize(version,ctx.maps.artworks.get(ref.artId),ctx.maps.assets));}return {artworks,missing};});}
    async function updatePaperVersions(paperId,refs,opts={}){const initial=await readSnapshot(),plan=initial.plans.find(p=>p.id===paperId);if(!plan)throw error('NOT_FOUND','没有找到这张餐纸');return savePaper({...plan,refs,artIds:refs.map(r=>r.artId)},opts);}
    async function saveDraft(value,opts={}){const raw=clone(value);assert(raw && ['draw','paper'].includes(raw.kind),'草稿类型无效');raw.id=raw.id || uid('draft');assert(identifier(raw.id),'草稿 ID 无效');return write(ctx=>{validateDraft(raw,ctx.maps);const draft=cleanDraft(raw),previous=ctx.maps.drafts.get(draft.id),expected=opts.expectedRevision===undefined?draft.revision:opts.expectedRevision;let conflicted=false;if((previous && (expected===undefined || previous.revision!==expected)) || (!previous && expected>0)){const origin=draft.id;draft.id=uid('draft');draft.conflictOf=origin;conflicted=true;}const saved={...draft,revision:conflicted?1:(previous?.revision || 0)+1,updatedAt:now()};ctx.put('drafts',saved);return {savedDraftId:saved.id,draftRevision:saved.revision,conflicted};});}
    async function deleteDraft(id,opts={}){return write(ctx=>{const previous=ctx.maps.drafts.get(id);matchesRevision(previous,opts.expectedRevision,'草稿');ctx.remove('drafts',id);});}
    async function setSettings(patch){assert(patch && typeof patch==='object','设置格式无效');return write(ctx=>{const previous=ctx.maps.meta.get('settings')?.value || defaultSettings(),next={...previous};if(Object.prototype.hasOwnProperty.call(patch,'mode')){assert(['solo','duo'].includes(patch.mode),'绘画模式无效');next.mode=patch.mode;}if(Object.prototype.hasOwnProperty.call(patch,'storeId')){assert(typeof patch.storeId==='string','门店 ID 无效');next.storeId=patch.storeId;}if(patch.galleryPreferences){assert(typeof patch.galleryPreferences==='object' && !Array.isArray(patch.galleryPreferences),'画廊偏好格式无效');for(const value of Object.values(patch.galleryPreferences))assert(typeof value==='boolean','画廊偏好值无效');next.galleryPreferences={...(previous.galleryPreferences || {}),...clone(patch.galleryPreferences)};}ctx.put('meta',{id:'settings',value:next});});}
    async function setMenu(store,meals){assert(store && identifier(store.id) && Array.isArray(meals),'门店菜单格式无效');return write(ctx=>{putCatalog(ctx,{stores:[store],menus:{[store.id]:meals}});ctx.put('meta',{id:'settings',value:{...(ctx.maps.meta.get('settings')?.value || defaultSettings()),storeId:store.id}});});}
    async function exportBackup(){await open();const data=await run('readonly',ctx=>rawData(ctx));return {format:FORMAT,version:BACKUP_VERSION,exportedAt:now(),data:await cleanBackupData(data)};}
    async function inspectBackup(input){
      let value;try{value=typeof input==='string'?JSON.parse(input):clone(input);}catch(e){throw error('INVALID_DATA','备份不是有效 JSON',e);}
      assert(value && value.format===FORMAT && value.version===BACKUP_VERSION && value.data,'备份格式或版本暂不支持');const data=value.data;
      for(const key of ['artworks','versions','assets','plans','drafts'])uniqueRows(data[key],key);
      assert(data.settings && typeof data.settings==='object' && !Array.isArray(data.settings),'备份设置无效');validateCatalog(data.catalog);
      const assets=new Map(data.assets.map(a=>[a.id,a])),versions=new Map(data.versions.map(v=>[v.id,v])),headers=new Map(data.artworks.map(h=>[h.id,h]));
      for(const asset of data.assets){assert(typeof asset.source==='string' && imagePattern.test(asset.source) && ['image/png','image/jpeg'].includes(asset.mimeType),'备份含无效图片');const hash=await digest(asset.source);assert(asset.hash===hash && asset.id==='asset-'+hash,'图片校验未通过');}
      for(const version of data.versions){assert(identifier(version.artId) && headers.has(version.artId) && version.payload && typeof version.payload==='object','备份画作版本关联无效');assert(Object.keys(version.payload).every(key=>VERSION_FIELDS.includes(key)),'备份包含未支持的画作字段');assert(version.hash===await digest(version.payload),'画作内容校验未通过');for(const key of ['imageAssetId','thumbnailAssetId'])if(version.payload[key])assert(assets.has(version.payload[key]),'备份缺少图片素材');const material=materialize(version,headers.get(version.artId),assets);normalizeArtwork(material,data.catalog);}
      for(const header of data.artworks){const version=versions.get(header.currentVersionId);assert(version && version.artId===header.id,'备份缺少画作当前版本');assert(Number.isInteger(header.revision) && header.revision>=1,'画作修订号无效');for(const key of ['consentAt','deletedAt','importedFrom'])if(header[key]!==undefined && header[key]!==null)assert(typeof header[key]==='string','画作元数据无效');if(header.albumOrder!==undefined)assert(Number.isFinite(header.albumOrder),'画册排序无效');if(header.isPublic!==undefined)assert(typeof header.isPublic==='boolean','公开许可无效');if(header.importedConsent)assert(typeof header.importedConsent.isPublic==='boolean' && (header.importedConsent.consentAt===null || typeof header.importedConsent.consentAt==='string'),'原始许可记录无效');}
      for(const plan of data.plans){validatePlanShape(plan,versions,headers,true);assert(Array.isArray(plan.refs) && plan.refs.length===plan.artIds.length && plan.refs.every((r,i)=>r.artId===plan.artIds[i]),'餐纸选图顺序与版本不匹配');}
      for(const draft of data.drafts)validateDraft(draft,{versions,artworks:headers});
      if(data.legacyArchives!==undefined){assert(Array.isArray(data.legacyArchives),'旧数据归档格式无效');for(const archive of data.legacyArchives)assert(Array.isArray(archive.keys) && archive.keys.length===2 && archive.keys.every((key,i)=>key===LEGACY_KEYS[i]) && Array.isArray(archive.raw) && archive.raw.length===2 && archive.raw.every(raw=>raw===null || typeof raw==='string'),'旧数据归档格式无效');}
      value.data=await cleanBackupData(data);
      await open();const preview=await run('readonly',ctx=>{const maps=Object.fromEntries(STORES.map(store=>[store,new Map([...ctx.maps[store]].map(([id,row])=>[id,clone(row)]))]));const simulated={maps,put(store,row){maps[store].set(row.id,clone(row));},remove(store,id){maps[store].delete(id);}};return {revision:ctx.maps.meta.get('revision')?.value || 0,...applyMerge(simulated,value.data)};});
      return {parsed:value,expectedDataRevision:preview.revision,summary:{artworks:data.artworks.filter(a=>!a.deletedAt).length,versions:data.versions.length,assets:data.assets.length,plans:data.plans.length,drafts:data.drafts.length,...preview.summary}};
    }
    function semanticVersion(version){return {hash:version.hash,payload:version.payload};}
    function semanticPaper(plan){const p=clone(plan);for(const key of ['id','revision','updatedAt','importedFrom'])delete p[key];return canonical(p);}
    function remapPaper(plan,artMap,versionMap){
      const mapped=clone(plan),artId=id=>artMap.get(id) || id;
      mapped.refs=(plan.refs || []).map(ref=>({artId:artId(ref.artId),versionId:versionMap.get(ref.versionId) || ref.versionId}));
      mapped.artIds=(plan.artIds || []).map(artId);
      for(const key of ['scales','artTitleStyles'])if(plan[key])mapped[key]=Object.fromEntries(Object.entries(plan[key]).map(([id,value])=>[artId(id),clone(value)]));
      if(plan.missingArtIds)mapped.missingArtIds=plan.missingArtIds.map(artId);
      return mapped;
    }
    function applyMerge(ctx,data){
        const summary={addedArtworks:0,addedVersions:0,addedPlans:0,addedDrafts:0,deduplicated:0,conflicts:0},artMap=new Map(),versionMap=new Map(),planMap=new Map();let albumOrder=Math.min(0,...[...ctx.maps.artworks.values()].map(a=>a.albumOrder || 0))-data.artworks.length;addAssets(ctx,data.assets);
        for(const source of data.artworks.slice().sort((a,b)=>(a.albumOrder || 0)-(b.albumOrder || 0))){
          const sourceVersions=data.versions.filter(v=>v.artId===source.id),current=data.versions.find(v=>v.id===source.currentVersionId),existing=ctx.maps.artworks.get(source.id);
          const exact=[...ctx.maps.artworks.values()].find(header=>{const version=ctx.maps.versions.get(header.currentVersionId);return version && canonical(semanticVersion(version))===canonical(semanticVersion(current)) && !!header.deletedAt===!!source.deletedAt;});
          let target=existing,artId=source.id,isNew=false;
          if(existing){const existingCurrent=ctx.maps.versions.get(existing.currentVersionId);if(canonical(semanticVersion(existingCurrent))!==canonical(semanticVersion(current)) || !!existing.deletedAt!==!!source.deletedAt){if(exact){artId=exact.id;target=exact;}else{artId=uid('art');target=null;summary.conflicts++;}}}
          else if(exact){artId=exact.id;target=exact;}
          if(!target){isNew=true;summary.addedArtworks++;}else summary.deduplicated++;
          artMap.set(source.id,artId);
          for(const version of sourceVersions){let match=[...ctx.maps.versions.values()].find(v=>v.artId===artId && canonical(semanticVersion(v))===canonical(semanticVersion(version)));if(match){versionMap.set(version.id,match.id);continue;}let versionId=version.id;const collision=ctx.maps.versions.get(versionId);if(collision)versionId=uid('version');const next={...clone(version),id:versionId,artId};ctx.put('versions',next);versionMap.set(version.id,versionId);summary.addedVersions++;}
          if(isNew)ctx.put('artworks',{...clone(source),id:artId,currentVersionId:versionMap.get(source.currentVersionId),revision:1,albumOrder:albumOrder++,isPublic:false,consentAt:null,...(source.isPublic || source.consentAt?{importedConsent:{isPublic:source.isPublic===true,consentAt:source.consentAt || null}}:{}),importedFrom:source.id});
        }
        for(const source of data.plans){const candidate=remapPaper(source,artMap,versionMap);const duplicate=[...ctx.maps.plans.values()].find(p=>semanticPaper(p)===semanticPaper(candidate));if(duplicate){planMap.set(source.id,duplicate.id);summary.deduplicated++;continue;}let id=source.id;if(ctx.maps.plans.has(id)){id=uid('paper');summary.conflicts++;}ctx.put('plans',{...candidate,id,revision:1,importedFrom:source.id});planMap.set(source.id,id);summary.addedPlans++;}
        for(const source of data.drafts){const draft=clone(source);if(draft.kind==='paper' && draft.payload?.plan){const p=draft.payload.plan=remapPaper(draft.payload.plan,artMap,versionMap);if(draft.payload.activeId)draft.payload.activeId=artMap.get(draft.payload.activeId)||draft.payload.activeId;const targetId=planMap.get(p.id);if(targetId){p.id=targetId;p.revision=ctx.maps.plans.get(targetId)?.revision || 0;draft.payload.baseRevision=p.revision;if(draft.payload.originId)draft.payload.originId=planMap.get(draft.payload.originId)||draft.payload.originId;}else if(ctx.maps.plans.has(p.id)){p.id=uid('paper');p.revision=0;draft.payload.baseRevision=0;}}
          const semantic=d=>{const value=clone(d);for(const key of ['id','revision','updatedAt','importedFrom'])delete value[key];return canonical(value);};if([...ctx.maps.drafts.values()].some(d=>semantic(d)===semantic(draft))){summary.deduplicated++;continue;}if(ctx.maps.drafts.has(draft.id)){draft.id=uid('draft');summary.conflicts++;}ctx.put('drafts',{...draft,revision:1,importedFrom:source.id});summary.addedDrafts++;}
        if(data.legacyArchives?.length){const archives=clone(ctx.maps.meta.get('backupArchives')?.value || []);for(const archive of data.legacyArchives)if(!archives.some(a=>canonical(a.raw)===canonical(archive.raw)))archives.push(clone(archive));ctx.put('meta',{id:'backupArchives',value:archives});}
        return {summary};
    }
    async function mergeBackup(inspected){
      const validated=await inspectBackup(inspected?.parsed || inspected),data=validated.parsed.data;
      return write(ctx=>{
        if(inspected?.expectedDataRevision!==undefined && inspected.expectedDataRevision!==(ctx.maps.meta.get('revision')?.value || 0))throw error('CONFLICT','画册在备份预检后发生变化，请重新预检');
        return applyMerge(ctx,data);
      });
    }
    function subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
    function close(){closed=true;ready=false;db?.close();db=null;channel?.close?.();channel=null;listeners.clear();}
    return {open,readSnapshot,createArtwork,replaceImage,setConsent,deleteArtwork,savePaper,resolvePaper,updatePaperVersions,saveDraft,deleteDraft,setSettings,setMenu,exportBackup,inspectBackup,mergeBackup,subscribe,close};
  }
  return {create,FORMAT,BACKUP_VERSION,DB_VERSION,LEGACY_KEYS};
});
