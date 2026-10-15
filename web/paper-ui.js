(function(root,factory){
  const ui=factory();
  if(typeof module==='object' && module.exports)module.exports=ui;
  else root.MealPaperUI=ui;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return {create(host) {
    const {core:C,paper:P,button,esc,thumbnail,root,modalRoot,toast} = host;
    const repo=host.repo;
    let plans=(host.snapshot?.plans || []).map(P.makePlan),session=null,previewFrame=0,previewVersion=0,exporting=false,zoom=null,enterVersion=0;
    const clone=value=>JSON.parse(JSON.stringify(value));
    const newDraftId=()=> 'draft-paper-'+(globalThis.crypto?.randomUUID?.() || Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    const notify=snapshot=>{if(host.onSnapshot)host.onSnapshot(snapshot);else sync(snapshot);};
    const sessionArt=id=>session?.artworks.find(a=>a.id===id);
    const readError=error=>{toast(error.name==='QuotaExceededError'?'设备空间不足，修改仍保留在当前页面，请先备份':error.message || '保存未完成，请重试');};
    function sync(snapshot) {
      plans=(snapshot?.plans || []).map(P.makePlan);
      if(session){const latest=plans.find(p=>p.id===session.plan.id);session.remoteChanged=!!latest && latest.revision!==session.baseRevision;refreshVersionTools();}
    }
    const artById=id=>host.artworks().find(a=>a.id===id);
    const active=()=>!!session && host.screen().startsWith('paper-');
    const createCanvas=(width,height)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;};
    const hasUnsaved=()=>active() && session.dirty;
    function teaser() {
      const count=host.artworks().length;
      return `<div class="paper-teaser"><span class="paper-teaser-star" aria-hidden="true">✳</span><small>FROM MY SKETCHBOOK</small><h2>把小小画作，拼成一张餐纸。</h2><p>${count>=3?'选 3～6 张自己的画，留住一桌小快乐。':`已攒 ${count} 张，再画 ${3-count} 张就能制作。`}</p>${button('paper-new','制作我的餐纸 ↗','text-button',count>=3?'':'disabled')}</div>${plans.length?`<details class="paper-saved"><summary>我的餐纸 <span>${plans.length} 个方案</span></summary><div>${plans.map(p=>button('paper-open',`<span class="paper-plan-icon" aria-hidden="true">▧</span><span><strong>${esc(p.title)}</strong><small>${C.dateLabel(p.updatedAt)} · ${p.artIds.length} 张画作${p.missingArtIds?.length?' · 需重新选画':''}</small></span><span aria-hidden="true">↗</span>`,'paper-plan',`data-id="${esc(p.id)}"`)).join('')}</div></details>`:''}`;
    }
    async function enter(id) {
      const token=++enterVersion,saved=plans.find(p=>p.id===id),plan=P.makePlan(saved || {templateId:'whitespace-v1',rendererVersion:P.TEMPLATE_RENDERER_VERSION});
      try {
        const resolved=await repo.resolvePaper(plan);if(token!==enterVersion)return;
        session={plan,artworks:resolved.artworks,filters:{...host.historyFilters()},originScroll:root.scrollTop,originId:id || '',activeId:plan.artIds[0] || '',dirty:false,missing:resolved.missing.length,baseRevision:plan.revision,draftId:newDraftId(),draftRevision:0,generation:0,draftTimer:0,draftChain:Promise.resolve(),draftStatus:'none',saving:false,remoteChanged:false};
        // Missing references remain visible for repair instead of silently changing the saved plan.
        host.show(saved && !resolved.missing.length && plan.artIds.length>=3 ? 'paper-edit' : 'paper-select');
      } catch(error){readError(error);}
    }
    async function resumeDraft(draft) {
      if(!draft || draft.kind!=='paper' || !draft.payload?.plan)return false;
      const token=++enterVersion,payload=draft.payload,plan=P.makePlan(payload.plan);
      try {
        const resolved=await repo.resolvePaper(plan);if(token!==enterVersion)return false;
        session={plan,artworks:resolved.artworks,filters:{query:'',store:'all',meal:'all',privacy:'all',...payload.filters},originScroll:payload.originScroll || 0,originId:payload.originId || '',activeId:payload.activeId || plan.artIds[0] || '',dirty:true,missing:resolved.missing.length,baseRevision:payload.baseRevision ?? plan.revision,draftId:draft.id,draftRevision:draft.revision || 0,generation:0,draftTimer:0,draftChain:Promise.resolve(),draftStatus:'saved',saving:false,remoteChanged:false};
        host.show(payload.screen==='paper-edit' && !resolved.missing.length && plan.artIds.length>=3?'paper-edit':'paper-select');
        root.scrollTop=payload.scroll || 0;toast('已恢复上次的餐纸编辑');return true;
      } catch(error){readError(error);return false;}
    }
    function queueDraft() {
      if(!session || session.saving)return;
      session.draftStatus='pending';clearTimeout(session.draftTimer);session.draftTimer=setTimeout(()=>flushDraft(),500);
    }
    function flushDraft() {
      const current=session;if(!current || !current.dirty)return Promise.resolve();
      clearTimeout(current.draftTimer);
      const generation=current.generation;current.draftStatus='pending';
      const payload=clone({plan:P.makePlan(current.plan),filters:current.filters,activeId:current.activeId,screen:host.screen(),scroll:root.scrollTop,originScroll:current.originScroll,originId:current.originId,baseRevision:current.baseRevision});
      current.draftChain=current.draftChain.catch(()=>{}).then(async()=>{
        const snapshot=await repo.saveDraft({id:current.draftId,kind:'paper',payload},{expectedRevision:current.draftRevision});
        const saved=snapshot.drafts.find(d=>d.id===(snapshot.savedDraftId || current.draftId));
        current.draftId=saved?.id || snapshot.savedDraftId || current.draftId;current.draftRevision=saved?.revision || current.draftRevision;
        if(current.generation===generation)current.draftStatus='saved';
        notify(snapshot);if(session===current)host.refreshDock();if(snapshot.conflicted)toast('上次草稿已在另一页修改，本页已另存草稿');
      });
      // Keep the rejected chain observable to callers, while reporting background failures.
      current.draftChain.catch(error=>{current.draftStatus='error';readError(error);if(session===current)host.refreshDock();});return current.draftChain;
    }
    function filtered() {
      const f=session.filters,q=f.query.trim().toLocaleLowerCase();
      return host.artworks().filter(a=>(f.store==='all'||a.storeId===f.store)&&(f.meal==='all'||a.mealId===f.meal)&&(f.privacy==='all'||(f.privacy==='public'?a.isPublic:!a.isPublic))&&[a.title,C.artStore(a).name,C.artMeal(a).name,...(C.artMeal(a).alias||[])].some(s=>String(s).toLocaleLowerCase().includes(q)));
    }
    function options() {
      const stores=new Map(),meals=new Map(),f=session.filters;
      host.artworks().forEach(a=>stores.set(a.storeId,C.artStore(a).name));
      if (!stores.has(f.store)) f.store='all';
      host.artworks().filter(a=>f.store==='all'||a.storeId===f.store).forEach(a=>{if(!meals.has(a.mealId))meals.set(a.mealId,{name:C.artMeal(a).name,store:C.artStore(a).name});});
      if (!meals.has(f.meal)) f.meal='all';
      return {stores,meals};
    }
    function selectOptions() {
      const {stores,meals}=options(),f=session.filters;
      const store=`<option value="all">全部门店（${stores.size}）</option>${[...stores].map(([id,name])=>`<option value="${esc(id)}" ${id===f.store?'selected':''}>${esc(name)}</option>`).join('')}`;
      const meal=`<option value="all">全部餐品（${meals.size}）</option>${[...meals].map(([id,m])=>`<option value="${esc(id)}" ${id===f.meal?'selected':''}>${esc(m.name + ([...meals].some(([otherId,other])=>otherId!==id&&other.name===m.name)?' · '+m.store:''))}</option>`).join('')}`;
      return {store,meal};
    }
    function selectionView() {
      const opts=selectOptions(),f=session.filters;
      return `${button('paper-leave','‹ 我的画册','screen-back')}<div class="paper-heading"><small>01 选画 <span>→ 02 排版</span></small><h1>选几张，拼一桌快乐。</h1><p>选 3～6 张 · 单人、双人和私密画作都可以</p></div>${session.missing?'<p class="info-strip">部分保存版本无法读取，请移除缺失画作并补选后保存。</p>':''}<div class="gallery-tools paper-selection-tools"><div class="gallery-search-row"><label class="sr-only" for="paper-search">搜索餐纸画作</label><input id="paper-search" class="title-input gallery-search" type="search" value="${esc(f.query)}" placeholder="搜索作品名、餐品或门店" autocomplete="off" maxlength="80">${button('paper-clear-search','清空','gallery-search-clear',`aria-label="清空选画搜索" ${f.query?'':'hidden'}`)}</div><div class="history-selects"><div><label class="sr-only" for="paper-store">筛选餐纸门店</label><select id="paper-store">${opts.store}</select></div><div><label class="sr-only" for="paper-meal">筛选餐纸餐品</label><select id="paper-meal">${opts.meal}</select></div></div><div class="filter-row" role="group" aria-label="餐纸画作公开状态">${[['all','全部'],['private','仅自己'],['public','允许公开']].map(([key,label])=>button('paper-filter',label,'filter-chip'+(f.privacy===key?' active':''),`data-filter="${key}" aria-pressed="${f.privacy===key}"`)).join('')}</div></div><div id="paper-results">${selectionResults()}</div>`;
    }
    function selectionResults() {
      const items=filtered(),ids=session.plan.artIds;
      return `<p class="gallery-results-status history-results-status" role="status">找到 ${items.length} 张作品<span>已选 ${ids.length} / 6 张</span></p>${items.length?`<div class="history-grid">${items.map(a=>button('paper-toggle',`<div class="art-paper"><img loading="lazy" src="${esc(thumbnail(a))}" alt="${esc(a.title)}"><span class="paper-pick-check" aria-hidden="true">${ids.includes(a.id)?ids.indexOf(a.id)+1:'+'}</span></div><strong>${esc(a.title)}</strong><small>${esc(C.artMeal(a).name)} · ${a.isPublic?'允许公开':'仅自己'}</small><span class="history-context"><span>${esc(C.artStore(a).name)}</span></span>`,'history-card paper-pick'+(ids.includes(a.id)?' selected':''),`data-id="${esc(a.id)}" aria-label="${ids.includes(a.id)?'取消选择':'选择'}画作：${esc(a.title)}" aria-pressed="${ids.includes(a.id)}"`)).join('')}</div>`:`<div class="gallery-no-results"><h2>没有找到这些画作</h2><p>已选画作会保留，可以换个条件继续找。</p>${button('paper-reset-filters','清除选画筛选','secondary')}</div>`}`;
    }
    function updateSelection(reset=false,updateOptions=false) {
      if (updateOptions) { const opts=selectOptions();document.querySelector('#paper-store').innerHTML=opts.store;document.querySelector('#paper-meal').innerHTML=opts.meal; }
      document.querySelector('#paper-results').innerHTML=selectionResults();
      document.querySelector('[data-action="paper-clear-search"]').hidden=!session.filters.query;
      root.querySelectorAll('[data-action="paper-filter"]').forEach(el=>{const selected=el.dataset.filter===session.filters.privacy;el.classList.toggle('active',selected);el.setAttribute('aria-pressed',String(selected));});
      host.refreshDock();if(reset)root.scrollTop=0;if(session.dirty)queueDraft();
    }
    function editorView() {
      const p=session.plan;
      return `${button('paper-reselect','‹ 重新选画','screen-back')}<div class="paper-heading"><small><span>01 选画 → </span>02 排版</small><h1>把这一餐，留在纸上。</h1></div><figure class="paper-preview">${button('paper-zoom','<canvas id="paper-preview" width="1000" height="707" role="img" aria-label="我的餐纸排版预览"></canvas><span class="paper-preview-hint">点击放大查看细节 ↗</span>','paper-preview-open','aria-label="放大查看餐纸" aria-haspopup="dialog"')}<figcaption>A3 横版比例 · 高清导出 4961 × 3508 px</figcaption></figure><div id="paper-template-tools">${templatePicker()}</div><div id="paper-version-tools" data-version-status="${versionStatus()}">${versionTools()}</div><div class="paper-form"><label for="paper-title">餐纸标题</label><input id="paper-title" class="title-input" maxlength="24" value="${esc(p.title)}" placeholder="${esc(P.DEFAULT_TITLE)}"><label for="paper-signature">你的署名 <small>可不填</small></label><input id="paper-signature" class="title-input" maxlength="16" value="${esc(p.signature)}" placeholder="例如：今天一起吃饭的我们"><div class="paper-note-options"><label><input id="paper-art-titles" type="checkbox" ${p.showArtworkTitles?'checked':''}>作品标题入画</label><label><input id="paper-date" type="checkbox" ${p.showDate?'checked':''}>显示日期</label><label><input id="paper-note-store" type="checkbox" ${p.showStore?'checked':''}>显示门店</label></div></div><div class="section-heading paper-piece-heading"><h2>调整小画的位置</h2><small>点一张，再调整</small></div><div id="paper-piece-tools">${pieceTools()}</div><p class="version-note">餐纸方案仅保存在当前设备<br>制作与下载不改变原画的公开状态</p>`;
    }
    function versionStatus() {return `${hasNewerVersions()?'newer':'same'}-${session.remoteChanged?'changed':'current'}`;}
    function versionTools() {
      return `<p class="version-note">已选画作固定为保存时的版本</p>${hasNewerVersions()?button('paper-update-versions','更新为最新版本','secondary'):''}${session.remoteChanged?'<p class="info-strip" role="status">另一页更新了此方案。当前编辑与原画版本会保留，保存时可重新载入或另存副本。</p>':''}`;
    }
    function refreshVersionTools() {
      if(!active() || host.screen()!=='paper-edit')return;
      const container=root.querySelector?.('#paper-version-tools');if(!container)return;
      const status=versionStatus();if(container.dataset.versionStatus===status)return;
      const scroll=root.scrollTop,focused=document.activeElement,focusedAction=container.contains?.(focused)?focused?.dataset.action:'';
      // Only this status area and the fixed dock change. Form fields, canvas and scroll stay intact.
      container.innerHTML=versionTools();container.dataset.versionStatus=status;host.refreshDock();
      if(focusedAction)container.querySelector?.(`[data-action="${focusedAction}"]`)?.focus({preventScroll:true});
      root.scrollTop=scroll;
    }
    function templatePicker() {
      const p=session.plan,legacy=p.templateId.startsWith('legacy-'),templates=P.TEMPLATES;
      const original=!!p.legacyTemplateId;
      return `<div class="section-heading"><h2>选择排版</h2><small>${legacy?'原版 · 排版 '+(p.layout+1):templates.find(t=>t.id===p.templateId)?.label || '留白'}</small></div><div class="filter-row" role="group" aria-label="餐纸排版模板">${templates.map(t=>button('paper-template',t.label,'filter-chip'+(p.templateId===t.id?' active':''),`data-template="${t.id}" aria-pressed="${p.templateId===t.id}"`)).join('')}${original?button('paper-template','保留原版 · 排版 '+(p.layout+1),'filter-chip'+(legacy?' active':''),`data-template="legacy-${p.layout}" aria-pressed="${legacy}"`):''}</div>`;
    }
    function pieceTools() {
      const ids=session.plan.artIds;
      if (!ids.includes(session.activeId)) session.activeId=ids[0];
      const index=ids.indexOf(session.activeId),current=sessionArt(session.activeId) || {title:'缺失画作'},titleStyle=session.plan.artTitleStyles[session.activeId] || {visible:true,scale:1};
      return `<div class="paper-pieces" role="group" aria-label="调整餐纸画作">${ids.map((id,i)=>{const a=sessionArt(id) || {title:'缺失画作',strokes:[]};return button('paper-active',`<img src="${esc(thumbnail(a))}" alt=""><span>${i+1}</span>`,'paper-piece'+(id===session.activeId?' active':''),`data-id="${esc(id)}" aria-label="调整第 ${i+1} 张：${esc(a.title)}" aria-pressed="${id===session.activeId}"`);}).join('')}</div><p class="paper-piece-caption">第 ${index+1} 张 · ${esc(current.title)}</p><div class="paper-move-controls">${button('paper-move','‹ 前移一位','secondary',`data-direction="-1" ${index>0?'':'disabled'}`)}${button('paper-move','后移一位 ›','secondary',`data-direction="1" ${index<ids.length-1?'':'disabled'}`)}</div><div class="paper-size"><label for="paper-size">画作大小 <output id="paper-size-value">${Math.round((session.plan.scales[session.activeId]||1)*100)}%</output></label><input id="paper-size" type="range" min="80" max="120" step="5" value="${Math.round((session.plan.scales[session.activeId]||1)*100)}"></div><div class="paper-art-title-tools"><label class="paper-title-toggle"><input id="paper-piece-title" type="checkbox" ${titleStyle.visible?'checked':''} ${session.plan.showArtworkTitles?'':'disabled'}>显示这张画的标题</label><p class="paper-title-element">${esc(current.title)}</p><p class="paper-title-note">${session.plan.showArtworkTitles?(titleStyle.visible?'作品原标题会和涂鸦一起排版':'这张画的标题暂不显示'):'先打开「作品标题入画」即可使用'}</p><div class="paper-size"><label for="paper-art-title-size">标题大小 <output id="paper-art-title-value">${Math.round(titleStyle.scale*100)}%</output></label><input id="paper-art-title-size" type="range" min="80" max="140" step="10" value="${Math.round(titleStyle.scale*100)}" ${session.plan.showArtworkTitles&&titleStyle.visible?'':'disabled'}></div></div>`;
    }
    function dock() {
      if (!active()) return '';
      if (host.screen()==='paper-select') { const ids=session.plan.artIds;return `<div class="paper-selection-dock"><div class="dock-summary" role="status"><span>已选 ${ids.length} / 6 张${ids.length<3?` · 再选 ${3-ids.length} 张`:''}</span><small>换筛选也会保留</small></div>${ids.length?`<div class="paper-picked-strip">${ids.map(id=>{const a=sessionArt(id) || {title:'缺失画作',strokes:[]};return button('paper-toggle',`<img src="${esc(thumbnail(a))}" alt=""><span>×</span>`,'paper-picked',`data-id="${esc(id)}" aria-label="移除已选画作：${esc(a.title)}"`);}).join('')}</div>`:''}${button('paper-compose',`排版这 ${ids.length} 张画 ↗`,'primary',ids.length>=3&&ids.length<=6?'':'disabled')}</div>`; }
      return `<p class="paper-save-status" role="status">${session.saving?'正在保存…':session.remoteChanged?'另一页更新了此方案，保存时可重新载入或另存副本':session.dirty?(session.draftStatus==='saved'?'修改已保留为草稿，方案尚未保存':session.draftStatus==='error'?'草稿保存失败，请保留此页并重试':'正在保留修改为草稿…'):plans.some(p=>p.id===session.plan.id)?'方案已保存在当前设备':'排版完成后，保存你的第一张餐纸'}</p><div class="paper-export-actions">${button('paper-save','保存方案','secondary',session.saving?'disabled':'')}${button('paper-export',exporting?'正在绘制…':'下载高清 PNG ↗','primary',exporting?'disabled':'')}</div>`;
    }
    function queuePreview() {
      const version=++previewVersion;
      cancelAnimationFrame(previewFrame);previewFrame=requestAnimationFrame(async()=>{
        const canvas=document.querySelector('#paper-preview');if(!canvas||!active())return;
        const current=session;
        try {const snapshot=P.captureExport(current.plan,current.artworks);await P.prepareImages(snapshot.artworks);if(version!==previewVersion||session!==current||!active()||canvas!==document.querySelector('#paper-preview'))return;P.render(canvas,snapshot.plan,snapshot.artworks,createCanvas,C);} catch(error) {if(version===previewVersion)toast(error.message);}
      });
    }
    function setZoom(scale,center=false) {
      if(!zoom)return;
      const viewport=modalRoot.querySelector('#paper-zoom-viewport'),stage=modalRoot.querySelector('.paper-zoom-stage'),canvas=modalRoot.querySelector('#paper-zoom-canvas');
      const oldWidth=canvas.offsetWidth,oldHeight=canvas.offsetHeight;
      const x=center || !oldWidth ? .5 : (viewport.scrollLeft+viewport.clientWidth/2-(stage.offsetWidth-oldWidth)/2)/oldWidth;
      const y=center || !oldHeight ? .5 : (viewport.scrollTop+viewport.clientHeight/2-(stage.offsetHeight-oldHeight)/2)/oldHeight;
      zoom.scale=Math.max(1,Math.min(3,scale));
      const fit=Math.min(Math.max(1,viewport.clientWidth-32),Math.max(1,viewport.clientHeight-32)*P.EXPORT_WIDTH/P.EXPORT_HEIGHT);
      const width=fit*zoom.scale,height=width*P.EXPORT_HEIGHT/P.EXPORT_WIDTH;
      canvas.style.width=width+'px';canvas.style.height=height+'px';
      stage.style.width=Math.max(viewport.clientWidth,width+32)+'px';stage.style.height=Math.max(viewport.clientHeight,height+32)+'px';
      viewport.scrollLeft=(stage.offsetWidth-width)/2+x*width-viewport.clientWidth/2;
      viewport.scrollTop=(stage.offsetHeight-height)/2+y*height-viewport.clientHeight/2;
      modalRoot.querySelector('#paper-zoom-value').textContent=Math.round(zoom.scale*100)+'%';
      modalRoot.querySelector('[data-action="paper-zoom-out"]').disabled=zoom.scale<=1;
      modalRoot.querySelector('[data-action="paper-zoom-in"]').disabled=zoom.scale>=3;
    }
    async function openZoom(opener) {
      if(host.screen()!=='paper-edit'||zoom)return;
      zoom={scroll:root.scrollTop,opener,scale:1.5,observer:null,drag:null};
      host.showModal(`<header class="paper-zoom-heading"><small>我的餐纸 · 放大预览</small><h2 id="paper-zoom-title" tabindex="-1">${esc(session.plan.title||P.DEFAULT_TITLE)}</h2></header><div id="paper-zoom-viewport" class="paper-zoom-viewport" role="region" aria-label="餐纸查看区域，可滚动查看" tabindex="0"><div class="paper-zoom-stage"><canvas id="paper-zoom-canvas" width="2400" height="1697" role="img" aria-label="餐纸高清放大预览"></canvas></div></div><div class="paper-zoom-controls" role="group" aria-label="餐纸预览缩放">${button('paper-zoom-out','−','secondary','aria-label="缩小餐纸"')}<output id="paper-zoom-value" aria-live="polite">150%</output>${button('paper-zoom-in','+','secondary','aria-label="放大餐纸"')}${button('paper-zoom-fit','适应屏幕','secondary paper-zoom-fit')}</div><p class="paper-zoom-help">拖动或滑动查看细节 · 关闭后继续编辑</p>`,{className:'paper-lightbox',label:'餐纸放大预览'});
      const viewport=modalRoot.querySelector('#paper-zoom-viewport');
      const currentZoom=zoom,snapshot=P.captureExport(session.plan,session.artworks);
      try {await P.prepareImages(snapshot.artworks);if(zoom!==currentZoom)return;P.render(modalRoot.querySelector('#paper-zoom-canvas'),snapshot.plan,snapshot.artworks,createCanvas,C);} catch(error) {if(zoom===currentZoom){closeZoom();toast(error.message);}return;}
      setZoom(zoom.scale,true);
      zoom.observer=new ResizeObserver(()=>{if(zoom)setZoom(zoom.scale);});zoom.observer.observe(viewport);
      viewport.addEventListener('pointerdown',e=>{
        if(e.pointerType!=='mouse'||e.button!==0)return;
        e.preventDefault();viewport.setPointerCapture(e.pointerId);zoom.drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.classList.add('dragging');
      });
      viewport.addEventListener('pointermove',e=>{
        const drag=zoom?.drag;if(!drag||drag.id!==e.pointerId)return;
        viewport.scrollLeft=drag.left+drag.x-e.clientX;viewport.scrollTop=drag.top+drag.y-e.clientY;
      });
      const stopDrag=()=>{if(zoom)zoom.drag=null;viewport.classList.remove('dragging');};
      viewport.addEventListener('pointerup',stopDrag);viewport.addEventListener('pointercancel',stopDrag);viewport.addEventListener('lostpointercapture',stopDrag);
    }
    function closeZoom() {
      if(!zoom)return false;
      const previous=zoom;zoom=null;previous.observer?.disconnect();modalRoot.innerHTML='';
      root.scrollTop=previous.scroll;if(previous.opener?.isConnected)previous.opener.focus({preventScroll:true});
      return true;
    }
    function dirty() {session.dirty=true;session.generation++;queueDraft();host.refreshDock();}
    function updatePieces() {document.querySelector('#paper-piece-tools').innerHTML=pieceTools();queuePreview();}
    function hasNewerVersions() {return session.plan.refs.some(ref=>{const latest=artById(ref.artId);return latest && latest.versionId!==ref.versionId;});}
    async function updateVersions() {
      const current=session,plan=P.makePlan(clone(current.plan));
      plan.refs=plan.artIds.map(id=>{const latest=artById(id),old=plan.refs.find(ref=>ref.artId===id);return latest?{artId:id,versionId:latest.versionId}:old;}).filter(Boolean);
      try {const resolved=await repo.resolvePaper(plan);if(session!==current)return;current.plan=plan;current.artworks=resolved.artworks;current.missing=resolved.missing.length;dirty();host.show('paper-edit');toast('已更新所选原画版本，保存后才改变此方案');}catch(error){readError(error);}
    }
    async function save(copy=false) {
      const current=session;if(!current || current.saving)return false;
      current.saving=true;host.refreshDock();
      try {
        await flushDraft();
        const generation=current.generation,plan=P.makePlan(clone(current.plan));P.validate(plan,current.artworks);
        if(copy){plan.id=P.makePlan().id;plan.revision=0;}
        const snapshot=await repo.savePaper(plan,{expectedRevision:copy?0:current.baseRevision,draftId:current.draftId,draftRevision:current.draftRevision});
        const saved=snapshot.plans.find(p=>p.id===plan.id);notify(snapshot);
        if(session===current){
          current.baseRevision=saved.revision;current.remoteChanged=false;current.draftRevision=0;refreshVersionTools();
          if(generation===current.generation){current.plan=P.makePlan(saved);current.dirty=false;current.missing=0;}
          else {current.plan.id=saved.id;current.plan.revision=saved.revision;queueDraft();}
          host.refreshDock();
        }
        toast('餐纸方案已保存，可在画册里继续编辑');return session!==current || !current.dirty;
      } catch(error) {
        if(error.name==='ConflictError' || error.code==='CONFLICT')host.showModal(`<h2>另一页已经更新相关内容</h2><p>本页修改仍保留在页面。你可以另存一个方案${plans.some(p=>p.id===current.plan.id)?'，或保留草稿后重新载入已保存方案':''}。</p>${button('paper-conflict-copy','另存本页方案','primary')}${plans.some(p=>p.id===current.plan.id)?button('paper-conflict-reload','重新载入已保存方案','secondary'):''}${button('close-modal','继续编辑','text-button')}`);
        else readError(error);
        return false;
      } finally {current.saving=false;if(session===current){if(current.dirty)queueDraft();host.refreshDock();}}
    }
    async function download() {
      if(exporting || !session)return;
      // The plan, artwork versions, title and filename are all captured synchronously.
      let snapshot;try{snapshot=P.captureExport(session.plan,session.artworks);}catch(error){readError(error);return;}
      exporting=true;host.refreshDock();
      try {
        if(document.fonts)await document.fonts.ready;
        await P.prepareImages(snapshot.artworks);
        const canvas=createCanvas(P.EXPORT_WIDTH,P.EXPORT_HEIGHT);P.render(canvas,snapshot.plan,snapshot.artworks,createCanvas,C);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片未能生成，请重试');
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=snapshot.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('高清餐纸已生成');
      } catch(error){toast(error.message || '导出未完成，请重试');}
      finally{exporting=false;host.refreshDock();}
    }
    function finish(destination) {const previous=session;if(!previous)return;clearTimeout(previous.draftTimer);session=null;++enterVersion;host.returnTo(destination,previous.originScroll,previous.originId);}
    async function discard(destination) {
      const current=session;if(!current)return;
      clearTimeout(current.draftTimer);
      try{await current.draftChain.catch(()=>{});const snapshot=await repo.deleteDraft(current.draftId,{expectedRevision:current.draftRevision});notify(snapshot);if(session===current){host.closeModal();finish(destination);}}catch(error){readError(error);}
    }
    function leave(destination='history') {
      if (!active()) return;
      if (session.dirty) {const valid=session.plan.artIds.length>=3&&session.plan.artIds.length<=6;host.showModal(`<h2>把这张餐纸留住？</h2><p>这次修改还没保存。你可以继续制作，或${valid?'保存方案后返回':'返回画册重新开始'}。</p>${valid?button('paper-save-leave','保存并返回','primary',`data-destination="${destination}"`):button('close-modal','继续选画','primary')}${button('paper-discard','放弃本次修改','danger-text',`data-destination="${destination}"`)}`); }
      else finish(destination);
    }
    root.addEventListener('scroll',()=>{if(active() && session.dirty)queueDraft();},{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDraft();});
    globalThis.addEventListener?.('pagehide',()=>flushDraft());
    document.addEventListener('click',async e=>{
      const el=e.target.closest('[data-action]');if(!el||el.disabled||!el.dataset.action.startsWith('paper-'))return;
      const action=el.dataset.action;
      if(action==='paper-new'||action==='paper-open'){await enter(el.dataset.id);return;}
      if(!active())return;
      if(action==='paper-leave')leave();
      else if(action==='paper-toggle'){
        const id=el.dataset.id,ids=session.plan.artIds;
        if(ids.includes(id)){session.plan.artIds=ids.filter(x=>x!==id);session.plan.refs=session.plan.refs.filter(ref=>ref.artId!==id);session.artworks=session.artworks.filter(art=>art.id!==id);}
        else {if(ids.length>=6){toast('一张餐纸最多选 6 张画作');return;}const art=artById(id);if(!art)return;ids.push(id);session.plan.refs.push({artId:id,versionId:art.versionId});session.artworks.push(clone(art));session.plan.scales[id]=session.plan.scales[id]||1;session.plan.artTitleStyles[id]=session.plan.artTitleStyles[id]||{visible:!art.titleEmbedded,scale:1};}
        session.missing=P.resolve(session.plan,session.artworks).missing.length;dirty();updateSelection();
        const next=[...root.querySelectorAll('[data-action="paper-toggle"]')].find(x=>x.dataset.id===id);if(next)next.focus({preventScroll:true});
      }
      else if(action==='paper-compose'){try{P.validate(session.plan,session.artworks);session.activeId=session.plan.artIds[0];host.show('paper-edit');queueDraft();}catch(error){toast(error.message);}}
      else if(action==='paper-reselect'){host.show('paper-select');queueDraft();}
      else if(action==='paper-clear-search'){session.filters.query='';document.querySelector('#paper-search').value='';updateSelection(true);document.querySelector('#paper-search').focus({preventScroll:true});}
      else if(action==='paper-reset-filters'){session.filters={query:'',store:'all',meal:'all',privacy:'all'};document.querySelector('#paper-search').value='';updateSelection(true,true);}
      else if(action==='paper-filter'){session.filters.privacy=el.dataset.filter;updateSelection(true);}
      else if(action==='paper-template'){const template=el.dataset.template;if(!P.TEMPLATES.some(t=>t.id===template) && template!=='legacy-'+session.plan.layout)return;session.plan.templateId=template;session.plan.rendererVersion=template.startsWith('legacy-')?'legacy-v1':P.TEMPLATE_RENDERER_VERSION;dirty();document.querySelector('#paper-template-tools').innerHTML=templatePicker();queuePreview();const next=[...root.querySelectorAll('[data-action="paper-template"]')].find(item=>item.dataset.template===template);next?.focus({preventScroll:true});}
      else if(action==='paper-zoom')openZoom(el);
      else if(action==='paper-zoom-in'&&zoom)setZoom(zoom.scale+.5);
      else if(action==='paper-zoom-out'&&zoom)setZoom(zoom.scale-.5);
      else if(action==='paper-zoom-fit'&&zoom)setZoom(1,true);
      else if(action==='paper-active'){session.activeId=el.dataset.id;queueDraft();updatePieces();const next=[...root.querySelectorAll('[data-action="paper-active"]')].find(x=>x.dataset.id===session.activeId);if(next)next.focus({preventScroll:true});}
      else if(action==='paper-move'){session.plan.artIds=P.move(session.plan.artIds,session.plan.artIds.indexOf(session.activeId),Number(el.dataset.direction));dirty();updatePieces();}
      else if(action==='paper-update-versions')await updateVersions();
      else if(action==='paper-conflict-copy'){if(await save(true))host.closeModal();}
      else if(action==='paper-conflict-reload'){try{await flushDraft();const id=session.plan.id;host.closeModal();await enter(id);}catch(_){}}
      else if(action==='paper-save')await save();
      else if(action==='paper-export')await download();
      else if(action==='paper-save-leave'){if(await save()){host.closeModal();finish(el.dataset.destination);}}
      else if(action==='paper-discard'){await discard(el.dataset.destination);}
    });
    document.addEventListener('input',e=>{
      if(!active())return;const id=e.target.id;
      if(id==='paper-search'){session.filters.query=e.target.value;updateSelection(true);}
      else if(id==='paper-title'||id==='paper-signature'){session.plan[id==='paper-title'?'title':'signature']=e.target.value;dirty();queuePreview();}
      else if(id==='paper-art-title-size'){session.plan.artTitleStyles[session.activeId].scale=Number(e.target.value)/100;document.querySelector('#paper-art-title-value').textContent=e.target.value+'%';dirty();queuePreview();}
      else if(id==='paper-size'){session.plan.scales[session.activeId]=Number(e.target.value)/100;document.querySelector('#paper-size-value').textContent=e.target.value+'%';dirty();queuePreview();}
    });
    document.addEventListener('change',e=>{
      if(!active())return;
      if(e.target.id==='paper-store'){session.filters.store=e.target.value;updateSelection(true,true);}
      else if(e.target.id==='paper-meal'){session.filters.meal=e.target.value;updateSelection(true);}
      else if(e.target.id==='paper-art-titles'){session.plan.showArtworkTitles=e.target.checked;dirty();updatePieces();}
      else if(e.target.id==='paper-piece-title'){session.plan.artTitleStyles[session.activeId].visible=e.target.checked;dirty();document.querySelector('#paper-art-title-size').disabled=!e.target.checked;document.querySelector('.paper-title-note').textContent=e.target.checked?'作品原标题会和涂鸦一起排版':'这张画的标题暂不显示';queuePreview();}
      else if(e.target.id==='paper-date'||e.target.id==='paper-note-store'){session.plan[e.target.id==='paper-date'?'showDate':'showStore']=e.target.checked;dirty();queuePreview();}
    });
    return {teaser,active,hasUnsaved,selectionView,editorView,dock,afterRender:queuePreview,leave,closeZoom,sync,resumeDraft,flushDraft,download,activeDraftId:()=>session?.draftId};
  }};
});
