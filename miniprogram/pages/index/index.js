const R = require('../../lib/runtime');
const C = R.C;
const API=require('../../lib/api');
Page({
  data: { tab:'home', filter:'all', showStores:false, detail:null, stores:[], selectedMeal:'',city:'',keyword:'',storeBusy:false,storeError:'',connectionMessage:'正在检查连接…',loading:true,connected:false,categoryIndex:0,categories:['全部餐品'] },
  onLoad(options) { if(['home','gallery','history'].indexOf(options.tab)>=0)this.setData({tab:options.tab}); },
  onShow() { this.refresh();if(!this.booted){this.booted=true;this.connect();} },
  async connect(){
    this.liveStoreId='';this.setData({loading:true});this.refresh();
    try{const status=await API.status();this.setData({connected:status.connected,connectionMessage:status.message});if(status.connected && C.store(this.state.storeId))await this.loadMenu(C.store(this.state.storeId));}
    catch(error){this.setData({connectionMessage:error.message});}
    finally{this.setData({loading:false});this.refresh();}
  },
  async loadMenu(store){
    this.liveStoreId='';const result=await API.menu(store);
    if(!result.meals.length)throw new Error('该门店当前没有可用餐品，请换店或稍后重试。');
    this.state=C.withMenu(R.read(),store,result.meals);R.commit(this.state);this.liveStoreId=store.id;
    const categories=['全部餐品'].concat(Array.from(new Set(result.meals.map(m=>m.tag))));
    this.setData({selectedMeal:result.meals[0].id,city:store.area || this.data.city,categories,categoryIndex:1,connectionMessage:'菜单已从麦当劳 MCP 更新 · 到店自取'});
  },
  refresh() {
    this.state=R.read();
    const menu=this.liveStoreId===this.state.storeId && this.data.connected ? C.menu(this.state.storeId).map(m=>Object.assign({},m,{imageUrl:this.failedImages && this.failedImages.has(m.id)?'':C.imageUrl(m)})) : [];
    if(!menu.some(m=>m.id===this.data.selectedMeal))this.setData({selectedMeal:menu[0]?menu[0].id:''});
    this.picks=this.picks||{};
    const gallery=menu.map(m=>{
      const all=C.eligible(this.state.artworks,this.state.storeId,m.id);
      const art=all.find(a=>a.id===this.picks[m.id])||C.pickArtwork(this.state.artworks,this.state.storeId,m.id);
      this.picks[m.id]=art?art.id:null;
      return Object.assign({},m,{art:art||null,count:all.length,date:art?C.dateLabel(art.createdAt):''});
    });
    const artworks=this.state.artworks.filter(a=>this.data.filter==='all'||(this.data.filter==='public'?a.isPublic:!a.isPublic)).map(a=>Object.assign({},a,{date:C.dateLabel(a.createdAt),modeLabel:a.mode==='duo'?'双人猜画':'单人绘画'}));
    const visibleMenu=menu.filter(m=>!this.data.categoryIndex || m.tag===this.data.categories[this.data.categoryIndex]);
    if(visibleMenu.length && !visibleMenu.some(m=>m.id===this.data.selectedMeal))this.setData({selectedMeal:visibleMenu[0].id});
    this.setData({store:C.store(this.state.storeId)||{name:'选择今天的餐厅'},mode:this.state.mode,menu,visibleMenu,gallery,visibleGallery:gallery.filter(m=>!this.data.categoryIndex || m.tag===this.data.categories[this.data.categoryIndex]),artworks,total:this.state.artworks.length,publicCount:this.state.artworks.filter(a=>a.isPublic).length,mealCount:new Set(this.state.artworks.map(a=>a.mealId)).size});
  },
  onTab(e) { this.setData({tab:e.currentTarget.dataset.tab});this.refresh();wx.pageScrollTo({scrollTop:0,duration:0}); },
  onMode(e) { try {this.state.mode=e.currentTarget.dataset.mode;R.commit(this.state);this.refresh();}catch(_){R.toast('未能保存设置，请检查设备空间');} },
  onMeal(e) { this.setData({selectedMeal:e.currentTarget.dataset.meal}); },
  onCategory(e){this.setData({categoryIndex:Number(e.detail.value)});this.refresh();},
  onStart(e) {
    const mealId=e.currentTarget.dataset.meal||this.data.selectedMeal;
    if(!this.data.menu.some(m=>m.id===mealId)){R.toast('请先加载真实门店菜单');return;}
    getApp().globalData.draft={mealId,storeId:this.state.storeId,mealSnapshot:Object.assign({},C.meal(mealId)),storeSnapshot:Object.assign({},C.store(this.state.storeId)),mode:this.state.mode,strokes:[],redo:[],attempts:0,savedId:null};
    wx.navigateTo({url:'/pages/draw/draw'});
  },
  showStorePicker() {if(!this.data.connected){R.toast('请先在本机网页预览中连接麦当劳');return;}this.setData({showStores:true});},
  closeStorePicker() {this.setData({showStores:false});},
  onCity(e){this.setData({city:e.detail.value});},
  onKeyword(e){this.setData({keyword:e.detail.value});},
  async searchStores(){
    if(this.data.storeBusy)return;const city=this.data.city.trim(),keyword=this.data.keyword.trim();if(!city||!keyword){R.toast('请填写城市和位置关键词');return;}
    this.setData({storeBusy:true,storeError:'',stores:[]});
    try{const result=await API.stores(city,keyword);this.setData({stores:result.stores,storeError:result.stores.length?'':'没有找到门店，换个关键词试试。'});}
    catch(error){this.setData({storeError:error.message});}finally{this.setData({storeBusy:false});}
  },
  async onStore(e){
    if(this.data.storeBusy)return;const store=this.data.stores.find(s=>s.id===e.currentTarget.dataset.id);if(!store)return;
    this.setData({storeBusy:true,storeError:''});try{await this.loadMenu(store);this.setData({showStores:false});}catch(error){this.setData({storeError:error.message,connectionMessage:error.message});}finally{this.setData({storeBusy:false});this.refresh();}
  },
  onImageError(e){this.failedImages=this.failedImages || new Set();this.failedImages.add(e.currentTarget.dataset.meal);this.refresh();},
  onFilter(e) {this.setData({filter:e.currentTarget.dataset.filter});this.refresh();},
  onShuffle(e) {
    const mealId=e.currentTarget.dataset.meal;
    const next=C.pickArtwork(this.state.artworks,this.state.storeId,mealId,this.picks[mealId]);
    if(next)this.picks[mealId]=next.id;
    this.refresh();
    if(C.eligible(this.state.artworks,this.state.storeId,mealId).length===1)R.toast('这道餐品目前只有这一张公开画作');
  },
  onDetail(e) {
    const art=this.state.artworks.find(a=>a.id===e.currentTarget.dataset.id);
    if(art)this.setData({detail:Object.assign({},art,{date:C.dateLabel(art.createdAt),storeName:C.artStore(art).name,mealName:C.artMeal(art).name})});
  },
  closeDetail() {this.setData({detail:null});},
  onPrivacy() {
    const art=this.data.detail;
    const apply=()=>{try {const state=R.read();state.artworks=C.setPublic(state.artworks,art.id,!art.isPublic);R.commit(state);this.setData({detail:null});this.refresh();R.toast(art.isPublic?'已撤回，仅自己可见':'已允许公开，可去餐品画廊查看');}catch(_){R.toast('未能保存，请检查设备空间');}};
    if(art.isPublic){apply();return;}
    wx.showModal({title:'允许这张画公开展示？',content:'将关联「'+art.storeName+'」的「'+art.mealName+'」。可随时撤回。此原型仅在当前设备模拟展示。',confirmText:'同意公开',confirmColor:'#ce4335',success:r=>{if(r.confirm)apply();}});
  },
  onPreview() {wx.previewImage({urls:[this.data.detail.thumbnail]});},
  onDelete() {
    const art=this.data.detail;
    wx.showModal({title:'删除这张画？',content:'删除后无法恢复，也会立即移出公开展示。',confirmText:'确认删除',confirmColor:'#ce4335',success:r=>{
      if(!r.confirm)return;
      try {const state=R.read();state.artworks=state.artworks.filter(a=>a.id!==art.id);R.commit(state);wx.getFileSystemManager().unlink({filePath:art.thumbnail,fail:()=>{}});this.setData({detail:null});this.refresh();R.toast('画作已删除');}
      catch(_){R.toast('删除未完成，请重试');}
    }});
  },
  stop() {}
});
