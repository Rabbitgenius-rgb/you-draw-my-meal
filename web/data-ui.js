(() => {
  'use strict';
  window.MealDataUI = {create(host) {
    const {repo,button,esc,toast,showModal,modalRoot} = host;
    let snapshot={drafts:[],warnings:[]},pending=null,pendingExample=false,busy=false,conflictCopy=null;
    const jsonDownload=(value,name)=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    function sync(next){snapshot=next;}
    function recoveryView(){
      const drafts=(snapshot.drafts || []).filter(d=>!host.activeDraft(d.draftId || d.id));
      return drafts.length ? `<aside class="recovery-card"><strong>还有 ${drafts.length} 份创作草稿</strong><p>上次没画完或没排完的，接着来。</p>${button('draft-list','继续上次创作 ↗','text-button')}</aside>` : '';
    }
    function tools(){
      return `<div class="album-data-tools" aria-label="画册数据管理">${button('backup-export','备份整册','text-button')}${button('backup-open','导入备份','text-button')}${button('example-open','体验三幅示例','text-button')}</div>${recoveryView()}${(snapshot.warnings || []).length?`<p class="storage-notice" role="status">${snapshot.warnings.map(w=>esc(typeof w==='string'?w:w.message || '旧页面数据有变化，请先备份再导入合并。')).join('<br>')}</p>${button('legacy-export','下载旧存储原文','text-button')}`:''}`;
    }
    function error(error,copy){
      if(error?.code==='CONFLICT'){
        conflictCopy=copy || null;
        showModal(`<h2>另一页已经更新了这份内容</h2><p>当前修改没有覆盖已保存内容。可以重新载入；编辑内容也可以另存副本。</p>${button('storage-reload','重新载入已保存内容','primary')}${copy?button('storage-copy','另存为私密副本','secondary'):''}`,{className:host.hasHistoryDetail()?'history-confirm':''});
      }else toast(error?.name==='QuotaExceededError'?'设备空间不足，当前修改仍在页面，请先备份':error?.message || '保存未完成，请备份后重试');
    }
    async function exportBackup(){
      const value=await repo.exportBackup();jsonDownload(value,`你画我点-整册备份-${new Date().toISOString().slice(0,10)}.json`);toast('整册备份已生成，请保存到安全的位置');
    }
    function exportLegacy(){
      jsonDownload({format:'draw-my-meal-legacy-archive',createdAt:new Date().toISOString(),state:localStorage.getItem('draw-my-meal-v1'),papers:localStorage.getItem('draw-my-meal-papers-v1')},'你画我点-旧存储原文.json');
    }
    function openImport(){
      pending=null;
      showModal(`<h2>导入整册备份</h2><p>先核对内容，再与当前画册合并。现有作品不会被覆盖；新增作品默认仅自己可见。</p><label class="sheet-label" for="backup-file">选择 JSON 备份文件</label><input id="backup-file" type="file" accept="application/json,.json"><p id="backup-status" role="status">支持本应用导出的完整备份。</p>`);
    }
    async function inspect(value,example=false){
      pending=await repo.inspectBackup(value);
      pendingExample=example;
      const counts=pending.summary;
      showModal(`<h2>${example?'体验三幅示例':'确认合并备份'}</h2><p>${example?'加入“霸！”“薯条开花”和“可乐起飞”，以及一张可编辑餐纸。三幅均为笔迹作品，示例不是当前麦当劳菜单。':'文件已通过格式与关联检查。相同内容会去重；同 ID 的不同内容会另存，并修复关联。'}</p><div class="backup-summary"><span>${counts.artworks} 张作品</span><span>${counts.plans} 张餐纸</span><span>${counts.drafts} 份草稿</span></div><p>本次将新增 ${counts.addedArtworks} 张作品、${counts.addedPlans} 张餐纸、${counts.addedDrafts} 份草稿；去重 ${counts.deduplicated} 项，冲突另存 ${counts.conflicts} 项。</p><p class="info-strip">新增作品默认私密，历史公开许可仅作记录。你的现有画作、餐纸和公开状态保持不变。</p>${button('backup-merge',example?'加入示例，开始体验':'确认合并到我的画册','primary')}`,{label:'备份导入确认'});
    }
    function draftList(){
      const drafts=(snapshot.drafts || []).filter(d=>!host.activeDraft(d.draftId || d.id)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
      showModal(`<h2>接着上次的小快乐</h2><p>恢复草稿不会改变任何画作的公开状态。</p><div class="draft-list">${drafts.map(d=>button('draft-resume',`<strong>${d.kind==='paper'?'餐纸排版':'绘画草稿'}</strong><small>${esc(d.payload?.plan?.title || d.payload?.draft?.title || (d.payload?.draft?.mode==='duo'?'双人回合 · 答案继续隐藏':'今天的一画'))} · ${esc(new Date(d.updatedAt).toLocaleString('zh-CN'))}</small>`,'draft-option',`data-id="${esc(d.draftId || d.id)}"`)).join('')}</div>`);
    }
    document.addEventListener('change',async e=>{
      if(e.target.id!=='backup-file' || !e.target.files[0])return;
      const status=modalRoot.querySelector('#backup-status');status.textContent='正在检查备份…';
      try{const value=JSON.parse(await e.target.files[0].text());await inspect(value);}
      catch(err){pending=null;if(status.isConnected)status.textContent=err.message || '备份无法读取，未导入任何内容';}
    });
    document.addEventListener('click',async e=>{
      const el=e.target.closest('[data-action]');if(!el || el.disabled)return;
      const action=el.dataset.action;
      if(!['backup-export','backup-open','backup-merge','example-open','draft-list','draft-resume','storage-reload','storage-copy','legacy-export'].includes(action))return;
      if(busy){toast('正在处理，请稍候再操作');return;}
      busy=true;el.disabled=true;
      try{
        if(action==='backup-export')await exportBackup();
        else if(action==='legacy-export')exportLegacy();
        else if(action==='backup-open')openImport();
        else if(action==='example-open'){const response=await fetch('examples/original-trio.json');if(!response.ok)throw new Error('示例包未能载入，请重试');await inspect(await response.json(),true);}
        else if(action==='backup-merge' && pending){
          try{const result=await repo.mergeBackup(pending);pending=null;host.onSnapshot(result);host.showHistory();toast('已安全合并，相同内容不会重复加入');}
          catch(err){if(err.code!=='CONFLICT')throw err;await inspect(pending.parsed,pendingExample);toast('画册刚有更新，已重新核对，请确认新的合并摘要');}
        }
        else if(action==='draft-list')draftList();
        else if(action==='draft-resume'){const d=snapshot.drafts.find(x=>(x.draftId || x.id)===el.dataset.id);if(d)await host.resume(d);}
        else if(action==='storage-reload'){host.onSnapshot(await repo.readSnapshot());host.reloadConflict();}
        else if(action==='storage-copy' && conflictCopy){const copy=conflictCopy;conflictCopy=null;await copy();}
      }catch(err){error(err);}
      finally{busy=false;if(el.isConnected)el.disabled=false;}
    });
    return {sync,tools,recoveryView,error,exportBackup,exportLegacy};
  }};
})();
