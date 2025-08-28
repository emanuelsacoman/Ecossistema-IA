// ======= Helpers & UI =======
const canvas = document.getElementById("ecosystem");
const ctx = canvas.getContext("2d");
const statsCanvas = document.getElementById("statsCanvas");
const sctx = statsCanvas.getContext("2d");
const TAU = Math.PI * 2;
const rand = (a=0,b=1)=>Math.random()*(b-a)+a;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dist2=(a,b)=>{const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy;};
const len=(x,y)=>Math.hypot(x,y);
const norm=(x,y)=>{const l=len(x,y)||1; return [x/l, y/l];};
const jitter=()=>rand(-1,1)*0.0001;
const $ = id => document.getElementById(id);

// UI refs
const ui = {
  showVision: $("showVision"),
  showTargets: $("showTargets"),
  enableFlocking: $("enableFlocking"),
  enableTerritory: $("enableTerritory"),
  enableMemory: $("enableMemory"),
  enableSeason: $("enableSeason"),

  plantRegen: $("plantRegen"),
  plantCap: $("plantCap"),
  herbSpeed: $("herbSpeed"),
  carnSpeed: $("carnSpeed"),
  visionRange: $("visionRange"),
  moveCost: $("moveCost"),

  out: {
    plantRegen: $("plantRegenOut"),
    plantCap: $("plantCapOut"),
    herbSpeed: $("herbSpeedOut"),
    carnSpeed: $("carnSpeedOut"),
    visionRange: $("visionRangeOut"),
    moveCost: $("moveCostOut"),
  },

  init: {
    herb: $("initHerb"),
    carn: $("initCarn"),
    plant: $("initPlant"),
  },

  popHint: $("popHint")
};

// Sync outputs
Object.entries({
  plantRegen: ui.plantRegen,
  plantCap: ui.plantCap,
  herbSpeed: ui.herbSpeed,
  carnSpeed: ui.carnSpeed,
  visionRange: ui.visionRange,
  moveCost: ui.moveCost
}).forEach(([k,el])=>{
  const sync=()=>ui.out[k].textContent = el.value;
  el.addEventListener("input", sync); sync();
});

// ======= World config =======
const world = {
  width: canvas.width,
  height: canvas.height,
  agents: [],
  plants: [],
  running: true,
  lastTs: performance.now(),
  plantAccumulator: 0,
  time: 0
};

const SPECIES = { PLANT: "plant", HERB: "herbivore", CARN: "carnivore" };

// ======= Stats logging =======
const stats = {
  history: [], // {t, herbCount, carnCount, plantCount}
  maxPoints: 120,
  tickAccumulator: 0
};

// ======= Entities =======
class Plant {
  constructor(x,y){
    this.type = SPECIES.PLANT;
    this.x = x; this.y = y;
    this.energy = 30;
    this.radius = 5;
  }
  draw(){
    ctx.beginPath();
    ctx.arc(this.x,this.y,this.radius,0,TAU);
    // slight gradient feel: center brighter
    const g = ctx.createRadialGradient(this.x,this.y,1,this.x,this.y,this.radius);
    g.addColorStop(0, "#5ff09a");
    g.addColorStop(1, "#33d17a");
    ctx.fillStyle = g;
    ctx.fill();
  }
}

class Animal {
  constructor(x,y, type, genes={}){
    this.type = type;
    this.x = x; this.y = y;

    const baseSpeed = type===SPECIES.HERB ? parseFloat(ui.herbSpeed.value) : parseFloat(ui.carnSpeed.value);
    const vision = parseFloat(ui.visionRange.value);
    this.genes = {
      speed: clamp((genes.speed ?? baseSpeed) + rand(-0.15,0.15), 0.2, 5),
      vision: clamp((genes.vision ?? vision) + rand(-8,8), 20, 260)
    };

    this.vx = rand(-1,1)*this.genes.speed;
    this.vy = rand(-1,1)*this.genes.speed;
    this.radius = type===SPECIES.CARN ? 10.5 : 9.0;
    this.energy = this.type===SPECIES.CARN ? 120 : 100;
    this.age = 0;
    this.maxAge = rand(70,140);
    this.target = null;
    this.mateCooldown = 0;
    this.state = "wander";
    this.memory = { lastFoodPos: null, lastFoodSeenAt: 0 }; // memory short term
    // territory for carnivores
    if (this.type === SPECIES.CARN && ui.enableTerritory.checked) {
      this.territory = { cx: this.x + rand(-80,80), cy: this.y + rand(-80,80), radius: rand(80,220) };
    } else {
      this.territory = null;
    }
  }

  perceive() {
    const R2 = this.genes.vision * this.genes.vision;
    const seenPlants = [];
    const seenHerb = [];
    const seenCarn = [];
    for (const p of world.plants) if (dist2(this,p) <= R2) seenPlants.push(p);
    for (const a of world.agents) {
      if (a===this) continue;
      if (dist2(this,a) <= R2) {
        if (a.type===SPECIES.HERB) seenHerb.push(a);
        else if (a.type===SPECIES.CARN) seenCarn.push(a);
      }
    }
    return {seenPlants, seenHerb, seenCarn};
  }

  decide(dt) {
    const {seenPlants, seenHerb, seenCarn} = this.perceive();

    // update memory if saw food
    if (ui.enableMemory.checked) {
      if (this.type === SPECIES.HERB && seenPlants.length) {
        const p = seenPlants[0];
        this.memory.lastFoodPos = {x: p.x, y: p.y}; this.memory.lastFoodSeenAt = world.time;
      }
      if (this.type === SPECIES.CARN && seenHerb.length) {
        const h = seenHerb[0];
        this.memory.lastFoodPos = {x: h.x, y: h.y}; this.memory.lastFoodSeenAt = world.time;
      }
    }

    const hunger = 1 - clamp(this.energy/150, 0, 1);
    const ageFactor = clamp(this.age/this.maxAge, 0, 1);
    const fear = this.type===SPECIES.HERB ? clamp(seenCarn.length / 3, 0, 1) : 0;
    const canMate = (this.energy > 120 && this.mateCooldown <= 0 && this.age > 8);

    const nearest = (arr)=> {
      let best=null, bestD=Infinity;
      for(const t of arr){
        const d=dist2(this,t);
        if(d<bestD){bestD=d; best=t;}
      }
      return [best, Math.sqrt(bestD)];
    };

    let scores = { wander: 0.1, seek_food: 0, flee: 0, mate: 0, rest: 0, patrol: 0 };

    if (this.type===SPECIES.HERB) {
      const [plant, plantDist] = nearest(seenPlants);
      if (plant) {
        const prox = clamp(1 - (plantDist / (this.genes.vision+1)), 0, 1);
        scores.seek_food = hunger * (0.6 + 0.4*prox);
        this.target = plant;
      } else if (ui.enableMemory.checked && this.memory.lastFoodPos && (world.time - this.memory.lastFoodSeenAt) < 15) {
        // if memory recently has food, go there
        scores.seek_food = 0.35 * hunger;
        this.target = {x: this.memory.lastFoodPos.x, y: this.memory.lastFoodPos.y, radius: 6};
      } else {
        scores.seek_food = 0.25*hunger;
        this.target = null;
      }
      scores.flee = fear * 1.2;
    } else {
      // carnívoro
      const [prey, preyDist] = nearest(seenHerb);
      if (prey) {
        const prox = clamp(1 - (preyDist / (this.genes.vision+1)), 0, 1);
        scores.seek_food = hunger * (0.6 + 0.6*prox);
        this.target = prey;
      } else if (ui.enableMemory.checked && this.memory.lastFoodPos && (world.time - this.memory.lastFoodSeenAt) < 20) {
        scores.seek_food = 0.3 * hunger;
        this.target = {x: this.memory.lastFoodPos.x, y: this.memory.lastFoodPos.y, radius: 8};
      } else {
        scores.seek_food = 0.25*hunger;
        this.target = null;
      }

      // territory incentive
      if (ui.enableTerritory.checked && this.territory) {
        const dx = this.x - this.territory.cx, dy = this.y - this.territory.cy;
        const d = Math.hypot(dx,dy);
        // if outside territory, strong desire to go back (patrol)
        if (d > this.territory.radius * 0.9) {
          scores.patrol = 0.6 + (d / (this.territory.radius+1));
        } else {
          scores.patrol = 0.05;
        }
      } else scores.patrol = 0;
    }

    scores.mate = canMate ? 0.45 * (1 - hunger) * (1 - ageFactor) : 0;
    scores.rest = clamp((ageFactor*0.6) + (hunger*0.2), 0, 0.9);
    scores.wander += (0.15 + Math.random()*0.05);

    // choose best
    let bestState = "wander", bestScore = -Infinity;
    for (const [k,v] of Object.entries(scores)) {
      if (v > bestScore) { bestScore = v; bestState = k; }
    }
    this.state = bestState;
  }

  steeringForFlocking(neighbors) {
    // neighbors: array of other herbivores within some radius
    if (!neighbors.length) return {cx:0,cy:0,sepx:0,sepy:0,alx:0,aly:0};

    // cohesion: move toward center
    let cx=0, cy=0;
    // separation: move away if too close
    let sex=0, sey=0;
    // alignment: match velocity
    let alx=0, aly=0;
    for (const n of neighbors) {
      cx += n.x; cy += n.y;
      alx += n.vx; aly += n.vy;
      const d = Math.hypot(this.x-n.x, this.y-n.y) || 1;
      if (d < 18) {
        sex += (this.x - n.x)/d;
        sey += (this.y - n.y)/d;
      }
    }
    const cnt = neighbors.length;
    return {cx: cx/cnt - this.x, cy: cy/cnt - this.y, sepx:sex, sepy:sey, alx: alx/cnt - this.vx, aly: aly/cnt - this.vy};
  }

  steerTowards(tx,ty,force=0.12) {
    const dx = tx - this.x, dy = ty - this.y;
    const [nx,ny] = norm(dx,dy);
    this.vx += nx * force; this.vy += ny * force;
  }

  steerAway(tx,ty,force=0.2) {
    const dx = this.x - tx, dy = this.y - ty;
    const [nx,ny] = norm(dx,dy);
    this.vx += nx * force; this.vy += ny * force;
  }

  act(dt) {
    this.decide(dt);

    // flocking for herbivores
    if (this.type === SPECIES.HERB && ui.enableFlocking.checked) {
      const neigh = world.agents.filter(a=>a!==this && a.type===SPECIES.HERB && dist2(this,a) < 60*60);
      const f = this.steeringForFlocking(neigh);
      // apply weighted
      this.vx += f.cx * 0.004 + f.sepx * 0.07 + f.alx * 0.01;
      this.vy += f.cy * 0.004 + f.sepy * 0.07 + f.aly * 0.01;
    }

    // behaviors
    if (this.state === "seek_food" && this.target) {
      this.steerTowards(this.target.x, this.target.y, 0.16);
    } else if (this.state === "flee") {
      const threats = world.agents.filter(a=>a.type===SPECIES.CARN && dist2(this,a) <= this.genes.vision*this.genes.vision);
      if (threats.length) {
        const cx = threats.reduce((s,a)=>s+a.x,0)/threats.length;
        const cy = threats.reduce((s,a)=>s+a.y,0)/threats.length;
        this.steerAway(cx, cy, 0.28);
      }
    } else if (this.state === "mate") {
      const partners = world.agents.filter(a=>a!==this && a.type===this.type && a.mateCooldown<=0);
      let best=null, bestD=Infinity;
      for(const p of partners){
        const d=dist2(this,p);
        if (d<bestD){bestD=d; best=p;}
      }
      if (best) {
        this.steerTowards(best.x, best.y, 0.14);
        if (Math.sqrt(bestD) < this.radius + best.radius + 2) this.reproduceWith(best);
      }
    } else if (this.state === "patrol" && this.territory) {
      // simple patrol: move toward a random point near center occasionally
      if (!this._patrolTarget || Math.hypot(this._patrolTarget.x - this.x, this._patrolTarget.y - this.y) < 12) {
        this._patrolTarget = {
          x: this.territory.cx + rand(-this.territory.radius*0.6, this.territory.radius*0.6),
          y: this.territory.cy + rand(-this.territory.radius*0.6, this.territory.radius*0.6)
        };
      }
      this.steerTowards(this._patrolTarget.x, this._patrolTarget.y, 0.10);
    } else if (this.state === "rest") {
      this.vx *= 0.94; this.vy *= 0.94;
    } else {
      // wander
      this.vx += rand(-0.05,0.05); this.vy += rand(-0.05,0.05);
    }

    // limit speed
    const spd = len(this.vx, this.vy);
    const max = this.genes.speed + jitter();
    if (spd > max) {
      const [nx,ny] = norm(this.vx, this.vy);
      this.vx = nx*max; this.vy = ny*max;
    }

    // move
    this.x += this.vx; this.y += this.vy;

    // bounce edges
    if (this.x < this.radius) { this.x = this.radius; this.vx *= -0.9; }
    if (this.x > world.width - this.radius) { this.x = world.width - this.radius; this.vx *= -0.9; }
    if (this.y < this.radius) { this.y = this.radius; this.vy *= -0.9; }
    if (this.y > world.height - this.radius) { this.y = world.height - this.radius; this.vy *= -0.9; }

    // energy cost
    const moveCost = parseFloat(ui.moveCost.value);
    const s = len(this.vx, this.vy);
    this.energy -= (0.04 + moveCost * (s*0.25)) * dt;

    // age and cooldowns
    this.age += dt; if (this.mateCooldown > 0) this.mateCooldown -= dt;

    // eating interactions
    if (this.type===SPECIES.HERB) {
      for (let i=world.plants.length-1;i>=0;i--){
        const p = world.plants[i];
        const d = Math.sqrt(dist2(this,p));
        if (d < this.radius + p.radius) {
          this.energy = Math.min(150, this.energy + p.energy);
          this.memory.lastFoodPos = {x:p.x,y:p.y}; this.memory.lastFoodSeenAt = world.time;
          world.plants.splice(i,1);
        }
      }
    } else if (this.type===SPECIES.CARN) {
      for (let i=world.agents.length-1;i>=0;i--){
        const a = world.agents[i];
        if (a===this || a.type!==SPECIES.HERB) continue;
        const d = Math.sqrt(dist2(this,a));
        if (d < this.radius + a.radius) {
          this.energy = Math.min(180, this.energy + 70);
          this.memory.lastFoodPos = {x:a.x,y:a.y}; this.memory.lastFoodSeenAt = world.time;
          world.agents.splice(i,1);
        }
      }
    }
  }

  reproduceWith(partner){
    const cost = 40;
    if (this.energy < cost || partner.energy < cost) return;
    this.energy -= cost; partner.energy -= cost;
    this.mateCooldown = 6; partner.mateCooldown = 6;
    const genes = {
      speed: clamp((this.genes.speed + partner.genes.speed)/2 + rand(-0.12,0.12), 0.2, 5),
      vision: clamp((this.genes.vision + partner.genes.vision)/2 + rand(-6,6), 20, 260)
    };
    const cx = (this.x + partner.x)/2 + rand(-8,8);
    const cy = (this.y + partner.y)/2 + rand(-8,8);
    world.agents.push(new Animal(cx, cy, this.type, genes));
  }

  draw() {
    // body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.fillStyle = this.type===SPECIES.CARN ? "#ff5e57" : "#6ea8fe";
    ctx.fill();

    // energy bar
    const w = 18, h = 3;
    const eNorm = clamp(this.energy/150, 0, 1);
    const gx = this.x - w/2, gy = this.y - this.radius - 8;
    ctx.fillStyle = "#00000088";
    ctx.fillRect(gx, gy, w, h);
    ctx.fillStyle = eNorm>0.5 ? "#4cd964" : (eNorm>0.25 ? "#ffcc00" : "#ff5e57");
    ctx.fillRect(gx, gy, w*eNorm, h);

    // vision
    if (ui.showVision.checked) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.genes.vision, 0, TAU);
      ctx.strokeStyle = this.type===SPECIES.CARN ? "#ff5e5733" : "#6ea8fe33";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // target line
    if (ui.showTargets.checked && this.target) {
      ctx.beginPath();
      ctx.moveTo(this.x,this.y);
      ctx.lineTo(this.target.x, this.target.y);
      ctx.strokeStyle = "#ffffff33";
      ctx.stroke();
    }

    // territory display for carnivores
    if (this.type===SPECIES.CARN && ui.enableTerritory.checked && this.territory) {
      ctx.beginPath();
      ctx.arc(this.territory.cx, this.territory.cy, this.territory.radius, 0, TAU);
      ctx.strokeStyle = "#ff5e5722";
      ctx.setLineDash([4,6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  isDead(){
    return this.energy <= 0 || this.age >= this.maxAge;
  }
}

// ======= World control functions =======
function addPlant(){
  if (world.plants.length >= parseInt(ui.plantCap.value)) return;
  const x = rand(12, world.width-12);
  const y = rand(12, world.height-12);
  world.plants.push(new Plant(x,y));
}
function addHerbivore(){
  world.agents.push(new Animal(rand(20,world.width-20), rand(20,world.height-20), SPECIES.HERB));
}
function addCarnivore(){
  world.agents.push(new Animal(rand(20,world.width-20), rand(20,world.height-20), SPECIES.CARN));
}

window.addPlant = addPlant;
window.addHerbivore = addHerbivore;
window.addCarnivore = addCarnivore;

function applyInitialSpawn(){
  resetSim(true);
  const h = parseInt(ui.init.herb.value);
  const c = parseInt(ui.init.carn.value);
  const p = parseInt(ui.init.plant.value);
  for(let i=0;i<h;i++) addHerbivore();
  for(let i=0;i<c;i++) addCarnivore();
  for(let i=0;i<p;i++) addPlant();
}
window.applyInitialSpawn = applyInitialSpawn;

function startSim(){ world.running = true; }
function stopSim(){ world.running = false; }
function resetSim(keepRunning=false){
  world.agents.length = 0; world.plants.length = 0;
  world.plantAccumulator = 0; stats.history.length = 0;
  if (!keepRunning) world.running = false;
}
window.startSim = startSim;
window.stopSim = stopSim;
window.resetSim = resetSim;

// ======= Seasonality =======
function seasonalityMultiplier() {
  if (!ui.enableSeason.checked) return 1;
  // simple sine wave over a long period — period controls "season" length
  const period = 60; // seconds per full season cycle (adjustable)
  const phase = (world.time % period) / period; // 0..1
  // multiplier between 0.5 (winter) and 1.6 (summer)
  return 1 + Math.sin(phase * TAU) * 0.55;
}

// ======= Simulation loop =======
function step(now){
  const dt = Math.min((now - world.lastTs)/1000, 0.05);
  world.lastTs = now;
  world.time += dt;

  // plant regen base
  let regen = parseFloat(ui.plantRegen.value);
  regen *= seasonalityMultiplier(); // apply season
  world.plantAccumulator += regen * dt;
  while (world.plantAccumulator >= 1 && world.plants.length < parseInt(ui.plantCap.value)){
    addPlant(); world.plantAccumulator -= 1;
  }

  if (world.running) {
    for (let i=world.agents.length-1;i>=0;i--){
      const a = world.agents[i];
      a.act(dt);
      if (a.isDead()) world.agents.splice(i,1);
    }
  }

  // draw
  ctx.clearRect(0,0,world.width, world.height);
  // subtle grid
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  for (let x=40; x<world.width; x+=40){ ctx.moveTo(x,0); ctx.lineTo(x,world.height); }
  for (let y=40; y<world.height; y+=40){ ctx.moveTo(0,y); ctx.lineTo(world.width,y); }
  ctx.strokeStyle="#6b7280";
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (const p of world.plants) p.draw();
  for (const a of world.agents) a.draw();

  // update stats every 0.5s
  stats.tickAccumulator += dt;
  if (stats.tickAccumulator >= 0.5) {
    stats.tickAccumulator = 0;
    const herbCount = world.agents.filter(a=>a.type===SPECIES.HERB).length;
    const carnCount = world.agents.filter(a=>a.type===SPECIES.CARN).length;
    const plantCount = world.plants.length;
    stats.history.push({t: world.time, herb: herbCount, carn: carnCount, plant: plantCount});
    if (stats.history.length > stats.maxPoints) stats.history.shift();
    ui.popHint.textContent = `H:${herbCount} C:${carnCount} P:${plantCount}`;
    drawStats();
  }

  requestAnimationFrame(step);
}

// ======= Stats drawing =======
function drawStats(){
  const w = statsCanvas.width, h = statsCanvas.height;
  sctx.clearRect(0,0,w,h);
  sctx.fillStyle = "#041216";
  sctx.fillRect(0,0,w,h);

  if (!stats.history.length) return;

  const maxY = Math.max(...stats.history.map(s=>Math.max(s.herb, s.carn, s.plant)), 5);
  const minY = 0;
  const pad = 6;
  const plotW = w - pad*2, plotH = h - pad*2;
  const n = stats.history.length;

  // axes faint grid
  sctx.strokeStyle = "#0e2230";
  sctx.lineWidth = 1;
  for (let i=0;i<4;i++){
    const yy = pad + (plotH/3)*i;
    sctx.beginPath(); sctx.moveTo(pad,yy); sctx.lineTo(pad+plotW,yy); sctx.stroke();
  }

  // helpers to map
  const xAt = i => pad + (i/(n-1 || 1)) * plotW;
  const yAt = v => pad + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;

  // draw plant (green)
  sctx.beginPath();
  for (let i=0;i<n;i++){
    const y = yAt(stats.history[i].plant);
    const x = xAt(i);
    if (i===0) sctx.moveTo(x,y); else sctx.lineTo(x,y);
  }
  sctx.strokeStyle = "#4cd964"; sctx.lineWidth = 2; sctx.stroke();

  // herb (blue)
  sctx.beginPath();
  for (let i=0;i<n;i++){
    const y = yAt(stats.history[i].herb);
    const x = xAt(i);
    if (i===0) sctx.moveTo(x,y); else sctx.lineTo(x,y);
  }
  sctx.strokeStyle = "#6ea8fe"; sctx.lineWidth = 2; sctx.stroke();

  // carn (red)
  sctx.beginPath();
  for (let i=0;i<n;i++){
    const y = yAt(stats.history[i].carn);
    const x = xAt(i);
    if (i===0) sctx.moveTo(x,y); else sctx.lineTo(x,y);
  }
  sctx.strokeStyle = "#ff5e57"; sctx.lineWidth = 2; sctx.stroke();

  // legend
  sctx.fillStyle = "#9fb1c2"; sctx.font = "10px sans-serif";
  sctx.fillText(`P:${stats.history[stats.history.length-1].plant}`, pad, h - 2);
  sctx.fillStyle = "#6ea8fe"; sctx.fillText(`H:${stats.history[stats.history.length-1].herb}`, pad+60, h - 2);
  sctx.fillStyle = "#ff5e57"; sctx.fillText(`C:${stats.history[stats.history.length-1].carn}`, pad+120, h - 2);
}

// ======= Boot =======
applyInitialSpawn();
requestAnimationFrame((ts)=>{ world.lastTs = ts; step(ts); });

// make canvas size responsive to declared pixels
canvas.width = 980; canvas.height = 680;
statsCanvas.width = 260; statsCanvas.height = 120;
