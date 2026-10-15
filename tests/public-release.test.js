'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {indexedDB}=require('fake-indexeddb'),R=require('../web/repository'),{buildPublicExamples,canonical}=require('../scripts/make-public-examples'),{scan}=require('../scripts/scan-public');
const seedPath=['../web/examples/ba-strokes.json','../public-materials/ba-strokes.json'].map(p=>path.join(__dirname,p)).find(p=>fs.existsSync(p)),seed=JSON.parse(fs.readFileSync(seedPath,'utf8'));
test('公开示例只含获准原笔迹与新原创笔迹，无历史图片/草稿/真实菜单',async t=>{
  const pack=buildPublicExamples(seed);assert.equal(pack.data.artworks.length,3);assert.deepEqual(pack.data.versions[0].payload.strokes,seed.strokes);assert.equal(seed.strokes.length,8);
  assert.deepEqual(pack.data.versions.map(v=>v.payload.title),['霸！','薯条开花','可乐起飞']);assert.ok(pack.data.artworks.every(a=>a.isPublic===false&&a.consentAt===null));
  for(const key of ['assets','drafts','legacyArchives'])assert.deepEqual(pack.data[key],[]);assert.deepEqual(pack.data.catalog,{stores:[],menus:{}});
  const repo=R.create({indexedDB,name:'public-example-test-'+Date.now(),storage:{getItem:()=>null},broadcast:false});t.after(()=>repo.close());
  await repo.mergeBackup(await repo.inspectBackup(pack));const after=await repo.readSnapshot();assert.equal(after.state.artworks.length,3);assert.equal((await repo.resolvePaper(after.plans[0])).missing.length,0);assert.equal(after.state.catalog.stores.length,0);
  const again=await repo.inspectBackup(pack);assert.equal(again.summary.addedArtworks,0);assert.equal(again.summary.addedPlans,0);assert.equal(again.summary.conflicts,0);
});
test('公开示例重复生成保持内容哈希、版本引用与原笔迹一致',()=>{
  const one=buildPublicExamples(seed),two=buildPublicExamples(seed);assert.equal(canonical(one),canonical(two));
  for(const ref of one.data.plans[0].refs)assert.ok(one.data.versions.some(v=>v.id===ref.versionId&&v.artId===ref.artId));
});
test('敏感信息扫描拦截凭证/私密文件/路径/符号链接且不输出值',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-scan-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const marker='ghp_'+'a'.repeat(36);fs.writeFileSync(path.join(dir,'bad.js'),'const x="'+marker+'";');fs.writeFileSync(path.join(dir,'.env.local'),'MCD_MCP_TOKEN=fixture');
  fs.writeFileSync(path.join(dir,'notes.md'),'/'+['Users','fixture','private-project'].join('/'));fs.symlinkSync(path.join(dir,'bad.js'),path.join(dir,'link.js'));
  const result=scan(dir);assert.equal(result.passed,false);assert.ok(result.findings.some(f=>f.rule==='provider-key'));assert.ok(result.findings.some(f=>f.rule==='private-env-file'));assert.ok(result.findings.some(f=>f.rule==='private-host-path'));assert.ok(result.findings.some(f=>f.rule==='symbolic-link'));assert.equal(JSON.stringify(result).includes(marker),false);
});
test('空环境示例与精确 MCP 占位符通过，实际值配置被拒绝',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-clean-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'.env.example'),'MCD_MCP_TOKEN=\n');const file=path.join(dir,'mcp-config.example.json'),config={mcpServers:{'mcd-mcp':{headers:{Authorization:'Bearer ${MCD_MCP_TOKEN}'}}}};fs.writeFileSync(file,JSON.stringify(config));assert.equal(scan(dir).passed,true);
  config.mcpServers['mcd-mcp'].headers.Authorization='Bearer fixture-config-value';fs.writeFileSync(file,JSON.stringify(config));assert.ok(scan(dir).findings.some(f=>f.rule==='config-not-placeholder-only'));
});
