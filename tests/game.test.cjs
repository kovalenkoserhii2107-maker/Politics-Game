const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function engine(){
 const values=new Map();let seed=123456;const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const context=vm.createContext({console,Date,Math:math,structuredClone,localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)}});
 for(const file of ['data/CountriesDB','data/RegionsDB','data/NeighborsDB','data/CitiesDB','UnitsDB','GameData','AI','GameLoop'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),context);
 return vm.runInContext('({GameData,AI,SaveGame,GameLoop,RegionsDB,UnitsDB,DEVELOPMENT,POLICIES})',context);
}
test('casualties are invariant under splitting an attack into orders',()=>{
 const {GameData}=engine();const fight=split=>{const d=new GameData('UA',{scenario:'war2024'});for(const id of ['UA-1','RU-19']){d.regions[id].army=d.emptyArmy();d.regions[id].army.infantry=10;}
 for(let i=0;i<(split?10:1);i++)assert.equal(d.queueAttack('UA-1','RU-19',{infantry:split?1:10}).ok,true);
 const log=d.processOrders().logs.find(l=>l.losses);return JSON.stringify(log.losses);};assert.equal(fight(true),fight(false));assert.ok(JSON.parse(fight(true)).attacker.infantry>0);
});
test('orders validate ownership, adjacency, funds, finite integer counts and reservations',()=>{
 const {GameData}=engine(),d=new GameData('UA');for(const n of [NaN,Infinity,-1,0,0.5])assert.equal(d.queueRecruitment('UA-1','infantry',n).ok,false);
 assert.ok(Number.isFinite(d.countries.UA.money));assert.equal(d.queueMovement('UA-1','US-1',{infantry:1}).ok,false);assert.equal(d.queueAttack('UA-1','RU-19',{infantry:1}).ok,false);
 const n=d.regions['UA-1'].army.infantry,to=d.getValidMoveTargets('UA-1')[0];assert.equal(d.queueMovement('UA-1',to,{infantry:n}).ok,true);assert.equal(d.queueMovement('UA-1',to,{infantry:1}).ok,false);
 const money=d.countries.UA.money;assert.equal(d.queueRecruitment('UA-1','tanks',1).ok,true);d.cancelOrder('recruitment',0);assert.equal(d.countries.UA.money,money);assert.equal(d.cancelOrder('movements',NaN),null);
});
test('construction reserves money, completes once, cancels or refunds lost territory',()=>{
 const {GameData,DEVELOPMENT}=engine(),d=new GameData('UA'),r=d.regions['UA-1'];const old=r.resources.agro,money=d.countries.UA.money;
 assert.equal(d.invest(r.id,'agro').ok,true);assert.equal(d.invest(r.id,'oil').ok,false);d.processProjects();assert.equal(r.resources.agro,old);d.processProjects();assert.equal(r.resources.agro,old+DEVELOPMENT.agro.gain);d.processProjects();assert.equal(r.resources.agro,old+15);
 assert.equal(d.invest(r.id,'industry').ok,true);assert.equal(d.cancelProject(r.id),true);assert.equal(d.countries.UA.money,money-DEVELOPMENT.agro.cost);
 d.invest(r.id,'oil');d.setOwner(r.id,'RU');d.processProjects();assert.equal(d.countries.UA.money,money-DEVELOPMENT.agro.cost);
});
test('policies change real budget with an influence cost and cooldown',()=>{
 const {GameData}=engine(),d=new GameData('UA');const base=d.countryBalance('UA');assert.equal(d.setPolicy('UA','production').ok,true);assert.ok(d.countryBalance('UA').industry>base.industry);assert.equal(d.countries.UA.influence,45);assert.equal(d.setPolicy('UA','social').ok,false);d.turn+=3;assert.equal(d.setPolicy('UA','social').ok,true);assert.ok(d.countryBalance('UA').social>0);
});
test('save restores projects, decisions, policies, queued orders and resources',()=>{
 const {GameData,SaveGame}=engine(),d=new GameData('UA',{scenario:'war2024'});d.invest('UA-1','agro');d.processProjects();d.queueRecruitment('UA-2','tanks',1);d.setPolicy('UA','social');d.decisions.push({type:'peace',from:'RU'});
 assert.equal(SaveGame.save(d),true);const loaded=SaveGame.load();assert.ok(loaded,SaveGame.error);const restored=GameData.restore(loaded.game);assert.equal(JSON.stringify(restored.serialize()),JSON.stringify(d.serialize()));restored.processProjects();assert.equal(restored.projects.length,0);
});
test('discard prevents lifecycle callbacks from resurrecting a save',()=>{const {GameData,SaveGame}=engine(),d=new GameData('UA');SaveGame.save(d);SaveGame.discard();assert.equal(SaveGame.save(d),false);assert.equal(SaveGame.load(),null);});
test('failed turns preserve the last complete save and cannot run again',()=>{
 const {GameData,GameLoop,SaveGame}=engine(),d=new GameData('UA');SaveGame.save(d);const before=JSON.stringify(SaveGame.load().game);
 const loop=Object.create(GameLoop.prototype);let calls=0;
 Object.assign(loop,{data:d,endTurnBtn:{},ui:{toast(){}},ai:{planTurn(){calls++;d.countries.UA.money=0;throw new Error('Injected turn failure');}}});
 loop.processTurn();assert.equal(loop.failed,true);assert.equal(loop.endTurnBtn.disabled,true);assert.equal(SaveGame.save(d),false);assert.equal(JSON.stringify(SaveGame.load().game),before);loop.processTurn();assert.equal(calls,1);
});
test('map fingerprint changes with geometry and incompatible saves are retained',()=>{const {GameData,SaveGame,RegionsDB}=engine();SaveGame.save(new GameData('UA'));const old=SaveGame.mapId();RegionsDB['CA-6'].path+='M0,0Z';SaveGame.signature=null;assert.notEqual(SaveGame.mapId(),old);assert.equal(SaveGame.load(),null);assert.ok(SaveGame.error);});
test('corrupt state rejected before restoration',()=>{const {GameData}=engine(),save=JSON.parse(JSON.stringify(new GameData('UA').serialize()));save.regions['UA-1'][1][0]=-1;assert.throws(()=>GameData.restore(save));});
test('every playable country starts with a valid save and finite budget',()=>{
 const {GameData}=engine();const world=new GameData('UA');
 for(const country of Object.values(world.countries).filter(c=>c.playable)) {
  const d=new GameData(country.id),balance=d.countryBalance(country.id);
  assert.ok(Number.isFinite(balance.income-balance.expense),country.id);
  assert.doesNotThrow(()=>GameData.validateSave(d.serialize()),country.id);
 }
});
test('world control produces victory; loss of all land produces defeat',()=>{const {GameData}=engine(),d=new GameData('UA');for(const r of Object.values(d.regions))d.setOwner(r.id,'UA');d.applyEndOfTurn();assert.equal(d.outcome,'victory');assert.equal(d.campaignProgress().share,1);const lost=new GameData('UA');for(const r of [...lost.getCountryRegions('UA')])lost.setOwner(r.id,'RU');lost.applyEndOfTurn();assert.equal(lost.outcome,'defeat');});
test('broke AI still issues tactical orders',()=>{const {GameData,AI}=engine(),d=new GameData('UA',{scenario:'war2024'});d.turn=20;d.countries.RU.money=0;d.countries.RU.lastNetIncome=-1000000;const ai=new AI(d);let calls=0;ai.planWar=()=>calls++;ai.planTurn();assert.ok(calls>0);});
test('peace remains pending until an answer, decline is persisted, turn locked',()=>{const {GameData,GameLoop,SaveGame}=engine(),d=new GameData('UA',{scenario:'war2024'});d.decisions.push({type:'peace',from:'RU'});let dialog;const loop=Object.create(GameLoop.prototype);Object.assign(loop,{data:d,ui:{showDecision:o=>dialog=o},endTurnBtn:{},updateTopBarUI(){}});loop.afterSummary();assert.equal(d.decisions.length,1);assert.equal(loop.endTurnBtn.disabled,true);SaveGame.save(d);assert.equal(SaveGame.load().game.decisions.length,1);dialog.onDecline();assert.equal(SaveGame.load().game.decisions.length,0);assert.equal(loop.endTurnBtn.disabled,false);});
test('80-turn deterministic campaign preserves integer armies and loadable state',()=>{const {GameData,AI,SaveGame}=engine(),d=new GameData('US',{scenario:'war2024'}),ai=new AI(d);for(let t=0;t<80&&!d.gameOver;t++){ai.planTurn();d.processOrders();d.applyEndOfTurn();d.turn++;d.currentDate.setDate(d.currentDate.getDate()+7);ai.diplomacy();for(const r of Object.values(d.regions)){assert.ok(d.regionsByCountry[r.owner].includes(r.id));assert.ok(Object.values(r.army).every(n=>Number.isInteger(n)&&n>=0));}assert.ok(SaveGame.save(d));assert.ok(SaveGame.load(),SaveGame.error);}});
test('logistics unlocks isolated island expeditions, charges and refunds transports',()=>{const {GameData}=engine(),d=new GameData('UA');d.startWar('UA','NZ');assert.equal(d.getValidAttackTargets('UA-1').includes('NZ-1'),false);d.countries.UA.tech.marchSpeed=3;assert.equal(d.getValidAttackTargets('UA-1').includes('NZ-1'),true);const before=d.countries.UA.money,inf=d.countries.UA.influence;assert.equal(d.queueAttack('UA-1','NZ-1',{infantry:1}).ok,true);assert.equal(d.countries.UA.money,before-525000);d.makePeace('UA','NZ');assert.equal(d.orders.attacks.length,0);assert.equal(d.countries.UA.money,before);assert.equal(d.countries.UA.influence,inf);});
test('every sovereign region is a legal expedition target at maximum logistics',()=>{const {GameData}=engine(),d=new GameData('UA');d.countries.UA.tech.marchSpeed=3;for(const c of Object.values(d.countries))if(c.playable&&c.id!=='UA')d.startWar('UA',c.id);const targets=new Set(d.getValidAttackTargets('UA-1'));for(const r of Object.values(d.regions))if(d.countries[r.owner].playable&&r.owner!=='UA')assert.ok(targets.has(r.id));});
test('surrounded defenders are fully counted in battle losses',()=>{const {GameData}=engine(),d=new GameData('UA');d.startWar('UA','MD');const target=d.regions['MD-1'];for(const id of d.getNeighbors(target.id))if(d.regions[id].owner==='MD')d.setOwner(id,'RO');const from=d.getCountryRegions('UA').find(r=>d.getNeighbors(r.id).includes(target.id));from.army=d.emptyArmy();from.army.aviation=1000;target.army=d.emptyArmy();target.army.infantry=10;d.queueAttack(from.id,target.id,{aviation:1000});const logs=d.processOrders().logs;assert.equal(logs.find(x=>x.losses).losses.defender.infantry,10);});
