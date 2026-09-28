const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function engine(){
 const values=new Map();let seed=123456;const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const context=vm.createContext({console,Date,Math:math,structuredClone,localStorage:{setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;}}});
 for(const file of ['data/CountriesDB','data/RegionsDB','data/NeighborsDB','data/CitiesDB','data/SeasDB','UnitsDB','Tech','Economy','Diplomacy','Missions','Score','Events','Unrest','Trade','Council','Nuclear','World','Credit','Shipping','Navy','GameData','AI','Finance','GameLoop'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),context);
 return Object.assign(vm.runInContext('({SeasDB,Credit,BOND,IMF,Shipping,SHIPPING,STRAITS,Navy,NAVY,SHIPS,GameData,AI,SaveGame,GameLoop,RegionsDB,UnitsDB,DEVELOPMENT,POLICIES,Economy,RESOURCES,ECONOMY,Tech,TECH_TREE,MODERNIZATION,Diplomacy,DIPLOMACY,Missions,MISSION_KINDS,MISSION_RULES,Score,GOALS,Events,EVENTS,DEBT,CYCLES,INFRA,Unrest,REVOLT,Trade,Council,COUNCIL,RULES,Nuclear,NUCLEAR,World,WORLD,TRAITS})',context),{localStorage:context.localStorage});
}
test('casualties are invariant under splitting an attack into orders',()=>{
 const {GameData}=engine();const fight=split=>{const d=new GameData('UA',{scenario:'war2024'});for(const id of ['UA-2','RU-62']){d.regions[id].army=d.emptyArmy();d.regions[id].army.infantry=10;}
 for(let i=0;i<(split?10:1);i++)assert.equal(d.queueAttack('UA-2','RU-62',{infantry:split?1:10}).ok,true);
 const log=d.processOrders().logs.find(l=>l.losses);return JSON.stringify(log.losses);};assert.equal(fight(true),fight(false));assert.ok(JSON.parse(fight(true)).attacker.infantry>0);
});
test('orders validate ownership, adjacency, funds, finite integer counts and reservations',()=>{
 const {GameData}=engine(),d=new GameData('UA');for(const n of [NaN,Infinity,-1,0,0.5])assert.equal(d.queueRecruitment('UA-1','infantry',n).ok,false);
 assert.ok(Number.isFinite(d.countries.UA.money));assert.equal(d.queueMovement('UA-1','US-1',{infantry:1}).ok,false);assert.equal(d.queueAttack('UA-2','RU-62',{infantry:1}).ok,false);
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
test('map fingerprint changes with geometry; a save with the same regions loads as is, network campaigns keep their players',()=>{const {GameData,SaveGame,RegionsDB,localStorage}=engine();const d=new GameData('UA',{humans:['PL']});d.countries.UA.money=12345678;d.turn=7;d.net={id:'c1',code:'ABCD',clients:{},names:{}};SaveGame.campaignRole='host';assert.ok(SaveGame.save(d));const single=new GameData('UA');single.turn=4;SaveGame.save(single);const old=SaveGame.mapId();RegionsDB['CA-6'].path+='M0,0Z';SaveGame.signature=null;assert.notEqual(SaveGame.mapId(),old);const loaded=SaveGame.load();assert.ok(loaded,SaveGame.error);assert.equal(SaveGame.migrated,false,'форма границ — не повод для переноса');assert.equal(loaded.game.turn,4);assert.equal(loaded.map,SaveGame.mapId());const camp=SaveGame.loadCampaign('c1');assert.equal(camp.game.turn,7);assert.equal(camp.game.countries.UA[0],12345678);assert.equal(camp.game.humans.join(),'UA,PL','игроки кампании на месте');});
test('saves from another map are rejected and retained',()=>{const {GameData,SaveGame,localStorage}=engine();const save=new GameData('UA').serialize();const regions={};for(const [id,r] of Object.entries(save.regions))regions['X'+id]=r;save.regions=regions;localStorage.setItem(SaveGame.KEY,JSON.stringify({map:'old',game:save}));assert.equal(SaveGame.load(),null);assert.ok(SaveGame.error);assert.ok(localStorage.getItem(SaveGame.KEY));});
test('v2 saves from the previous version migrate with defaults for new fields',()=>{const {GameData,SaveGame,localStorage}=engine();const d=new GameData('DE',{scenario:'war2024'});d.startWar('DE','PL');d.setOwner('PL-1','DE');const v3=d.serialize();const v2={v:2,player:'DE',cheat:false,scenario:'war2024',date:v3.date,turn:5,regions:{},countries:{},wars:v3.wars,truces:[],orders:{recruitment:[],attacks:[],movements:[],recon:[]},decisions:[],history:[],gameOver:false};for(const [id,r] of Object.entries(v3.regions))v2.regions[id]=r.slice(0,4);for(const [id,c] of Object.entries(v3.countries))v2.countries[id]=c.slice(0,7);localStorage.setItem(SaveGame.KEY,JSON.stringify({map:'1996:AD-1:ZW-9',savedAt:1,game:v2}));const loaded=SaveGame.load();assert.ok(loaded,SaveGame.error);const r=GameData.restore(loaded.game);assert.equal(r.regions['PL-1'].owner,'DE');assert.equal(r.turn,5);assert.ok(r.isAtWar('DE','PL'));assert.equal(r.countries.DE.policy,'balanced');assert.equal(r.difficulty,'normal');});
test('export produces a file that imports back identically',()=>{const {GameData,SaveGame}=engine();const d=new GameData('BR',{difficulty:'hard'});d.turn=3;const file=SaveGame.exportFile(d);assert.match(file.name,/br-turn3\.json$/);const back=GameData.restore(SaveGame.parse(file.text).game);assert.equal(SaveGame.migrated,false);assert.equal(JSON.stringify(back.serialize()),JSON.stringify(d.serialize()));assert.throws(()=>SaveGame.parse('{"nope":1}'));});
test('difficulty scales the player budget and AI caution',()=>{const {GameData,AI}=engine();const money=l=>new GameData('FR',{difficulty:l}).countries.FR.money;assert.ok(money('easy')>money('normal'));assert.ok(money('hard')<money('normal'));const easy=new AI(new GameData('FR',{difficulty:'easy'})),hard=new AI(new GameData('FR',{difficulty:'hard'}));assert.ok(easy.rule('ATTACK_MARGIN')>hard.rule('ATTACK_MARGIN'));assert.equal(new AI(new GameData('FR')).rule('AI_WAR_CHANCE'),0.1);});
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
    assert.ok(Math.abs(after.tradeBonus - before.tradeBonus - DIPLOMACY.DEAL_BONUS) < 1e-9, 'сделка добавляет бонус к портовому');
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
    const money = d.countries.US.money, rel = Diplomacy.relation(d, 'US', weak);
    const r = d.diplomacyAction(weak, 'tribute');
    assert.ok(r.paid > 0);
    assert.equal(d.countries.US.money, money + r.paid);
    assert.equal(Diplomacy.relation(d, 'US', weak), rel + DIPLOMACY.TRIBUTE_RELATION);
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
    const timers = [];
    const context = vm.createContext({ console, JSON, Math, Map, String, Number, Array, Object, Date, setInterval: f => timers.push(f), clearInterval() {} });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/Net.js'), 'utf8') + ';this.NetLink = NetLink;this.NET = NET;', context);
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
    // «я на связи»: тишина дольше DEAD_MS — связь считается оборванной
    let closed = 0;
    const quiet = { open: true, send: x => sent.push(x), on: (e, f) => { handlers[e] = f; }, close() {} };
    sent.length = 0;
    const alive = new context.NetLink(quiet, () => {}, () => closed++);
    const beat = timers[timers.length - 1];
    beat();
    assert.ok(sent.some(x => x.h === 1), 'шлёт сигнал');
    handlers.data({ h: 1 });
    assert.equal(got.length, 1, 'сигнал — не сообщение');
    alive.lastSeen -= context.NET.DEAD_MS + 1;
    beat();
    assert.equal(closed, 1);
    beat(); handlers.close();
    assert.equal(closed, 1, 'сообщаем один раз');
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
    const expected = (tax - (e.taxBase(x) + e.taxBase(y)) * e.countries.DE.taxRate) * REVOLT.CIVIL_TAX;
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

test('UN: the Security Council puts sanctions on the aggressor; humans on the council vote; sanctions cut trade and expire; truce ends wars', () => {
    const { GameData, GameLoop, AI, Council, COUNCIL, Economy, Diplomacy } = engine();
    const d = new GameData('DE', { humans: ['PL'] });
    d.un.seats = ['PL', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'DK', 'AT', 'CZ'];
    // Германия напала на Францию и захватила три области
    d.startWar('DE', 'FR');
    for (const r of d.getCountryRegions('FR').filter(r => r.id !== d.countries.FR.capital).slice(0, 3)) d.setOwner(r.id, 'DE');
    assert.equal(Council.aggressor(d), 'DE');
    d.turn = COUNCIL.FIRST;
    const item = Council.agenda(d)[0];
    assert.equal(item.kind, 'sanctions');
    assert.equal(item.target, 'DE');
    const events = [];
    Council.open(d, item, events);
    assert.ok(events.some(e => e.message.includes('Совбез ООН')));
    assert.equal(d.decisions.length, 0, 'цель санкций не голосует');
    assert.equal(d.seatOf('PL').decisions[0].type, 'council');
    // Польша голосует «за» — командой, как в сетевой игре
    const guest = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    guest.becomePlayer('PL'); guest.recorder = [];
    guest.act('answerDecision', true);
    d.replay('PL', guest.recorder);
    assert.equal(d.council.votes.PL, true);
    assert.equal(d.council.votes.DE, false, 'голос цели — против сам');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(JSON.stringify(back.council), JSON.stringify(d.council));
    // члены Совбеза не любят захватчиков: принимают
    for (const cc of Council.members(d)) if (!d.isHuman(cc)) { Diplomacy.changeRelation(d, cc, 'DE', -50); delete d.deals[d.pairKey(cc, 'DE')]; delete d.alliances[d.pairKey(cc, 'DE')]; }
    const tradeBefore = Economy.runMarkets(GameData.restore(JSON.parse(JSON.stringify(d.serialize())))).DE;
    d.turn++;
    const out = [];
    const result = Council.resolve(d, out);
    assert.equal(result.passed, true, out.map(e => e.message).join());
    assert.ok(out.some(e => e.message.includes('Польша — за')));
    assert.ok(Council.sanctioned(d, 'DE'));
    assert.equal(d.council, null);
    const sold = r => Object.values(r.res).reduce((a, x) => a + x.sold + x.bought, 0);
    assert.ok(sold(Economy.runMarkets(d).DE) < sold(tradeBefore) * 0.8);
    d.turn += COUNCIL.SANCTION_TURNS;
    Council.resolve(d, out);
    assert.equal(Council.sanctioned(d, 'DE'), false);
    // всеобщее перемирие — Генассамблея, голосуют все
    const w = new GameData('FR');
    w.startWar('FR', 'ES'); w.startWar('IT', 'AT');
    w.turn = COUNCIL.FIRST;
    Council.open(w, { kind: 'truce' }, []);
    assert.equal(w.decisions[0].kind, 'truce');
    w.act('answerDecision', true);
    w.turn++; const r2 = Council.resolve(w, []);
    assert.equal(r2.passed, true);
    assert.equal(w.wars.size, 0);
    assert.ok(w.truceLeft('FR', 'ES') > 0);
    // и всё это — через обычный ход
    const g = new GameData('UA', { scenario: 'war2024' });
    const loop = mpLoop(GameLoop, AI, g);
    g.turn = COUNCIL.FIRST - 1; g.startWar('IT', 'AT');
    const rep = loop.resolveTurn();
    assert.ok(g.council, 'созван в ходе');
    assert.ok(rep.UA.turnData.events.some(m => m.includes('ООН')));
    const bad = g.serialize(); bad.council.council.kind = 'nope';
    assert.throws(() => GameData.restore(bad));
});

test('hot seat: queue survives save in the main slot, looking through another seat keeps it valid', () => {
    const { GameData, SaveGame } = engine();
    const d = new GameData('UA', { humans: ['PL'], hotseat: true });
    assert.equal(d.multiplayer, true);
    assert.equal(new GameData('UA', { hotseat: true }).hotseat, null, 'одному — не нужно');
    d.hotseat.done.push('UA');
    d.becomePlayer('PL');
    assert.ok(SaveGame.save(d));
    assert.equal(SaveGame.campaigns().length, 0, 'не сетевая кампания');
    const back = GameData.restore(SaveGame.load().game);
    assert.equal(back.playerCountry, 'PL');
    assert.equal(back.hotseat.done.join(), 'UA');
    assert.equal(JSON.stringify(back.serialize()), JSON.stringify(d.serialize()));
    const bad = d.serialize(); bad.hotseat.done = ['FR'];
    assert.throws(() => GameData.restore(bad));
});

test('a country with debt that loses its last region keeps a finite treasury; broken saves are repaired', () => {
    const { GameData } = engine(), d = new GameData('KZ', { humans: ['CN'] });
    const kg = d.countries.KG;
    kg.debt = 45900000;
    for (const r of [...d.getCountryRegions('KG')]) d.setOwner(r.id, 'KZ');
    d.onCapitalLost('KG');   // как при захвате столицы в бою
    d.applyEndOfTurn();
    assert.ok(Number.isFinite(kg.money), 'казна не NaN');
    assert.ok(Number.isFinite(kg.lastNetIncome));
    assert.ok(Number.isFinite(GameData.restore(JSON.parse(JSON.stringify(d.serialize()))).countries.KG.money));
    // сохранение, испорченное прежней ошибкой: казна null
    const broken = JSON.parse(JSON.stringify(d.serialize()));
    broken.countries.KG[0] = null; broken.countries.KG[4] = null;
    const fixed = GameData.restore(broken);
    assert.equal(fixed.countries.KG.money, 0);
    assert.equal(fixed.humans.join(), 'KZ,CN', 'люди и места на месте');
    // что именно не так — видно в сообщении
    const bad = JSON.parse(JSON.stringify(d.serialize())); bad.countries.KG[1] = 5;
    assert.throws(() => GameData.restore(bad), /страна KG/);
});

test('UN: the target does not vote against itself; a permanent member target vetoes and the case goes to the General Assembly', () => {
    const { GameData, Council, COUNCIL } = engine(), d = new GameData('FR', { humans: ['DE'] });
    d.un.seats = ['DE', 'IT', 'PL', 'NL', 'BE', 'SE', 'NO', 'DK', 'AT', 'CZ'];
    d.startWar('FR', 'ES');
    for (const r of d.getCountryRegions('ES').filter(r => r.id !== d.countries.ES.capital).slice(0, 3)) d.setOwner(r.id, 'FR');
    d.turn = COUNCIL.FIRST;
    const events = [];
    Council.open(d, Council.agenda(d).find(x => x.kind === 'sanctions'), events);
    assert.equal(d.council.target, 'FR');
    assert.equal(d.decisions.filter(x => x.type === 'council').length, 0, 'Франции не предлагают голосовать против себя');
    assert.equal(d.seatOf('DE').decisions.filter(x => x.type === 'council').length, 1, 'Германия в Совбезе голосует');
    assert.equal(d.council.votes.FR, false, 'голос цели — против');
    assert.ok(events.some(e => e.for === 'FR' && e.message.includes('против вас') && e.message.includes('3 области') && e.message.includes('вето')));
    assert.ok(events.some(e => e.exceptFor === 'FR' && e.message.includes('на голосовании')));
    assert.equal(Council.vote(d, 'FR', true), false, 'и командой «за» тоже нельзя');
    // старое сохранение, где решение уже лежит у цели, — отвечается «против» само
    d.decisions.push({ type: 'council', from: 'FR', kind: 'sanctions' });
    d.answerDecision(true);
    assert.equal(d.council.votes.FR, false);
    // Франция — постоянный член: её «против» — вето, дело уходит в Ассамблею
    d.turn++;
    const out = [];
    assert.equal(Council.resolve(d, out).passed, false);
    assert.ok(out.some(e => e.message.includes('Франция')));
    assert.ok(d.un.vetoed.some(v => v.target === 'FR'));
    assert.ok(Council.agenda(d).some(x => x.kind === 'condemn' && x.target === 'FR'));
    assert.equal(Council.regionsWord(1) + '|' + Council.regionsWord(21) + '|' + Council.regionsWord(12) + '|' + Council.regionsWord(5), '1 область|21 область|12 областей|5 областей');
});

test('battle: a strike from several regions gets a flank bonus; odds include strikes already queued', () => {
    const { GameData, RULES } = engine();
    const setup = () => {
        const d = new GameData('UA');
        d.startWar('UA', 'MD');
        const target = d.getCountryRegions('MD').find(r => d.getNeighbors(r.id).filter(id => d.regions[id]?.owner === 'UA').length >= 1);
        // две свои области рядом с целью
        let sources = d.getNeighbors(target.id).filter(id => d.regions[id]?.owner === 'UA');
        if (sources.length < 2) { const other = d.getNeighbors(target.id).find(id => d.regions[id] && d.regions[id].owner !== 'UA' && id !== target.id); d.setOwner(other, 'UA'); sources = d.getNeighbors(target.id).filter(id => d.regions[id]?.owner === 'UA'); }
        for (const id of sources) d.regions[id].army = { ...d.emptyArmy(), infantry: 20 };
        return { d, target, sources };
    };
    // один удар 20 пехоты из одной области
    const a = setup();
    a.d.queueAttack(a.sources[0], a.target.id, { infantry: 20 });
    const one = a.d.processOrders().logs.find(l => l.for === 'UA');
    // те же 20, но по 10 из двух областей
    const b = setup();
    b.d.queueAttack(b.sources[0], b.target.id, { infantry: 10 });
    const est = b.d.strikeEstimate(b.target.id, { infantry: 10 }, b.sources[1]);
    assert.equal(est.directions, 2);
    assert.ok(Math.abs(est.flank - RULES.FLANK_BONUS) < 1e-9);
    b.d.queueAttack(b.sources[1], b.target.id, { infantry: 10 });
    const two = b.d.processOrders().logs.find(l => l.for === 'UA');
    assert.ok(Math.abs(two.power.attack / one.power.attack - (1 + RULES.FLANK_BONUS)) < 0.02, `${two.power.attack} vs ${one.power.attack}`);
    assert.ok(two.detail.includes('направлений'));
    assert.equal(GameData.flankBonus(5), RULES.FLANK_MAX);
});

test('garrisons: troops sent to an ally stay mine, defend, cost upkeep, come home when the alliance ends', () => {
    const { GameData, Diplomacy, RULES } = engine();
    const d = new GameData('PL', { humans: ['DE'] });
    Diplomacy.sign(d, 'PL', 'DE', 'alliance');
    const from = d.getCountryRegions('PL').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'DE'));
    const to = d.getNeighbors(from.id).find(id => d.regions[id]?.owner === 'DE');
    from.army = { ...d.emptyArmy(), infantry: 30, tanks: 5 };
    const powerBefore = d.calculateMilitaryPower('PL'), upkeepBefore = d.countryBalance('PL').upkeep;
    const defBefore = d.defensePower(d.regions[to], { infantry: 10 });
    assert.equal(d.act('sendGarrison', from.id, to, { infantry: 20, tanks: 5 }).ok, true);
    assert.equal(from.army.infantry, 10);
    assert.equal(d.regions[to].army.infantry === undefined ? 0 : 1, 1, 'армия хозяина не тронута');
    assert.equal(d.garrisonsIn(to)[0].cc, 'PL');
    assert.equal(d.calculateMilitaryPower('PL'), powerBefore, 'войска по-прежнему в силе Польши');
    assert.equal(d.countryBalance('PL').upkeep, upkeepBefore, 'и Польша за них платит');
    assert.ok(d.defensePower(d.regions[to], { infantry: 10 }) > defBefore, 'оборона области сильнее');
    assert.ok(d.seatOf('DE').diploEvents === undefined);
    assert.ok(d.diploEvents.some(e => e.for === 'DE' && e.message.includes('в помощь')));
    // сохранение
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.garrisonsIn(to)[0].army.infantry, 20);
    // бой: враг бьёт по области — контингент теряет долю и отходит домой при падении
    d.startWar('CZ', 'DE');
    const enemyFrom = d.getNeighbors(to).find(id => d.regions[id]?.owner === 'CZ');
    if (enemyFrom) {
        d.regions[enemyFrom].army = { ...d.emptyArmy(), tanks: 400 };
        d.queueAttack(enemyFrom, to, { tanks: 400 }, 'CZ');
        const { logs } = d.processOrders();
        assert.ok(logs.some(l => l.for === 'DE' && l.detail.includes('помогали')));
        if (d.regions[to].owner === 'CZ') assert.equal(d.garrisonsIn(to).length, 0, 'из павшей области отошли');
    }
    // возврат вручную
    const g = d.garrisonsOf('PL')[0];
    if (g) { const r = d.act('recallGarrison', g.region); assert.equal(r.ok, true); assert.equal(d.garrisonsOf('PL').length, 0); }
    // союз распался — войска дома сами
    const e = new GameData('PL', { humans: ['DE'] });
    Diplomacy.sign(e, 'PL', 'DE', 'alliance');
    const f2 = e.getCountryRegions('PL').find(r => e.getNeighbors(r.id).some(id => e.regions[id]?.owner === 'DE'));
    const t2 = e.getNeighbors(f2.id).find(id => e.regions[id]?.owner === 'DE');
    f2.army = { ...e.emptyArmy(), infantry: 10 };
    e.act('sendGarrison', f2.id, t2, { infantry: 10 });
    delete e.alliances[e.pairKey('PL', 'DE')];
    const { events } = e.applyEndOfTurn();
    assert.equal(e.garrisonsOf('PL').length, 0);
    assert.ok(events.some(x => x.for === 'PL' && x.message.includes('вернулись домой')));
    assert.ok(e.getCountryRegions('PL').reduce((a, r) => a + r.army.infantry, 0) >= 10 * 0.8, 'войска дома (с учётом дезертирства)');
    const bad = d.serialize(); bad.garrisons = { 'XX-1': {} };
    assert.throws(() => GameData.restore(bad), /войска союзников/);
});

test('a campaign from the previous map is laid onto the re-cut regions and keeps its players', () => {
    const { GameData, SaveGame, RegionsDB } = engine();
    const d = new GameData('UA', { humans: ['PL'] });
    d.net = { id: 'c1', code: 'ABCD', clients: {}, names: {} };
    const [a, b] = Object.keys(RegionsDB).filter(id => RegionsDB[id].cc === 'UA' && d.regions[id].owner === 'UA' && id !== d.countries.UA.capital);
    // на прежней карте: область a захвачена Польшей, в b стоят войска
    d.setOwner(a, 'PL');
    d.regions[b].army = { ...d.emptyArmy(), infantry: 40 };
    d.regions[a].army = { ...d.emptyArmy(), infantry: 5 };
    const money = d.countries.UA.money;
    assert.equal(d.queueRecruitment(b, 'infantry', 1).ok, true);
    const game = d.serialize();
    // новая карта: b влилась в a, а новая b вышла из прежней a
    const saved = SaveGame.remap;
    SaveGame.remap = { from: 'map-old', sources: { [b]: a }, heirs: { [b]: a } };
    try {
        const p = SaveGame.parse(JSON.stringify({ map: 'map-old', savedAt: 1, game }));
        assert.equal(SaveGame.migrated, true);
        assert.equal(p.map, SaveGame.mapId());
        assert.equal(p.game.humans.join(), 'UA,PL', 'игроки кампании на месте');
        assert.ok(p.game.net, 'сеть кампании на месте');
        assert.equal(p.game.regions[b][0], 'PL', 'новая b — от прежней a');
        assert.equal(p.game.regions[a][1][game.units.indexOf('infantry')], 45, 'войска b ушли в a');
        assert.equal(p.game.regions[b][1].reduce((s, n) => s + n, 0), 0);
        assert.equal(p.game.countries.UA[0], money, 'приказ хода отменён с возвратом денег');
        assert.equal(p.game.orders.recruitment.length, 0);
        GameData.restore(p.game);
    } finally { SaveGame.remap = saved; }
});

test('nuclear: real powers start armed; research, build, first test alarms the world and the council', () => {
    const { GameData, Nuclear, NUCLEAR, Council, Diplomacy, Tech } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    assert.ok(Nuclear.isPower(d, 'RU') && Nuclear.isPower(d, 'US') && !Nuclear.isPower(d, 'UA'));
    assert.ok(Tech.has(d.countries.RU, 'hydrogen') && !Tech.has(d.countries.UA, 'nuclear'));
    const ua = d.countries.UA;
    assert.equal(d.act('nuclearBuild', 'atom').ok, false, 'без технологии нельзя');
    Tech.grant(ua, 'nuclear');
    ua.money = 100e6;
    const upkeep0 = d.countryBalance('UA').upkeep;
    assert.equal(d.act('nuclearBuild', 'hydrogen').ok, false, 'водородная — отдельная технология');
    assert.equal(d.act('nuclearBuild', 'atom').ok, true);
    assert.equal(ua.money, 100e6 - NUCLEAR.KINDS.atom.cost);
    assert.equal(d.act('nuclearBuild', 'atom').ok, false, 'одна сборка за раз');
    const relPL = Diplomacy.relation(d, 'UA', 'PL'), relUS = Diplomacy.relation(d, 'UA', 'US'), relJP = Diplomacy.relation(d, 'UA', 'JP');
    for (let i = 0; i < NUCLEAR.KINDS.atom.turns; i++) { d.turn++; d.applyEndOfTurn(); }
    assert.equal(Nuclear.stock(d, 'UA').atom, 1);
    assert.ok(d.nuclear.powers.includes('UA'));
    assert.ok(Diplomacy.relation(d, 'UA', 'PL') < relPL, 'соседи встревожены');
    assert.ok(Diplomacy.relation(d, 'UA', 'US') - relUS < Diplomacy.relation(d, 'UA', 'JP') - relJP, 'ядерные державы — сильнее прочих');
    assert.ok(d.countryBalance('UA').upkeep >= upkeep0 + NUCLEAR.KINDS.atom.upkeep - 1, 'арсенал стоит содержания');
    // совет ставит на голосование санкции за программу
    d.turn = 10; const events = [];
    const item = Council.agenda(d).find(x => x.kind === 'nuclear');
    assert.equal(item.target, 'UA');
    Council.open(d, item, events);
    assert.equal(d.council.kind, 'nuclear');
    assert.equal(d.council.target, 'UA');
    assert.equal(d.council.votes.UA, false, 'против себя не голосуют');
    assert.equal(Council.aiVote(d, 'US', d.council), true, 'прежние ядерные державы — за');
    // отмена сборки возвращает деньги
    Tech.grant(ua, 'hydrogen');
    const m = ua.money = 100e6;
    d.act('nuclearBuild', 'hydrogen');
    assert.equal(d.act('nuclearCancel').refund, NUCLEAR.KINDS.hydrogen.cost);
    assert.equal(ua.money, m);
});

test('nuclear: a strike needs war and influence, devastates the region, brings sanctions; the AI answers in kind', () => {
    const { GameData, Nuclear, NUCLEAR, AI, Diplomacy, Council } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    d.nuclear.arsenal.UA = { atom: 1, hydrogen: 1 };
    const target = d.getNeighbors(d.getCountryRegions('UA').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'RU')).id).find(id => d.regions[id]?.owner === 'RU');
    const pl = d.getCountryRegions('PL')[0].id;
    assert.equal(d.act('nuclearStrike', pl, 'atom').ok, false, 'только по стране, с которой война');
    d.countries.UA.influence = 10;
    assert.equal(d.act('nuclearStrike', target, 'atom').ok, false, 'нужно влияние');
    d.countries.UA.influence = 100;
    const r = d.regions[target];
    r.army = { ...d.emptyArmy(), infantry: 100, tanks: 20 };
    r.development.industry = 2; r.resources.industry += 40;
    const pop = r.population, rel = Diplomacy.relation(d, 'UA', 'DE');
    const res = d.act('nuclearStrike', target, 'hydrogen');
    assert.equal(res.ok, true);
    assert.ok(r.army.infantry <= 5 && r.army.tanks <= 1, 'армия стёрта');
    assert.equal(r.population, pop - Math.round(pop * NUCLEAR.KINDS.hydrogen.people));
    assert.equal(r.development.industry, 0, 'постройки разрушены');
    assert.ok(Nuclear.fallout(d, target));
    assert.equal(d.countries.UA.influence, 100 - NUCLEAR.KINDS.hydrogen.influence);
    assert.ok(Council.sanctioned(d, 'UA'), 'санкции без голосования');
    assert.ok(Diplomacy.relation(d, 'UA', 'DE') <= rel + NUCLEAR.KINDS.hydrogen.relation);
    assert.equal(Nuclear.stock(d, 'UA').hydrogen, 0);
    // заражённая область налогов не платит
    const tax = d.countryBalance('RU').tax;
    d.nuclear.fallout[target] = d.turn - 1;
    assert.ok(d.countryBalance('RU').tax > tax);
    d.nuclear.fallout[target] = d.turn + 3;
    // ответ ИИ: по самой населённой области обидчика
    const biggest = d.getCountryRegions('UA').reduce((a, b) => (b.population > a.population ? b : a)).id;
    new AI(d).planNuclear(d.countries.RU);
    const answer = d.nuclear.strikes.find(s => s.by === 'RU');
    assert.ok(answer && answer.retaliation && answer.target === 'UA');
    assert.equal(answer.region, biggest);
    assert.ok(d.diploEvents.some(e => e.for === 'UA' && e.message.includes('Россия нанесла ядерный удар')));
    // сохранение и загрузка
    const back = GameData.restore(structuredClone(d.serialize()));
    assert.equal(JSON.stringify(back.nuclear), JSON.stringify(d.nuclear));
});

test('nuclear: deterrence — the AI does not start wars on nuclear powers and seeks peace with them; old saves get the 2024 arsenals', () => {
    const { GameData, Nuclear, AI } = engine();
    const d = new GameData('PL');
    assert.equal(Nuclear.deterrence(d, 'DE', 'FR'), 0, 'без бомбы на ядерную державу не нападают');
    assert.equal(Nuclear.deterrence(d, 'US', 'RU'), 0.3);
    assert.equal(Nuclear.deterrence(d, 'FR', 'DE'), 1);
    d.startWar('DE', 'FR');
    assert.equal(new AI(d).acceptsPeace('DE', 'FR'), true);
    const old = d.serialize(); delete old.nuclear;
    for (const c of Object.values(old.countries)) c[12] = c[12].filter(t => t !== 'nuclear' && t !== 'hydrogen');
    const e = GameData.restore(old);
    assert.equal(Nuclear.describe(e, 'RU'), Nuclear.describe(d, 'RU'));
    assert.ok(e.countries.FR.techs.includes('hydrogen'));
});

test('UN: who is the aggressor — a defender who pushed the invader back is not; treaties and secession are not conquest', () => {
    const { GameData, Council, COUNCIL } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    // Россия напала; Украина отбилась и заняла три области России
    const ru = d.getCountryRegions('RU').filter(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'UA')).slice(0, 3);
    for (const r of ru) d.setOwner(r.id, 'UA');
    assert.equal(Council.taken(d, 'UA'), 0, 'отбить у напавшего — не агрессия');
    assert.equal(Council.aggressor(d), null);
    // и после мира тоже
    d.makePeace('UA', 'RU');
    assert.equal(Council.taken(d, 'UA'), 0);
    d.turn = COUNCIL.FIRST;
    assert.ok(!Council.agenda(d).some(x => x.target === 'UA' && ['sanctions', 'embargo', 'enforce', 'condemn'].includes(x.kind)));
    // Россия проиграла начатую войну — Генассамблея может назначить репарации
    assert.ok(Council.agenda(d).some(x => x.kind === 'reparations' && x.target === 'RU' && x.victim === 'UA'));
    // союзник жертвы, вступивший по договору, — тоже защитник
    const e = new GameData('PL');
    e.alliances[e.pairKey('FR', 'BE')] = 0;
    e.startWar('DE', 'BE');
    assert.ok(e.isAtWar('FR', 'DE'));
    for (const r of e.getCountryRegions('DE').slice(0, 3)) e.setOwner(r.id, 'FR');
    assert.equal(Council.taken(e, 'FR'), 0);
    // а напавший — агрессор
    for (const r of e.getCountryRegions('BE').filter(r => r.id !== e.countries.BE.capital).slice(0, 1)) e.setOwner(r.id, 'DE');
    assert.equal(Council.taken(e, 'DE'), Math.min(1, e.getCountryRegions('DE').filter(r => r.originalOwner === 'BE').length));
    // область, отданная по договору, — не захват
    const f = new GameData('PL');
    const gift = f.getCountryRegions('CZ').find(r => r.id !== f.countries.CZ.capital);
    f.handoverRegion(gift.id, 'CZ', 'DE');
    assert.equal(Council.taken(f, 'DE'), 0);
    // а отнятая в бою после этого — снова захват
    f.setOwner(gift.id, 'CZ'); f.startWar('DE', 'CZ'); f.setOwner(gift.id, 'DE');
    assert.equal(Council.taken(f, 'DE'), 1, 'отнятая в бою — захват');
});

test('UN measures: embargo, peacekeepers, ceasefire, enforcement coalition, condemnation, aid and reparations', () => {
    const { GameData, Council, COUNCIL, Diplomacy } = engine();
    const d = new GameData('PL', { humans: ['UA'] });
    const apply = (item, ayes = []) => Council.apply(d, { votes: {}, victim: null, against: null, pair: null, target: null, ...item }, ayes, []);
    // эмбарго: новые рода войск и модернизация закрыты
    d.startWar('DE', 'CZ');
    const de = d.countries.DE;
    de.techs.push('motorized'); de.money = 1e9;
    const region = d.getCountryRegions('DE')[0].id;
    apply({ kind: 'embargo', target: 'DE', victim: 'CZ' });
    assert.ok(Council.embargoed(d, 'DE'));
    assert.equal(d.queueRecruitment(region, 'mech', 1, 'DE').ok, false);
    assert.equal(d.queueRecruitment(region, 'infantry', 1, 'DE').ok, true, 'пехоту — можно');
    assert.equal(d.research('DE', 'infantry').ok, false);
    // миротворцы: приграничная область жертвы держится крепче
    const border = d.getCountryRegions('CZ').find(r => d.getNeighbors(r.id).some(id => d.regions[id]?.owner === 'DE'));
    const before = d.defensePower(border, d.emptyArmy());
    apply({ kind: 'peacekeepers', target: 'CZ', against: 'DE' });
    assert.ok(Math.abs(d.defensePower(border, d.emptyArmy()) / before - COUNCIL.PEACEKEEPING_DEFENSE) < 1e-9);
    // прекращение огня
    apply({ kind: 'ceasefire', pair: ['CZ', 'DE'] });
    assert.equal(d.isAtWar('DE', 'CZ'), false);
    assert.ok(d.truceLeft('DE', 'CZ') > 0);
    // принуждение к миру: соседи агрессора из голосовавших «за» вступают в войну — и это не агрессия
    d.startWar('DE', 'CZ');
    const ayes = d.neighbourCountries('DE').filter(cc => cc !== 'CZ' && !d.isHuman(cc) && d.countries[cc].playable);
    apply({ kind: 'enforce', target: 'DE', victim: 'CZ' }, ayes);
    const coalition = ayes.filter(cc => d.isAtWar(cc, 'DE'));
    assert.ok(coalition.length >= 1 && coalition.length <= COUNCIL.ENFORCE_ALLIES);
    for (const r of d.getCountryRegions('DE').filter(r => r.id !== de.capital).slice(0, 2)) d.setOwner(r.id, coalition[0]);
    assert.equal(Council.taken(d, coalition[0]), 0);
    assert.ok(Council.sanctioned(d, 'DE'));
    // осуждение Ассамблеей
    de.influence = 50;
    const rel = Diplomacy.relation(d, 'DE', 'FR');
    apply({ kind: 'condemn', target: 'DE' }, ['FR']);
    assert.equal(de.influence, 50 - COUNCIL.CONDEMN_INFLUENCE);
    assert.equal(Diplomacy.relation(d, 'DE', 'FR'), Math.max(-100, rel + COUNCIL.CONDEMN_RELATION));
    // гуманитарная помощь
    const money = d.countries.UA.money;
    apply({ kind: 'aid', target: 'UA' });
    assert.ok(d.countries.UA.money > money);
    // репарации: каждый ход, пока не выплачено
    apply({ kind: 'reparations', target: 'DE', victim: 'CZ' });
    const cz = d.countries.CZ.money, per = d.un.reparations[0].amount;
    const events = [];
    d.turn++; Council.upkeep(d, events);
    assert.equal(d.countries.CZ.money, cz + per);
    assert.equal(d.un.reparations[0].left, COUNCIL.REPARATION_TURNS - 1);
    // сроки: всё снимается само
    d.turn += 20; Council.upkeep(d, events);
    assert.equal(Council.embargoed(d, 'DE'), false);
    assert.equal(Object.keys(d.un.peacekeepers).length, 0);
    assert.ok(events.some(e => e.message.includes('эмбарго снято')));
    // выборы в Совбез раз в срок; сохранение
    assert.equal(d.un.seats.length, COUNCIL.SC_ELECTED);
    assert.ok(!d.un.seats.some(cc => COUNCIL.SC_PERMANENT.includes(cc)));
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(JSON.stringify(back.un), JSON.stringify(d.un));
    // партия до ООН: летопись берётся из идущих войн, Совбез выбирается заново
    const old = d.serialize(); delete old.council.un;
    const o = GameData.restore(old);
    assert.equal(o.un.seats.length, COUNCIL.SC_ELECTED);
    assert.equal(o.un.wars[o.pairKey('DE', 'CZ')].aggressor, 'DE');
});

test('UN events: peacekeepers request, IAEA, border incident, tribunal and UN fund work both ways', () => {
    const { GameData, Council, Events, EVENTS, Tech, Diplomacy, Nuclear } = engine();
    const fresh = () => {
        const d = new GameData('PL');
        d.startWar('DE', 'CZ');
        d.un.peacekeepers.CZ = { against: 'DE', until: d.turn + 5 };
        return d;
    };
    const run = (d, key, choice) => {
        const decision = { type: 'event', from: 'PL', event: key, ctx: EVENTS[key].when(d, 'PL') };
        assert.ok(decision.ctx, `${key}: условие выполнено`);
        assert.ok(Events.validDecision(JSON.parse(JSON.stringify(decision))), `${key}: решение сохраняется`);
        const text = Events.apply(d, decision, choice);
        assert.equal(typeof text, 'string');
        return { text, ctx: decision.ctx };
    };
    // миротворцы
    let d = fresh();
    const home = d.regions[d.countries.PL.capital];
    home.army.infantry = 20;
    const infl = d.countries.PL.influence;
    run(d, 'un_peacekeepers', true);
    assert.equal(home.army.infantry, 15);
    assert.equal(d.countries.PL.influence, Math.min(100, infl + 8));
    // МАГАТЭ: только у тех, кто сам завёл бомбу
    d = fresh();
    assert.equal(EVENTS.iaea.when(d, 'PL'), null);
    Tech.grant(d.countries.PL, 'nuclear');
    d.nuclear.arsenal.PL = { atom: 1, hydrogen: 0 };
    run(d, 'iaea', false);
    assert.ok(d.nuclear.council.includes('PL'), 'отказ — ООН обратит внимание');
    // инцидент на границе
    d = fresh();
    run(d, 'border_incident', true);
    run(d, 'border_incident', false);
    // суд ООН: захваченная область возвращается
    d = fresh();
    d.startWar('PL', 'LT');
    const lt = d.getCountryRegions('LT').find(r => r.id !== d.countries.LT.capital);
    d.setOwner(lt.id, 'PL');
    d.makePeace('PL', 'LT');
    const { ctx } = run(d, 'tribunal', true);
    assert.equal(d.regions[ctx.region].owner, 'LT');
    assert.equal(Council.taken(d, 'PL'), 0);
    // отказ — дело в Ассамблее
    d.startWar('PL', 'LT');
    d.setOwner(lt.id, 'PL');
    d.makePeace('PL', 'LT');
    run(d, 'tribunal', false);
    assert.ok(d.un.vetoed.some(v => v.target === 'PL'));
    // взнос в фонд ООН
    d = fresh();
    d.countries.PL.money = 1e9;
    const rel = Diplomacy.relation(d, 'PL', 'CZ');
    run(d, 'un_fund', true);
    assert.ok(Diplomacy.relation(d, 'PL', 'CZ') > rel, 'жертва войны благодарна');
});

test('economy by GDP per capita: rich countries pay more per person; conquered land pays as it used to; world money stays the same', () => {
    const { GameData, Economy } = engine();
    const d = new GameData('PL');
    assert.ok(Economy.wealth('US') > 3 * Economy.wealth('IN'), 'американец богаче индийца');
    assert.ok(Economy.wealth('LU') <= 4 && Economy.wealth('ET') >= 0.2, 'разрыв сглажен');
    // деньги мира в сумме не изменились: Σ население × богатство ≈ Σ население
    const { CountriesDB } = require('../js/data/CountriesDB.js');
    let pop = 0, weighted = 0;
    for (const [cc, c] of Object.entries(CountriesDB)) if (c.playable && c.gdp > 0) { pop += c.population; weighted += c.population * Economy.wealth(cc); }
    assert.ok(Math.abs(weighted / pop - 1) < 0.05);
    // налог США больше индийского, хотя людей вчетверо меньше
    assert.ok(d.countryBalance('US').tax / d.countries.US.taxRate > d.countryBalance('IN').tax / d.countries.IN.taxRate);
    // захваченная область платит по богатству своей земли
    const r = d.getCountryRegions('DE').find(x => x.id !== d.countries.DE.capital);
    const base = d.taxBase(r);
    d.setOwner(r.id, 'PL');
    assert.equal(d.taxBase(r), base);
    // у всех стран на старте конечный бюджет, почти все — не в минусе
    let broke = 0, total = 0;
    for (const c of Object.values(d.countries)) {
        if (!c.playable || !d.regionsByCountry[c.id].length) continue;
        const b = d.steadyBalance(c.id);
        assert.ok(Number.isFinite(b.income - b.expense), c.id);
        total++; if (b.income < b.expense) broke++;
    }
    assert.ok(broke / total < 0.05, `в минусе ${broke} из ${total}`);
});

test('world 2024: blocs and rivalries at start, traits per game are saved; partners help a weaker victim of aggression', () => {
    const { GameData, Diplomacy, World, TRAITS, AI } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    assert.ok(Diplomacy.relation(d, 'DE', 'FR') >= 35);
    assert.ok(Diplomacy.relation(d, 'US', 'KP') <= -50);
    assert.ok(Diplomacy.relation(d, 'IN', 'PK') <= -50);
    assert.ok(Diplomacy.relation(d, 'DE', 'UA') >= 25);
    for (const c of Object.values(d.countries)) if (c.playable) assert.ok(TRAITS[d.traits[c.id]], c.id);
    assert.notEqual(d.traits.RU, 'isolationist');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(JSON.stringify(back.traits), JSON.stringify(d.traits));
    // старая партия без характеров получает их при загрузке
    const old = d.serialize(); delete old.traits;
    assert.ok(Object.keys(GameData.restore(old).traits).length > 100);
    // помощь Украине от друзей, пока Россия сильнее
    const money = d.countries.UA.money, us = d.countries.US.money;
    const events = [];
    World.endTurn(d, events);
    const aid = d.countries.UA.money - money;
    assert.ok(aid > 0, 'помощь пришла');
    assert.ok(d.countries.US.money < us, 'США заплатили');
    assert.ok(aid <= d.countryBalance('UA').upkeep * 0.6 + 1, 'не больше доли содержания армии');
    assert.ok(events.some(e => e.for === 'UA' && e.message.includes('Помощь партнёров')));
});

test('AI traits: an expansionist starts most wars, rivals are preferred, the sanctioned wait', () => {
    const { GameData, AI, Diplomacy } = engine();
    const d = new GameData('IS');
    const ai = new AI(d);
    d.turn = 20;
    for (const c of Object.values(d.countries)) c.influence = 100;
    for (const cc of Object.keys(d.traits)) d.traits[cc] = 'isolationist';
    d.traits.SA = 'expansionist';
    // Саудовская Аравия сильнее Йемена и враждует с ним
    let sa = 0, n = 0, yemen = 0;
    for (let i = 0; i < 60; i++) { const p = ai.pickAiWar(); if (!p) continue; n++; if (p.attacker === 'SA') { sa++; if (p.target === 'YE') { yemen++; assert.ok(p.grudge); } } }
    assert.ok(n > 0 && sa / n > 0.5, `экспансионист выбран ${sa} из ${n}`);
    assert.ok(yemen > 0, 'давний враг — среди целей');
    // под санкциями новых войн не начинают
    d.sanctions.SA = d.turn + 5;
    for (let i = 0; i < 30; i++) { const p = ai.pickAiWar(); assert.ok(!p || p.attacker !== 'SA'); }
    // друзей не трогают
    delete d.sanctions.SA;
    Diplomacy.changeRelation(d, 'SA', 'YE', 200);
    for (let i = 0; i < 30; i++) { const p = ai.pickAiWar(); assert.ok(!p || !(p.attacker === 'SA' && p.target === 'YE')); }
});

test('bonds: modest sum, nothing to pay during the grace period, then even payments; limit and save', () => {
    const { GameData, Credit, BOND } = engine();
    const d = new GameData('PL');
    const pl = d.countries.PL;
    const tax = d.countryBalance('PL').tax;
    const money = pl.money;
    const r = d.act('issueBonds', tax * 2);
    assert.equal(r.ok, true);
    assert.equal(pl.money, money + r.amount);
    assert.equal(d.countryBalance('PL').bonds, 0, 'в отсрочку не платим');
    // лимит: больше BOND.WEEKS недельных налогов не выпустить
    d.act('issueBonds', tax * 100);
    assert.ok(Credit.bondsOwed(d, 'PL') <= Credit.bondLimit(d, 'PL') + 1e5);
    assert.equal(d.act('issueBonds', tax).ok, false);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(Credit.bondsOwed(back, 'PL'), Credit.bondsOwed(d, 'PL'));
    // через отсрочку — выплаты ровными долями, долг гасится
    d.turn += BOND.GRACE;
    const due = d.countryBalance('PL').bonds;
    assert.ok(due > 0);
    const owed = Credit.bondsOwed(d, 'PL');
    d.applyEndOfTurn();
    assert.equal(Credit.bondsOwed(d, 'PL'), owed - due);
    for (let i = 0; i < BOND.TERM; i++) { d.turn++; d.applyEndOfTurn(); }
    assert.equal(Credit.bondsOwed(d, 'PL'), 0, 'погашено');
    const bad = d.serialize(); bad.credit = { PL: { bonds: [{ owed: -1, start: 1, pay: 1 }], imf: null, imfBan: 0 } };
    assert.throws(() => GameData.restore(bad), /займы/);
});

test('IMF: bigger and softer for a victim of aggression, refuses the aggressor; tranche and broken conditions', () => {
    const { GameData, Credit, IMF, Council } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    const peace = new GameData('PL');
    const calm = Credit.imfOffer(peace, 'PL');
    assert.equal(calm.ok, true);
    assert.deepEqual([...calm.conditions], ['noWar', 'tax', 'austerity']);
    const victim = Credit.imfOffer(d, 'UA');
    assert.equal(victim.ok, true);
    assert.equal(victim.aggressor, 'RU');
    assert.deepEqual([...victim.conditions], ['noWar'], 'жертве — мягче');
    assert.equal(victim.weeks, IMF.VICTIM_WEEKS);
    assert.equal(Credit.imfOffer(d, 'RU').ok, false, 'агрессору — нет');
    // ООН признала агрессора — ещё больше
    d.sanctions.RU = d.turn + 5;
    assert.equal(Credit.imfOffer(d, 'UA').weeks, IMF.BRANDED_WEEKS);
    // программа: первый транш сразу, выплаты — со следующего хода
    const money = d.countries.UA.money;
    const r = d.act('takeImf');
    assert.equal(r.ok, true);
    assert.equal(d.countries.UA.money, money + r.amount);
    assert.ok(d.countryBalance('UA').imf > 0, 'платим сразу');
    assert.equal(d.act('takeImf').ok, false, 'вторую не дают');
    // второй транш через TRANCHE_TURNS ходов
    d.turn += IMF.TRANCHE_TURNS;
    const before = Credit.peek(d, 'UA').imf.left;
    const { events } = d.applyEndOfTurn();
    assert.ok(Credit.peek(d, 'UA').imf.left > before, 'второй транш пришёл');
    assert.ok(events.some(e => e.for === 'UA' && e.message.includes('второй транш')));
    // обычная страна: налог ниже порога — программа заморожена
    peace.countries.PL.taxRate = 0.2;
    peace.act('takeImf');
    peace.countries.PL.taxRate = 0.05;
    const inf = peace.countries.PL.influence;
    const res = peace.applyEndOfTurn();
    const p = Credit.peek(peace, 'PL').imf;
    assert.equal(p.broken, true);
    assert.equal(p.second, 0);
    assert.ok(peace.countries.PL.influence < inf + 5);
    assert.ok(res.events.some(e => e.for === 'PL' && e.message.includes('заморозил')));
    assert.equal(Credit.imfOffer(peace, 'PL').ok, false);
    // объявление войны нарушает «без новых войн»
    const w = new GameData('PL');
    w.act('takeImf');
    w.countries.PL.influence = 100;
    assert.equal(w.act('declareWar', 'PL', 'BY').ok, true);
    assert.equal(Credit.peek(w, 'PL').imf.broken, true);
    const back = GameData.restore(JSON.parse(JSON.stringify(w.serialize())));
    assert.equal(Credit.peek(back, 'PL').imf.broken, true);
});

test('empty treasury: the first turn in the red only warns, desertion then scales with the hole', () => {
    const { GameData } = engine();
    const d = new GameData('PL');
    const army = () => d.getCountryRegions('PL').reduce((s, r) => s + Object.values(r.army).reduce((a, b) => a + b, 0), 0);
    d.countries.PL.money = -1e9;
    const n = army();
    const first = d.applyEndOfTurn();
    assert.equal(army(), n, 'первый ход — только предупреждение');
    assert.ok(first.events.some(e => e.type === 'bankrupt' && e.message.includes('Со следующего хода')));
    d.countries.PL.money = -1e9;
    d.applyEndOfTurn();
    const lost = n - army();
    assert.ok(lost > 0 && lost <= Math.ceil(n * 0.1) + d.getCountryRegions('PL').length * 3, `ушло ${lost} из ${n}`);
    d.countries.PL.money = 1e9;
    d.applyEndOfTurn();
    d.countries.PL.money = -1;
    const again = army();
    d.applyEndOfTurn();
    assert.equal(army(), again, 'после выхода из минуса счётчик сброшен');
});

test('victim of aggression: neighbours may help, a UN-branded aggressor brings a coalition and arms deliveries', () => {
    const { GameData, World, Diplomacy } = engine();
    const d = new GameData('UA', { scenario: 'war2024' });
    // соседи без дружбы, но в ссоре с агрессором, иногда помогают
    for (const cc of ['MD', 'RO', 'HU', 'SK', 'PL']) { d.relations[d.pairKey(cc, 'UA')] = 5; d.relations[d.pairKey(cc, 'RU')] = -30; }
    let neighbour = false;
    for (let i = 0; i < 10 && !neighbour; i++) { const ev = []; World.endTurn(d, ev); neighbour = ev.some(e => e.message.includes('Соседи тоже помогли')); }
    assert.ok(neighbour, 'соседи помогли хотя бы раз');
    // признанный агрессор: помощь больше, и приходит оружие
    d.sanctions.RU = d.turn + 5;
    const w = d.un.wars[d.pairKey('RU', 'UA')];
    d.turn = w.start + 3;
    const money = d.countries.UA.money;
    const power = d.calculateMilitaryPower('UA');
    const ev = [];
    World.endTurn(d, ev);
    assert.ok(d.countries.UA.money > money);
    assert.ok(ev.some(e => e.message.includes('Коалиция против агрессора')));
    assert.ok(ev.some(e => e.message.includes('Поставки оружия')), ev.map(e => e.message).join(' | '));
    assert.ok(d.calculateMilitaryPower('UA') > power, 'армия жертвы выросла');
});

test('AI allies defend with troops: a neighbour sends a contingent to the front, a far ally an expedition; home after the war', () => {
    const { GameData, AI, Diplomacy } = engine();
    const d = new GameData('CZ');
    const ai = new AI(d);
    // Польша — сосед Германии; Португалия — далеко
    Diplomacy.sign(d, 'PL', 'DE', 'alliance');
    Diplomacy.sign(d, 'PT', 'DE', 'alliance');
    d.startWar('CZ', 'DE');
    for (const r of d.getCountryRegions('PL')) r.army = { ...d.emptyArmy(), infantry: 40, tanks: 10 };
    d.countries.PT.money = 5e9;
    for (const turn of [0, 1]) { d.turn = 10 + turn; ai.helpAllies(d.countries.PL, d.enemiesOf('PL')); ai.helpAllies(d.countries.PT, d.enemiesOf('PT')); }
    const inDE = cc => d.garrisonsOf(cc).filter(g => d.regions[g.region].owner === 'DE');
    assert.ok(inDE('PL').length > 0, 'Польша прислала войска');
    assert.ok(inDE('PT').length > 0, 'Португалия — экспедицию');
    const front = id => d.getNeighbors(id).some(n => d.regions[n]?.owner === 'CZ');
    assert.ok(inDE('PL').every(g => front(g.region)), 'на фронт с Чехией');
    // война кончилась — отзывают
    d.makePeace('CZ', 'DE');
    ai.helpAllies(d.countries.PL, []);
    ai.helpAllies(d.countries.PT, []);
    assert.equal(d.garrisonsOf('PL').length + d.garrisonsOf('PT').length, 0);
});

test('ports: the 100 biggest real ports and Odesa, Sevastopol exist from the start; new ones only on the coast', () => {
    const { GameData, Shipping, SeasDB } = engine();
    const d = new GameData('UA');
    const at = name => d.regions[SeasDB.ports.find(p => p.name === name).region];
    assert.ok(SeasDB.ports.length >= 100);
    assert.equal(at('Шанхай').development.port >= 4, true, 'первая тройка — 4-й уровень');
    assert.equal(at('Роттердам').development.port >= 2, true, 'двадцатка — 2-й');
    assert.equal(at('Одесса').development.port, 1);
    assert.equal(at('Севастополь').development.port, 1);
    assert.ok(Shipping.portMarks(d).some(m => m.name === 'Одесса'), 'значок порта в городе');
    const kyiv = d.regions['UA-6'];
    const mykolaiv = d.getCountryRegions('UA').find(r => Shipping.coastal(r) && !r.development.port);
    assert.ok(mykolaiv, 'есть прибрежная область без порта');
    assert.ok(!Shipping.coastal(kyiv) && !d.developKinds(kyiv).includes('port'));
    d.countries.UA.money = 1e9;
    assert.equal(d.act('invest', kyiv.id, 'port').ok, false, 'в Киеве порт не строится');
    const before = d.countryBalance('UA');
    assert.ok(before.shipping > 0, 'одесский порт уже даёт фрахт');
    assert.equal(d.act('invest', mykolaiv.id, 'port').ok, true);
    for (let i = 0; i < 3; i++) d.applyEndOfTurn();
    assert.equal(mykolaiv.development.port, 1);
    const after = d.countryBalance('UA');
    assert.ok(after.shipping > before.shipping && after.tradeBonus > before.tradeBonus, 'фрахт и торговый бонус выросли');
    const mark = Shipping.portMarks(d).find(m => m.region === mykolaiv.id);
    assert.deepEqual([mark.x, mark.y], [SeasDB.coast[mykolaiv.id].x, SeasDB.coast[mykolaiv.id].y], 'новый порт — у берега области');
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(back.regions[mykolaiv.id].development.port, 1);
    // восставшая область порт не использует
    const levels = Shipping.portLevels(d, 'UA');
    d.revolts[mykolaiv.id] = { turn: d.turn };
    assert.equal(Shipping.portLevels(d, 'UA'), levels - 1);
});

test('straits: keepers charge fees or close; dependents pay, lose trade and grow angry; AI keepers react to war', () => {
    const { GameData, Shipping, STRAITS, Diplomacy, AI, Economy } = engine();
    const d = new GameData('TR');
    assert.deepEqual([...Shipping.keepers(d, 'bosporus')], ['TR']);
    assert.equal(Shipping.access(d, 'GE'), 1);
    // плата: Грузия платит Турции с торговли
    assert.equal(d.act('setStraitPolicy', 'bosporus', 'fee', 0.05).ok, true);
    assert.equal(Shipping.passage(d, 'bosporus', 'GE').fee, 0.05);
    const { transit, tolls } = Shipping.settle(d, { GE: 1e6, BG: 2e6 });
    assert.equal(transit.GE, Math.round(1e6 * 1 * 0.05));
    assert.equal(tolls.TR, transit.GE + transit.BG);
    assert.equal(d.countries.TR.lastTolls, tolls.TR);
    assert.ok(d.countryBalance('TR').tolls > 0);
    // чужой пролив не настроить
    assert.equal(d.act('setStraitPolicy', 'suez', 'closed', 0).ok, false);
    // закрыт: торговля Грузии падает, отношения портятся
    const rel = Diplomacy.relation(d, 'TR', 'GE');
    d.act('setStraitPolicy', 'bosporus', 'closed', 0);
    assert.ok(Shipping.access(d, 'GE') < 0.2);
    assert.ok(Economy.reach(d, 'GE') < 0.2);
    d.turn = 5;
    Shipping.endTurn(d, []);
    assert.ok(Diplomacy.relation(d, 'TR', 'GE') < rel);
    // исключения сильнее общего режима: закрыт для всех, но Болгарию пропускаем
    assert.equal(d.act('setStraitRule', 'bosporus', 'BG', 'allow').ok, true);
    assert.equal(Shipping.passage(d, 'bosporus', 'BG').blocked, false);
    assert.equal(Shipping.passage(d, 'bosporus', 'RO').blocked, true);
    // открыт с платой, но Румынии — закрыт, а Болгарии — бесплатно
    d.act('setStraitPolicy', 'bosporus', 'fee', 0.05);
    d.act('setStraitRule', 'bosporus', 'RO', 'deny');
    assert.equal(Shipping.passage(d, 'bosporus', 'RO').blocked, true);
    assert.equal(Shipping.passage(d, 'bosporus', 'BG').fee, 0, 'Болгария не платит');
    assert.equal(Shipping.passage(d, 'bosporus', 'GE').fee, 0.05);
    d.act('setStraitRule', 'bosporus', 'RO', null);
    assert.equal(Shipping.passage(d, 'bosporus', 'RO').blocked, false, 'исключение снято');
    // «закрывать врагам»: закрыт только для воюющих
    d.act('setStraitPolicy', 'bosporus', 'open', 0);
    assert.equal(d.act('setStraitHostile', 'bosporus', true).ok, true);
    assert.equal(Shipping.passage(d, 'bosporus', 'RO').blocked, false);
    d.startWar('TR', 'GE');
    assert.equal(Shipping.passage(d, 'bosporus', 'GE').blocked, true);
    // сохранение
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(Shipping.policy(back, 'bosporus', 'TR').hostile, true);
    assert.deepEqual([...Shipping.policy(back, 'bosporus', 'TR').allow], ['BG']);
    const bad = d.serialize(); bad.shipping.straits.bosporus.TR.mode = 'пираты';
    assert.throws(() => GameData.restore(bad), /проливы/);
    // игрок узнаёт о закрытии пролива, от которого зависит
    const g = new GameData('GE');
    const ev = [];
    Shipping.endTurn(g, ev);
    Shipping.setPolicy(g, 'bosporus', 'TR', 'closed');
    Shipping.endTurn(g, ev);
    assert.ok(ev.some(e => e.for === 'GE' && e.message.includes('Босфор')));
    // ИИ-хозяин на войне закрывает пролив врагам
    const w = new GameData('GE');
    w.startWar('EG', 'IL');
    for (let t = 0; t < 6; t++) { w.turn = t; Shipping.planAI(w); }
    assert.equal(Shipping.policy(w, 'suez', 'EG').hostile, true);
    assert.equal(Shipping.policy(w, 'suez', 'EG').mode, 'fee', 'канал — платный');
    assert.equal(Shipping.passage(w, 'suez', 'IL').blocked, true);
});

// Стороны пролива: [зона-сторона моря sea, другая зона].
function straitSides(SeasDB, id, sea) {
    const [a, b] = Object.entries(SeasDB.straits).find(([, s]) => s === id)[0].split('|');
    return SeasDB.zones[a].sea === sea ? [a, b] : [b, a];
}

test('seas: water is split into zones bounded by the coast; straits are the only gate between their sides', () => {
    const { SeasDB, Navy } = engine();
    const zones = Object.entries(SeasDB.zones);
    assert.ok(zones.length > 150, `морских зон: ${zones.length}`);
    for (const [id, z] of zones) for (const n of z.adj) assert.ok(SeasDB.zones[n].adj.includes(id), `соседство ${id}-${n} взаимно`);
    assert.ok(zones.every(([, z]) => z.path && z.path.startsWith('M')), 'у каждой зоны есть контур');
    for (const id of ['bosporus', 'danish', 'gibraltar', 'suez', 'bab', 'hormuz', 'malacca', 'panama', 'kerch']) {
        assert.ok(Object.values(SeasDB.straits).includes(id), `пролив ${id} стоит на границе зон`);
    }
    // из Чёрного моря в Эгейское — только через Босфор
    const [black, aegean] = straitSides(SeasDB, 'bosporus', 'Чёрное море');
    const blackSea = new Set(zones.filter(([, z]) => z.sea === 'Чёрное море' || z.sea === 'Азовское море').map(([id]) => id));
    for (const id of blackSea) for (const n of SeasDB.zones[id].adj) {
        if (blackSea.has(n)) continue;
        assert.ok(SeasDB.straits[[id, n].sort().join('|')] === 'bosporus', `выход из Чёрного моря ${id}→${n} — только Босфор`);
    }
    assert.ok(SeasDB.zones[black].adj.includes(aegean));
    // а через Босфор — Мраморное, Эгейское и дальше в Средиземное, Суэц и Гибралтар
    const reach = new Set([black]);
    for (const q = [black]; q.length;) for (const n of SeasDB.zones[q.shift()].adj) if (!reach.has(n)) { reach.add(n); q.push(n); }
    for (const sea of ['Мраморное море', 'Эгейское море', 'Красное море', 'Северное море', 'Балтийское море']) {
        assert.ok(zones.some(([id, z]) => z.sea === sea && reach.has(id)), `из Чёрного моря доступно: ${sea}`);
    }
    // Каспий — замкнутый
    assert.ok(!zones.some(([id, z]) => z.sea === 'Каспийское море' && reach.has(id)));
    // Одесса выходит в Чёрное море, Киев — никуда
    assert.ok(Navy.seasOf('UA-1').every(z => blackSea.has(z)));
    assert.equal(Navy.seasOf('UA-6').length, 0);
});

test('navy: shipyard needs a port of the right level and tech; ships launch into the chosen sea; upkeep counted', () => {
    const { GameData, Navy, SHIPS } = engine();
    const d = new GameData('UA');
    d.countries.UA.money = 1e9;
    const port = d.regions['UA-1'];
    const sea = Navy.seasOf(port.id)[0];
    port.development.port = 0;
    assert.equal(d.act('buildShips', port.id, 'corvette', 1, sea).ok, false, 'без порта нельзя');
    port.development.port = 2;
    assert.equal(d.act('buildShips', port.id, 'destroyer', 1, sea).reason, 'Нужен порт 3-го уровня');
    assert.match(d.act('buildShips', port.id, 'sub', 1, sea).reason, /Подводные лодки/);
    const r = d.act('buildShips', port.id, 'corvette', 3, sea);
    assert.equal(r.ok, true);
    assert.equal(d.act('buildShips', port.id, 'patrol', 1, sea).reason, 'Верфь занята');
    for (let i = 0; i < SHIPS.corvette.turns; i++) d.processOrders();
    assert.equal(Navy.fleet(d, sea, 'UA').corvette, 3);
    assert.equal(d.countryBalance('UA').navy, 3 * SHIPS.corvette.upkeep);
    // отмена возвращает деньги
    d.act('buildShips', port.id, 'patrol', 2, sea);
    const money = d.countries.UA.money;
    assert.equal(d.act('cancelShips', port.id).ok, true);
    assert.equal(d.countries.UA.money, money + 2 * SHIPS.patrol.cost);
});

test('navy: fleets sail up to two seas a turn, a closed strait bars the way, enemies fight, the weaker retreats', () => {
    const { GameData, Navy, NAVY, SeasDB } = engine();
    const d = new GameData('GR');
    const [black, aegean] = straitSides(SeasDB, 'bosporus', 'Чёрное море');
    Navy.add(d, black, 'UA', { frigate: 2 });
    const far = Object.keys(SeasDB.zones).find(z => SeasDB.zones[z].sea === 'Каспийское море');
    assert.equal(d.act('moveFleet', black, far, { frigate: 1 }, 'UA').ok, false, 'в Каспий по морю не попасть');
    assert.ok(Navy.reachable(d, 'UA', black).size >= SeasDB.zones[black].adj.length, 'за ход — дальше соседей');
    // Турция закрыла Босфор для всех — Украине не пройти, Турции — можно
    d.setStraitPolicy('bosporus', 'closed', 0, 'TR');
    assert.equal(Navy.canPass(d, 'UA', black, aegean), false);
    assert.equal(Navy.reachable(d, 'UA', black).has(aegean), false);
    assert.equal(Navy.canPass(d, 'TR', black, aegean), true);
    // Турция пропускает Украину по исключению
    d.setStraitRule('bosporus', 'UA', 'allow', 'TR');
    assert.equal(Navy.canPass(d, 'UA', black, aegean), true);
    d.setStraitPolicy('bosporus', 'open', 0, 'TR');
    d.setStraitRule('bosporus', 'UA', null, 'TR');
    assert.equal(d.act('moveFleet', black, aegean, { frigate: 2 }, 'UA').ok, true);
    d.processOrders();
    assert.equal(Navy.fleet(d, aegean, 'UA').frigate, 2);
    assert.equal(Navy.fleet(d, black, 'UA'), null);
    // бой: сильный флот против слабого
    Navy.add(d, aegean, 'TR', { destroyer: 6, corvette: 4 });
    d.startWar('TR', 'UA');
    d.processOrders();
    assert.equal(Navy.fleet(d, aegean, 'UA'), null, 'слабый отступил или погиб');
    assert.ok(Navy.fleet(d, aegean, 'TR'));
    // подлодки опасны надводным кораблям без ПЛО и беспомощны против корветов
    assert.ok(Navy.damage({ sub: 4 }, { destroyer: 1 }) > Navy.damage({ sub: 4 }, { corvette: 4 }));
    assert.ok(Navy.damage({ corvette: 4 }, { sub: 4 }) > Navy.damage({ patrol: 4 }, { sub: 4 }));
});

test('navy: blockade stops ports and cuts sea trade; a fleet offshore supports a landing attack', () => {
    const { GameData, Navy, Shipping, Economy } = engine();
    const d = new GameData('GE');
    const odesa = d.regions['UA-1'];
    odesa.development.port = 3;
    assert.ok(Shipping.portActive(d, odesa));
    const reach = Economy.reach(d, 'UA');
    d.startWar('TR', 'UA');
    const seas = Navy.seasOf(odesa.id);
    for (const z of seas) Navy.add(d, z, 'TR', { destroyer: 4 });
    assert.equal(Navy.blockaded(d, odesa), true);
    assert.equal(Shipping.portActive(d, odesa), false, 'порт стоит');
    assert.ok(Navy.blockadeShare(d, 'UA') > 0);
    assert.ok(Economy.reach(d, 'UA') < reach, 'морская торговля упала');
    // свой флот сильнее — блокады нет
    Navy.add(d, seas[0], 'UA', { destroyer: 6 });
    assert.equal(Navy.blockaded(d, odesa), false);
    // огонь с моря помогает наступлению на прибрежную область
    Navy.take(d, seas[0], 'UA', { destroyer: 6 });
    assert.ok(Navy.shoreBonus(d, odesa, ['TR']) > 0);
    assert.equal(Navy.shoreBonus(d, d.regions['UA-6'], ['TR']), 0, 'Киев с моря не достать');
    // сохранение
    const next = [...Navy.reachable(d, 'TR', seas[0])][0];
    assert.equal(d.act('moveFleet', seas[0], next, { destroyer: 1 }, 'TR').ok, true);
    const back = GameData.restore(JSON.parse(JSON.stringify(d.serialize())));
    assert.equal(Navy.fleet(back, seas[0], 'TR').destroyer, 4);
    assert.equal(back.navalOrders.length, 1);
    const bad = d.serialize(); bad.navy.navy.atlantis = {};
    assert.throws(() => GameData.restore(bad), /флот/);
});

test('navy AI: a coastal country at war builds ships at its port and sails to the enemy coast', () => {
    const { GameData, AI, Navy } = engine();
    const d = new GameData('IS');
    const ai = new AI(d);
    for (const r of d.getCountryRegions('TR')) if (Navy.seasOf(r.id).length) r.development.port = 3;
    d.countries.TR.money = 5e9;
    d.startWar('TR', 'GR');
    for (let t = 0; t < 16; t++) { d.turn = t; Navy.planAI(d, ai); d.processOrders(); }
    assert.ok(Navy.totalPower(d, 'TR') > 0, 'Турция построила флот');
    const greek = new Set(d.getCountryRegions('GR').flatMap(r => Navy.seasOf(r.id)));
    assert.ok(Navy.fleets(d, 'TR').some(f => greek.has(f.zone)), 'флот у греческих берегов');
});
