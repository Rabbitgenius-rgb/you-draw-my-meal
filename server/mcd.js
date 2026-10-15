'use strict';
const fs=require('node:fs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const ENDPOINT='https://mcp.mcd.cn';
const ALLOWED=['query-nearby-stores','query-meals'];
class AppError extends Error {constructor(code,message,status=502){super(message);this.code=code;this.status=status;}}
function safeError(error){
  if(error instanceof AppError)return error;
  const code=error && (error.code || error.status);
  if(code===401 || code===403 || error && error.constructor.name==='UnauthorizedError')return new AppError('AUTH','Token 无效或已过期，请重新配置。',401);
  if(code===429)return new AppError('RATE_LIMIT','麦当劳查询较频繁，请稍后重试。',429);
  return new AppError('UPSTREAM','暂时无法连接麦当劳 MCP，请检查网络后重试。');
}
function readToken(file){
  try {const line=fs.readFileSync(file,'utf8').split(/\r?\n/).find(s=>/^\s*MCD_MCP_TOKEN\s*=/.test(s));if(line)return line.slice(line.indexOf('=')+1).trim().replace(/^(['"])(.*)\1$/,'$2');}catch(_){}
  return (process.env.MCD_MCP_TOKEN || '').trim();
}
function unpack(result){
  if(result.isError)throw new AppError('TOOL_ERROR','麦当劳查询未成功，请检查 Token、门店或查询条件。');
  let value=result.structuredContent;
  if(!value)for(const item of result.content || []){if(item.type!=='text')continue;try{value=JSON.parse(item.text.replace(/^```(?:json)?\s*|\s*```$/g,''));break;}catch(_){}}
  if(!value || typeof value!=='object')throw new AppError('DATA','麦当劳返回的数据格式暂不支持。');
  if(value.success===false || value.code && ![0,200,'0','200'].includes(value.code))throw new AppError('QUERY','麦当劳未返回可用结果，请检查查询条件或稍后重试。');
  return Object.prototype.hasOwnProperty.call(value,'data') ? value.data : value;
}
const string=value=>value==null?'':String(value).trim();
function code(value){const v=string(value);if(!/^[A-Za-z0-9_-]{1,80}$/.test(v))throw new AppError('INPUT','门店或餐品编码无效。',400);return v;}
function image(value){try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password ? url.href : '';}catch(_){return '';}}
function normalizeStores(data,city){
  if(!Array.isArray(data))throw new AppError('DATA','麦当劳门店数据格式暂不支持。');
  return data.filter(s=>s && s.storeCode && s.storeName).map(s=>({id:'mcd:'+code(s.storeCode)+':1',source:'mcd',storeCode:code(s.storeCode),beCode:s.beCode?code(s.beCode):'',name:string(s.storeName),area:city,address:string(s.address),note:s.businessStatus===false?'当前非营业时段':'到店自取',businessStatus:s.businessStatus!==false}));
}
function normalizeMenu(data,storeCode){
  if(!data || !data.meals || typeof data.meals!=='object' || Array.isArray(data.meals))throw new AppError('DATA','麦当劳菜单数据格式暂不支持。');
  const tags=new Map();for(const category of data.categories || [])for(const entry of category.meals || []){const id=string(typeof entry==='object'?entry.code:entry);if(!tags.has(id))tags.set(id,string(category.name));}
  const aliases={'板烧鸡腿堡':['板烧','鸡腿堡','汉堡'],'薯条':['炸薯条','中薯','大薯','小薯'],'麦乐鸡':['鸡块','炸鸡块','麦乐鸡块'],'可乐':['可口可乐','快乐水'],'可口可乐':['可乐','快乐水']};
  return Object.entries(data.meals).filter(([,m])=>m && m.name).map(([key,m])=>{const mealCode=code(m.code || key),name=string(m.name);return {id:'mcd:'+storeCode+':'+mealCode,code:mealCode,source:'mcd',name,alias:[name].concat(aliases[name]||[]),tag:tags.get(mealCode)||'门店餐品',image:image(m.image)};});
}
function adaptArgs(schema,args){
  const out={};for(const [key,value] of Object.entries(args)){const property=schema && schema.properties && schema.properties[key];out[key]=property && (property.type==='string' || property.enum && property.enum.every(x=>typeof x==='string')) ? String(value) : value;}return out;
}
class McdService {
  constructor({getToken,endpoint=ENDPOINT,timeout=15000}){this.getToken=getToken;this.endpoint=endpoint;this.timeout=timeout;this.token='';this.client=null;this.pending=null;this.schemas=new Map();}
  async close(){const client=this.client;this.client=null;this.schemas.clear();if(client)await client.close().catch(()=>{});}
  async ready(){
    const token=this.getToken();if(!token)throw new AppError('NOT_CONFIGURED','请先在本机预览中连接麦当劳 MCP。',503);
    if(this.pending){await this.pending;return this.ready();}if(this.client && token===this.token)return this.client;
    this.pending=(async()=>{
      await this.close();this.token=token;
      const client=new Client({name:'draw-my-meal',version:'0.2.0'},{capabilities:{}});client.onerror=()=>{};
      const transport=new StreamableHTTPClientTransport(new URL(this.endpoint),{
        requestInit:{headers:{Authorization:'Bearer '+token},redirect:'error'},
        fetch:(url,init={})=>fetch(url,{...init,signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(this.timeout)]):AbortSignal.timeout(this.timeout)}),
        reconnectionOptions:{maxRetries:0,maxReconnectionDelay:1000,initialReconnectionDelay:1000,reconnectionDelayGrowFactor:1}
      });
      try{
        await client.connect(transport,{timeout:this.timeout});
        const tools=[];let cursor;do{const page=await client.listTools(cursor?{cursor}:undefined,{timeout:this.timeout});tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
        for(const name of ALLOWED){const tool=tools.find(t=>t.name===name);if(!tool)throw new AppError('TOOLS','当前麦当劳 MCP 未开放门店或菜单查询工具。');this.schemas.set(name,tool.inputSchema);}
        this.client=client;return client;
      }catch(error){await client.close().catch(()=>{});throw safeError(error);}
    })();try{return await this.pending;}finally{this.pending=null;}
  }
  async status(){if(!this.getToken())return {configured:false,connected:false,message:'连接麦当劳后，选择真实门店和餐品。'};try{await this.ready();return {configured:true,connected:true,message:'已连接麦当劳 MCP'};}catch(error){const e=safeError(error);return {configured:true,connected:false,message:e.message,code:e.code};}}
  async call(name,args){
    if(!ALLOWED.includes(name))throw new AppError('FORBIDDEN','此应用仅支持门店与菜单查询。',403);
    const client=await this.ready();try{return unpack(await client.callTool({name,arguments:adaptArgs(this.schemas.get(name),args)},undefined,{timeout:this.timeout}));}catch(error){const e=safeError(error);if(!(error instanceof AppError))await this.close();throw e;}
  }
  async stores(city,keyword){if(!city || !keyword || city.length>40 || keyword.length>100)throw new AppError('INPUT','请填写城市和位置关键词。',400);return normalizeStores(await this.call('query-nearby-stores',{searchType:2,beType:1,city,keyword}),city);}
  async menu(storeCode,beCode){storeCode=code(storeCode);const args={storeCode,orderType:1,beType:1};if(beCode)args.beCode=code(beCode);return normalizeMenu(await this.call('query-meals',args),storeCode);}
}
module.exports={McdService,AppError,safeError,readToken,unpack,normalizeStores,normalizeMenu,adaptArgs};
