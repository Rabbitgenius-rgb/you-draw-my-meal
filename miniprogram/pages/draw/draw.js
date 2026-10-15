const R=require('../../lib/runtime'), C=R.C;
Page({
  data:{colors:C.COLORS,color:C.COLORS[0],brush:.011,sizes:[.006,.011,.022],erase:false,hasInk:false,canUndo:false,canRedo:false,referenceVisible:true,showSave:false,saving:false,title:'',allowPublic:false},
  onLoad(){
    this.draft=getApp().globalData.draft;
    if(!this.draft){wx.reLaunch({url:'/pages/index/index'});return;}
    this.setData({meal:Object.assign({},C.artMeal(this.draft),{imageUrl:C.imageUrl(C.artMeal(this.draft))}),store:C.artStore(this.draft),mode:this.draft.mode,title:'今天的'+C.artMeal(this.draft).name});
  },
  onReady(){if(this.draft)this.initCanvas();},
  onResize(){if(this.canvas)this.initCanvas();},
  initCanvas(){
    this.createSelectorQuery().select('#drawCanvas').fields({node:true,size:true}).select('#drawCanvas').boundingClientRect().exec(r=>{
      if(!r[0]||!r[0].node)return;
      this.canvas=r[0].node;this.width=r[0].width;this.height=r[0].height;this.rect=r[1];
      const ratio=Math.min(wx.getWindowInfo().pixelRatio||1,3);
      this.canvas.width=this.width*ratio;this.canvas.height=this.height*ratio;
      this.ctx=this.canvas.getContext('2d');this.ctx.scale(ratio,ratio);this.refreshDrawing();
    });
  },
  point(t){return {x:Math.max(0,Math.min(1,(typeof t.x==='number'?t.x:t.clientX-this.rect.left)/this.width)),y:Math.max(0,Math.min(1,(typeof t.y==='number'?t.y:t.clientY-this.rect.top)/this.height))};},
  onTouchStart(e){
    if(!this.ctx||this.data.showSave||this.isDrawing)return;
    this.isDrawing=true;this.draft.strokes.push({color:this.data.color,width:this.data.erase?this.data.brush*3:this.data.brush,erase:this.data.erase,points:[this.point(e.touches[0])]});this.draft.redo=[];this.refreshDrawing();
  },
  onTouchMove(e){
    if(!this.isDrawing||!e.touches.length)return;
    const s=this.draft.strokes[this.draft.strokes.length-1],p=this.point(e.touches[0]),last=s.points[s.points.length-1];
    if(Math.hypot(p.x-last.x,p.y-last.y)<.002||s.points.length>5000)return;
    s.points.push(p);this.redraw();
  },
  onTouchEnd(){this.isDrawing=false;},
  redraw(){if(this.ctx)C.drawStrokes(this.ctx,this.draft.strokes,this.width,this.height);},
  refreshDrawing(){this.redraw();this.setData({hasInk:this.draft.strokes.length>0,canUndo:this.draft.strokes.length>0,canRedo:this.draft.redo.length>0});},
  onColor(e){this.setData({color:e.currentTarget.dataset.color,erase:false});},
  onEraser(){this.setData({erase:!this.data.erase});},
  onSize(e){this.setData({brush:Number(e.currentTarget.dataset.size)});},
  onReference(){this.setData({referenceVisible:!this.data.referenceVisible});},
  onUndo(){if(this.draft.strokes.length){this.draft.redo.push(this.draft.strokes.pop());this.refreshDrawing();}},
  onRedo(){if(this.draft.redo.length){this.draft.strokes.push(this.draft.redo.pop());this.refreshDrawing();}},
  onClear(){if(this.draft.strokes.length)wx.showModal({title:'重新画一张？',content:'清空当前画布，已经保存的作品不受影响。',confirmText:'清空画布',confirmColor:'#ce4335',success:r=>{if(r.confirm){this.draft.strokes=[];this.draft.redo=[];this.refreshDrawing();}}});},
  async prepare(){
    if(!this.draft.strokes.some(s=>!s.erase&&s.points.length)){R.toast('先在画布上留下一笔吧');return false;}
    try{this.draft.previewFile=await R.preparePreview(this.canvas);return true;}catch(_){R.toast('画作预览生成失败，请重试');return false;}
  },
  async onDone(){
    if(this.data.saving)return;this.setData({saving:true});const ok=await this.prepare();this.setData({saving:false});if(!ok)return;
    if(this.draft.mode==='duo')wx.navigateTo({url:'/pages/guess/guess'});
    else this.setData({showSave:true,allowPublic:false,previewFile:this.draft.previewFile});
  },
  onTitle(e){this.setData({title:e.detail.value});},
  onConsent(e){this.setData({allowPublic:e.detail.value===true});},
  closeSave(){if(!this.data.saving)this.setData({showSave:false});},
  async onSave(){
    if(this.data.saving)return;this.setData({saving:true});
    try{await R.saveDraft(this.draft,this.data.title,this.data.allowPublic);R.album();}
    catch(_){R.toast('未能保存，请检查设备空间后重试');}finally{this.setData({saving:false});}
  },
  onBack(){
    const back=()=>{getApp().globalData.draft=null;wx.navigateBack();};
    if(this.draft.strokes.length&&!this.draft.savedId)wx.showModal({title:'这张画还没保存',content:'返回后会丢弃本轮画作。可以取消返回，先保存这张画。',confirmText:'放弃本轮',confirmColor:'#ce4335',success:r=>{if(r.confirm)back();}});else back();
  },
  onImageError(){this.setData({'meal.imageUrl':''});},
  stop(){}
});
