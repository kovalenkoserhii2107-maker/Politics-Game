const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {stamp}=require('../tools/stamp_assets.js');
// Без свежих меток браузер может смешать новые стили со старыми скриптами.
test('index.html references css/js with current content hashes',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.equal(stamp(html),html,'Метки версий устарели: node tools/stamp_assets.js');
 const refs=html.match(/(?:src|href)="(?:css|js)\/[^"]+"/g)||[];
 assert.ok(refs.length>=10);
 for(const ref of refs)assert.match(ref,/\?v=[0-9a-f]{10}"$/);
});
// Новый модуль легко забыть подключить: в тестах он грузится, а в браузере — нет.
test('every engine script in js/ is included by index.html',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 for(const file of fs.readdirSync(path.join(__dirname,'../js')).filter(f=>f.endsWith('.js')))
  assert.ok(html.includes(`src="js/${file}?v=`),`index.html не подключает js/${file}`);
});
