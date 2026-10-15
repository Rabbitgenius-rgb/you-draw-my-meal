(() => {
  'use strict';
  const C = window.MealArt;
  const root = document.querySelector('#app');
  const tabbar = document.querySelector('#tabbar');
  const mealDock = document.querySelector('#meal-dock');
  const modalRoot = document.querySelector('#modal-root');
  const asset = file => '../miniprogram/assets/' + file;
  const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const repo = window.MealRepository.create({indexedDB,storage:localStorage});
  let snapshot={state:C.initialState(),plans:[],drafts:[],revision:-1,warnings:[]};
  let state = snapshot.state, ready=false, storageFailure=null;
  let tab = 'home', screen = 'home', selectedMeal = '';
  let connection={configured:false,connected:false,loading:true,message:'正在检查连接…'}, liveStoreId='';
  let storeResults=[], city=(C.store(state.storeId)||{}).area || '', keyword='', storeBusy=false, storeError='', searched=false, category='all';
  let filter = 'all', draft = null, color = C.COLORS[0], brush = .011, erase = false;
  let referenceVisible = true, canvas = null, ctx = null, resizeObserver = null, activePointer = null;
  let feedback = '', guessValue = '', revealedCorrect = false;
  let mealQuery = '', mealCategory = 'all';
  let galleryQuery = '', galleryOnlyWithArt = true;
  let historyQuery = '', historyStore = 'all', historyMeal = 'all';
  let historyDetail = null;
  let drawingDraftId='',drawingDraftRevision=0,drawingTimer=0,drawingContext=null,drawingStatus='',savingArtwork=false;
  const paperUI = window.MealPaperUI.create({core:C,paper:window.MealPaper,repo,snapshot,onSnapshot,button,esc,thumbnail,root,modalRoot,toast,showModal,closeModal,
    artworks:()=>state.artworks,screen:()=>screen,historyFilters:()=>({query:historyQuery,store:historyStore,meal:historyMeal,privacy:filter}),
    show:next=>{screen=next;render();},refreshDock:renderMealDock,
    returnTo:(destination,scroll,id)=>{screen=tab=destination;render();if(destination==='history'){const opener=[...root.querySelectorAll('[data-action="paper-open"]')].find(el=>el.dataset.id===id)||root.querySelector('[data-action="paper-new"]');if(opener){const details=opener.closest('details');if(details)details.open=true;}root.scrollTop=scroll;if(opener)opener.focus({preventScroll:true});}}});
  const galleryPicks = {};
  window.MealImageImport.create({core:C,button,esc,modalRoot,toast,showModal,storeId:()=>state.storeId,
    artwork:id=>state.artworks.find(art=>art.id===id),
    add:async art=>{const value=await commit(()=>repo.createArtwork(art));return !!value;},
    replace:async(id,imageSource,original)=>{
      if (!original || original.kind!=='image') {toast('没有找到这张图片作品');return false;}
      return !!await commit(()=>repo.replaceImage(id,imageSource,{expectedRevision:original.revision}),async()=>{
        const copy={...original,id:newId('art'),title:(original.title.slice(0,25)+'（副本）'),imageSource,thumbnail:'',isPublic:false,consentAt:null};
        delete copy.versionId;delete copy.revision;
        if(await commit(()=>repo.createArtwork(copy))){goHistory();toast('新图片已另存为私密副本');}
      });
    },
    finish:id=>{if(id && historyDetail)refreshHistoryDetail();else goHistory();}});
  const artMode = art => art.kind === 'image' ? '图片作品' : art.mode === 'duo' ? '双人猜画' : '单人绘画';
  const WALL_PAGE_SIZE = 12;
  let wall = null, galleryScroll = 0, lightboxId = null, lightboxOriginId = null;
  const icons = {
    home:'<path d="M4 20l4-1 12-12-4-4L4 15v5Z"/><path d="M13 6l4 4M4 21h16"/>',
    gallery:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 5 4 3-3 5 5"/><circle cx="16" cy="9" r="1"/>',
    history:'<path d="M5 4h13a2 2 0 0 1 2 2v15H6a3 3 0 0 1 0-6h14M5 4v11M9 7v5M12 7h5"/>',
    undo:'<path d="M8 6L3 11l5 5M3 11h11a6 6 0 0 1 6 6"/>',
    redo:'<path d="M16 6l5 5-5 5M21 11H10a6 6 0 0 0-6 6"/>',
    erase:'<path d="M4 15l9-11 8 7-9 10H9l-5-4v-2ZM10 9l8 7M13 21h8"/>',
    pin:'<path d="M12 21s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z"/><circle cx="12" cy="9" r="2"/>'
  };
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
  const newId=prefix=>prefix+'-'+crypto.randomUUID();
  const dataUI=window.MealDataUI.create({repo,button,esc,toast,showModal,modalRoot,onSnapshot,
    activeDraft:id=>id===drawingDraftId || id===paperUI.activeDraftId?.(),hasHistoryDetail:()=>!!historyDetail,
    resume:resumeCreation,showHistory:goHistory,reloadConflict:()=>{modalRoot.innerHTML='';historyDetail=null;refreshVisible();}});
  function onSnapshot(next){
    if(next.revision<snapshot.revision)return;
    snapshot=next;state=next.state;C.setCatalog(state.catalog);paperUI.sync(next);dataUI.sync(next);
  }
  async function commit(action,copy){try{const next=await action();onSnapshot(next);return next;}catch(error){dataUI.error(error,copy);return null;}}
  function refreshVisible(){
    if(!['home','gallery','history','wall'].includes(screen))return;
    const scroll=root.scrollTop,focus=document.activeElement,focusId=focus?.id,start=focus?.selectionStart,end=focus?.selectionEnd;
    const expanded=!!root.querySelector('.paper-saved[open]');render();
    if(expanded && root.querySelector('.paper-saved'))root.querySelector('.paper-saved').open=true;
    root.scrollTop=scroll;
    const target=focusId && document.getElementById(focusId);if(target){target.focus({preventScroll:true});if(typeof target.setSelectionRange==='function' && start!==null)try{target.setSelectionRange(start,end);}catch(_){}}
    if(historyDetail && modalRoot.querySelector('.history-detail'))refreshHistoryDetail();
    if(lightboxId && !wallArtworks().some(a=>a.id===lightboxId))closeModal();
  }
  async function readChanges(){
    try{const next=await repo.readSnapshot();if(next.revision>snapshot.revision){onSnapshot(next);refreshVisible();}}
    catch(error){dataUI.error(error);}
  }
  let toastTimer;
  function toast(message) {
    const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }
  function button(action, text, className, extra) { return `<button type="button" class="${className || ''}" data-action="${action}" ${extra || ''}>${text}</button>`; }
  const liveMenu=()=>liveStoreId===state.storeId && connection.connected ? C.menu(state.storeId) : [];
  const mealImage=m=>C.imageUrl(m).replace(/^\/assets\//,'../miniprogram/assets/') || '../miniprogram/assets/no-image.svg';
  async function api(path,options){
    const response=await fetch('/api/mcd/'+path,{...options,signal:AbortSignal.timeout(45000)});
    const value=await response.json();if(!response.ok)throw new Error(value.error && value.error.message || '查询未完成，请重试');return value;
  }
  async function connect(){
    connection={...connection,loading:true,message:'正在检查连接…'};liveStoreId='';refreshVisible();
    try{connection={...await api('status'),loading:false};if(connection.connected && C.store(state.storeId))await loadMenu(C.store(state.storeId));}
    catch(error){connection={...connection,loading:false,message:error.message || '本机服务未连接，请启动 npm start 后重试。'};}
    if(['home','gallery','history'].includes(screen))refreshVisible();
  }
  function connectionPanel(){
    if(liveMenu().length)return '';
    return `<div class="connection-panel" role="status"><strong>${connection.loading?'正在加载麦当劳菜单…':connection.connected?'选一家今天的餐厅':connection.configured?'麦当劳连接需要检查':'先连接麦当劳，开启今天的一画'}</strong><p>${esc(connection.message)}</p>${connection.loading?'':button(connection.connected?'store':'setup',connection.connected?'搜索真实门店 ↗':'连接麦当劳 ↗','primary')}${!connection.loading?button('retry-connect','↻ 重新检查连接','text-button'):''}</div>`;
  }
  function setup(){
    showModal(`<h2>连接麦当劳</h2><p>从 <a href="https://open.mcd.cn/mcp" target="_blank" rel="noreferrer">麦当劳开放平台</a> 获取 Token，粘贴后保存。仅保存在本机后端。</p><label class="sheet-label" for="mcd-token">MCP Token</label><input id="mcd-token" class="title-input" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 Token" maxlength="16000"><p id="setup-message" role="status"></p>${button('save-token','保存并连接','primary')}${button('retry-connect','已在配置文件中填写，重新连接','text-button')}`);
  }
  async function saveToken(el){
    const input=document.querySelector('#mcd-token');if(!input || !input.value.trim()){toast('请先粘贴 Token');return;}
    const token=input.value;input.value='';el.disabled=true;document.querySelector('#setup-message').textContent='正在保存并连接…';
    try{if(!connection.setupNonce)connection={...connection,...await api('status')};connection={...await api('config',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Nonce':connection.setupNonce},body:JSON.stringify({token})}),loading:false};
      if(connection.connected){closeModal();render();openStorePicker();toast('已连接麦当劳 MCP');}
      else {document.querySelector('#setup-message').textContent=connection.message;render();}
    }catch(error){const message=document.querySelector('#setup-message');if(message)message.textContent=error.message || '保存未完成，请重试';}
    finally{el.disabled=false;}
  }
  function storeRow(){
    const selected=C.store(state.storeId);
    return `<div class="store-row">${button('store',icon('pin')+esc(selected?selected.name:'选择今天的餐厅')+' ⌄','store-button')}<span class="demo-badge">${liveMenu().length?'麦当劳菜单':'等待选餐'}</span></div>`;
  }
  function openStorePicker(){
    if(!connection.connected){setup();return;}
    showModal(`<h2>今天在哪一店？</h2><p>按城市和附近地标查找，到店自取菜单随门店变化。</p><label class="sheet-label" for="store-city">城市</label><input id="store-city" class="title-input" value="${esc(city)}" maxlength="40"><label class="sheet-label" for="store-keyword">位置关键词</label><input id="store-keyword" class="title-input" value="${esc(keyword)}" placeholder="例如：安福路、人民广场" maxlength="100">${button('search-stores',storeBusy?'查询中…':'搜索附近门店','primary',storeBusy?'disabled':'')}<p class="store-status" role="status">${esc(storeError || (storeBusy?'正在查询麦当劳…':searched && !storeResults.length?'没有找到门店，换个关键词试试。':''))}</p><div class="store-results">${storeResults.map(s=>button('select-store',`<strong>${esc(s.name)}${s.id===state.storeId?' ✓':''}</strong><small>${esc(s.address || s.area)} · ${esc(s.note)}</small>`,'store-option',`data-store="${esc(s.id)}" ${storeBusy?'disabled':''}`)).join('')}</div>`);
  }
  async function searchStores(){
    city=document.querySelector('#store-city').value.trim();keyword=document.querySelector('#store-keyword').value.trim();
    if(!city || !keyword){toast('请填写城市和位置关键词');return;}storeBusy=true;storeError='';storeResults=[];openStorePicker();
    try{storeResults=(await api('stores?'+new URLSearchParams({city,keyword}))).stores;searched=true;}catch(error){storeError=error.message;}
    finally{storeBusy=false;if(document.querySelector('#store-city'))openStorePicker();}
  }
  async function loadMenu(store){
    liveStoreId='';const result=await api('menu?'+new URLSearchParams({storeCode:store.storeCode,beCode:store.beCode || ''}));
    if(!result.meals.length)throw new Error('该门店当前没有可用餐品，请换店或稍后重试。');
    if(!await commit(()=>repo.setMenu(store,result.meals)))throw new Error('菜单未能保存，请检查设备空间');
    liveStoreId=store.id;selectedMeal=result.meals[0].id;category='all';connection.message='菜单已从麦当劳 MCP 更新 · 到店自取';
    galleryOnlyWithArt=typeof state.galleryPreferences?.[store.id]==='boolean'?state.galleryPreferences[store.id]:result.meals.some(m=>C.eligible(state.artworks,store.id,m.id).length);
  }
  async function selectStore(id){
    const store=storeResults.find(s=>s.id===id);if(!store || storeBusy)return;storeBusy=true;storeError='';openStorePicker();
    try{await loadMenu(store);closeModal();render();}catch(error){storeError=error.message;connection.message=error.message;render();}
    finally{storeBusy=false;if(document.querySelector('#store-city'))openStorePicker();}
  }
  function thumbnail(artwork) {
    if (artwork.kind === 'image') return artwork.imageSource;
    if (artwork.thumbnail) return artwork.thumbnail;
    return drawThumbnail(artwork.strokes);
  }
  function drawThumbnail(strokes) {
    const temp = document.createElement('canvas'); temp.width = 600; temp.height = 600;
    C.drawStrokes(temp.getContext('2d'), strokes, 600, 600); return temp.toDataURL('image/png');
  }
  function render() {
    if(!ready){root.innerHTML=`<section class="screen"><h1 class="page-title">${storageFailure?'先保护好你的画册':'正在打开画册…'}</h1><p class="page-subtitle">${storageFailure?esc(storageFailure.message):'正在检查本机数据，请稍候。'}</p>${storageFailure?button('legacy-export','下载旧存储原文','primary')+button('storage-retry','重试打开画册','secondary'):''}</section>`;tabbar.hidden=true;mealDock.hidden=true;return;}
    if (resizeObserver) resizeObserver.disconnect();
    canvas = null; ctx = null; activePointer = null;
    tabbar.hidden = !['home','gallery','history'].includes(screen);
    tabbar.innerHTML = [['home','home','今天画'],['gallery','gallery','餐品画廊'],['history','history','我的画册']].map(([key,ico,label]) => button('tab', icon(ico) + `<span>${label}</span>`, 'nav-item' + (tab === key ? ' active' : ''), `data-tab="${key}" aria-current="${tab === key ? 'page' : 'false'}"`)).join('');
    const views = { home:homeView, gallery:galleryView, wall:wallView, history:historyView, draw:drawView, handoff:handoffView, guess:guessView, reveal:revealView, 'paper-select':paperUI.selectionView, 'paper-edit':paperUI.editorView };
    root.innerHTML = `<section class="screen ${screen}">${views[screen]()}</section>`;
    renderMealDock();
    root.scrollTop = 0;
    if (paperUI.active()) paperUI.afterRender();
    if (screen === 'draw') setupCanvas();
    if (screen === 'guess') {
      const input = document.querySelector('#guess-input');
      input.value = guessValue;
      input.addEventListener('input', e => { guessValue = e.target.value;scheduleDrawingDraft(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submitGuess(); });
    }
  }
  function homeView() {
    const allMenu = liveMenu();
    if (!allMenu.some(m => m.id === selectedMeal)) selectedMeal = allMenu[0] ? allMenu[0].id : '';
    const selected = allMenu.find(m => m.id === selectedMeal);
    return `${storeRow()}${dataUI.recoveryView()}<div class="hero"><div class="eyebrow">TODAY’S MEAL, YOUR LITTLE ART.</div><h1>把今天的好吃，<br><em>画下来。</em></h1><p>一顿饭，一幅画，一点小快乐。</p><img class="hero-illustration" src="${asset('burger.png')}" alt="手绘汉堡插画"><div class="hero-sticker">不用画得像，<br>画得开心就好。</div></div>
      <div class="section-heading"><h2>今天，怎么画？</h2><small>两种方式，一样好玩</small></div>
      <div class="modes">${['solo','duo'].map(mode => button('mode', `<span class="mode-icon">${mode === 'solo' ? '✎' : '☻ ☻'}</span><span class="check">${state.mode === mode ? '✓' : ''}</span><strong>${mode === 'solo' ? '一个人，慢慢画' : '两个人，猜着玩'}</strong><small>${mode === 'solo' ? '留住今天的一餐' : '你来画，我来猜'}</small>`, 'mode-card' + (state.mode === mode ? ' selected' : ''), `data-mode="${mode}" aria-pressed="${state.mode === mode}"`)).join('')}</div>
      <div class="section-heading"><h2>选一道今天的餐品</h2><small>给今天找个小主角</small></div>
      ${connectionPanel()}${selected ? button('open-meals',`<img src="${esc(mealImage(selected))}" alt="${esc(selected.name)}参考图"><span class="chosen-meal-copy"><small>今天的主角</small><strong>${esc(selected.name)}</strong><span>本店 ${allMenu.length} 道餐品 · 分类或搜索挑选</span></span><span class="choose-another">换一道 ↗</span>`,'chosen-meal') : ''}
      <p class="micro-note">${state.mode === 'solo' ? '画作默认只属于你，公开由你决定。' : '传手机双人玩法 · 画完后把手机交给对方。'}</p>
      ${button('open-gallery', '<span class="mini-art">✿</span><span><strong>看看大家笔下的这一餐</strong><small>被允许公开的画，会在餐品旁遇见你。</small></span><span class="arrow">↗</span>', 'community-teaser')}`;
  }
  function renderMealDock() {
    if (paperUI.active()) {mealDock.hidden=false;mealDock.innerHTML=paperUI.dock();return;}
    mealDock.hidden = screen !== 'home';
    if (mealDock.hidden) { mealDock.innerHTML = ''; return; }
    const selected = liveMenu().find(m => m.id === selectedMeal);
    mealDock.innerHTML = `<div class="dock-summary"><span>${selected ? '已选 · ' + esc(selected.name) : '先选择门店和餐品'}</span><small>${state.mode === 'duo' ? '双人猜画' : '单人绘画'}</small></div>${button('start',state.mode === 'solo' ? '开始画今天的餐品 ↗' : '开始双人猜画 ↗','primary',selected ? '' : 'disabled')}`;
  }
  function openMealPicker() {
    if (!liveMenu().length) { if (connection.connected) openStorePicker(); else setup(); return; }
    mealQuery = ''; mealCategory = 'all';
    const allMenu = liveMenu();
    showModal(`<header class="meal-picker-heading"><h2 id="meal-picker-title" tabindex="-1">今天，画哪一道？</h2><p>${esc(C.store(state.storeId).name)}</p></header><label class="sr-only" for="meal-search">搜索餐品</label><input id="meal-search" class="title-input meal-search" type="search" placeholder="搜索餐品名称，例如板烧" maxlength="80" autocomplete="off"><div class="picker-filters"><label for="picker-category">餐品分类</label><select id="picker-category"><option value="all">全部餐品（${allMenu.length}）</option>${[...new Set(allMenu.map(m => m.tag))].map(tag => `<option value="${esc(tag)}">${esc(tag)}</option>`).join('')}</select></div><p id="meal-results-status" class="meal-results-status" role="status" aria-live="polite"></p><div class="meal-picker-results" role="region" aria-label="餐品列表"></div><footer class="meal-picker-footer"></footer>`,{className:'meal-picker',label:'选择今天的餐品'});
    updateMealPicker(true);
  }
  function updateMealPicker(resetScroll = false) {
    const results = modalRoot.querySelector('.meal-picker-results');
    if (!results) return;
    const query = mealQuery.trim().toLocaleLowerCase();
    const menu = liveMenu().filter(m => (mealCategory === 'all' || m.tag === mealCategory) && [m.name,...(m.alias || [])].some(name => String(name).toLocaleLowerCase().includes(query)));
    const top = resetScroll ? 0 : results.scrollTop;
    results.innerHTML = menu.length ? `<div class="meal-grid">${menu.map(m => button('pick-meal',`<span class="meal-check" aria-hidden="true">✓</span><img loading="lazy" src="${esc(mealImage(m))}" alt="${esc(m.name)}参考图"><strong>${esc(m.name)}</strong><small>${esc(m.tag)}</small>`,'meal-card' + (selectedMeal === m.id ? ' selected' : ''),`data-meal="${esc(m.id)}" aria-label="选择${esc(m.name)}" aria-pressed="${selectedMeal === m.id}"`)).join('')}</div>` : `<div class="meal-search-empty"><h3>没有找到这道餐品</h3><p>换个名称或分类试试。</p>${button('reset-meal-search','清除筛选','text-button')}</div>`;
    results.scrollTop = top;
    document.querySelector('#meal-results-status').textContent = `找到 ${menu.length} 道餐品`;
    const selected = liveMenu().find(m => m.id === selectedMeal);
    modalRoot.querySelector('.meal-picker-footer').innerHTML = `<div class="picker-chosen" aria-live="polite">${selected ? `<img src="${esc(mealImage(selected))}" alt=""><div><small>已选 · ${state.mode === 'duo' ? '双人猜画' : '单人绘画'}</small><strong>${esc(selected.name)}</strong></div>` : '<span>请选择一道餐品</span>'}</div>${button('picker-start',state.mode === 'duo' ? '画这道，让 TA 猜 ↗' : '就画这道 ↗','primary',selected ? '' : 'disabled')}`;
  }
  function categoryPicker(allMenu){return allMenu.length?`<div class="menu-filters"><label for="meal-category">餐品分类</label><select id="meal-category"><option value="all" ${category==='all'?'selected':''}>全部餐品（${allMenu.length}）</option>${[...new Set(allMenu.map(m=>m.tag))].map(tag=>`<option value="${esc(tag)}" ${tag===category?'selected':''}>${esc(tag)}</option>`).join('')}</select></div>`:'';}
  function galleryPreviews(mealId, refresh = false) {
    const key = state.storeId + ':' + mealId;
    const all = C.galleryArtworks(state.artworks, state.storeId, mealId, 'random');
    const byId = new Map(all.map(a => [a.id, a]));
    const previous = galleryPicks[key] || [];
    let ids = refresh ? [] : previous.filter(id => byId.has(id));
    ids = ids.concat(all.map(a => a.id).filter(id => !ids.includes(id))).slice(0, 3);
    if (refresh && ids.length > 1 && ids.join('|') === previous.join('|')) ids.push(ids.shift());
    galleryPicks[key] = ids;
    return ids.map(id => byId.get(id));
  }
  function galleryView() {
    const allMenu = liveMenu();
    return `<h1 class="page-title">好吃，也好看<span style="color:var(--red)">。</span></h1><p class="page-subtitle">同一道餐品，每个人都有自己的画法。</p>${storeRow()}${connectionPanel()}${allMenu.length ? `<div class="gallery-tools"><div class="gallery-search-row"><label class="sr-only" for="gallery-search">搜索画廊餐品</label><input id="gallery-search" class="title-input gallery-search" type="search" value="${esc(galleryQuery)}" placeholder="搜索本店餐品，例如板烧" maxlength="80" autocomplete="off">${button('clear-gallery-search','清空','gallery-search-clear',`aria-label="清空餐品搜索" ${galleryQuery ? '' : 'hidden'}`)}</div><div class="gallery-filter-row">${categoryPicker(allMenu)}<label class="gallery-art-toggle"><input id="gallery-only-art" type="checkbox" ${galleryOnlyWithArt ? 'checked' : ''}><span>只看有作品</span></label></div></div><div id="gallery-results">${galleryResults()}</div><p class="info-strip">原型中的公开展示仅在当前设备模拟。你可以在「我的画册」随时撤回许可。</p>` : ''}`;
  }
  function galleryResults() {
    const allMenu = liveMenu();
    const counts = new Map(allMenu.map(m => [m.id, C.eligible(state.artworks, state.storeId, m.id).length]));
    const query = galleryQuery.trim().toLocaleLowerCase();
    const items = allMenu.filter(m => (category === 'all' || m.tag === category) && (!galleryOnlyWithArt || counts.get(m.id) > 0) && [m.name,...(m.alias || [])].some(name => String(name).toLocaleLowerCase().includes(query)));
    const withArt = allMenu.filter(m => counts.get(m.id) > 0).length;
    const status = `<p class="gallery-results-status" role="status" aria-live="polite">找到 ${items.length} 道餐品<span>本店 ${withArt} 道有公开作品</span></p>`;
    if (!items.length) return `${status}<div class="gallery-no-results"><span aria-hidden="true">✎</span><h2>${galleryOnlyWithArt ? '还没有符合条件的公开作品' : '没有找到这道餐品'}</h2><p>${galleryOnlyWithArt ? '换个关键词或分类，<br>也可以取消「只看有作品」。' : '换个名称或分类，再找找今天的好吃。'}</p>${button('reset-gallery-filters','清除筛选','secondary')}</div>`;
    return `${status}<div class="gallery-list">${items.map(m => {
      const count = counts.get(m.id);
      const previews = galleryPreviews(m.id);
      const slots = previews.map(a => `<span class="preview-paper" data-art-id="${esc(a.id)}"><img loading="lazy" src="${esc(thumbnail(a))}" alt="${esc(a.title)}"></span>`);
      while (slots.length < 3) slots.push(`<span class="preview-placeholder" aria-hidden="true"><span>✎</span><small>${count ? '等一张新画' : slots.length === 0 ? '第一张，等你' : '留给小灵感'}</small></span>`);
      return `<article class="gallery-card" data-meal="${esc(m.id)}"><div class="gallery-product"><img loading="lazy" src="${esc(mealImage(m))}" alt="${esc(m.name)}参考图">${button('open-wall',`<strong>${esc(m.name)}</strong><small>共 ${count} 张公开作品</small>`,'gallery-meal-link',`data-meal="${esc(m.id)}"`)}${button('draw-meal','画这道 ↗','text-button',`data-meal="${esc(m.id)}"`)}</div>${button('open-wall',slots.join(''),'gallery-previews',`data-meal="${esc(m.id)}" aria-label="查看${esc(m.name)}的全部 ${count} 张公开作品"`)}<div class="gallery-card-footer"><span>${count ? `随机预览 ${previews.length} 张` : '画作获准公开后，将出现在这里'}</span>${count > 1 ? button('shuffle-previews','↻ 换组预览','text-button',`data-meal="${esc(m.id)}"`) : ''}${button('open-wall',count ? '查看全部 ↗' : '进入作品墙 ↗','text-button',`data-meal="${esc(m.id)}"`)}</div></article>`;
    }).join('')}</div>`;
  }
  function updateGalleryResults() {
    const results = document.querySelector('#gallery-results');
    if (!results) return;
    results.innerHTML = galleryResults();
    document.querySelector('[data-action="clear-gallery-search"]').hidden = !galleryQuery;
    root.scrollTop = 0;
  }
  function resetGalleryFilters() {
    galleryQuery = ''; category = 'all'; galleryOnlyWithArt = false;
    document.querySelector('#gallery-search').value = '';
    document.querySelector('#meal-category').value = 'all';
    document.querySelector('#gallery-only-art').checked = false;
    updateGalleryResults();
    saveGalleryPreference();
    document.querySelector('#gallery-search').focus({preventScroll:true});
  }
  function wallArtworks() {
    if (!wall || wall.storeId !== state.storeId || !liveMenu().some(m => m.id === wall.mealId)) return [];
    const all = C.galleryArtworks(state.artworks, wall.storeId, wall.mealId, wall.order);
    if (wall.order !== 'random') return all;
    const byId = new Map(all.map(a => [a.id, a]));
    wall.randomIds = wall.randomIds.filter(id => byId.has(id));
    wall.randomIds.push(...all.map(a => a.id).filter(id => !wall.randomIds.includes(id)));
    return wall.randomIds.map(id => byId.get(id));
  }
  function openWall(mealId) {
    if (!liveMenu().some(m => m.id === mealId)) return;
    galleryScroll = root.scrollTop;
    wall = {storeId:state.storeId,mealId,order:'latest',randomIds:[],limit:WALL_PAGE_SIZE};
    tab = 'gallery'; screen = 'wall'; render();
    document.querySelector('#wall-title').focus({preventScroll:true});
  }
  function wallView() {
    const m = C.menu(wall.storeId).find(item => item.id === wall.mealId);
    const items = wallArtworks();
    const shown = Math.min(wall.limit, items.length);
    return `${button('back-gallery','‹ 餐品画廊','screen-back')}<div class="wall-heading"><img src="${esc(mealImage(m))}" alt="${esc(m.name)}参考图"><div><h1 id="wall-title" tabindex="-1">${esc(m.name)}</h1><p>${esc(C.store(wall.storeId).name)}</p></div></div><div class="wall-summary"><strong>共 ${items.length} 张公开作品</strong>${button('draw-meal','我也画这道 ↗','text-button',`data-meal="${esc(m.id)}"`)}</div><div class="wall-toolbar"><div class="wall-orders" role="group" aria-label="作品排序">${[['latest','最新'],['random','随机浏览']].map(([order,label]) => button('wall-order',label,'wall-order' + (wall.order === order ? ' active' : ''),`data-order="${order}" aria-pressed="${wall.order === order}"`)).join('')}</div>${wall.order === 'random' && items.length > 1 ? button('reshuffle-wall','↻ 换个顺序','text-button') : '<span class="wall-tip">点画作放大</span>'}</div><div id="wall-results">${wallResults(items, shown)}</div><p class="info-strip">只展示本店这道餐品已获许可的画作。当前为本机公开展示，可在「我的画册」撤回。</p>`;
  }
  function wallResults(items = wallArtworks(), shown = Math.min(wall.limit, items.length)) {
    if (!items.length) return `<div class="wall-empty"><span>✎</span><h2>第一张，等你来画。</h2><p>把今天这道好吃的画下来，<br>允许公开后，就能在这里遇见它。</p>${button('draw-meal','画这道餐品 ↗','primary',`data-meal="${esc(wall.mealId)}"`)}</div>`;
    return `<div class="wall-grid">${items.slice(0, shown).map(a => button('zoom-art',`<span class="wall-paper"><img loading="lazy" src="${esc(thumbnail(a))}" alt="${esc(a.title)}"></span><strong>${esc(a.title)}</strong><small>${esc(C.dateLabel(a.createdAt))} · ${artMode(a)}</small>`,'wall-art',`data-id="${esc(a.id)}" aria-label="放大查看：${esc(a.title)}"`)).join('')}</div><div class="wall-pagination"><p role="status">已显示 ${shown} / ${items.length} 张</p>${shown < items.length ? button('more-wall',`再看 ${Math.min(WALL_PAGE_SIZE, items.length - shown)} 张 ↓`,'secondary') : '<span>这一餐的画，暂时都在这里了。</span>'}</div>`;
  }
  function setWallOrder(order, reshuffle = false) {
    if (!wall || !['latest','random'].includes(order)) return;
    if (wall.order === order && !reshuffle) return;
    const previous = wallArtworks().map(a => a.id);
    wall.order = order; wall.limit = WALL_PAGE_SIZE; wall.randomIds = [];
    if (order === 'random') {
      wall.randomIds = wallArtworks().map(a => a.id);
      if (wall.randomIds.length > 1 && wall.randomIds.join('|') === previous.join('|')) wall.randomIds.push(wall.randomIds.shift());
    }
    render();
    document.querySelector(`[data-action="${reshuffle ? 'reshuffle-wall' : 'wall-order'}"]${reshuffle ? '' : `[data-order="${order}"]`}`).focus({preventScroll:true});
  }
  function showArtwork(id, keepFocus = false) {
    const items = wallArtworks(), index = items.findIndex(a => a.id === id), a = items[index];
    if (!a) { closeModal(); return; }
    const focusAction = keepFocus && document.activeElement ? document.activeElement.dataset.action : '';
    if (!keepFocus) lightboxOriginId = id;
    lightboxId = id;
    showModal(`<header class="lightbox-heading"><small>${index + 1} / ${items.length} · ${wall.order === 'random' ? '随机浏览' : '最新作品'}</small><h2 id="lightbox-title" tabindex="-1">${esc(a.title)}</h2></header><div class="lightbox-figure"><img src="${esc(thumbnail(a))}" alt="${esc(a.title)}的放大画作"></div><div class="lightbox-meta"><strong>${esc(C.artMeal(a).name)}</strong><p>${esc(C.artStore(a).name)}</p><small>${esc(C.dateLabel(a.createdAt))} · ${artMode(a)} · 已获公开许可</small></div><div class="lightbox-controls">${button('previous-art','‹ 上一张','secondary',index > 0 ? '' : 'disabled')}${button('next-art','下一张 ›','secondary',index < items.length - 1 ? '' : 'disabled')}</div>`,{className:'art-lightbox',label:'画作放大查看'});
    if (focusAction) { const control = modalRoot.querySelector(`[data-action="${focusAction}"]:not(:disabled)`); if (control) control.focus({preventScroll:true}); }
  }
  function stepArtwork(step) {
    const items = wallArtworks(), index = items.findIndex(a => a.id === lightboxId);
    if (index >= 0 && items[index + step]) showArtwork(items[index + step].id, true);
  }
  function historyView() {
    const total = state.artworks.length, pub = state.artworks.filter(a => a.isPublic).length;
    const options = historyOptions();
    return `<div class="mine-top"><div class="avatar">✎</div><div><h1>我的小小画册</h1><p>把吃过的快乐，一笔一笔攒起来。</p></div></div><div class="stats"><div><strong>${total}</strong><small>张小作品</small></div><div><strong>${pub}</strong><small>张允许公开</small></div><div><strong>${new Set(state.artworks.map(a => a.mealId)).size}</strong><small>种餐品记忆</small></div></div>${dataUI.tools()}${button('import-image','＋ 导入图片作品','text-button album-import-button')}${paperUI.teaser()}${total ? `<div class="gallery-tools history-tools"><div class="gallery-search-row"><label class="sr-only" for="history-search">搜索我的画册</label><input id="history-search" class="title-input gallery-search" type="search" value="${esc(historyQuery)}" placeholder="搜索作品名、餐品或门店" maxlength="80" autocomplete="off">${button('clear-history-search','清空','gallery-search-clear',`aria-label="清空画册搜索" ${historyQuery ? '' : 'hidden'}`)}</div><div class="history-selects"><div><label class="sr-only" for="history-store">筛选门店</label><select id="history-store">${historyStoreOptions(options.stores)}</select></div><div><label class="sr-only" for="history-meal">筛选餐品</label><select id="history-meal">${historyMealOptions(options.meals)}</select></div></div><div class="filter-row" role="group" aria-label="画作公开状态">${[['all','全部'],['private','仅自己'],['public','允许公开']].map(([key,label]) => button('filter',label,'filter-chip' + (filter === key ? ' active' : ''),`data-filter="${key}" aria-pressed="${filter === key}"`)).join('')}</div></div>` : ''}<div id="history-results">${historyResults()}</div><p class="version-note">作品保存在当前设备 · 刷新后仍可查看<br>门店菜单来自麦当劳 MCP · 公开展示仅在本机模拟</p>`;
  }
  function historyOptions() {
    const stores = new Map();
    state.artworks.forEach(a => { if (!stores.has(a.storeId)) stores.set(a.storeId, {id:a.storeId,name:C.artStore(a).name}); });
    if (historyStore !== 'all' && !stores.has(historyStore)) historyStore = 'all';
    const meals = new Map();
    state.artworks.filter(a => historyStore === 'all' || a.storeId === historyStore).forEach(a => {
      if (!meals.has(a.mealId)) meals.set(a.mealId, {id:a.mealId,name:C.artMeal(a).name,stores:new Set()});
      meals.get(a.mealId).stores.add(C.artStore(a).name);
    });
    if (historyMeal !== 'all' && !meals.has(historyMeal)) historyMeal = 'all';
    return {stores:[...stores.values()],meals:[...meals.values()]};
  }
  function historyStoreOptions(stores) {
    return `<option value="all" ${historyStore === 'all' ? 'selected' : ''}>全部门店（${stores.length}）</option>${stores.map(s => `<option value="${esc(s.id)}" ${historyStore === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}`;
  }
  function historyMealOptions(meals) {
    return `<option value="all" ${historyMeal === 'all' ? 'selected' : ''}>全部餐品（${meals.length}）</option>${meals.map(m => {
      const label = m.name + (meals.some(other => other.id !== m.id && other.name === m.name) ? ' · ' + [...m.stores].join(' / ') : '');
      return `<option value="${esc(m.id)}" ${historyMeal === m.id ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('')}`;
  }
  function historyItems() {
    const query = historyQuery.trim().toLocaleLowerCase();
    return state.artworks.filter(a => (filter === 'all' || (filter === 'public' ? a.isPublic : !a.isPublic)) && (historyStore === 'all' || a.storeId === historyStore) && (historyMeal === 'all' || a.mealId === historyMeal) && [a.title,C.artStore(a).name,C.artMeal(a).name,...(C.artMeal(a).alias || [])].some(text => String(text).toLocaleLowerCase().includes(query)));
  }
  function historyResults() {
    const items = historyItems();
    const status = state.artworks.length ? `<p class="gallery-results-status history-results-status" role="status" aria-live="polite">找到 ${items.length} 张作品<span>画册共 ${state.artworks.length} 张</span></p>` : '';
    if (!items.length) return `${status}<div class="empty-state"><img src="${asset('fries.png')}" alt="手绘薯条"><h3>${state.artworks.length ? '没有找到符合条件的画作' : '今天的快乐，还没落笔'}</h3><p>${state.artworks.length ? '换个关键词、门店、餐品或公开状态试试。' : '不必是画家，也能拥有一本自己的餐品画册。'}</p>${button(state.artworks.length ? 'reset-history-filters' : 'new-art',state.artworks.length ? '清除筛选' : '去画今天这一餐 ↗',state.artworks.length ? 'secondary' : 'primary')}</div>`;
    return `${status}<div class="history-grid">${items.map(a => button('detail', `<div class="art-paper"><img loading="lazy" src="${esc(thumbnail(a))}" alt="${esc(a.title)}"><span class="privacy ${a.isPublic ? 'public' : ''}">${a.isPublic ? '✳ 允许公开' : '⌑ 仅自己'}</span></div><strong>${esc(a.title)}</strong><small>${esc(C.dateLabel(a.createdAt))} · ${artMode(a)}</small><span class="history-context"><span title="${esc(C.artMeal(a).name)}">${esc(C.artMeal(a).name)}</span><span title="${esc(C.artStore(a).name)}">${esc(C.artStore(a).name)}</span></span>`, 'history-card', `data-id="${esc(a.id)}"`)).join('')}</div>`;
  }
  function updateHistoryResults(updateOptions = false) {
    const results = document.querySelector('#history-results');
    if (!results) return;
    if (updateOptions) {
      const options = historyOptions();
      document.querySelector('#history-store').innerHTML = historyStoreOptions(options.stores);
      document.querySelector('#history-meal').innerHTML = historyMealOptions(options.meals);
    }
    results.innerHTML = historyResults();
    document.querySelector('[data-action="clear-history-search"]').hidden = !historyQuery;
    root.querySelectorAll('[data-action="filter"]').forEach(el => {
      el.classList.toggle('active', el.dataset.filter === filter);
      el.setAttribute('aria-pressed', String(el.dataset.filter === filter));
    });
    root.scrollTop = 0;
  }
  function resetHistoryFilters() {
    historyQuery = ''; historyStore = 'all'; historyMeal = 'all'; filter = 'all';
    document.querySelector('#history-search').value = '';
    updateHistoryResults(true);
    document.querySelector('#history-search').focus({preventScroll:true});
  }
  function drawView() {
    const m = C.artMeal(draft);
    return `${button('back','‹ 返回','screen-back')}<div class="draw-heading"><h1>${draft.mode === 'duo' ? '你先画，让 TA 猜' : '今天，就画它'}</h1><span class="round-badge">${draft.mode === 'duo' ? '双人 · 画画回合' : '单人 · 自在画'}</span></div><div class="reference">${referenceVisible ? `<img src="${esc(mealImage(m))}" alt="${esc(m.name)}参考图"><div><strong>${esc(m.name)}</strong><small>${m.image ? '对照餐品画，也可以画眼前的实物' : '暂无参考图，可对照实物画'}</small></div>` : '<div><strong>参考图已收起</strong><small>跟着自己的感觉画</small></div>'}${button('reference',referenceVisible ? '收起参考' : '展开参考','')}</div><div class="canvas-paper"><canvas id="drawing-canvas" aria-label="餐品绘画画布" role="img"></canvas><div class="canvas-placeholder" ${draft.strokes.length ? 'hidden' : ''}><span>✎</span><p>在这里，画今天的${esc(m.name)}</p><small>歪歪扭扭，也很可爱。</small></div><span class="canvas-counter">YOUR LITTLE MASTERPIECE</span></div><div class="tools"><div class="swatches">${C.COLORS.map((c,i) => button('color','','swatch' + (color === c && !erase ? ' active' : ''),`style="--swatch:${c}" data-color="${c}" aria-label="${['深棕','红色','黄色','绿色','蓝色','紫色'][i]}画笔" aria-pressed="${color === c && !erase}"`)).join('')}</div>${button('eraser',icon('erase') + '橡皮','tool-button' + (erase ? ' active' : ''),'aria-label="橡皮擦" aria-pressed="' + erase + '"')}</div><div class="tool-row"><div class="brush-sizes">${[.006,.011,.022].map((size,i) => button('size',`<span style="width:${4+i*3}px;height:${4+i*3}px"></span>`,'brush-size' + (brush === size ? ' active' : ''),`data-size="${size}" aria-label="${['细','中','粗'][i]}画笔"`)).join('')}</div>${button('undo',icon('undo'),'tool-button',`aria-label="撤销" ${draft.strokes.length ? '' : 'disabled'}`)}${button('redo',icon('redo'),'tool-button',`aria-label="重做" ${draft.redo.length ? '' : 'disabled'}`)}${button('clear','清空','tool-button')}</div><div class="draw-actions">${button(draft.mode === 'duo' ? 'handoff' : 'save',draft.mode === 'duo' ? '我画好了，交给 TA 猜 ↗' : '画好了，存进画册 ↗','primary')}</div><p class="draw-subtitle">${draft.mode === 'duo' ? '下一步会隐藏餐品名称与参考图，再把手机交给对方。' : '保存后默认仅自己可见，你可以单独允许这张画公开。'}</p><p id="drawing-draft-status" class="micro-note" role="status">${esc(drawingStatus || '落笔后自动保存草稿')}</p>`;
  }
  function handoffView() {
    return `${button('resume','‹ 继续修改画作','screen-back')}<div class="handoff-icon">☻ ↗ ☻</div><h1>现在，把手机<br>交给另一位。</h1><p>画作已经准备好。<br>让 TA 猜猜，今天画的是哪道餐品？</p><div class="sealed">✦ 餐品答案已藏好 ✦</div>${button('guess-start','我接到了，开始猜 ↗','primary')}<p class="micro-note">传手机双人模式 · 无需创建房间</p>`;
  }
  function guessView() {
    return `${button('back','‹ 结束本轮','screen-back')}<div class="draw-heading"><h1>这道好吃的，你猜？</h1><span class="round-badge">双人 · 猜画回合</span></div><p class="page-subtitle">只看画，不偷看答案。猜错也可以继续试。</p><div class="guess-art"><img src="${drawThumbnail(draft.strokes)}" alt="对方画出的餐品，请猜名称"></div><label for="guess-input" class="sheet-label">你觉得画的是什么？</label><input id="guess-input" class="guess-input" placeholder="输入餐品名称，例如：薯条" maxlength="40" autocomplete="off"><p class="guess-feedback" role="status">${esc(feedback)}</p><div class="guess-actions">${button('reveal','揭晓答案','secondary')}${button('submit-guess','猜一下 ↗','primary')}</div><p class="guess-hint">${draft.attempts ? '已经猜了 ' + draft.attempts + ' 次，再大胆一点。' : '画得像不像不重要，心有灵犀才有趣。'}</p>`;
  }
  function revealView() {
    const m = C.artMeal(draft);
    return `<div class="reveal-header"><div class="confetti">✳ ✦ ✳</div><h1>${revealedCorrect ? '默契，满分！' : '原来画的是它！'}</h1><p>又多了一张，属于你们这一餐的小纪念。</p></div><div class="guess-art"><img src="${drawThumbnail(draft.strokes)}" alt="本轮画作"></div><div class="reveal-answer"><img src="${esc(mealImage(m))}" alt="${esc(m.name)}参考图"><strong>${esc(m.name)}</strong></div>${button('save','把这一轮存进画册 ↗','primary')}${button('swap','交换角色，再画一轮','secondary')}<p class="micro-note">交换角色前会先保存本轮画作，默认仅自己可见。</p>`;
  }
  function startDrawing(mealId) {
    const id=mealId || selectedMeal;if(!liveMenu().some(m=>m.id===id)){toast('请先加载真实门店菜单');return;}
    draft = { mealSnapshot:{...C.meal(id)},storeSnapshot:{...C.store(state.storeId)},mealId: id, storeId: state.storeId, mode: state.mode, strokes:[], redo:[], attempts:0, savedId:null };
    drawingDraftId=newId('draft-draw');drawingDraftRevision=0;drawingContext={id:drawingDraftId,revision:0,chain:Promise.resolve()};drawingStatus='';clearTimeout(drawingTimer);
    referenceVisible = true; erase = false; feedback = ''; guessValue = ''; screen = 'draw'; render();
  }
  function setupCanvas() {
    canvas = document.querySelector('#drawing-canvas'); ctx = canvas.getContext('2d');
    const resize = () => {
      const rect = canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 3);
      canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); C.drawStrokes(ctx, draft.strokes, rect.width, rect.height);
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas); resize();
    canvas.addEventListener('pointerdown', e => {
      if (activePointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); activePointer = e.pointerId; canvas.setPointerCapture(e.pointerId);
      draft.strokes.push({ color, width:erase ? brush * 3 : brush, erase, points:[point(e)] }); draft.redo = []; refreshDrawing();
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== activePointer) return;
      const stroke = draft.strokes[draft.strokes.length-1], p = point(e), last = stroke.points[stroke.points.length-1];
      if (Math.hypot(p.x-last.x,p.y-last.y) < .002 || stroke.points.length > 5000) return;
      stroke.points.push(p); redraw();
    });
    const finish = e => { if (activePointer === e.pointerId) { activePointer = null; refreshDrawing();flushDrawingDraft().catch(()=>{}); } };
    canvas.addEventListener('pointerup',finish); canvas.addEventListener('pointercancel',finish); canvas.addEventListener('lostpointercapture',finish);
  }
  function point(e) { const r = canvas.getBoundingClientRect(); return {x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}; }
  function redraw() { if (!canvas) return; const r=canvas.getBoundingClientRect(); C.drawStrokes(ctx,draft.strokes,r.width,r.height); }
  function refreshDrawing() {
    redraw(); document.querySelector('.canvas-placeholder').hidden = draft.strokes.length > 0;
    document.querySelector('[data-action="undo"]').disabled = !draft.strokes.length;
    document.querySelector('[data-action="redo"]').disabled = !draft.redo.length;
  }
  function scheduleDrawingDraft(){
    if(!draft || draft.savedId || savingArtwork)return;
    clearTimeout(drawingTimer);drawingStatus='正在保存草稿…';drawingTimer=setTimeout(()=>flushDrawingDraft().catch(()=>{}),500);
  }
  function flushDrawingDraft(){
    const current=drawingContext;
    if(!draft || draft.savedId || savingArtwork || !current)return current?.chain || Promise.resolve();
    clearTimeout(drawingTimer);
    const payload=JSON.parse(JSON.stringify({draft,screen,color,brush,erase,referenceVisible,feedback,guessValue,revealedCorrect,scroll:root.scrollTop}));
    current.chain=current.chain.catch(()=>{}).then(async()=>{
      try{
        const next=await repo.saveDraft({id:current.id,kind:'draw',payload},{expectedRevision:current.revision});
        onSnapshot(next);current.id=next.savedDraftId || current.id;current.revision=next.draftRevision || next.drafts.find(d=>d.id===current.id)?.revision || current.revision;
        if(drawingContext===current){drawingDraftId=current.id;drawingDraftRevision=current.revision;drawingStatus='草稿已自动保存';}
        if(next.conflicted)toast('另一页也修改了草稿，本页已另存一份');
      }catch(error){if(drawingContext===current)drawingStatus='草稿未能保存，当前修改仍在页面';dataUI.error(error);throw error;}
      const status=root.querySelector('#drawing-draft-status');if(status && drawingContext===current)status.textContent=drawingStatus;
    });return current.chain;
  }
  async function resumeCreation(saved){
    modalRoot.innerHTML='';historyDetail=null;
    if(saved.kind==='paper'){await paperUI.resumeDraft(saved);return;}
    const p=saved.payload;if(!p?.draft)return;
    draft=JSON.parse(JSON.stringify(p.draft));draft.savedId=null;drawingDraftId=saved.id;drawingDraftRevision=saved.revision || 0;drawingContext={id:drawingDraftId,revision:drawingDraftRevision,chain:Promise.resolve()};drawingStatus='已恢复草稿';
    color=C.COLORS.includes(p.color)?p.color:C.COLORS[0];brush=[.006,.011,.022].includes(p.brush)?p.brush:.011;erase=!!p.erase;referenceVisible=p.referenceVisible!==false;feedback=p.feedback || '';guessValue=p.guessValue || '';revealedCorrect=!!p.revealedCorrect;
    // A restored duo round never reveals an answer until the player explicitly asks.
    screen=draft.mode==='duo' && ['handoff','guess','reveal'].includes(p.screen)?'handoff':'draw';render();root.scrollTop=p.scroll || 0;
  }
  async function discardDrawing(){
    clearTimeout(drawingTimer);const current=drawingContext;await current?.chain.catch(()=>{});
    if(current && !await commit(()=>repo.deleteDraft(current.id,{expectedRevision:current.revision})))return;
    if(drawingContext!==current)return;draft=null;drawingDraftId='';drawingContext=null;modalRoot.innerHTML='';screen=tab='home';render();
  }
  function showModal(content,options = {}) {
    modalRoot.innerHTML = `<div class="modal-shade"><section class="sheet ${options.className || ''}" role="dialog" aria-modal="true" aria-label="${options.label || '操作面板'}">${button('close-modal','×','sheet-close','aria-label="关闭面板"')}${content}</section></div>`;
    const focus = modalRoot.querySelector(options.className === 'meal-picker' ? '#meal-picker-title' : options.className === 'art-lightbox' ? '#lightbox-title' : options.className === 'history-detail' ? '#history-detail-title' : options.className === 'paper-lightbox' ? '#paper-zoom-title' : 'input:not([type="checkbox"]),button:not(.sheet-close)'); if (focus) focus.focus({preventScroll:true});
  }
  function closeModal() {
    if (paperUI.closeZoom()) return;
    if (historyDetail && modalRoot.querySelector('.history-confirm')) { showHistoryDetail(historyDetail.id); return; }
    if (historyDetail) { closeHistoryDetail(); return; }
    const wasMealPicker = !!modalRoot.querySelector('.meal-picker');
    const wasLightbox = !!modalRoot.querySelector('.art-lightbox'), previousId = lightboxOriginId;
    modalRoot.innerHTML = '';
    lightboxId = null;
    lightboxOriginId = null;
    if (wasLightbox && screen === 'wall') {
      const opener = [...root.querySelectorAll('[data-action="zoom-art"]')].find(el => el.dataset.id === previousId);
      if (opener) opener.focus({preventScroll:true});
    }
    if (wasMealPicker && screen === 'home') {
      const top = root.scrollTop; render(); root.scrollTop = top;
      const opener = root.querySelector('[data-action="open-meals"]'); if (opener) opener.focus({preventScroll:true});
    }
  }
  function openSave() {
    if (!draft.strokes.some(s => !s.erase)) { toast('先在画布上留下一笔吧'); return; }
    if (draft.savedId) { goHistory(); return; }
    showModal(`<h2>把今天，存进画册。</h2><img class="save-preview" src="${drawThumbnail(draft.strokes)}" alt="即将保存的画作"><label class="sheet-label" for="art-title">给这张画起个名字</label><input id="art-title" class="title-input" maxlength="30" value="${esc(draft.title || '今天的' + C.artMeal(draft).name)}"><label class="consent-line"><input type="checkbox" id="save-public"><span>允许这张画在对应餐品旁公开展示<small>仅关联「${esc(C.artStore(draft).name)} · ${esc(C.artMeal(draft).name)}」。可随时撤回。原型仅在当前设备模拟。</small></span></label>${button('confirm-save','保存到我的画册 ↗','primary')}<p class="micro-note">不勾选，就是仅自己可见。</p>`);
  }
  async function saveDraft(title, isPublic) {
    if(savingArtwork)return null;
    if (draft.savedId) return state.artworks.find(a => a.id === draft.savedId);
    const current=drawingContext,currentDraft=draft;
    savingArtwork=true;clearTimeout(drawingTimer);
    try {
      await current?.chain.catch(()=>{});
      const art={id:newId('art'),mealId:currentDraft.mealId,storeId:currentDraft.storeId,mode:currentDraft.mode,mealSnapshot:currentDraft.mealSnapshot,storeSnapshot:currentDraft.storeSnapshot,
        title:String(title || '今天的'+C.artMeal(currentDraft).name).trim().slice(0,30),createdAt:new Date().toISOString(),strokes:JSON.parse(JSON.stringify(currentDraft.strokes)),thumbnail:drawThumbnail(currentDraft.strokes),isPublic:!!isPublic,consentAt:isPublic?new Date().toISOString():null};
      if (!await commit(()=>repo.createArtwork(art,{draftId:current?.id,draftRevision:current?.revision}))) return null;
      if(drawingContext!==current || draft!==currentDraft)return null;
      currentDraft.savedId = art.id; return art;
    } catch (error) { toast(error.message); return null; }
    finally{savingArtwork=false;if(draft && !draft.savedId)scheduleDrawingDraft();}
  }
  function goHistory() { clearTimeout(drawingTimer);closeModal(); draft = null;drawingDraftId='';drawingContext=null; tab = 'history'; screen = 'history'; filter = 'all'; historyQuery = ''; historyStore = 'all'; historyMeal = 'all'; render(); }
  function detail(id) {
    if (!historyItems().some(a => a.id === id)) return;
    historyDetail = {id,originId:id,scroll:root.scrollTop,dirty:false};
    showHistoryDetail(id);
  }
  function showHistoryDetail(id, keepFocus = false) {
    const items = historyItems(), index = items.findIndex(a => a.id === id), a = items[index];
    if (!a) { closeHistoryDetail(); return; }
    const focusAction = keepFocus && document.activeElement ? document.activeElement.dataset.action : '';
    historyDetail.id = id;
    showModal(`<header class="history-detail-heading"><small>${index + 1} / ${items.length} · 当前筛选结果</small><h2 id="history-detail-title" tabindex="-1">${esc(a.title)}</h2></header><div class="history-detail-body"><img class="detail-art" src="${esc(thumbnail(a))}" alt="${esc(a.title)}"><div class="detail-meta"><span>${C.dateLabel(a.createdAt)}</span><span>${esc(C.artStore(a).name)}</span><span>${esc(C.artMeal(a).name)}</span><span>${artMode(a)}</span></div><p>${a.isPublic ? '这张画已获你的公开许可，可在对应门店的餐品旁随机出现。' : '这张画仅自己可见。公开展示由你决定。'}</p>${button(a.isPublic ? 'revoke' : 'allow-public', a.isPublic ? '撤回公开许可' : '允许这张画公开展示 ↗','primary',`data-id="${esc(id)}" data-revision="${a.revision}"`)}${button('download','保存画作图片','secondary',`data-id="${esc(id)}"`)}${a.kind==='image'?button('replace-image','替换画作图片','secondary',`data-id="${esc(id)}"`):''}${button('delete','删除这张画','danger-text',`data-id="${esc(id)}"`)}</div><nav class="history-detail-controls" aria-label="浏览筛选后的画作">${button('previous-history','‹ 上一张','secondary',index > 0 ? '' : 'disabled')}${button('next-history','下一张 ›','secondary',index < items.length - 1 ? '' : 'disabled')}</nav>`,{className:'history-detail',label:'画册作品详情'});
    if (focusAction) { const control = modalRoot.querySelector(`[data-action="${focusAction}"]:not(:disabled)`); if (control) control.focus({preventScroll:true}); }
  }
  function stepHistoryDetail(step) {
    if (!historyDetail) return;
    const items = historyItems(), index = items.findIndex(a => a.id === historyDetail.id);
    if (index >= 0 && items[index + step]) showHistoryDetail(items[index + step].id, true);
  }
  function closeHistoryDetail() {
    const previous = historyDetail;
    historyDetail = null; modalRoot.innerHTML = '';
    if (!previous || screen !== 'history') return;
    if (previous.dirty) render();
    root.scrollTop = previous.scroll;
    const cards = [...root.querySelectorAll('[data-action="detail"]')];
    const opener = cards.find(el => el.dataset.id === previous.originId) || cards.find(el => el.dataset.id === previous.id) || root.querySelector('#history-search');
    if (opener) opener.focus({preventScroll:true});
  }
  function refreshHistoryDetail(previousIndex) {
    if (!historyDetail) { closeModal(); render(); return; }
    historyDetail.dirty = true;
    const items = historyItems();
    const current = items.find(a => a.id === historyDetail.id) || items[Math.min(previousIndex,items.length - 1)];
    if (current) showHistoryDetail(current.id);
    else closeHistoryDetail();
  }
  function leave() {
    if (draft && draft.strokes.length && !draft.savedId) showModal(`<h2>这张画还没保存</h2><p>返回后会丢弃本轮画作。也可以先保存到画册。</p>${button('save','先保存这张画','primary')}${button('discard','放弃本轮，返回首页','danger-text')}`);
    else { draft=null;screen='home';tab='home';render(); }
  }
  function submitGuess() {
    if (!guessValue.trim()) { toast('先写下你的猜想吧'); return; }
    draft.attempts++;
    if (C.isCorrect(guessValue,draft.mealId,draft.mealSnapshot)) { revealedCorrect=true;screen='reveal';render(); }
    else { feedback='还差一点！可以换个名字试试，或直接揭晓。';render();document.querySelector('#guess-input').focus({preventScroll:true}); }
  }
  document.addEventListener('click', async e => {
    if (e.target.closest('.wordmark')) { e.preventDefault(); if (paperUI.active()) paperUI.leave('home'); else if (draft) leave(); else {screen='home';tab='home';render();} return; }
    if (e.target.classList.contains('modal-shade')) { closeModal(); return; }
    const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
    const a=el.dataset.action;
    if(a==='tab'){tab=el.dataset.tab;screen=tab;render();}
    else if(a==='mode'){if(await commit(()=>repo.setSettings({mode:el.dataset.mode})))render();}
    else if(a==='open-meals'){openMealPicker();}
    else if(a==='pick-meal'){selectedMeal=el.dataset.meal;updateMealPicker();const picked=modalRoot.querySelector('[data-action="pick-meal"][aria-pressed="true"]');if(picked)picked.focus({preventScroll:true});}
    else if(a==='picker-start'){closeModal();startDrawing();}
    else if(a==='reset-meal-search'){mealQuery='';mealCategory='all';document.querySelector('#meal-search').value='';document.querySelector('#picker-category').value='all';updateMealPicker(true);}
    else if(a==='start'){startDrawing();}
    else if(a==='new-art'){screen='home';tab='home';render();}
    else if(a==='draw-meal'){startDrawing(el.dataset.meal);}
    else if(a==='open-gallery'){screen='gallery';tab='gallery';render();}
    else if(a==='clear-gallery-search'){galleryQuery='';document.querySelector('#gallery-search').value='';updateGalleryResults();document.querySelector('#gallery-search').focus({preventScroll:true});}
    else if(a==='reset-gallery-filters'){resetGalleryFilters();}
    else if(a==='clear-history-search'){historyQuery='';document.querySelector('#history-search').value='';updateHistoryResults();document.querySelector('#history-search').focus({preventScroll:true});}
    else if(a==='reset-history-filters'){resetHistoryFilters();}
    else if(a==='filter'){filter=el.dataset.filter;updateHistoryResults();}
    else if(a==='store'){openStorePicker();}
    else if(a==='setup'){setup();}
    else if(a==='save-token'){saveToken(el);}
    else if(a==='retry-connect'){closeModal();connect();}
    else if(a==='search-stores'){searchStores();}
    else if(a==='select-store'){selectStore(el.dataset.store);}
    else if(a==='shuffle-previews'){galleryPreviews(el.dataset.meal,true);const top=root.scrollTop;render();root.scrollTop=top;const card=[...root.querySelectorAll('.gallery-card')].find(card=>card.dataset.meal===el.dataset.meal);card.querySelector('[data-action="shuffle-previews"]').focus({preventScroll:true});}
    else if(a==='open-wall'){openWall(el.dataset.meal);}
    else if(a==='back-gallery'){screen='gallery';render();root.scrollTop=galleryScroll;const opener=[...root.querySelectorAll('.gallery-meal-link')].find(el=>el.dataset.meal===wall.mealId);if(opener)opener.focus({preventScroll:true});}
    else if(a==='wall-order'){setWallOrder(el.dataset.order);}
    else if(a==='reshuffle-wall'){setWallOrder('random',true);}
    else if(a==='more-wall'){const top=root.scrollTop;wall.limit+=WALL_PAGE_SIZE;document.querySelector('#wall-results').innerHTML=wallResults();root.scrollTop=top;const newlyLoaded=root.querySelectorAll('[data-action="zoom-art"]')[wall.limit-WALL_PAGE_SIZE];if(newlyLoaded)newlyLoaded.focus({preventScroll:true});}
    else if(a==='zoom-art'){showArtwork(el.dataset.id);}
    else if(a==='previous-art'){stepArtwork(-1);}
    else if(a==='next-art'){stepArtwork(1);}
    else if(a==='reference'){referenceVisible=!referenceVisible;render();}
    else if(a==='color'){color=el.dataset.color;erase=false;render();}
    else if(a==='eraser'){erase=!erase;render();}
    else if(a==='size'){brush=Number(el.dataset.size);render();}
    else if(a==='undo'){draft.redo.push(draft.strokes.pop());refreshDrawing();}
    else if(a==='redo'){draft.strokes.push(draft.redo.pop());refreshDrawing();}
    else if(a==='clear'){if(draft.strokes.length)showModal(`<h2>重新画一张？</h2><p>清空当前画布，已经保存的作品不受影响。</p><div class="confirm-actions">${button('close-modal','再想想','secondary')}${button('confirm-clear','清空画布','primary')}</div>`);}
    else if(a==='confirm-clear'){draft.strokes=[];draft.redo=[];closeModal();refreshDrawing();}
    else if(a==='back'){leave();}
    else if(a==='discard'){await discardDrawing();}
    else if(a==='save'){openSave();}
    else if(a==='confirm-save'){el.disabled=true;const art=await saveDraft(document.querySelector('#art-title').value,document.querySelector('#save-public').checked);if(el.isConnected)el.disabled=false;if(art){goHistory();toast('已保存，今天的快乐留住了');}}
    else if(a==='handoff'){if(!draft.strokes.some(s=>!s.erase)){toast('先在画布上留下一笔吧');return;}screen='handoff';render();}
    else if(a==='resume'){screen='draw';render();}
    else if(a==='guess-start'){screen='guess';render();}
    else if(a==='submit-guess'){submitGuess();}
    else if(a==='reveal'){revealedCorrect=false;screen='reveal';render();}
    else if(a==='swap'){if(await saveDraft('今天的'+C.artMeal(draft).name,false)){draft=null;tab='home';screen='home';render();toast('本轮已存入画册，交换角色再选一道吧');}}
    else if(a==='detail'){detail(el.dataset.id);}
    else if(a==='previous-history'||a==='next-history'){stepHistoryDetail(a==='previous-history'?-1:1);}
    else if(a==='close-modal'){closeModal();}
    else if(a==='allow-public'){const art=state.artworks.find(x=>x.id===el.dataset.id);showModal(`<h2>让这张画，遇见别人。</h2><p>允许后，这张画可在「${esc(C.artStore(art).name)}」的「${esc(C.artMeal(art).name)}」旁随机展示。你可以随时撤回许可。</p><p class="info-strip">此原型仅在当前设备模拟公开展示。</p>${button('confirm-public','同意公开这张画','primary',`data-id="${esc(art.id)}" data-revision="${art.revision}"`)}`,{className:historyDetail?'history-confirm':''});}
    else if(a==='confirm-public'||a==='revoke'){const index=historyItems().findIndex(x=>x.id===el.dataset.id);el.disabled=true;if(await commit(()=>repo.setConsent(el.dataset.id,a==='confirm-public',{expectedRevision:Number(el.dataset.revision)}))){refreshHistoryDetail(index);toast(a==='confirm-public'?'已允许公开，可去餐品画廊查看':'已撤回，仅自己可见');}if(el.isConnected)el.disabled=false;}
    else if(a==='delete'){const art=state.artworks.find(x=>x.id===el.dataset.id);if(!art)return;const used=snapshot.plans.filter(p=>p.artIds.includes(art.id)).length;showModal(`<h2>删除这张画？</h2><p>将移出画册与公开展示。${used?'已有 '+used+' 张餐纸会继续保留保存时的画作副本。':''}</p><div class="confirm-actions">${button('close-modal','保留这张画','secondary')}${button('confirm-delete','确认删除','primary',`data-id="${esc(el.dataset.id)}" data-revision="${art.revision}"`)}</div>`,{className:historyDetail?'history-confirm':''});}
    else if(a==='confirm-delete'){const index=historyItems().findIndex(x=>x.id===el.dataset.id);el.disabled=true;if(await commit(()=>repo.deleteArtwork(el.dataset.id,{expectedRevision:Number(el.dataset.revision)}))){refreshHistoryDetail(index);toast('画作已删除');}if(el.isConnected)el.disabled=false;}
    else if(a==='storage-retry'){await bootstrap();}
    else if(a==='download'){const art=state.artworks.find(x=>x.id===el.dataset.id);const link=document.createElement('a');link.href=thumbnail(art);link.download=art.title+(art.kind==='image'&&art.imageSource.startsWith('data:image/jpeg;')?'.jpg':'.png');link.click();}
    if(['reference','color','eraser','size','undo','redo','confirm-clear','handoff','resume','guess-start','submit-guess','reveal'].includes(a))scheduleDrawingDraft();
  });
  document.addEventListener('input',e=>{if(e.target.id==='art-title' && draft){draft.title=e.target.value;scheduleDrawingDraft();}else if(e.target.id==='meal-search'){mealQuery=e.target.value;updateMealPicker(true);}else if(e.target.id==='gallery-search'){galleryQuery=e.target.value;updateGalleryResults();}else if(e.target.id==='history-search'){historyQuery=e.target.value;updateHistoryResults();}});
  document.addEventListener('change',e=>{if(e.target.id==='meal-category'){category=e.target.value;updateGalleryResults();}else if(e.target.id==='picker-category'){mealCategory=e.target.value;updateMealPicker(true);}else if(e.target.id==='gallery-only-art'){galleryOnlyWithArt=e.target.checked;updateGalleryResults();saveGalleryPreference();}else if(e.target.id==='history-store'){historyStore=e.target.value;updateHistoryResults(true);}else if(e.target.id==='history-meal'){historyMeal=e.target.value;updateHistoryResults();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(['ArrowLeft','ArrowRight'].includes(e.key)){if(lightboxId){e.preventDefault();stepArtwork(e.key==='ArrowLeft'?-1:1);}else if(historyDetail&&modalRoot.querySelector('.history-detail')){e.preventDefault();stepHistoryDetail(e.key==='ArrowLeft'?-1:1);}}if(e.key==='Tab'&&modalRoot.firstChild){const focusables=[...modalRoot.querySelectorAll('button,input,select,a,[tabindex="0"]')].filter(x=>!x.disabled);const first=focusables[0],last=focusables[focusables.length-1];if(['meal-picker-title','lightbox-title','history-detail-title','paper-zoom-title'].includes(document.activeElement.id)){e.preventDefault();(e.shiftKey?last:first).focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  window.addEventListener('beforeunload',e=>{if((draft&&draft.strokes.length&&!draft.savedId)||paperUI.hasUnsaved()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('error',e=>{if(e.target.tagName==='IMG' && e.target.src.includes('https:')){e.target.src=asset('no-image.svg');e.target.alt='暂无参考图，可对照实物画';}},true);
  async function saveGalleryPreference(){if(state.storeId)await commit(()=>repo.setSettings({galleryPreferences:{[state.storeId]:galleryOnlyWithArt}}));}
  async function bootstrap(){
    ready=false;storageFailure=null;render();
    try{await repo.open();onSnapshot(await repo.readSnapshot());ready=true;storageFailure=null;render();connect();}
    catch(error){storageFailure=error;render();}
  }
  repo.subscribe(event=>{
    if(event.type==='blocked'){storageFailure={message:event.message};if(!ready)render();else toast(event.message);return;}
    if(event.type==='versionchange'){toast(event.message+'；请先备份当前草稿');return;}
    if(ready)readChanges();
  });
  window.addEventListener('focus',()=>{if(ready)readChanges();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDrawingDraft().catch(()=>{});else if(ready)readChanges();});
  window.addEventListener('pagehide',()=>flushDrawingDraft().catch(()=>{}));
  bootstrap();
})();
