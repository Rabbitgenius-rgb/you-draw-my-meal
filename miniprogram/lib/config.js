// 默认电脑联调；npm run phone:start 会生成当前局域网的临时配置。
// 麦当劳 Token 只在后端 .env.local 中配置，不能放进小程序。
module.exports=Object.assign({apiBase:'http://127.0.0.1:4173',deviceKey:''},require('./device.local'));
