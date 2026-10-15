const C = require('./core');
const adapter = { getItem: key => wx.getStorageSync(key), setItem: (key, value) => wx.setStorageSync(key, value) };
function read() { return C.readState(adapter); }
function commit(state) { C.persist(adapter, state); }
function toast(title) { wx.showToast({ title, icon:'none' }); }
function preparePreview(canvas) {
  return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvas, fileType:'png', success:r=>resolve(r.tempFilePath), fail:reject }));
}
async function saveDraft(draft, title, isPublic) {
  if (draft.savedId) return read().artworks.find(a=>a.id===draft.savedId);
  const art = C.makeArtwork(Object.assign({},draft,{title}));
  if (!draft.previewFile) throw new Error('画作预览尚未生成，请重试');
  const dest = wx.env.USER_DATA_PATH + '/' + art.id + '.png';
  await new Promise((resolve,reject)=>wx.getFileSystemManager().copyFile({srcPath:draft.previewFile,destPath:dest,success:resolve,fail:reject}));
  art.thumbnail=dest;
  const state=read();
  let artworks=[art].concat(state.artworks);
  if(isPublic)artworks=C.setPublic(artworks,art.id,true);
  try { commit(Object.assign({},state,{artworks})); }
  catch(error) { wx.getFileSystemManager().unlink({filePath:dest,fail:()=>{}}); throw error; }
  draft.savedId=art.id;
  return art;
}
function album() { getApp().globalData.draft=null;wx.reLaunch({url:'/pages/index/index?tab=history'}); }
module.exports={C,read,commit,toast,preparePreview,saveDraft,album};
