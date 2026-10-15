const {apiBase,deviceKey}=require('./config');
function request(path,params){
  const query=Object.keys(params || {}).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(params[k] || '')).join('&');
  return new Promise((resolve,reject)=>wx.request({url:apiBase+'/api/mcd/'+path+(query?'?'+query:''),method:'GET',timeout:45000,header:deviceKey?{'X-Meal-Device-Key':deviceKey}:{},
    success:r=>r.statusCode===200?resolve(r.data):reject(new Error(r.data && r.data.error && r.data.error.message || '麦当劳查询未成功，请重试')),
    fail:()=>reject(new Error('本机服务未连接，请检查后端地址和网络。'))
  }));
}
module.exports={status:()=>request('status'),stores:(city,keyword)=>request('stores',{city,keyword}),menu:store=>request('menu',{storeCode:store.storeCode,beCode:store.beCode})};
