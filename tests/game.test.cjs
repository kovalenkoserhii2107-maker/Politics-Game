const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function engine(){
 const values=new Map();let seed=123456;const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const context=vm.createContext({console,Date,Math:math,structuredClone,localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}}});
 for(const file of ['data/CountriesDB','data/RegionsDB','data/NeighborsDB','data/CitiesDB','UnitsDB','Tech','Economy','Diplomacy','Missions','Score','Events','Unrest','Trade','GameData','AI','GameLoop'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),context);
 return Object.assign(vm.runInContext('({GameData,AI,SaveGame,GameLoop,RegionsDB,UnitsDB,DEVELOPMENT,POLICIES,Economy,RESOURCES,ECONOMY,Tech,TECH_TREE,MODERNIZATION,Diplomacy,DIPLOMACY,Missions,MISSION_KINDS,MISSION_RULES,Score,GOALS,Events,EVENTS,DEBT,CYCLES,INFRA,Unrest,REVOLT,Trade,RULES})',context),{localStorage:context.localStorage});
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
 const {GameData,Economy}=engine(),d=new GameData('UA');const base=Economy.flows(d,'UA').goods.prod,sales=d.countryBalance('UA').sales;assert.equal(d.setPolicy('UA','production').ok,true);assert.ok(Economy.flows(d,'UA').goods.prod>base);assert.ok(d.countryBalance('UA').sales>sales);assert.equal(d.countries.UA.influence,45);assert.equal(d.setPolicy('UA','social').ok,false);d.turn+=3;assert.equal(d.setPolicy('UA','social').ok,true);assert.ok(d.countryBalance('UA').social>0);
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
test('map fingerprint changes with geometry; such saves migrate and keep a backup',()=>{const {GameData,SaveGame,RegionsDB,localStorage}=engine();const d=new GameData('UA');d.countries.UA.money=12345678;d.turn=7;SaveGame.save(d);const old=SaveGame.mapId();RegionsDB['CA-6'].path+='M0,0Z';SaveGame.signature=null;assert.notEqual(SaveGame.mapId(),old);const loaded=SaveGame.load();assert.ok(loaded,SaveGame.error);assert.equal(SaveGame.migrated,true);assert.equal(loaded.game.turn,7);assert.equal(loaded.game.countries.UA[0],12345678);assert.ok(localStorage.getItem(SaveGame.BACKUP_KEY));});
test('saves from another map are rejected and retained',()=>{const {GameData,SaveGame,localStorage}=engine();const save=new GameData('UA').serialize();const regions={};for(const [id,r] of Object.entries(save.regions))regions['X'+id]=r;save.regions=regions;localStorage.setItem(SaveGame.KEY,JSON.stringify({map:'old',game:save}));assert.equal(SaveGame.load(),null);assert.ok(SaveGame.error);assert.ok(localStorage.getItem(SaveGame.KEY));});
test('v2 saves from the previous version migrate with defaults for new fields',()=>{const {GameData,SaveGame,localStorage}=engine();const d=new GameData('DE',{scenario:'war2024'});d.startWar('DE','PL');d.setOwner('PL-1','DE');const v3=d.serialize();const v2={v:2,player:'DE',cheat:false,scenario:'war2024',date:v3.date,turn:5,regions:{},countries:{},wars:v3.wars,truces:[],orders:{recruitment:[],attacks:[],movements:[],recon:[]},decisions:[],history:[],gameOver:false};for(const [id,r] of Object.entries(v3.regions))v2.regions[id]=r.slice(0,4);for(const [id,c] of Object.entries(v3.countries))v2.countries[id]=c.slice(0,7);localStorage.setItem(SaveGame.KEY,JSON.stringify({map:'1996:AD-1:ZW-9',savedAt:1,game:v2}));const loaded=SaveGame.load();assert.ok(loaded,SaveGame.error);const r=GameData.restore(loaded.game);assert.equal(r.regions['PL-1'].owner,'DE');assert.equal(r.turn,5);assert.ok(r.isAtWar('DE','PL'));assert.equal(r.countries.DE.policy,'balanced');assert.equal(r.difficulty,'normal');});
test('export produces a file that imports back identically',()=>{const {GameData,SaveGame}=engine();const d=new GameData('BR',{difficulty:'hard'});d.turn=3;const file=SaveGame.exportFile(d);assert.match(file.name,/br-turn3\.json$/);const back=GameData.restore(SaveGame.parse(file.text).game);assert.equal(SaveGame.migrated,false);assert.equal(JSON.stringify(back.serialize()),JSON.stringify(d.serialize()));assert.throws(()=>SaveGame.parse('{"nope":1}'));});
test('difficulty scales the player budget and AI caution',()=>{const {GameData,AI}=engine();const money=l=>new GameData('FR',{difficulty:l}).countries.FR.money;assert.ok(money('easy')>money('normal'));assert.ok(money('hard')<money('normal'));const easy=new AI(new GameData('FR',{difficulty:'easy'})),hard=new AI(new GameData('FR',{difficulty:'hard'}));assert.ok(easy.rule('ATTACK_MARGIN')>hard.rule('ATTACK_MARGIN'));assert.equal(new AI(new GameData('FR')).rule('AI_WAR_CHANCE'),0.05);});
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
test('world market conserves money and goods: sold equals bought',()=>{const {GameData,Economy,RESOURCES}=engine(),d=new GameData('DE');for(let t=0;t<6;t++){const out=Economy.runMarkets(d);const total=Object.values(out).reduce((a,r)=>a+r.money,0);assert.ok(Math.abs(total)<=Object.keys(out).length,'money '+total);for(const key of Object.keys(RESOURCES)){const sold=Object.values(out).reduce((a,r)=>a+r.res[key].sold,0),bought=Object.values(out).reduce((a,r)=>a+r.res[key].bought,0);assert.ok(Math.abs(sold-bought)<1e-6,key);assert.ok(Number.isFinite(d.market[key])&&d.market[key]>0);}}});
test('prices rise under shortage and fall under glut within the corridor',()=>{const {GameData,Economy,ECONOMY,RESOURCES}=engine(),d=new GameData('DE');for(const c of Object.values(d.countries))if(c.stock)c.stock.food=0;for(const r of Object.values(d.regions))r.resources.agro=0;for(let t=0;t<30;t++)Economy.runMarkets(d);assert.ok(d.market.food>RESOURCES.food.price*1.5);assert.ok(d.market.food<=RESOURCES.food.price*ECONOMY.PRICE_MAX);const g=new GameData('DE');for(const r of Object.values(g.regions))r.resources.industry*=5;for(let t=0;t<30;t++)Economy.runMarkets(g);assert.ok(g.market.goods<RESOURCES.goods.price*0.8);assert.ok(g.market.goods>=RESOURCES.goods.price*ECONOMY.PRICE_MIN-1);});
test('hunger lowers loyalty, shrinks population and army; broke countries cannot buy',()=>{const {GameData}=engine(),d=new GameData('UA');const ua=d.countries.UA;ua.money=-1e9;ua.stock.food=0;for(const r of d.getCountryRegions('UA'))r.resources.agro=0;const pop=d.getCountryRegions('UA').reduce((a,r)=>a+r.population,0),army=d.getCountryRegions('UA').reduce((a,r)=>a+r.army.infantry,0);const {events}=d.applyEndOfTurn();assert.ok(ua.economy.sat.food<0.8);assert.equal(ua.economy.res.food.bought,0);assert.ok(events.some(e=>e.type==='shortage'));d.applyEndOfTurn();assert.ok(d.getCountryRegions('UA').reduce((a,r)=>a+r.population,0)<pop);assert.ok(d.getCountryRegions('UA').reduce((a,r)=>a+r.army.infantry,0)<army);assert.ok(d.getCountryRegions('UA').every(r=>r.loyalty<1));});
test('keep mode stores surplus instead of selling; war blockade limits trade',()=>{const {GameData,Economy}=engine(),d=new GameData('KZ');assert.equal(d.setTrade('KZ','food','keep'),true);assert.equal(d.setTrade('KZ','food','hoard'),false);const before=d.countries.KZ.stock.food,out=Economy.runMarkets(d);assert.equal(out.KZ.res.food.sold,0);assert.ok(d.countries.KZ.stock.food>before);const w=new GameData('KZ');const peace=Economy.runMarkets(new GameData('KZ')).KZ.res.energy.sold;w.startWar('KZ','UZ');const war=Economy.runMarkets(w).KZ.res.energy.sold;assert.ok(war<peace*0.7);});
test('economy survives save, restore and migration from saves without it',()=>{const {GameData,SaveGame}=engine(),d=new GameData('UA');d.setTrade('UA','goods','keep');d.applyEndOfTurn();const back=GameData.restore(JSON.parse(JSON.stringify(d.serialize())));assert.equal(JSON.stringify(back.serialize()),JSON.stringify(d.serialize()));assert.equal(back.countries.UA.trade.goods,'keep');const old=d.serialize();delete old.market;for(const c of Object.values(old.countries))c.length=9;for(const r of Object.values(old.regions))r.length=6;const migrated=GameData.restore(GameData.migrateSave(old));assert.ok(migrated.countries.UA.stock.food>0);assert.equal(migrated.countries.UA.trade.food,'sell');});
test('tech tree: locked units, research takes turns, unlocks, cancel refunds',()=>{const {GameData,TECH_TREE}=engine(),d=new GameData('DE');const de=d.countries.DE;de.money=1e9;const r=d.getCountryRegions('DE')[0].id;assert.equal(d.queueRecruitment(r,'drones',1).ok,false);assert.equal(d.startResearch('DE','ewar').ok,false);assert.equal(d.startResearch('DE','drones').ok,true);assert.equal(de.money,1e9-TECH_TREE.drones.cost);assert.equal(d.startResearch('DE','medicine').ok,false);for(let i=1;i<TECH_TREE.drones.turns;i++){d.applyEndOfTurn();d.turn++;assert.equal(d.queueRecruitment(r,'drones',1).ok,false);}const {events}=d.applyEndOfTurn();d.turn++;assert.ok(events.some(e=>e.type==='tech'));assert.equal(d.queueRecruitment(r,'drones',1).ok,true);assert.equal(d.startResearch('DE','drones').ok,false);
 const m=de.money;d.startResearch('DE','medicine');assert.equal(d.cancelResearch('DE'),TECH_TREE.medicine.cost);assert.equal(de.money,m);d.startResearch('DE','medicine');d.turn++;assert.equal(d.cancelResearch('DE'),TECH_TREE.medicine.cost/2);});
test('modernization gets pricier each step and stops at the cap',()=>{const {GameData,MODERNIZATION}=engine(),d=new GameData('DE');d.countries.DE.money=1e12;let last=0;for(let l=1;l<MODERNIZATION.MAX;l++){const c=d.techCost('DE','tanks');assert.ok(c>last);last=c;assert.equal(d.research('DE','tanks').ok,true);}assert.equal(d.techCost('DE','tanks'),null);assert.equal(d.research('DE','tanks').ok,false);assert.equal(d.techCost('DE','stealth'),null);assert.ok(Math.abs(d.techMultiplier('DE','tanks')-(1+(MODERNIZATION.MAX-1)*MODERNIZATION.STEP))<1e-9);});
test('tech effects: fewer losses, stronger defense, more food, logistics',()=>{const {GameData,Economy,Tech}=engine(),a=new GameData('UA'),b=new GameData('UA');const t=a.regions['UA-1'];const base=a.defensePower(t,{infantry:10});Tech.grant(b.countries.UA,'fortify');assert.ok(b.defensePower(b.regions['UA-1'],{infantry:10})>base*1.14);const food=Economy.flows(a,'UA').food.prod;Tech.grant(b.countries.UA,'agrotech');assert.ok(Economy.flows(b,'UA').food.prod>food*1.14);Tech.grant(b.countries.UA,'logistics2');assert.equal(b.countries.UA.tech.marchSpeed,3);
 const fight=med=>{const d=new GameData('UA');d.startWar('UA','MD');if(med)Tech.grant(d.countries.UA,'medicine');const from=d.getCountryRegions('UA').find(r=>d.getNeighbors(r.id).includes('MD-1'));from.army=d.emptyArmy();from.army.infantry=100;d.regions['MD-1'].army=d.emptyArmy();d.regions['MD-1'].army.infantry=60;d.queueAttack(from.id,'MD-1',{infantry:100});return d.processOrders().logs.find(l=>l.losses).losses.attacker.infantry;};assert.ok(fight(true)<fight(false));});
test('research survives save and old logistics levels become technologies',()=>{const {GameData}=engine(),d=new GameData('DE');d.countries.DE.money=1e9;d.startResearch('DE','powergrid');d.research('DE','infantry');const back=GameData.restore(JSON.parse(JSON.stringify(d.serialize())));assert.equal(JSON.stringify(back.serialize()),JSON.stringify(d.serialize()));assert.equal(back.countries.DE.research.id,'powergrid');const old=d.serialize();for(const c of Object.values(old.countries)){c.length=9;}old.countries.DE[3].marchSpeed=3;const m=GameData.restore(GameData.migrateSave(old));assert.ok(m.countries.DE.techs.includes('logistics2'));assert.equal(m.countries.DE.research,null);});
test('rich AI spends surplus on science instead of hoarding',()=>{const run=science=>{const {GameData,AI}=engine(),d=new GameData('DE'),ai=new AI(d);if(!science)ai.planScience=()=>{};d.countries.CN.money=5e8;for(let t=0;t<10;t++){ai.planTurn();d.processOrders();d.applyEndOfTurn();d.turn++;}return d.countries.CN;};const cn=run(true),hoard=run(false);assert.ok(cn.techs.length>=3);assert.ok(Object.keys(cn.tech).some(k=>k!=='marchSpeed'&&cn.tech[k]>1));assert.ok(cn.money<hoard.money-1e8,`${cn.money} vs ${hoard.money}`);});

// --- дипломатия ---
test('diplomacy: gift improves relations, deal gives trade bonus, pact blocks war', () => {
    const { GameData, Diplomacy, DIPLOMACY } = engine(), d = new GameData('DE');
    const de = d.countries.DE;
    de.money = 1e9; de.influence = 100;
    assert.equal(d.diplomacyAction('FR', 'gift').ok, true);
    assert.ok(Diplomacy.relation(d, 'DE', 'FR') > 0);
    const before = d.countryBalance('DE');
    const deal = d.diplomacyAction('FR', 'deal');
    assert.equal(deal.accepted, true);
    assert.equal(d.stats.deals, 1);
    const after = d.countryBalance('DE');
    assert.equal(after.tradeBonus, DIPLOMACY.DEAL_BONUS);
    assert.ok(after.sales >= before.sales && after.purchases <= before.purchases);
    assert.equal(d.diplomacyAction('FR', 'pact').accepted, true);
    assert.equal(d.canDeclareWar('DE', 'FR').ok, false);
    assert.equal(d.diplomacyAction('FR', 'cancel-pact').ok, true);
    assert.equal(d.canDeclareWar('DE', 'FR').ok, false, 'после разрыва пакта — пауза');
    d.turn += 3;
    assert.equal(d.canDeclareWar('DE', 'FR').ok, true);
});

test('diplomacy: allies join a defensive war, alliance needs trust', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE');
    d.countries.DE.influence = 100;
    assert.equal(d.diplomacyAction('PL', 'alliance').accepted, false, 'без отношений и договоров союз не подпишут');
    d.relations[d.pairKey('DE', 'PL')] = 70;
    Diplomacy.sign(d, 'DE', 'PL', 'deal');
    assert.equal(d.diplomacyAction('PL', 'alliance').accepted, true);
    assert.equal(d.canDeclareWar('DE', 'PL').ok, false);
    d.countries.CZ.influence = 100;
    const result = d.declareWar('CZ', 'PL');
    assert.equal(result.ok, true);
    assert.deepEqual([...result.joined], ['DE']);
    assert.equal(d.isAtWar('DE', 'CZ'), true);
    assert.ok(d.takeDiploEvents().some(e => e.message.includes('союзник')));
});

test('diplomacy: tribute only from much weaker countries, decline hurts relations', () => {
    const { GameData, Diplomacy, DIPLOMACY } = engine(), d = new GameData('US');
    d.countries.US.influence = 100;
    const weak = d.neighbourCountries('US').find(cc => d.calculateMilitaryPower('US') > DIPLOMACY.TRIBUTE_RATIO * d.calculateMilitaryPower(cc));
    assert.ok(weak);
    const money = d.countries.US.money;
    const r = d.diplomacyAction(weak, 'tribute');
    assert.ok(r.paid > 0);
    assert.equal(d.countries.US.money, money + r.paid);
    assert.equal(Diplomacy.relation(d, 'US', weak), DIPLOMACY.TRIBUTE_RELATION);
    const d2 = new GameData('LT');
    d2.countries.LT.influence = 100;
    assert.equal(d2.diplomacyAction('PL', 'tribute').paid, 0);
});

test('diplomacy survives save and relations drift back', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE');
    d.relations[d.pairKey('DE', 'FR')] = 40;
    Diplomacy.sign(d, 'DE', 'FR', 'pact');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(Diplomacy.relation(back, 'DE', 'FR'), 50);
    assert.ok(Diplomacy.pactLeft(back, 'DE', 'FR') > 0);
    const rel = Diplomacy.relation(back, 'DE', 'FR');
    Diplomacy.endTurn(back, []);
    assert.equal(Diplomacy.relation(back, 'DE', 'FR'), rel - 1);
    const bad = d.serialize(); bad.diplomacy.relations['DE|FR'] = 500;
    assert.throws(() => GameData.restore(bad));
});

// --- задания ---
test('missions: three active, progress counts from issue, claim pays and replaces', () => {
    const { GameData, Missions } = engine(), d = new GameData('UA', { scenario: 'war2024' });
    assert.equal(d.missions.length, 3);
    d.missions[0] = { kind: 'recruit', target: 2, text: 'x', stat: 'recruited', base: d.stats.recruited || 0, reward: { money: 1e6, influence: 5 }, issued: 0 };
    assert.equal(Missions.claim(d, 0), null, 'невыполненное не выдаётся');
    assert.equal(d.queueRecruitment('UA-1', 'infantry', 1).ok, true);
    assert.equal(Missions.progress(d, d.missions[0]).done, false);
    assert.equal(d.queueRecruitment('UA-1', 'infantry', 1).ok, true);
    assert.equal(Missions.progress(d, d.missions[0]).done, true);
    assert.equal(Missions.readyCount(d) >= 1, true);
    const ua = d.countries.UA, money = ua.money, infl = ua.influence;
    assert.deepEqual({ ...Missions.claim(d, 0) }, { money: 1e6, influence: 5 });
    assert.equal(ua.money, money + 1e6);
    assert.equal(ua.influence, Math.min(100, infl + 5));
    assert.equal(d.missions.length, 3);
    assert.equal(d.stats.missions, 1);
});

test('missions: cancelled recruitment does not count, skip costs influence, stale ones replaced', () => {
    const { GameData, Missions, MISSION_RULES } = engine(), d = new GameData('UA', { scenario: 'war2024' });
    d.queueRecruitment('UA-1', 'infantry', 1);
    d.cancelOrder('recruitment', 0);
    assert.equal(d.stats.recruited, 0);
    d.countries.UA.influence = MISSION_RULES.SKIP_COST;
    const kind = d.missions[1].kind;
    assert.equal(Missions.skip(d, 1), true);
    assert.equal(d.countries.UA.influence, 0);
    assert.equal(d.missions.length, 3);
    assert.ok(!d.missions.some(m => m.kind === kind));
    assert.equal(Missions.skip(d, 0), false);
    d.missions[2] = { kind: 'battles', target: 2, text: 'x', stat: 'battlesWon', base: 0, reward: { money: 1e6, influence: 5 }, issued: 0 };
    d.makePeace('UA', 'RU');
    Missions.update(d);
    assert.ok(!d.missions.some(m => m.kind === 'battles'));
    assert.equal(d.missions.length, 3);
});

test('missions: done is announced once and missions survive save', () => {
    const { GameData, Missions } = engine(), d = new GameData('DE');
    d.missions[0] = { kind: 'treasury', target: 1, text: 'x', value: 'money', start: 0, reward: { money: 1e6, influence: 5 }, issued: 0 };
    assert.equal(Missions.update(d).length, 1);
    assert.equal(Missions.update(d).length, 0);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(JSON.stringify(back.missions), JSON.stringify(d.missions));
    assert.equal(Missions.progress(back, back.missions[0]).done, true);
});

// --- сетевая игра: несколько людей ---
const mpLoop = (GameLoop, AI, d) => Object.assign(Object.create(GameLoop.prototype), { data: d, ai: new AI(d), monthNames: Array(12).fill('м') });

test('multiplayer: AI never commands a human country, each human gets own report', () => {
    const { GameData, GameLoop, AI } = engine(), d = new GameData('DE', { humans: ['PL'] });
    assert.deepEqual([...d.humans], ['DE', 'PL']);
    assert.equal(d.seats.PL.missions.length, 3, 'у гостя свои задания');
    d.countries.PL.money = 1e9;
    const loop = mpLoop(GameLoop, AI, d);
    for (let i = 0; i < 12; i++) {
        loop.ai.planTurn();
        assert.ok(!Object.values(d.orders).flat().some(o => o.country === 'PL' || o.country === 'DE'), 'ИИ не отдаёт приказов за людей');
        d.orders = d.emptyOrders();
        const reports = loop.resolveTurn();
        assert.ok(reports.DE && reports.PL);
        assert.ok(reports.PL.turnData.logs.every(l => l.for === 'PL'));
    }
    assert.equal(d.seats.PL.history.length, 12, 'журнал гостя ведётся отдельно');
    assert.equal(d.history.length, 12);
});

test('multiplayer: guest commands replay on the host in the guest name only', () => {
    const { GameData } = engine(), host = new GameData('DE', { humans: ['PL'] });
    const guest = GameData.restore(JSON.parse(JSON.stringify(host.serialize())));
    guest.becomePlayer('PL');
    assert.equal(guest.playerCountry, 'PL');
    assert.equal(guest.missions.length, 3);
    guest.recorder = [];
    const region = guest.getCountryRegions('PL')[0].id;
    assert.equal(guest.act('queueRecruitment', region, 'infantry', 2).ok, true);
    guest.act('setTaxRate', 'PL', 0.12);
    guest.act('queueRecruitment', host.getCountryRegions('DE')[0].id, 'infantry', 1, 'DE');   // чужая страна
    const failed = host.replay('PL', JSON.parse(JSON.stringify(guest.recorder)));
    assert.equal(failed, 1);
    assert.equal(host.orders.recruitment.filter(o => o.country === 'PL').length, 1);
    assert.equal(host.orders.recruitment.filter(o => o.country === 'DE').length, 0);
    assert.equal(host.countries.PL.taxRate, 0.12);
    assert.equal(host.playerCountry, 'DE', 'после повтора сервер снова смотрит своими глазами');
    assert.equal(host.seats.PL.stats.recruited, 2);
    // отмена своего приказа по номеру среди своих
    host.act('queueRecruitment', host.getCountryRegions('DE')[0].id, 'infantry', 1);
    assert.equal(host.replay('PL', [{ name: 'cancelOwnOrder', args: ['recruitment', 0] }]), 0);
    assert.equal(host.orders.recruitment.map(o => o.country).join(), 'DE');
    assert.equal(host.replay('PL', [{ name: 'constructor', args: [] }, { name: 'setTaxRate', args: ['DE', 0.3] }]), 2);
});

test('multiplayer: proposals between humans wait for the answer, peace too', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.countries.DE.influence = 100; d.countries.PL.influence = 100;
    const r = d.act('diplomacyAction', 'PL', 'deal');
    assert.equal(r.pending, true);
    assert.equal(Diplomacy.hasDeal(d, 'DE', 'PL'), false);
    assert.equal(d.act('diplomacyAction', 'PL', 'deal').ok, false, 'второй раз то же не отправить');
    assert.equal(d.act('diplomacyAction', 'PL', 'tribute').ok, false);
    d.withPlayer('PL', () => assert.equal(d.act('answerDecision', true).accepted, true));
    assert.equal(Diplomacy.hasDeal(d, 'DE', 'PL'), true);
    assert.ok(d.takeDiploEvents().some(e => e.for === 'DE' && e.message.includes('принимает')));
    d.act('diplomacyAction', 'PL', 'cancel-deal');
    d.turn = 10;
    assert.equal(d.act('declareWar', 'DE', 'PL').ok, true);
    assert.equal(d.act('proposePeace', 'PL').pending, true);
    assert.equal(d.isAtWar('DE', 'PL'), true);
    d.withPlayer('PL', () => d.act('answerDecision', true));
    assert.equal(d.isAtWar('DE', 'PL'), false);
});

test('multiplayer: seats survive save, one human defeated does not end the game', () => {
    const { GameData, GameLoop, AI } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.seats.PL.stats.recruited = 5;
    d.net = { code: 'AB12', clients: { x1: 'PL' } };
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.deepEqual([...back.humans], ['DE', 'PL']);
    assert.equal(back.seats.PL.stats.recruited, 5);
    assert.equal(back.net.code, 'AB12');
    for (const r of back.getCountryRegions('PL')) back.setOwner(r.id, 'DE');
    const reports = mpLoop(GameLoop, AI, back).resolveTurn();
    assert.equal(back.countries.PL.alive, false);
    assert.equal(back.gameOver, false);
    assert.ok(reports.PL.turnData.events.some(e => e.includes('потеряла все области')));
    const bad = d.serialize(); bad.humans = ['DE', 'DE'];
    assert.throws(() => GameData.restore(bad));
});

test('network framing: long messages are chunked under the PeerJS byte limit and reassembled', () => {
    const context = vm.createContext({ console, JSON, Math, Map, String, Number, Array, Object });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/Net.js'), 'utf8') + ';this.NetLink = NetLink;', context);
    const handlers = {}, sent = [];
    const conn = { open: true, send: x => sent.push(x), on: (e, f) => { handlers[e] = f; }, close() {} };
    const got = [];
    const link = new context.NetLink(conn, m => got.push(m));
    const big = { t: 'state', text: 'Польша "Лодзь" 🎮 '.repeat(20000) };
    assert.equal(link.send(big), true);
    assert.ok(sent.length > 1);
    for (const piece of sent) assert.ok(Buffer.byteLength(JSON.stringify(piece)) < 16300, 'кусок влезает в канал PeerJS');
    for (const piece of [...sent].reverse()) handlers.data(piece);   // порядок не важен
    assert.equal(got.length, 1);
    assert.equal(got[0].text, big.text);
    handlers.data({ c: 'x', i: 0, n: 2, d: '{"t":' });              // неполное — ждём
    handlers.data('мусор');
    assert.equal(got.length, 1);
});

// --- помощь, уступки, совместные атаки, цели ---
test('transfer: money and stock go to a friend, not to an enemy', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    const de = d.countries.DE, pl = d.countries.PL;
    const money = de.money, plMoney = pl.money;
    assert.equal(d.act('transfer', 'PL', 'money', 5e6).ok, true);
    assert.equal(de.money, money - 5e6);
    assert.equal(pl.money, plMoney + 5e6);
    assert.ok(d.takeDiploEvents().some(e => e.for === 'PL' && e.message.includes('передаёт')));
    de.stock.food = 10;
    assert.equal(d.act('transfer', 'PL', 'food', 4).ok, true);
    assert.equal(de.stock.food, 6);
    assert.equal(d.act('transfer', 'PL', 'food', 40).ok, false);
    assert.equal(d.act('transfer', 'PL', 'money', 1e15).ok, false);
    assert.ok(Diplomacy.relation(d, 'DE', 'PL') > 0);
    d.turn = 20; de.influence = 100;
    d.declareWar('DE', 'FR');
    assert.equal(d.act('transfer', 'FR', 'money', 1e6).ok, false);
});

test('cede region: only a bordering region, not the capital; troops withdraw', () => {
    const { GameData } = engine(), d = new GameData('DE', { humans: ['PL'] });
    const border = d.getCountryRegions('DE').find(r => r.id !== d.countries.DE.capital && d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'PL'));
    assert.ok(border);
    const troops = Object.values(border.army).reduce((a, b) => a + b, 0);
    const before = d.calculateMilitaryPower('DE');
    assert.equal(d.act('cedeRegion', d.countries.DE.capital, 'PL').ok, false);
    assert.equal(d.act('cedeRegion', border.id, 'PL').ok, true);
    assert.equal(d.regions[border.id].owner, 'PL');
    assert.equal(Object.values(d.regions[border.id].army).reduce((a, b) => a + b, 0), 0);
    if (troops) assert.ok(Math.abs(d.calculateMilitaryPower('DE') - before) < before * 0.2, 'войска отошли, а не пропали');
    const far = d.getCountryRegions('DE').find(r => !d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'IT') && r.id !== d.countries.DE.capital);
    assert.ok(far);
    assert.equal(d.act('cedeRegion', far.id, 'IT').ok, false, 'не граничит — не отдать');
});

test('joint attack: allies merge into one battle with a bonus, the stronger takes the region', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.turn = 20;
    Diplomacy.sign(d, 'DE', 'PL', 'alliance');
    const cz = d.getCountryRegions('CZ').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'DE') && d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'PL'));
    assert.ok(cz, 'есть чешская область на стыке Германии и Польши');
    d.countries.DE.influence = 100; d.countries.PL.influence = 100;
    d.declareWar('DE', 'CZ');
    assert.equal(d.isAtWar('PL', 'CZ'), false);
    d.withPlayer('PL', () => d.act('declareWar', 'PL', 'CZ'));
    const fromDE = d.getNeighbors(cz.id).find(id => d.regions[id]?.owner === 'DE');
    const fromPL = d.getNeighbors(cz.id).find(id => d.regions[id]?.owner === 'PL');
    d.regions[fromDE].army.tanks = 60; d.regions[fromPL].army.infantry = 30;
    d.regions[cz.id].army = d.emptyArmy(); d.regions[cz.id].army.infantry = 20;
    assert.equal(d.queueAttack(fromDE, cz.id, { tanks: 60 }, 'DE').ok, true);
    assert.equal(d.queueAttack(fromPL, cz.id, { infantry: 30 }, 'PL').ok, true);
    const { logs } = d.processOrders();
    const de = logs.find(l => l.for === 'DE'), pl = logs.find(l => l.for === 'PL');
    assert.ok(de && pl, 'оба союзника получили отчёт');
    assert.equal(de.joint, true);
    assert.equal(de.success, true);
    assert.equal(pl.success, true);
    assert.equal(d.regions[cz.id].owner, 'DE');
    assert.equal(d.regions[cz.id].army.infantry, 0, 'польская пехота вернулась домой');
    assert.ok(d.regions[fromPL].army.infantry > 0);
});

test('goals: timed game ends with the fastest-growing human, coop ends together', () => {
    const { GameData, GameLoop, AI, Score } = engine();
    const d = new GameData('DE', { humans: ['PL'], goal: 'turns30' });
    assert.equal(d.goal, 'turns30');
    const loop = mpLoop(GameLoop, AI, d);
    const border = d.getCountryRegions('DE').find(r => r.id !== d.countries.DE.capital && d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'PL'));
    d.act('cedeRegion', border.id, 'PL');   // Польша сразу впереди на область
    d.turn = 29;
    loop.resolveTurn();
    assert.equal(d.gameOver, true);
    assert.ok(d.isHuman(d.winner));
    const v = Score.verdict(d, d.winner === 'DE' ? 'PL' : 'DE');
    assert.equal(v.victory, false);
    assert.equal(Score.verdict(d, d.winner).victory, true);
    assert.equal(new GameData('DE', { goal: 'coop' }).goal, 'domination', 'вместе — только в сетевой игре');
    const c = new GameData('DE', { humans: ['PL'], goal: 'coop' });
    for (const r of Object.values(c.regions).slice(0, 200)) c.setOwner(r.id, 'DE');
    const events = [];
    Score.checkEnd(c, events);
    assert.equal(c.gameOver, true);
    assert.equal(Score.verdict(c, 'PL').victory, true);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.goal, 'turns30');
    assert.equal(back.scoreStart.DE, d.scoreStart.DE);
});

test('events: roll a choice for a human, both options work, decision survives save', () => {
    const { GameData, Events, EVENTS } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.turn = 10;
    for (let i = 0; i < 40 && !(d.decisions.length && d.seats.PL.decisions.length); i++) {
        d.stats.lastEvent = 0; d.seats.PL.stats.lastEvent = 0;
        Events.roll(d, []);
    }
    const mine = d.decisions.find(x => x.type === 'event');
    assert.ok(mine && d.seats.PL.decisions.some(x => x.type === 'event'), 'событие выпало обоим');
    assert.ok(EVENTS[mine.event]);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.ok(back.decisions.some(x => x.type === 'event'));
    // каждый вариант каждого события применяется без ошибок
    for (const key of Object.keys(EVENTS)) {
        for (const choice of [true, false]) {
            const t = new GameData('UA', { scenario: 'war2024' });
            t.countries.UA.money = 1e9;
            t.startResearch('UA', 'drones'); t.startResearch('UA', 'motorized');
            const r = t.getCountryRegions('UA')[0];
            const ctx = EVENTS[key].when(t, 'UA') || { region: r.id, cost: 1e5, money: 1e5, food: 5, from: 'PL', tanks: 1, infantry: 1, sale: 1e5 };
            t.decisions.unshift({ type: 'event', from: 'UA', event: key, ctx });
            const res = t.act('answerDecision', choice);
            assert.equal(res.ok, true, key);
            assert.equal(typeof res.summary, 'string', key);
        }
    }
});

test('multiplayer: any treaty can be proposed to a human for free, the human decides', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.countries.DE.influence = 0;
    Diplomacy.changeRelation(d, 'DE', 'PL', -50);   // даже при плохих отношениях
    const r = d.act('diplomacyAction', 'PL', 'alliance');
    assert.equal(r.ok, true);
    assert.equal(r.pending, true);
    assert.equal(d.countries.DE.influence, 0, 'влияние не тратится');
    assert.equal(d.proposalPending('PL', 'alliance'), true);
    assert.equal(d.act('diplomacyAction', 'PL', 'alliance').ok, false, 'повторно — нет');
    d.withPlayer('PL', () => d.act('answerDecision', true));
    assert.equal(Diplomacy.isAllied(d, 'DE', 'PL'), true);
    assert.equal(d.proposalPending('PL', 'alliance'), false);
    // отказ — союза нет
    const e = new GameData('DE', { humans: ['PL'] });
    e.act('diplomacyAction', 'PL', 'pact');
    e.withPlayer('PL', () => e.act('answerDecision', false));
    assert.equal(Diplomacy.pactLeft(e, 'DE', 'PL'), 0);
});

test('network campaigns: own save slots for host and guest, guest can become the server', () => {
    const { GameData, SaveGame, localStorage } = engine();
    const host = new GameData('DE', { humans: ['PL'] });
    host.net = { id: 'camp1', code: 'AB12', clients: { kid42: 'PL' }, names: { DE: 'Папа', PL: 'Сын' } };
    SaveGame.save(new GameData('UA'));                       // одиночная партия
    SaveGame.campaignRole = 'host';
    assert.equal(SaveGame.save(host), true);
    assert.equal(SaveGame.load().game.player, 'UA', 'сетевая кампания не затирает одиночную');
    // копия гостя — его глазами
    const guest = GameData.restore(JSON.parse(JSON.stringify(host.serialize())));
    guest.becomePlayer('PL');
    guest.net.id = 'camp1';
    const guestSave = JSON.parse(JSON.stringify(guest.serialize()));
    assert.deepEqual([...guestSave.humans], ['PL', 'DE']);
    const back = GameData.restore(guestSave);
    assert.equal(back.playerCountry, 'PL');
    assert.equal(back.seats.DE.missions.length, host.missions.length);
    const list = SaveGame.campaigns();
    assert.equal(list.length, 1);
    assert.equal(list[0].meta.code, 'AB12');
    assert.equal(SaveGame.loadCampaign('camp1').game.player, 'DE');
    for (let i = 0; i < 8; i++) {
        const g = new GameData('FR', { humans: ['ES'] });
        g.net = { id: 'c' + i, code: 'X' + i, clients: {}, names: {} };
        SaveGame.save(g);
    }
    assert.ok(SaveGame.campaigns().length <= SaveGame.CAMPAIGN_MAX, 'старые кампании вытесняются');
    SaveGame.removeCampaign('c7');
    assert.ok(!SaveGame.campaigns().some(c => c.meta.id === 'c7'));
    assert.ok(localStorage.getItem('politics-game-save'));
});

// --- экономика: долг, цикл, инфраструктура ---
test('debt: borrow up to the limit, interest in the budget, repay, survives save', () => {
    const { GameData, Economy, DEBT } = engine(), d = new GameData('DE');
    const de = d.countries.DE, money = de.money;
    const limit = Economy.debtLimit(d, 'DE');
    assert.ok(limit > 0);
    const r = d.act('borrow', limit * 2);
    assert.equal(r.ok, true);
    assert.equal(de.debt, limit, 'больше лимита не дают');
    assert.equal(de.money, money + limit);
    assert.equal(d.act('borrow', 1e6).ok, false);
    const b = d.countryBalance('DE');
    assert.ok(b.interest > 0 && b.expense >= b.interest);
    assert.ok(Economy.debtRate(d, 'DE') <= DEBT.RATE_MAX + 1e-9);
    assert.equal(Economy.debtRating(d, 'DE').grade, 'D');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.countries.DE.debt, limit);
    assert.equal(d.act('repay', 1e15).ok, true);
    assert.equal(de.debt, 0);
    assert.equal(d.countryBalance('DE').interest, 0);
    assert.equal(d.act('repay', 1).ok, false);
});

test('world cycle changes phases, affects taxes and is saved', () => {
    const { GameData, Economy, CYCLES } = engine(), d = new GameData('DE');
    const base = d.countryBalance('DE').tax;
    d.cycle = { phase: 'boom', until: d.turn + 5 };
    assert.ok(Math.abs(d.countryBalance('DE').tax - base * CYCLES.boom.tax) < 1);
    d.cycle = { phase: 'recession', until: d.turn + 5 };
    assert.ok(d.countryBalance('DE').tax < base);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.cycle.phase, 'recession');
    const seen = new Set();
    for (let t = 0; t < 200; t++) { d.turn = t; Economy.advanceCycle(d); seen.add(d.cycle.phase); }
    assert.ok(seen.has('boom') && seen.has('recession') && seen.has('normal'));
    const bad = d.serialize(); bad.cycle = { phase: 'crash', until: 3 };
    assert.throws(() => GameData.restore(bad));
});

test('infrastructure raises regional taxes and loyalty target; old saves get level 0', () => {
    const { GameData } = engine(), d = new GameData('DE');
    const region = d.getCountryRegions('DE')[0];
    d.countries.DE.money = 1e9;
    const tax = d.countryBalance('DE').tax;
    assert.equal(d.act('invest', region.id, 'infra').ok, true);
    d.projects.find(p => p.regionId === region.id).remaining = 1;
    d.processProjects();
    assert.equal(region.development.infra, 1);
    assert.ok(d.countryBalance('DE').tax > tax);
    const old = d.serialize();
    for (const r of Object.values(old.regions)) delete r[5].infra;
    const back = GameData.restore(JSON.parse(JSON.stringify(old)));
    assert.equal(back.regions[region.id].development.infra, 0);
});

// --- восстания ---
test('unrest: low loyalty builds up, a revolt stops taxes and the region secedes to a neighbour', () => {
    const { GameData, Unrest, REVOLT } = engine(), d = new GameData('DE');
    const region = d.getCountryRegions('DE').find(r => r.id !== d.countries.DE.capital);
    const tax = d.countryBalance('DE').tax;
    region.loyalty = 0.2;
    const events = [];
    let turns = 0;
    while (!d.revolts[region.id] && turns < 20) { region.loyalty = 0.2; Unrest.update(d, events); turns++; }
    assert.ok(d.revolts[region.id], 'восстание вспыхнуло');
    assert.ok(events.some(e => e.for === 'DE' && e.message.includes('зреет')), 'было предупреждение');
    assert.ok(events.some(e => e.for === 'DE' && e.message.includes('Восстание')));
    assert.ok(d.countryBalance('DE').tax < tax, 'восставшая область не платит');
    const sponsor = d.revolts[region.id].sponsor;
    assert.ok(sponsor && sponsor !== 'DE');
    for (let i = 0; i < REVOLT.TURNS; i++) Unrest.update(d, events);
    assert.notEqual(region.owner, 'DE', 'область отделилась');
    assert.ok(!d.revolts[region.id]);
    assert.ok(events.some(e => e.for === 'DE' && e.message.includes('отделилась')));
});

test('unrest: suppress with a strong garrison, appease with money', () => {
    const { GameData, Unrest } = engine(), d = new GameData('DE');
    const [a, b] = d.getCountryRegions('DE');
    Unrest.start(d, a.id, []);
    a.army.tanks += 200;
    const r = d.act('suppressRevolt', a.id);
    assert.equal(r.won, true);
    assert.ok(!d.revolts[a.id]);
    Unrest.start(d, b.id, []);
    b.army = d.emptyArmy();
    const lost = d.act('suppressRevolt', b.id);
    assert.equal(lost.won, false);
    assert.equal(d.act('suppressRevolt', b.id).ok, false, 'раз в ход');
    d.countries.DE.money = 1e9;
    const paid = d.act('appeaseRevolt', b.id);
    assert.equal(paid.ok, true);
    assert.ok(!d.revolts[b.id]);
    assert.ok(b.loyalty >= 0.6);
});

test('unrest: a human neighbour decides; civil war cuts taxes; revolts are saved', () => {
    const { GameData, Unrest, REVOLT } = engine(), d = new GameData('DE', { humans: ['PL'] });
    const region = d.getCountryRegions('DE').find(r => r.id !== d.countries.DE.capital && d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'PL'));
    d.relations[d.pairKey('DE', 'PL')] = -90;   // поляки — главный соперник
    d.turn = 5;
    Unrest.start(d, region.id, []);
    assert.equal(d.revolts[region.id].sponsor, 'PL');
    assert.ok(d.seats.PL.decisions.some(x => x.type === 'rebels'));
    d.withPlayer('PL', () => d.act('answerDecision', true));
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.revolts[region.id].accepted, true);
    for (let i = 0; i < REVOLT.TURNS; i++) Unrest.update(d, []);
    assert.equal(region.owner, 'PL');
    // гражданская война
    const e = new GameData('DE');
    const tax = e.countryBalance('DE').tax;
    const [x, y] = e.getCountryRegions('DE').filter(r => r.id !== e.countries.DE.capital);
    Unrest.start(e, x.id, []); Unrest.start(e, y.id, []);
    assert.equal(Unrest.civilWar(e, 'DE'), true);
    const expected = (tax - (x.population + y.population) * e.countries.DE.taxRate) * REVOLT.CIVIL_TAX;
    assert.ok(e.countryBalance('DE').tax < tax * REVOLT.CIVIL_TAX);
    assert.ok(Math.abs(e.countryBalance('DE').tax - expected) / expected < 0.1);
});

test('unrest: a revolt in the capital ends with a coup, not a lost country', () => {
    const { GameData, Unrest, REVOLT } = engine(), d = new GameData('DE');
    const capital = d.regions[d.countries.DE.capital];
    d.countries.DE.taxRate = 0.3; d.countries.DE.influence = 40;
    const money = d.countries.DE.money;
    Unrest.start(d, capital.id, []);
    const events = [];
    for (let i = 0; i < REVOLT.TURNS; i++) Unrest.update(d, events);
    assert.equal(capital.owner, 'DE');
    assert.equal(d.countries.DE.taxRate, 0.1);
    assert.equal(d.countries.DE.influence, 0);
    assert.ok(d.countries.DE.money < money);
    assert.ok(events.some(e => e.message.includes('Переворот')));
});

// --- сделки между игроками ---
test('trade: package deal with money, stock, regions and peace executes at once', () => {
    const { GameData, Trade, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.turn = 20; d.countries.DE.influence = 100;
    d.declareWar('DE', 'PL');
    const plRegion = Trade.tradableRegions(d, 'PL', 'DE')[0];
    assert.ok(plRegion);
    d.countries.DE.stock.food = 50;
    const moneyDE = d.countries.DE.money, moneyPL = d.countries.PL.money;
    const offer = { give: { money: 5e6, food: 20 }, get: { regions: [plRegion.id] }, treaties: ['peace', 'deal'] };
    assert.equal(d.act('proposeTrade', 'PL', { ...offer, treaties: ['deal'] }).ok, false, 'договор при войне — только с миром');
    assert.equal(d.act('proposeTrade', 'PL', { give: { regions: [plRegion.id] } }).ok, false, 'чужую область не отдать');
    assert.equal(d.act('proposeTrade', 'PL', offer).ok, true);
    assert.equal(d.act('proposeTrade', 'PL', offer).ok, false, 'вторая сделка — после ответа');
    assert.equal(d.countries.DE.money, moneyDE, 'до согласия ничего не списано');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.ok(back.seats.PL.decisions.some(x => x.type === 'trade'));
    const r = d.withPlayer('PL', () => d.act('answerDecision', true));
    assert.equal(r.accepted, true);
    assert.equal(d.isAtWar('DE', 'PL'), false);
    assert.equal(Diplomacy.hasDeal(d, 'DE', 'PL'), true);
    assert.equal(d.regions[plRegion.id].owner, 'DE');
    assert.equal(d.countries.DE.money, moneyDE - 5e6);
    assert.equal(d.countries.PL.money, moneyPL + 5e6);
    assert.equal(d.countries.DE.stock.food, 30);
    assert.ok(d.takeDiploEvents().some(e => e.for === 'DE' && e.message.includes('принимает сделку')));
});

test('trade: declined or impossible deals change nothing', () => {
    const { GameData } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.act('proposeTrade', 'PL', { give: { money: 1e6 }, get: { money: 2e6 } });
    const money = d.countries.DE.money;
    d.withPlayer('PL', () => d.act('answerDecision', false));
    assert.equal(d.countries.DE.money, money);
    assert.ok(d.takeDiploEvents().some(e => e.message.includes('отклоняет')));
    d.act('proposeTrade', 'PL', { give: { money: 1e6 } });
    d.countries.DE.money = 0;                 // деньги кончились до ответа
    const r = d.withPlayer('PL', () => d.act('answerDecision', true));
    assert.equal(r.accepted, false);
    assert.ok(r.failed);
    assert.equal(d.countries.DE.money, 0);
    assert.equal(d.act('proposeTrade', 'FR', { give: { money: 1 } }).ok, false, 'с ИИ сделок нет');
    assert.equal(d.act('proposeTrade', 'PL', {}).ok, false, 'пустая сделка');
});

// --- союзники ---
test('allies: troops go only to an adjacent ally region and become theirs', () => {
    const { GameData, Diplomacy } = engine(), d = new GameData('DE', { humans: ['PL'] });
    const from = d.getCountryRegions('DE').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'PL'));
    const to = d.getNeighbors(from.id).find(id => d.regions[id]?.owner === 'PL');
    from.army.infantry = 20;
    assert.equal(d.act('giveTroops', from.id, to, { infantry: 5 }).ok, false, 'без союза нельзя');
    Diplomacy.sign(d, 'DE', 'PL', 'alliance');
    const before = d.regions[to].army.infantry;
    assert.equal(d.act('giveTroops', from.id, to, { infantry: 5 }).ok, true);
    assert.equal(from.army.infantry, 15);
    assert.equal(d.regions[to].army.infantry, before + 5);
    assert.ok(d.takeDiploEvents().some(e => e.for === 'PL' && e.message.includes('передаёт вам войска')));
    assert.equal(d.act('giveTroops', from.id, to, { infantry: 500 }).ok, false);
});

test('allies: a joint operation is visible to allies, boosts the planned strike, then expires', () => {
    const { GameData, Diplomacy, RULES } = engine(), d = new GameData('DE', { humans: ['PL'] });
    d.turn = 20; d.countries.DE.influence = 100;
    const target = d.getCountryRegions('CZ').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'DE'));
    assert.equal(d.act('planOperation', target.id).ok, false, 'не воюем');
    d.declareWar('DE', 'CZ');
    assert.equal(d.act('planOperation', target.id).ok, false, 'нужен союзник');
    Diplomacy.sign(d, 'DE', 'PL', 'alliance');
    assert.equal(d.act('planOperation', target.id).ok, true);
    assert.equal(d.visibleOperations('PL').length, 1, 'союзник видит операцию');
    assert.equal(d.visibleOperations('FR').length, 0);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.operations[0].target, target.id);
    // в свой ход удар сильнее
    const fight = withOp => {
        const g = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
        if (!withOp) g.operations = [];
        g.turn = 21;
        const from = g.getNeighbors(target.id).find(id => g.regions[id]?.owner === 'DE');
        g.regions[from].army.tanks = 30;
        g.queueAttack(from, target.id, { tanks: 30 }, 'DE');
        return g.processOrders().logs.find(l => l.for === 'DE');
    };
    const a = fight(true), b = fight(false);
    assert.ok(a.power.attack > b.power.attack);
    assert.ok(a.detail.includes('операции'));
    d.turn = 21; d.applyEndOfTurn();
    assert.equal(d.operations.length, 0, 'операция отработала и снята');
});

test('chronicle: records every turn for humans and top AI, survives save, rejects junk', () => {
    const { GameData, GameLoop, AI, Score } = engine(), d = new GameData('DE', { humans: ['PL'] });
    assert.equal(d.chronicle.countries.slice(0, 2).join(), 'DE,PL');
    assert.equal(d.chronicle.countries.length, 5);
    assert.equal(d.chronicle.turns.length, 1);
    const loop = mpLoop(GameLoop, AI, d);
    for (let t = 0; t < 3; t++) loop.resolveTurn();
    assert.equal(d.chronicle.turns.length, 4);
    assert.equal(d.chronicle.turns.map(t => t[0]).join(), '0,1,2,3');
    const row = d.chronicle.turns[3][1][0];
    assert.equal(row[0], d.regionsByCountry.DE.length);
    assert.equal(row[3], Score.total(d, 'DE'));
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(JSON.stringify(back.chronicle), JSON.stringify(d.chronicle));
    const bad = d.serialize(); bad.chronicle.turns[0][1][0] = [1, 2, 'x', 4];
    assert.throws(() => GameData.restore(bad));
    const old = d.serialize(); delete old.chronicle;
    assert.equal(GameData.restore(old).chronicle.turns.length, 1, 'старое сохранение начинает хронику заново');
});
