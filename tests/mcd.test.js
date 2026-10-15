'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
const {McdService,normalizeMenu,unpack,readToken,safeError}=require('../server/mcd');
const {createServer}=require('../scripts/serve');
// Protocol fixtures are isolated tests; the app never loads these as fallback menus.
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
for(const enableJsonResponse of [true,false])test('官方 SDK 与本机 MCP 协议夹具往返：'+(enableJsonResponse?'JSON':'SSE'),async()=>{
  const calls=[];let authSeen=false;
  const mcp=new Server({name:'fixture-only',version:'1.0.0'},{capabilities:{tools:{}}});
  mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'query-nearby-stores',inputSchema:{type:'object',properties:{searchType:{type:'string'},beType:{type:'string'}}}},{name:'query-meals',inputSchema:{type:'object',properties:{orderType:{type:'number'},beType:{type:'number'}}}}]}));
  mcp.setRequestHandler(CallToolRequestSchema,async request=>{
    calls.push(request.params);
    const data=request.params.name==='query-nearby-stores'?[{storeCode:'1001',beCode:'2001',storeName:'协议测试门店',address:'夹具地址',businessStatus:true}]:{categories:[{name:'汉堡',meals:[{code:'3001'}]}],meals:{'3001':{name:'测试餐品',image:'https://example.com/meal.png',currentPrice:'1',withOrder:{private:'omit'}},'3002':{name:'无图餐品'}}};
    return {content:[{type:'text',text:JSON.stringify({success:true,code:200,data})}]};
  });
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=> 'fixture-session',enableJsonResponse});await mcp.connect(transport);
  const server=http.createServer(async(req,res)=>{authSeen=req.headers.authorization==='Bearer fixture-not-a-real-token';let body;if(req.method==='POST'){let raw='';for await(const c of req)raw+=c;body=JSON.parse(raw);}await transport.handleRequest(req,res,body);});
  const endpoint=await listen(server),service=new McdService({getToken:()=> 'fixture-not-a-real-token',endpoint,timeout:2000});
  try{
    assert.equal((await service.status()).connected,true);
    const stores=await service.stores('上海','地标');assert.equal(stores[0].id,'mcd:1001:1');assert.equal(stores[0].beCode,'2001');
    const menu=await service.menu(stores[0].storeCode,stores[0].beCode);assert.equal(menu[0].id,'mcd:1001:3001');assert.equal(menu[0].tag,'汉堡');assert.equal(menu[1].image,'');assert.equal(menu[0].currentPrice,undefined);assert.equal(menu[0].withOrder,undefined);
    assert.equal(calls[0].arguments.searchType,'2');assert.equal(calls[0].arguments.beType,'1');assert.equal(calls[1].arguments.beType,1);assert.equal(calls[1].arguments.orderType,1);assert.equal(authSeen,true);
    await assert.rejects(service.call('create-order',{}),e=>e.code==='FORBIDDEN');assert.equal(calls.length,2);
  }finally{await service.close();await mcp.close();await close(server);}
});
test('错误、缺失 Token 和非 HTTPS 图片不会伪装成真实查询成功',async()=>{
  let touched=false;const service=new McdService({getToken:()=>'',endpoint:'http://127.0.0.1:1'});
  service.ready=async()=>{touched=true;};assert.equal((await service.status()).configured,false);assert.equal(touched,false);
  assert.throws(()=>unpack({isError:true,content:[{type:'text',text:'private-upstream-message'}]}),e=>!e.message.includes('private-upstream'));
  assert.throws(()=>unpack({structuredContent:{success:false,code:401,message:'secret'}}),e=>!e.message.includes('secret'));
  assert.equal(normalizeMenu({meals:{a:{name:'菜品',image:'javascript:alert(1)'}}},'1')[0].image,'');
  assert.equal(safeError(Object.assign(new Error('secret-token'),{code:401})).code,'AUTH');
  assert.equal(safeError(new Error('secret-token')).message.includes('secret-token'),false);
});
test('本机 API 配置防跨站、私密文件不提供、Token 保存但永不返回',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meal-mcp-test-')),envFile=path.join(dir,'.env.local');
  const service={close:async()=>{},status:async()=>({configured:!!readToken(envFile),connected:false,message:'fixture-only'}),stores:async()=>[],menu:async()=>[]};
  const server=createServer({service,envFile}),base=await listen(server);
  try{
    const status=await (await fetch(base+'/api/mcd/status')).json();assert.equal(status.configured,false);
    let response=await fetch(base+'/api/mcd/config',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json','X-Setup-Nonce':status.setupNonce},body:JSON.stringify({token:'fixture-only-secret'})});assert.equal(response.status,403);assert.equal(fs.existsSync(envFile),false);
    response=await fetch(base+'/api/mcd/config',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Setup-Nonce':status.setupNonce},body:JSON.stringify({token:'fixture-only-secret'})});assert.equal(response.status,200);assert.equal((await response.text()).includes('fixture-only-secret'),false);assert.equal(readToken(envFile),'fixture-only-secret');assert.equal(fs.statSync(envFile).mode & 0o777,0o600);
    for(const url of ['/.env.local','/server/mcd.js','/miniprogram/lib/device.local.js','/miniprogram/lib//device.local.js','/miniprogram/lib/%2fdevice.local.js','/miniprogram%2flib%2fdevice.local.js','/miniprogram/Lib/DEVICE.LOCAL.JS','/node_modules/@modelcontextprotocol/sdk/package.json','/api/mcd/call']){response=await fetch(base+url);assert.ok([403,404].includes(response.status));assert.equal((await response.text()).includes('fixture-only-secret'),false);}
    const hostStatus=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/mcd/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(hostStatus,403);
  }finally{await close(server);fs.rmSync(dir,{recursive:true,force:true});}
});
