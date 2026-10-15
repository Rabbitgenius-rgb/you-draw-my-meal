(() => {
  'use strict';
  window.MealImageImport = {create(host) {
    const {core:C,button,esc,modalRoot,toast} = host;
    let pending=null,revision=0;
    function openReplacement(id) {
      const art=host.artwork(id);
      if (!art || art.kind!=='image') {toast('这张画不能替换图片');return;}
      pending={replaceId:id,imageSource:'',original:JSON.parse(JSON.stringify(art))};revision++;
      host.showModal(`<h2>替换画作图片</h2><p>${esc(art.title)} · ${esc(C.artMeal(art).name)}</p><p class="micro-note">作品名称、门店、餐品和公开状态会保留。</p><label class="sheet-label" for="import-file">选择新的画作图片</label><input id="import-file" type="file" accept="image/png,image/jpeg"><img id="import-preview" class="save-preview" alt="待替换的画作" hidden><p id="import-status" role="status"></p>${button('confirm-import','保存新图片','primary','disabled')}<p class="micro-note">支持 PNG、JPG，单张不超过 8 MB；原文件保持不变，画册保存轻量副本。</p>`,{className:'history-confirm',label:'替换画作图片'});
    }
    function open() {
      const storeId=host.storeId(),store=C.store(storeId),meals=C.menu(storeId);
      if (!store || !meals.length) {toast('先在「今天画」选择门店并加载餐品，再导入图片');return;}
      pending={storeId,imageSource:''};revision++;
      host.showModal(`<h2>把图片放进画册</h2><p>${esc(store.name)} · 导入后仅自己可见</p><label class="sheet-label" for="import-file">选择画作图片</label><input id="import-file" type="file" accept="image/png,image/jpeg"><img id="import-preview" class="save-preview" alt="待导入的画作" hidden><p id="import-status" role="status"></p><label class="sheet-label" for="import-title">作品名称</label><input id="import-title" class="title-input" maxlength="30" placeholder="例如：今天的薯条"><label class="sheet-label" for="import-meal">对应餐品</label><select id="import-meal" class="title-input">${meals.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select><label class="consent-line"><input id="import-embedded-title" type="checkbox" checked><span>图片中已包含标题<small>餐纸默认不重复添加，可在排版中另行开启。</small></span></label>${button('confirm-import','加入我的画册 ↗','primary','disabled')}<p class="micro-note">支持 PNG、JPG，单张不超过 8 MB；画册保存轻量副本。公开展示需在作品详情中单独允许。</p>`);
    }
    async function readFile(file) {
      if (!pending || !file)return;
      const ticket=++revision,context=pending,status=modalRoot.querySelector('#import-status'),save=modalRoot.querySelector('[data-action="confirm-import"]');
      pending.imageSource='';save.disabled=true;modalRoot.querySelector('#import-preview').hidden=true;
      try {
        if (!['image/png','image/jpeg'].includes(file.type))throw new Error('请选择 PNG 或 JPG 图片');
        if (file.size>8*1024*1024)throw new Error('图片超过 8 MB，请选择较小的图片');
        status.textContent='正在读取画作…';
        const source=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败，请重新选择'));reader.readAsDataURL(file);});
        const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('图片无法打开，请重新选择'));img.src=source;});
        // Keep the original file untouched; store a compact album copy in this device.
        const ratio=Math.min(1,1000/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
        const ctx=canvas.getContext('2d');ctx.fillStyle=C.PAPER;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
        if (ticket!==revision || context!==pending || !status.isConnected)return;
        pending.imageSource=canvas.toDataURL('image/jpeg',.94);
        const preview=modalRoot.querySelector('#import-preview');preview.src=pending.imageSource;preview.hidden=false;
        const title=modalRoot.querySelector('#import-title');if (title && !title.value.trim())title.value=file.name.replace(/\.[^.]+$/,'').slice(0,30);
        status.textContent='图片已就绪';save.disabled=false;
      } catch(error) {if (ticket===revision && status.isConnected)status.textContent=error.message;}
    }
    async function save() {
      if (!pending?.imageSource)return;
      const context=pending,saveButton=modalRoot.querySelector('[data-action="confirm-import"]');if(saveButton)saveButton.disabled=true;
      try {
        if (pending.replaceId) {
          const id=pending.replaceId;
          if (!await host.replace(id,pending.imageSource,pending.original))return;
          if(context===pending){pending=null;revision++;if(saveButton?.isConnected)host.finish(id);}toast('画作图片已更新');return;
        }
        const art=C.makeArtwork({kind:'image',...pending,mealId:modalRoot.querySelector('#import-meal').value,title:modalRoot.querySelector('#import-title').value,titleEmbedded:modalRoot.querySelector('#import-embedded-title').checked});
        if (!await host.add(art))return;
        if(context===pending){pending=null;revision++;if(saveButton?.isConnected)host.finish();}toast('图片已加入画册，仅自己可见');
      } catch(error) {toast(error.message);}
      finally{if(context===pending && saveButton?.isConnected)saveButton.disabled=false;}
    }
    document.addEventListener('change',e=>{if(e.target.id==='import-file')readFile(e.target.files[0]);});
    document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;if(el.dataset.action==='import-image')open();else if(el.dataset.action==='replace-image')openReplacement(el.dataset.id);else if(el.dataset.action==='confirm-import')save();});
  }};
})();
