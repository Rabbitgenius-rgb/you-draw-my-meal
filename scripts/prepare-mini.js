'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../miniprogram/lib/device.local.js');
// This generated module is always present for WeChat's static module resolver.
if(!fs.existsSync(file))fs.writeFileSync(file,'// 本机生成的联调配置，不提交 Git。\nmodule.exports={};\n',{mode:0o600});
