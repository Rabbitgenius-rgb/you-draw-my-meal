const R=require('../../lib/runtime'), C=R.C;
Page({
  data:{stage:'handoff',guess:'',feedback:'',attempts:0,correct:false,showSave:false,saving:false,allowPublic:false},
  onLoad(){this.draft=getApp().globalData.draft;if(!this.draft||!this.draft.previewFile){wx.reLaunch({url:'/pages/index/index'});return;}this.setData({previewFile:this.draft.previewFile,title:'今天的'+C.artMeal(this.draft).name});},
  onStartGuess(){this.setData({stage:'guess'});},
  onGuessInput(e){this.setData({guess:e.detail.value});},
  onGuess(){
    if(!this.data.guess.trim()){R.toast('先写下你的猜想吧');return;}
    this.draft.attempts++;this.setData({attempts:this.draft.attempts});
    if(C.isCorrect(this.data.guess,this.draft.mealId,this.draft.mealSnapshot))this.reveal(true);else this.setData({feedback:'还差一点！换个名字试试，或直接揭晓。'});
  },
  onReveal(){this.reveal(false);},
  reveal(correct){this.setData({stage:'reveal',correct,meal:Object.assign({},C.artMeal(this.draft),{imageUrl:C.imageUrl(C.artMeal(this.draft))}),store:C.artStore(this.draft)});wx.pageScrollTo({scrollTop:0,duration:0});},
  onResume(){wx.navigateBack();},
  openSave(){if(this.draft.savedId){R.album();return;}this.setData({showSave:true,allowPublic:false});},
  closeSave(){if(!this.data.saving)this.setData({showSave:false});},
  onTitle(e){this.setData({title:e.detail.value});},
  onConsent(e){this.setData({allowPublic:e.detail.value===true});},
  async onSave(){if(this.data.saving)return;this.setData({saving:true});try{await R.saveDraft(this.draft,this.data.title,this.data.allowPublic);R.album();}catch(_){R.toast('未能保存，请检查设备空间后重试');}finally{this.setData({saving:false});}},
  async onSwap(){if(this.data.saving)return;this.setData({saving:true});try{await R.saveDraft(this.draft,'今天的'+C.artMeal(this.draft).name,false);getApp().globalData.draft=null;wx.reLaunch({url:'/pages/index/index'});}catch(_){R.toast('本轮未能保存，请检查设备空间后重试');}finally{this.setData({saving:false});}},
  onEnd(){wx.showModal({title:'先结束这一轮？',content:'可以直接揭晓并保存画作，也可以回到画布继续画。',cancelText:'继续猜',confirmText:'揭晓答案',confirmColor:'#ce4335',success:r=>{if(r.confirm)this.reveal(false);}});},
  onImageError(){this.setData({'meal.imageUrl':''});},
  stop(){}
});
