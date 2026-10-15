const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name.startsWith('.')||['node_modules','test-results','artifacts'].includes(e.name)?[]:e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const all=files(root);let count=0;
for(const file of all){
  if(file.endsWith('.js')){const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status){process.stderr.write(r.stderr);process.exit(1);}count++;}
  if(file.endsWith('.json'))JSON.parse(fs.readFileSync(file,'utf8'));
}
const app=JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json')));
for(const page of app.pages)for(const ext of ['.js','.json','.wxml'])if(!fs.existsSync(path.join(root,'miniprogram',page+ext)))throw new Error('Missing page: '+page+ext);
console.log(`${count} JavaScript files parsed; JSON and all declared mini-program pages checked.`);
