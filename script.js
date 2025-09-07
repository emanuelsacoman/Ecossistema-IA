/*
  Improved Ecosystem Simulation
  - Hardening: guards for missing DOM, safe parsing, avoid expensive operations in hot loops
  - Structure: separated update/draw/loop, cached UI values, clearer class methods
  - Fixes: avoid sqrt where unnecessary, safe nearest() handling, prevent division by zero, consistent units
  - Usage: include in an HTML page that has the expected element IDs (see uiKeys). If elements missing, defaults are used.
*/
'use strict';

// ======= Utilities =======
const TAU = Math.PI * 2;
const rand = (a = 0, b = 1) => Math.random() * (b - a) + a;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const len = (x, y) => Math.hypot(x, y);
const norm = (x, y) => { const l = len(x, y) || 1; return [x / l, y / l]; };
const $ = id => document.getElementById(id) || null;

// UI keys we expect in DOM
const uiKeys = {
  showVision: 'showVision',
  showTargets: 'showTargets',
  showDebug: 'showDebug',
  enableFlocking: 'enableFlocking',
  enableTerritory: 'enableTerritory',
  enableMemory: 'enableMemory',
  enableSeason: 'enableSeason',
  plantRegen: 'plantRegen',
  plantCap: 'plantCap',
  herbSpeed: 'herbSpeed',
  carnSpeed: 'carnSpeed',
  visionRange: 'visionRange',
  moveCost: 'moveCost',
  plantRegenOut: 'plantRegenOut',
  plantCapOut: 'plantCapOut',
  herbSpeedOut: 'herbSpeedOut',
  carnSpeedOut: 'carnSpeedOut',
  visionRangeOut: 'visionRangeOut',
  moveCostOut: 'moveCostOut',
  initHerb: 'initHerb',
  initCarn: 'initCarn',
  initPlant: 'initPlant',
  popHint: 'popHint'
};

// Grab canvases (must exist) and contexts
const canvas = $('ecosystem');
const statsCanvas = $('statsCanvas');
if (!canvas || !statsCanvas) {
  console.error('Required canvas elements not found (ids: ecosystem, statsCanvas)');
}
const ctx = canvas ? canvas.getContext('2d') : null;
const sctx = statsCanvas ? statsCanvas.getContext('2d') : null;

// Build UI object with graceful defaults
const ui = {};
for (const [key, id] of Object.entries(uiKeys)) ui[key] = $(id);

// Helper to read a numeric UI value with default and min/max
function readNumber(el, fallback = 0, min = -Infinity, max = Infinity) {
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? clamp(v, min, max) : fallback;
}
function readInt(el, fallback = 0, min = -Infinity, max = Infinity) {
  if (!el) return fallback;
  const v = parseInt(el.value, 10);
  return Number.isFinite(v) ? clamp(v, min, max) : fallback;
}

// Keep outputs in sync if present
const outputs = {
  plantRegen: ui.plantRegenOut,
  plantCap: ui.plantCapOut,
  herbSpeed: ui.herbSpeedOut,
  carnSpeed: ui.carnSpeedOut,
  visionRange: ui.visionRangeOut,
  moveCost: ui.moveCostOut
};
for (const [key, outEl] of Object.entries(outputs)) {
  const inEl = ui[key];
  if (!inEl || !outEl) continue;
  const sync = () => { outEl.textContent = inEl.value; };
  inEl.addEventListener('input', sync, { passive: true });
  sync();
}

// ======= World & Config =======
const world = {
  width: 800,
  height: 600,
  agents: [],
  plants: [],
  running: true,
  lastTs: performance.now(),
  plantAccumulator: 0,
  time: 0
};

const SPECIES = { PLANT: 'plant', HERB: 'herbivore', CARN: 'carnivore' };

// Stats
const stats = {
  history: [], // {t, herb, carn, plant}
  maxPoints: 120,
  tickAccumulator: 0,
  tickInterval: 0.5 // seconds
};

// ======= Entities =======
class Plant {
  constructor(x, y) {
    this.type = SPECIES.PLANT;
    this.x = x; this.y = y;
    this.energy = 30;
    this.radius = 5;
  }
  draw(ctx) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    const g = ctx.createRadialGradient(this.x, this.y, 1, this.x, this.y, this.radius);
    g.addColorStop(0, '#5ff09a');
    g.addColorStop(1, '#33d17a');
    ctx.fillStyle = g;
    ctx.fill();
  }
}

class Animal {
  constructor(x, y, type, genes = {}) {
    this.type = type;
    this.x = x; this.y = y;
    this.age = 0;
    this.maxAge = rand(70, 140);
    this.mateCooldown = 0;

    const baseSpeed = (type === SPECIES.HERB) ? readNumber(ui.herbSpeed, 1.2, 0.2, 5) : readNumber(ui.carnSpeed, 1.6, 0.2, 5);
    const vision = readNumber(ui.visionRange, 120, 20, 260);

    this.genes = {
      speed: clamp((genes.speed ?? baseSpeed) + rand(-0.15, 0.15), 0.2, 5),
      vision: clamp((genes.vision ?? vision) + rand(-8, 8), 20, 260)
    };

    // velocity
    const angle = rand(0, TAU);
    this.vx = Math.cos(angle) * this.genes.speed * rand(0.2, 1);
    this.vy = Math.sin(angle) * this.genes.speed * rand(0.2, 1);

    this.radius = (type === SPECIES.CARN) ? 10.5 : 9.0;
    this.energy = (type === SPECIES.CARN) ? 120 : 100;
    this.state = 'wander';
    this.target = null;
    this.memory = { lastFoodPos: null, lastFoodSeenAt: -Infinity };

    // territory
    this.territory = (type === SPECIES.CARN && ui.enableTerritory && ui.enableTerritory.checked)
      ? { cx: this.x + rand(-80, 80), cy: this.y + rand(-80, 80), radius: rand(80, 220) }
      : null;
  }

  perceive() {
    const R2 = this.genes.vision * this.genes.vision;
    const seenPlants = [];
    const seenHerb = [];
    const seenCarn = [];

    // iterate plants
    for (let i = 0; i < world.plants.length; i++) {
      const p = world.plants[i]; if (dist2(this, p) <= R2) seenPlants.push(p);
    }
    for (let i = 0; i < world.agents.length; i++) {
      const a = world.agents[i]; if (a === this) continue;
      if (dist2(this, a) <= R2) {
        if (a.type === SPECIES.HERB) seenHerb.push(a);
        else if (a.type === SPECIES.CARN) seenCarn.push(a);
      }
    }
    return { seenPlants, seenHerb, seenCarn };
  }

  decide(dt) {
    const { seenPlants, seenHerb, seenCarn } = this.perceive();

    // nearest helper (returns [entity, distanceNumber]) distanceNumber is linear distance or null
    const nearest = (arr) => {
      let best = null; let bestD2 = Infinity;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i]; const d2 = dist2(this, t);
        if (d2 < bestD2) { bestD2 = d2; best = t; }
      }
      return [best, isFinite(bestD2) && best ? Math.sqrt(bestD2) : null];
    };

    const hunger = 1 - clamp(this.energy / 150, 0, 1);
    const ageFactor = clamp(this.age / this.maxAge, 0, 1);
    const fear = (this.type === SPECIES.HERB) ? clamp(seenCarn.length / 3, 0, 1) : 0;
    const canMate = (this.energy > 120 && this.mateCooldown <= 0 && this.age > 8);

    let scores = { wander: 0.1, seek_food: 0, flee: 0, mate: 0, rest: 0, patrol: 0 };

    if (this.type === SPECIES.HERB) {
      const [plant, plantDist] = nearest(seenPlants);
      if (ui.enableMemory && ui.enableMemory.checked && plant) {
        this.memory.lastFoodPos = { x: plant.x, y: plant.y };
        this.memory.lastFoodSeenAt = world.time;
      }

      if (plant) {
        const prox = clamp(1 - (plantDist / (this.genes.vision + 1)), 0, 1);
        scores.seek_food = hunger * (0.6 + 0.4 * prox);
        this.target = plant;
      } else if (ui.enableMemory && ui.enableMemory.checked && this.memory.lastFoodPos && (world.time - this.memory.lastFoodSeenAt) < 15) {
        scores.seek_food = 0.35 * hunger;
        this.target = { x: this.memory.lastFoodPos.x, y: this.memory.lastFoodPos.y, radius: 6 };
      } else {
        scores.seek_food = 0.25 * hunger;
        this.target = null;
      }

      scores.flee = fear * 1.2;

    } else {
      // carnivore
      const [prey, preyDist] = nearest(seenHerb);
      if (ui.enableMemory && ui.enableMemory.checked && prey) {
        this.memory.lastFoodPos = { x: prey.x, y: prey.y };
        this.memory.lastFoodSeenAt = world.time;
      }
      if (prey) {
        const prox = clamp(1 - (preyDist / (this.genes.vision + 1)), 0, 1);
        scores.seek_food = hunger * (0.6 + 0.6 * prox);
        this.target = prey;
      } else if (ui.enableMemory && ui.enableMemory.checked && this.memory.lastFoodPos && (world.time - this.memory.lastFoodSeenAt) < 20) {
        scores.seek_food = 0.3 * hunger;
        this.target = { x: this.memory.lastFoodPos.x, y: this.memory.lastFoodPos.y, radius: 8 };
      } else {
        scores.seek_food = 0.25 * hunger; this.target = null; scores.wander += 0.25;
      }

      // territory scoring
      if (ui.enableTerritory && ui.enableTerritory.checked && this.territory) {
        const dx = this.x - this.territory.cx, dy = this.y - this.territory.cy;
        const d = Math.hypot(dx, dy);
        if (d > this.territory.radius * 0.9) scores.patrol = 0.6 + (d / (this.territory.radius + 1));
        else scores.patrol = 0.05;
      }
    }

    // mating, resting, wander
    scores.mate = canMate ? 0.45 * (1 - hunger) * (1 - ageFactor) : 0;
    scores.rest = clamp((ageFactor * 0.6) + (hunger * 0.2), 0, 0.9);
    scores.wander += (0.15 + Math.random() * 0.05);

    let bestState = 'wander', bestScore = -Infinity;
    for (const [k, v] of Object.entries(scores)) if (v > bestScore) { bestScore = v; bestState = k; }
    this.state = bestState;
  }

  steeringForFlocking(neighbors) {
    if (!neighbors || neighbors.length === 0) return { cx: 0, cy: 0, sepx: 0, sepy: 0, alx: 0, aly: 0 };
    let cx = 0, cy = 0, sex = 0, sey = 0, alx = 0, aly = 0;
    for (let i = 0; i < neighbors.length; i++) {
      const n = neighbors[i]; cx += n.x; cy += n.y; alx += n.vx; aly += n.vy;
      const d = Math.hypot(this.x - n.x, this.y - n.y) || 1;
      if (d < 18) { sex += (this.x - n.x) / d; sey += (this.y - n.y) / d; }
    }
    const cnt = neighbors.length;
    return { cx: cx / cnt - this.x, cy: cy / cnt - this.y, sepx: sex, sepy: sey, alx: alx / cnt - this.vx, aly: aly / cnt - this.vy };
  }

  steerTowards(tx, ty, force = 0.12) {
    const dx = tx - this.x, dy = ty - this.y;
    const [nx, ny] = norm(dx, dy);
    this.vx += nx * force; this.vy += ny * force;
  }
  steerAway(tx, ty, force = 0.2) {
    const dx = this.x - tx, dy = this.y - ty;
    const [nx, ny] = norm(dx, dy);
    this.vx += nx * force; this.vy += ny * force;
  }

  act(dt) {
    this.decide(dt);

    // Carnivore rest heuristic
    if (this.type === SPECIES.CARN) {
      if (this.energy > 130 && this.state !== 'rest') this.state = 'rest';
      else if (this.energy < 90 && this.state === 'rest') this.state = 'seek_food';
    }

    // Flocking
    if (this.type === SPECIES.HERB && ui.enableFlocking && ui.enableFlocking.checked) {
      const neigh = [];
      const thresh = 60 * 60; // squared
      for (let i = 0; i < world.agents.length; i++) {
        const a = world.agents[i]; if (a === this || a.type !== SPECIES.HERB) continue;
        if (dist2(this, a) < thresh) neigh.push(a);
      }
      const f = this.steeringForFlocking(neigh);
      this.vx += f.cx * 0.004 + f.sepx * 0.07 + f.alx * 0.01;
      this.vy += f.cy * 0.004 + f.sepy * 0.07 + f.aly * 0.01;
    }

    // Behavior execution
    if (this.state === 'seek_food' && this.target) {
      this.steerTowards(this.target.x, this.target.y, 0.16);
      if (this.type === SPECIES.CARN) {
        const allies = [];
        const allyThresh = 80 * 80;
        for (let i = 0; i < world.agents.length; i++) {
          const a = world.agents[i]; if (a === this || a.type !== SPECIES.CARN) continue;
          if (dist2(this, a) < allyThresh) allies.push(a);
        }
        if (allies.length) {
          let avgVx = 0, avgVy = 0, cx = 0, cy = 0;
          for (let i = 0; i < allies.length; i++) { const ally = allies[i]; avgVx += ally.vx; avgVy += ally.vy; cx += ally.x; cy += ally.y; }
          avgVx /= allies.length; avgVy /= allies.length; cx /= allies.length; cy /= allies.length;
          this.steerTowards(cx, cy, 0.05);
          this.vx += (avgVx - this.vx) * 0.04; this.vy += (avgVy - this.vy) * 0.04;
        }
      }

    } else if (this.state === 'flee') {
      const threats = [];
      const R2 = this.genes.vision * this.genes.vision;
      for (let i = 0; i < world.agents.length; i++) { const a = world.agents[i]; if (a.type === SPECIES.CARN && dist2(this, a) <= R2) threats.push(a); }
      if (threats.length) {
        let cx = 0, cy = 0;
        for (let i = 0; i < threats.length; i++) { cx += threats[i].x; cy += threats[i].y; }
        cx /= threats.length; cy /= threats.length;
        this.steerAway(cx, cy, 0.28);
      }

    } else if (this.state === 'mate') {
      let partner = null; let bestD2 = Infinity;
      for (let i = 0; i < world.agents.length; i++) {
        const p = world.agents[i]; if (p === this || p.type !== this.type || p.mateCooldown > 0) continue;
        const d2 = dist2(this, p); if (d2 < bestD2) { bestD2 = d2; partner = p; }
      }
      if (partner) {
        const d = Math.sqrt(bestD2);
        this.steerTowards(partner.x, partner.y, 0.14);
        if (d < this.radius + partner.radius + 2) this.reproduceWith(partner);
      }

    } else if (this.state === 'patrol' && this.territory) {
      if (!this._patrolTarget || Math.hypot(this._patrolTarget.x - this.x, this._patrolTarget.y - this.y) < 12) {
        this._patrolTarget = { x: this.territory.cx + rand(-this.territory.radius * 0.6, this.territory.radius * 0.6), y: this.territory.cy + rand(-this.territory.radius * 0.6, this.territory.radius * 0.6) };
      }
      this.steerTowards(this._patrolTarget.x, this._patrolTarget.y, 0.10);

    } else if (this.state === 'rest') {
      this.vx *= 0.94; this.vy *= 0.94;

    } else {
      this.vx += rand(-0.05, 0.05); this.vy += rand(-0.05, 0.05);
    }

    // limit speed
    const spd = len(this.vx, this.vy);
    const max = this.genes.speed + (Math.random() - 0.5) * 0.0002;
    if (spd > max) { const [nx, ny] = norm(this.vx, this.vy); this.vx = nx * max; this.vy = ny * max; }

    // integrate
    this.x += this.vx; this.y += this.vy;

    // bounds
    if (this.x < this.radius) { this.x = this.radius; this.vx *= -0.9; }
    if (this.x > world.width - this.radius) { this.x = world.width - this.radius; this.vx *= -0.9; }
    if (this.y < this.radius) { this.y = this.radius; this.vy *= -0.9; }
    if (this.y > world.height - this.radius) { this.y = world.height - this.radius; this.vy *= -0.9; }

    // energy cost (cache moveCost)
    const moveCost = readNumber(ui.moveCost, 0.5, 0, 10);
    const s = len(this.vx, this.vy);
    this.energy -= (0.04 + moveCost * (s * 0.25)) * dt;

    // lifecycle
    this.age += dt; if (this.mateCooldown > 0) this.mateCooldown -= dt;

    // eating
    if (this.type === SPECIES.HERB) {
      for (let i = world.plants.length - 1; i >= 0; i--) {
        const p = world.plants[i]; const d2 = dist2(this, p); if (d2 <= (this.radius + p.radius) * (this.radius + p.radius)) {
          this.energy = Math.min(150, this.energy + p.energy);
          if (ui.enableMemory && ui.enableMemory.checked) { this.memory.lastFoodPos = { x: p.x, y: p.y }; this.memory.lastFoodSeenAt = world.time; }
          world.plants.splice(i, 1);
        }
      }
    } else if (this.type === SPECIES.CARN) {
      for (let i = world.agents.length - 1; i >= 0; i--) {
        const a = world.agents[i]; if (a === this || a.type !== SPECIES.HERB) continue;
        const d2 = dist2(this, a); if (d2 <= (this.radius + a.radius) * (this.radius + a.radius)) {
          this.energy = Math.min(180, this.energy + 70);
          if (ui.enableMemory && ui.enableMemory.checked) { this.memory.lastFoodPos = { x: a.x, y: a.y }; this.memory.lastFoodSeenAt = world.time; }
          world.agents.splice(i, 1);
        }
      }
    }
  }

  reproduceWith(partner) {
    const cost = 40; if (this.energy < cost || partner.energy < cost) return;
    this.energy -= cost; partner.energy -= cost; this.mateCooldown = 6; partner.mateCooldown = 6;
    const genes = { speed: clamp((this.genes.speed + partner.genes.speed) / 2 + rand(-0.12, 0.12), 0.2, 5), vision: clamp((this.genes.vision + partner.genes.vision) / 2 + rand(-6, 6), 20, 260) };
    const cx = (this.x + partner.x) / 2 + rand(-8, 8); const cy = (this.y + partner.y) / 2 + rand(-8, 8);
    world.agents.push(new Animal(cx, cy, this.type, genes));
  }

  draw(ctx) {
    if (!ctx) return;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.fillStyle = (this.type === SPECIES.CARN) ? '#ff5e57' : '#6ea8fe'; ctx.fill();

    // energy bar
    const w = 18, h = 3; const eNorm = clamp(this.energy / 150, 0, 1);
    const gx = this.x - w / 2, gy = this.y - this.radius - 8;
    ctx.fillStyle = '#00000088'; ctx.fillRect(gx, gy, w, h);
    ctx.fillStyle = eNorm > 0.5 ? '#4cd964' : (eNorm > 0.25 ? '#ffcc00' : '#ff5e57'); ctx.fillRect(gx, gy, w * eNorm, h);

    // vision
    if (ui.showVision && ui.showVision.checked) {
      ctx.beginPath(); ctx.arc(this.x, this.y, this.genes.vision, 0, TAU); ctx.strokeStyle = (this.type === SPECIES.CARN) ? '#ff5e5733' : '#6ea8fe33'; ctx.lineWidth = 1; ctx.stroke();
    }

    // target
    if (ui.showTargets && ui.showTargets.checked && this.target) {
      if (typeof this.target.x === 'number' && typeof this.target.y === 'number') {
        ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(this.target.x, this.target.y); ctx.strokeStyle = '#ffffff33'; ctx.stroke();
      }
    }

    // territory
    if (this.type === SPECIES.CARN && ui.enableTerritory && ui.enableTerritory.checked && this.territory) {
      ctx.beginPath(); ctx.arc(this.territory.cx, this.territory.cy, this.territory.radius, 0, TAU); ctx.strokeStyle = '#ff5e5722'; ctx.setLineDash([4, 6]); ctx.stroke(); ctx.setLineDash([]);
    }

    // debug
    if (ui.showDebug && ui.showDebug.checked) {
      ctx.fillStyle = 'white'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
      ctx.fillText(`${this.type === SPECIES.CARN ? 'Carnívoro' : 'Herbívoro'} | E:${Math.round(this.energy)} | ${this.state}`, this.x, this.y - this.radius - 14);
    }
  }

  isDead() { return this.energy <= 0 || this.age >= this.maxAge; }
}

// ======= World control helpers =======
function addPlant(manualX = null, manualY = null) {
  const cap = readInt(ui.plantCap, 120, 1, 10000);
  if (world.plants.length >= cap) return false;
  const x = (manualX !== null) ? manualX : rand(12, world.width - 12);
  const y = (manualY !== null) ? manualY : rand(12, world.height - 12);
  world.plants.push(new Plant(x, y));
  return true;
}
function addHerbivore() { world.agents.push(new Animal(rand(20, world.width - 20), rand(20, world.height - 20), SPECIES.HERB)); }
function addCarnivore() { world.agents.push(new Animal(rand(20, world.width - 20), rand(20, world.height - 20), SPECIES.CARN)); }

window.addPlant = addPlant; window.addHerbivore = addHerbivore; window.addCarnivore = addCarnivore;

function applyInitialSpawn() {
  resetSim(true);
  const h = readInt(ui.initHerb, 8, 0, 1000);
  const c = readInt(ui.initCarn, 4, 0, 1000);
  const p = readInt(ui.initPlant, 40, 0, 10000);
  for (let i = 0; i < h; i++) addHerbivore();
  for (let i = 0; i < c; i++) addCarnivore();
  for (let i = 0; i < p; i++) addPlant();
}
window.applyInitialSpawn = applyInitialSpawn;

function startSim() { world.running = true; }
function stopSim() { world.running = false; }
function resetSim(keepRunning = false) {
  world.agents.length = 0; world.plants.length = 0; world.plantAccumulator = 0; stats.history.length = 0; world.time = 0;
  if (!keepRunning) world.running = false;
}
window.startSim = startSim; window.stopSim = stopSim; window.resetSim = resetSim;

// ======= Seasons =======
function seasonalityMultiplier() {
  if (!ui.enableSeason || !ui.enableSeason.checked) return 1;
  const period = 60; // seconds per cycle
  const phase = (world.time % period) / period;
  return 1 + Math.sin(phase * TAU) * 0.55;
}

// ======= Update & Draw =======
function update(dt) {
  // plant regen
  const regenBase = readNumber(ui.plantRegen, 2, 0, 100);
  let regen = regenBase * seasonalityMultiplier();
  world.plantAccumulator += regen * dt;
  const cap = readInt(ui.plantCap, 120, 1, 10000);
  while (world.plantAccumulator >= 1 && world.plants.length < cap) { addPlant(); world.plantAccumulator -= 1; }

  if (world.running) {
    // iterate backwards for safe removal
    for (let i = world.agents.length - 1; i >= 0; i--) {
      const a = world.agents[i]; a.act(dt); if (a.isDead()) world.agents.splice(i, 1);
    }
  }

  // stats bookkeeping
  stats.tickAccumulator += dt;
  if (stats.tickAccumulator >= stats.tickInterval) {
    stats.tickAccumulator = 0;
    const herbCount = world.agents.filter(a => a.type === SPECIES.HERB).length;
    const carnCount = world.agents.filter(a => a.type === SPECIES.CARN).length;
    const plantCount = world.plants.length;
    stats.history.push({ t: world.time, herb: herbCount, carn: carnCount, plant: plantCount });
    if (stats.history.length > stats.maxPoints) stats.history.shift();
    if (ui.popHint) ui.popHint.textContent = `H:${herbCount} C:${carnCount} P:${plantCount}`;
    drawStats();
  }
}

function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, world.width, world.height);

  // background grid
  ctx.globalAlpha = 0.06; ctx.beginPath();
  for (let x = 40; x < world.width; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, world.height); }
  for (let y = 40; y < world.height; y += 40) { ctx.moveTo(0, y); ctx.lineTo(world.width, y); }
  ctx.strokeStyle = '#6b7280'; ctx.stroke(); ctx.globalAlpha = 1;

  for (let i = 0; i < world.plants.length; i++) world.plants[i].draw(ctx);
  for (let i = 0; i < world.agents.length; i++) world.agents[i].draw(ctx);
}

// ======= Main loop =======
function step(now) {
  if (!world.lastTs) world.lastTs = now;
  const dt = Math.min((now - world.lastTs) / 1000, 0.05);
  world.lastTs = now; world.time += dt;
  update(dt); draw();
  requestAnimationFrame(step);
}

// ======= Stats drawing =======
function drawStats() {
  if (!sctx || !statsCanvas) return;
  const w = statsCanvas.width, h = statsCanvas.height;
  sctx.clearRect(0, 0, w, h);
  sctx.fillStyle = '#041216'; sctx.fillRect(0, 0, w, h);
  if (!stats.history.length) return;

  const maxY = Math.max(...stats.history.map(s => Math.max(s.herb, s.carn, s.plant)), 5);
  const minY = 0; const pad = 6; const plotW = w - pad * 2, plotH = h - pad * 2; const n = stats.history.length;
  sctx.strokeStyle = '#0e2230'; sctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const yy = pad + (plotH / 3) * i; sctx.beginPath(); sctx.moveTo(pad, yy); sctx.lineTo(pad + plotW, yy); sctx.stroke(); }

  const xAt = i => pad + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yAt = v => pad + plotH - ((v - minY) / (maxY - minY || 1)) * plotH;

  // plants
  sctx.beginPath(); for (let i = 0; i < n; i++) { const y = yAt(stats.history[i].plant); const x = xAt(i); if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y); }
  sctx.strokeStyle = '#4cd964'; sctx.lineWidth = 2; sctx.stroke();
  // herb
  sctx.beginPath(); for (let i = 0; i < n; i++) { const y = yAt(stats.history[i].herb); const x = xAt(i); if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y); }
  sctx.strokeStyle = '#6ea8fe'; sctx.lineWidth = 2; sctx.stroke();
  // carn
  sctx.beginPath(); for (let i = 0; i < n; i++) { const y = yAt(stats.history[i].carn); const x = xAt(i); if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y); }
  sctx.strokeStyle = '#ff5e57'; sctx.lineWidth = 2; sctx.stroke();

  sctx.fillStyle = '#9fb1c2'; sctx.font = '10px sans-serif'; sctx.fillText(`P:${stats.history[stats.history.length - 1].plant}`, pad, h - 2);
  sctx.fillStyle = '#6ea8fe'; sctx.fillText(`H:${stats.history[stats.history.length - 1].herb}`, pad + 60, h - 2);
  sctx.fillStyle = '#ff5e57'; sctx.fillText(`C:${stats.history[stats.history.length - 1].carn}`, pad + 120, h - 2);
}

// ======= Responsividade & Boot =======
function resizeCanvas() {
  const panelWidth = document.querySelector('.panel')?.offsetWidth || 300;
  const w = Math.max(200, window.innerWidth - panelWidth);
  const h = Math.max(200, window.innerHeight);
  if (canvas) { canvas.width = w; canvas.height = h; }
  world.width = w; world.height = h;
  if (statsCanvas) { statsCanvas.width = 260; statsCanvas.height = 120; }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// initialize and start
applyInitialSpawn();
world.lastTs = performance.now();
requestAnimationFrame(step);

// Export for debugging
window._ecosystemWorld = world; window._ecosystemUI = ui; window._ecosystemStats = stats;
