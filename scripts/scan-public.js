#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const EXCLUDE=new Set(['node_modules','.git']);
const TEXT=/\.(?:js|cjs|mjs|json|md|txt|html|css|svg|wxml|wxss|yml|yaml)$|(?:^|\/)(?:LICENSE|NOTICE|\.gitignore|\.env\.example)$/i;
function scan(root){
  const findings=[],files=[],excludedGenerated=[];
  function finding(file,rule){findings.push({file,rule});}
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(EXCLUDE.has(entry.name))continue;const full=path.join(dir,entry.name),rel=path.relative(root,full).split(path.sep).join('/'),stat=fs.lstatSync(full);if(stat.isSymbolicLink()){finding(rel,'symbolic-link');continue;}if(entry.isDirectory()){walk(full);continue;}if(!entry.isFile()){finding(rel,'non-regular-file');continue;}const bytes=fs.readFileSync(full);
    if(rel==='miniprogram/lib/device.local.js'&&bytes.toString('utf8')==='// 本机生成的联调配置，不提交 Git。\nmodule.exports={};\n'){excludedGenerated.push(rel);continue;}
    files.push({path:rel,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    if(/(^|\/)\.env(?:$|\.)/.test(rel)&&rel!=='.env.example')finding(rel,'private-env-file');
    if(/(?:^|\/)(?:device\.local\.js|project\.private\.config\.json|\.phone-dev\.json|id_rsa|id_ed25519|\.DS_Store)$|(?:backup|private|before|jiahao|niulai|hao-abstract|film-reference|douyin-reference)/i.test(rel))finding(rel,'private-or-uncleared-file');
    if(/\.(?:pem|key|p12|pfx|sqlite|db|zip|mp4|mov)$/i.test(rel))finding(rel,'unexpected-sensitive-or-unreviewed-binary');
    if(!TEXT.test(rel))continue;const value=bytes.toString('utf8');
    for(const [rule,re] of [
      ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
      ['provider-key',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|live-)?[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})\b/],
      ['jwt-value',/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
      ['bearer-literal',/Bearer\s+(?!\$\{|YOUR_|fixture)[A-Za-z0-9_.-]{20,}/],
      ['private-host-path',/\/(?:Users|home)\/[A-Za-z0-9._-]+\/|\/private\/var\/folders\/|\/var\/folders\//],
      ['original-work-reference',/嘉豪|家豪|牛来|抖音|niulai|jiahao|豪！/],
      ['credential-url',/https?:\/\/[^\s/]+:[^\s/@]+@/]
    ])if(re.test(value)&&!(rule==='original-work-reference'&&rel==='scripts/scan-public.js'))finding(rel,rule);
    const assignments=value.matchAll(/\b(?:[A-Z_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)|token|apiKey|password|secret|deviceKey)\s*[:=]\s*['"]([^'"\r\n]{8,})['"]/g);
    for(const match of assignments)if(!/^(?:fixture|not-a-|unknown-secret-marker|\$\{|YOUR_|MCD_MCP_TOKEN)/.test(match[1]))finding(rel,'credential-assignment');
    if(rel==='.env.example'&&value.split(/\r?\n/).some(l=>/^\s*MCD_MCP_TOKEN\s*=\s*\S/.test(l)))finding(rel,'nonempty-env-example');
    if(rel==='mcp-config.example.json'){try{const config=JSON.parse(value),auth=config.mcpServers?.['mcd-mcp']?.headers?.Authorization;if(auth!=='Bearer ${MCD_MCP_TOKEN}')finding(rel,'config-not-placeholder-only');}catch(_){finding(rel,'invalid-example-json');}}
  }}
  walk(root);
  return {schema:1,scope:'candidate files only; no local credentials read; no values printed',files:files.sort((a,b)=>a.path.localeCompare(b.path)),excludedGenerated,findings,passed:findings.length===0};
}
if(require.main===module){const result=scan(path.resolve(process.argv[2]||path.join(__dirname,'..')));console.log(JSON.stringify({fileCount:result.files.length,passed:result.passed,findings:result.findings},null,2));process.exitCode=result.passed?0:1;}
module.exports={scan};
