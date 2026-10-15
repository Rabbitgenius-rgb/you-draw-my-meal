'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {McdService,AppError,safeError,readToken}=require('../server/mcd');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
function createServer({service,envFile=path.join(root,'.env.local')}={}){
  service=service || new McdService({getToken:()=>readToken(envFile)});
  const setupNonce=crypto.randomBytes(24).toString('hex');
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host || '';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw new AppError('HOST','仅允许本机访问。',403);
      if(req.headers.origin && req.headers.origin!=='http://'+host)throw new AppError('ORIGIN','不允许跨站访问。',403);
      const url=new URL(req.url,'http://'+host),pathname=decodeURIComponent(url.pathname);
      if(pathname.startsWith('/api/')){
        if(req.method==='GET' && pathname==='/api/mcd/status')return json(res,200,{...await service.status(),setupNonce});
        if(req.method==='POST' && pathname==='/api/mcd/config'){
          if(req.headers.origin!=='http://'+host || req.headers['x-setup-nonce']!==setupNonce || !/^application\/json\b/.test(req.headers['content-type']||''))throw new AppError('ORIGIN','请从本机预览页面保存配置。',403);
          let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>16384)throw new AppError('INPUT','Token 过长，请检查粘贴内容。',400);}
          let body;try{body=JSON.parse(raw);}catch(_){throw new AppError('INPUT','配置格式无效。',400);}
          const token=typeof body.token==='string'?body.token.trim().replace(/^Bearer\s+/i,''):'';
          if(!token || /[\r\n\x00-\x20]/.test(token))throw new AppError('INPUT','请粘贴完整 Token，不要包含空格或换行。',400);
          // Never echo, log or return this value. This path is outside the static allowlist.
          const temp=envFile+'.tmp';fs.writeFileSync(temp,'# 本机后端配置，请勿提交或分享。\nMCD_MCP_TOKEN='+token+'\n',{mode:0o600});fs.renameSync(temp,envFile);fs.chmodSync(envFile,0o600);
          await service.close();return json(res,200,{...await service.status(),setupNonce});
        }
        if(req.method!=='GET')throw new AppError('METHOD','不支持此请求。',405);
        if(pathname==='/api/mcd/stores')return json(res,200,{stores:await service.stores((url.searchParams.get('city')||'').trim(),(url.searchParams.get('keyword')||'').trim())});
        if(pathname==='/api/mcd/menu')return json(res,200,{meals:await service.menu(url.searchParams.get('storeCode'),url.searchParams.get('beCode'))});
        throw new AppError('NOT_FOUND','接口不存在。',404);
      }
      if(req.method!=='GET' && req.method!=='HEAD')throw new AppError('METHOD','不支持此请求。',405);
      if(pathname==='/'){res.writeHead(302,{Location:'/web/index.html'});return res.end();}
      const target=path.resolve(root,'.'+pathname);
      if(!target.startsWith(root+path.sep) || pathname.split('/').some(p=>p.startsWith('.')) || target.toLowerCase()===path.join(root,'miniprogram/lib/device.local.js').toLowerCase() || !['web','miniprogram'].includes(pathname.split('/')[1]))throw new AppError('FORBIDDEN','Forbidden',403);
      const buffer=await fs.promises.readFile(target).catch(()=>{throw new AppError('NOT_FOUND','Not found',404);});
      res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:buffer);
    }catch(error){const e=safeError(error);json(res,e.status,{error:{code:e.code,message:e.message}});}
  });
  server.on('close',()=>service.close());return server;
}
if(require.main===module){const port=Number(process.env.PORT||4173);createServer().listen(port,'127.0.0.1',()=>console.log('你画我点预览 http://127.0.0.1:'+port));}
module.exports={createServer};
