import { TAU, clamp, distanceSq, length, smoothstep } from '../core/math.js';

export const KIND = {
  PLANT: 'plant',
  HERBIVORE: 'herbivore',
  CARNIVORE: 'carnivore'
};

export const STATE_LABELS = {
  wander: 'explorando',
  forage: 'procurando comida',
  graze: 'pastando',
  flee: 'fugindo',
  herd: 'agrupando',
  mate: 'reproduzindo',
  hunt: 'cacando',
  patrol: 'patrulhando',
  rest: 'descansando'
};

export class Plant {
  constructor(id, x, y, biome, genes, rng, options = {}) {
    this.id = id;
    this.kind = KIND.PLANT;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.alive = true;
    this.deathReason = '';
    this.age = options.age ?? rng.float(0, 22);
    this.genes = genes;
    this.biomeId = biome.id;
    this.maxBiomass = genes.plantMass * biome.plantCapacity;
    this.biomass = options.biomass ?? rng.float(4, this.maxBiomass * 0.72);
    this.energyDensity = 1.25;
    this.matureAge = rng.float(12, 30) / genes.plantGrowth;
    this.maxAge = genes.lifespan * rng.float(0.82, 1.18);
    this.seedCooldown = rng.float(12, 34);
    this.mature = false;
    this.radius = 4;
    this.refreshSize();
  }

  update(dt, sim) {
    if (!this.alive) return;

    const cell = sim.environment.getCellAt(this.x, this.y);
    const biome = cell.biome;
    this.biomeId = biome.id;
    this.maxBiomass = this.genes.plantMass * biome.plantCapacity * cell.fertility;

    const envGrowth = sim.environment.getGrowthMultiplier(biome);
    const crowdStress = sim.plantPressureAt(this.x, this.y, 42);
    const moistureFit = clamp((sim.environment.moisture + biome.moisture + this.genes.droughtTolerance * 0.22) / 2.1, 0.25, 1.12);
    const growth = this.genes.plantGrowth * biome.plantGrowth * envGrowth * sim.settings.plantGrowth * cell.fertility * moistureFit;
    const openSpace = clamp(1 - this.biomass / (this.maxBiomass || 1), 0, 1);

    this.biomass += growth * openSpace * clamp(1 - crowdStress * 0.08, 0.35, 1) * 4.2 * dt;
    if (sim.environment.weather.id === 'drought') {
      this.biomass -= clamp(1.1 - this.genes.droughtTolerance, 0, 0.9) * 1.8 * dt;
    }

    this.age += dt * sim.settings.lifeSpeed;
    this.seedCooldown -= dt;
    if (this.mature && this.seedCooldown <= 0 && sim.canSeedPlant()) {
      const seedChance = 0.35 * envGrowth * clamp(1 - crowdStress * 0.16, 0, 1);
      if (sim.rng.chance(seedChance)) sim.queuePlantSeed(this);
      this.seedCooldown = sim.rng.float(18, 44);
    }

    if (this.age >= this.maxAge) {
      this.alive = false;
      this.deathReason = 'idade';
    } else if (this.biomass <= 0.8) {
      this.alive = false;
      this.deathReason = 'consumida';
    }

    this.refreshSize();
  }

  consume(amount) {
    if (!this.alive) return 0;
    const taken = Math.min(this.biomass, amount);
    this.biomass -= taken;
    if (this.biomass <= 0.8) {
      this.alive = false;
      this.deathReason = 'consumida';
    }
    this.refreshSize();
    return taken * this.energyDensity;
  }

  refreshSize() {
    this.mature = this.age >= this.matureAge && this.biomass >= this.maxBiomass * 0.42;
    this.radius = clamp(2.5 + Math.sqrt(Math.max(0, this.biomass)) * 0.72, 2.5, 10.5);
  }
}

export class Animal {
  constructor(id, x, y, kind, genes, rng, options = {}) {
    this.id = id;
    this.kind = kind;
    this.x = x;
    this.y = y;
    const angle = rng.float(0, TAU);
    const startSpeed = genes.speed * rng.float(0.12, 0.42);
    this.vx = Math.cos(angle) * startSpeed;
    this.vy = Math.sin(angle) * startSpeed;
    this.ax = 0;
    this.ay = 0;
    this.genes = genes;
    this.alive = true;
    this.deathReason = '';
    this.age = options.age ?? 0;
    this.parents = options.parents || [];
    this.generation = options.generation ?? 1;
    this.maturityAge = kind === KIND.HERBIVORE ? 23 / genes.fertility : 34 / genes.fertility;
    this.maxAge = genes.lifespan;
    this.maxEnergy = (kind === KIND.HERBIVORE ? 132 : 185) * genes.size;
    this.energy = options.energy ?? this.maxEnergy * (options.newborn ? 0.42 : 0.72);
    this.radius = 8;
    this.stageScale = 1;
    this.state = 'wander';
    this.previousState = 'wander';
    this.stateTime = 0;
    this.reproductionCooldown = options.newborn ? this.maturityAge : rng.float(7, 18);
    this.restDebt = rng.float(0, 0.18);
    this.wanderAngle = angle;
    this.wanderTimer = rng.float(0.4, 2.3);
    this.target = null;
    this.targetX = x;
    this.targetY = y;
    this.memoryFoodX = x;
    this.memoryFoodY = y;
    this.memoryFoodAge = 999;
    this.memoryThreatX = x;
    this.memoryThreatY = y;
    this.memoryThreatAge = 999;
    this.lastMealAge = 0;
    this.utility = {
      flee: 0,
      forage: 0,
      graze: 0,
      herd: 0,
      mate: 0,
      hunt: 0,
      patrol: 0,
      rest: 0,
      wander: 0
    };
    this.sense = {
      nearestPlant: null,
      nearestPlantD2: Infinity,
      nearestPrey: null,
      nearestPreyD2: Infinity,
      nearestThreat: null,
      nearestThreatD2: Infinity,
      mate: null,
      mateD2: Infinity,
      groupCount: 0,
      groupX: 0,
      groupY: 0,
      alignX: 0,
      alignY: 0,
      separateX: 0,
      separateY: 0,
      predatorCount: 0
    };

    this.territory = null;
    if (kind === KIND.CARNIVORE) {
      this.territory = {
        x,
        y,
        radius: genes.territory,
        targetX: x,
        targetY: y,
        timer: 0
      };
    }

    this.updateStage();
  }

  update(dt, sim) {
    if (!this.alive) return;

    this.ax = 0;
    this.ay = 0;
    this.memoryFoodAge += dt;
    this.memoryThreatAge += dt;
    this.lastMealAge += dt;
    this.reproductionCooldown = Math.max(0, this.reproductionCooldown - dt);
    this.age += dt * sim.settings.lifeSpeed;
    this.restDebt = clamp(this.restDebt + dt * 0.018 * this.genes.metabolism, 0, 1);
    this.updateStage();

    sim.perceive(this);
    this.decide(sim);
    this.act(dt, sim);
    this.integrate(dt, sim);
    this.metabolize(dt, sim);

    if (this.energy <= 0) {
      this.alive = false;
      this.deathReason = 'fome';
    } else if (this.age >= this.maxAge) {
      this.alive = false;
      this.deathReason = 'idade';
    }
  }

  updateStage() {
    const juvenile = clamp(this.age / (this.maturityAge || 1), 0, 1);
    const senior = smoothstep(this.maxAge * 0.72, this.maxAge, this.age);
    this.stageScale = clamp(0.54 + juvenile * 0.46 - senior * 0.2, 0.5, 1);
    const baseRadius = this.kind === KIND.CARNIVORE ? 10.8 : 8.4;
    this.radius = baseRadius * this.genes.size * this.stageScale;
  }

  get isAdult() {
    return this.age >= this.maturityAge && this.age < this.maxAge * 0.86;
  }

  get hunger() {
    return clamp(1 - this.energy / this.maxEnergy, 0, 1);
  }

  decide(sim) {
    const u = this.utility;
    u.flee = 0;
    u.forage = 0;
    u.graze = 0;
    u.herd = 0;
    u.mate = 0;
    u.hunt = 0;
    u.patrol = 0;
    u.rest = 0;
    u.wander = 0.16;

    const hunger = this.hunger;
    const adultEnergy = this.energy / this.maxEnergy;
    const nightRest = sim.environment.light < 0.38 ? 0.18 : 0;
    const reproductionEnergy = this.kind === KIND.HERBIVORE ? 0.68 : 0.56;
    const mateReady = this.isAdult && this.reproductionCooldown <= 0 && adultEnergy > reproductionEnergy && this.sense.mate && sim.canAnimalReproduce(this);

    if (this.kind === KIND.HERBIVORE) {
      const threatNearness = this.sense.nearestThreat ? 1 - Math.sqrt(this.sense.nearestThreatD2) / (this.visionRange(sim) || 1) : 0;
      const fear = clamp((threatNearness * 1.15 + this.sense.predatorCount * 0.12) * (1.18 - this.genes.courage), 0, 1.45);
      u.flee = fear;
      u.forage = hunger * (this.sense.nearestPlant ? 1.02 : (this.memoryFoodAge < 28 && sim.settings.enableMemory ? 0.42 : 0.22));
      u.graze = this.sense.nearestPlant && hunger > 0.18 ? hunger * 0.95 : 0;
      u.herd = sim.settings.enableFlocking ? this.genes.sociability * (0.16 + fear * 0.46) * clamp(this.sense.groupCount / 5, 0, 1) : 0;
      u.mate = mateReady ? 0.86 * (1 - hunger) * this.genes.fertility : 0;
      u.rest = this.restDebt * 0.42 + nightRest + (adultEnergy < 0.18 ? 0.18 : 0);
      u.wander += (1 - hunger) * 0.06;
    } else {
      const preyNearness = this.sense.nearestPrey ? 1 - Math.sqrt(this.sense.nearestPreyD2) / (this.visionRange(sim) || 1) : 0;
      u.hunt = hunger * (this.sense.nearestPrey ? 0.82 + preyNearness * 0.54 : (this.memoryFoodAge < 32 && sim.settings.enableMemory ? 0.36 : 0.16));
      const preyAbundance = sim.stats.current.herbivores / Math.max(1, sim.stats.current.carnivores * 4);
      u.mate = mateReady ? (0.82 + clamp(preyAbundance, 0, 1) * 0.28) * (1 - hunger) * this.genes.fertility : 0;
      u.rest = (1 - hunger) * 0.22 + this.restDebt * 0.52 + nightRest * 0.35;
      if (sim.settings.enableTerritory && this.territory) {
        const d = Math.sqrt(distanceSq(this.x, this.y, this.territory.x, this.territory.y));
        u.patrol = clamp((d / this.territory.radius) * 0.58, 0, 0.78);
        if (!this.sense.nearestPrey && hunger < 0.48) u.patrol += 0.12;
      }
      u.wander += 0.1;
    }

    let bestState = 'wander';
    let bestScore = u.wander;
    const states = this.kind === KIND.HERBIVORE
      ? ['flee', 'graze', 'forage', 'mate', 'herd', 'rest', 'wander']
      : ['hunt', 'mate', 'patrol', 'rest', 'wander'];

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      if (u[state] > bestScore) {
        bestScore = u[state];
        bestState = state;
      }
    }

    this.setState(bestState);
  }

  act(dt, sim) {
    this.target = null;
    const s = this.sense;
    const rng = sim.rng;

    if (this.state === 'flee') {
      const source = s.nearestThreat;
      const tx = source ? source.x : this.memoryThreatX;
      const ty = source ? source.y : this.memoryThreatY;
      this.addFlee(tx, ty, 270 * this.genes.stamina);
      this.applyHerding(75, 0.18, 0.55);
      if (source) {
        this.memoryThreatX = source.x;
        this.memoryThreatY = source.y;
        this.memoryThreatAge = 0;
      }
    } else if (this.state === 'graze' || this.state === 'forage') {
      let tx = this.memoryFoodX;
      let ty = this.memoryFoodY;
      if (s.nearestPlant) {
        this.target = s.nearestPlant;
        tx = s.nearestPlant.x;
        ty = s.nearestPlant.y;
        this.memoryFoodX = tx;
        this.memoryFoodY = ty;
        this.memoryFoodAge = 0;
      }
      if (sim.settings.enableMemory || s.nearestPlant) this.addSeek(tx, ty, 165);
      else this.addWander(rng, 78, dt);
      if (s.nearestPlant) this.tryEatPlant(dt, sim, s.nearestPlant);
      this.applyHerding(58, 0.08, 0.4);
    } else if (this.state === 'hunt') {
      let tx = this.memoryFoodX;
      let ty = this.memoryFoodY;
      if (s.nearestPrey) {
        this.target = s.nearestPrey;
        const lead = clamp(Math.sqrt(s.nearestPreyD2) / 90, 0, 1.15);
        tx = s.nearestPrey.x + s.nearestPrey.vx * lead * 0.28;
        ty = s.nearestPrey.y + s.nearestPrey.vy * lead * 0.28;
        this.memoryFoodX = s.nearestPrey.x;
        this.memoryFoodY = s.nearestPrey.y;
        this.memoryFoodAge = 0;
      }
      if (sim.settings.enableMemory || s.nearestPrey) this.addSeek(tx, ty, 205 * this.genes.aggression);
      else this.addWander(rng, 72, dt);
      if (s.nearestPrey) this.tryCatchPrey(sim, s.nearestPrey);
    } else if (this.state === 'mate') {
      if (s.mate) {
        this.target = s.mate;
        this.addSeek(s.mate.x, s.mate.y, 142);
        const touch = this.radius + s.mate.radius + 5;
        if (s.mateD2 <= touch * touch) sim.reproduceAnimal(this, s.mate);
      } else {
        this.addWander(rng, 54, dt);
      }
    } else if (this.state === 'herd') {
      this.applyHerding(105, 0.28, 0.88);
      this.addWander(rng, 38, dt);
    } else if (this.state === 'patrol' && this.territory) {
      this.territory.timer -= dt;
      if (this.territory.timer <= 0 || distanceSq(this.x, this.y, this.territory.targetX, this.territory.targetY) < 420) {
        const angle = rng.float(0, TAU);
        const radius = rng.float(this.territory.radius * 0.25, this.territory.radius * 0.88);
        this.territory.targetX = clamp(this.territory.x + Math.cos(angle) * radius, 18, sim.width - 18);
        this.territory.targetY = clamp(this.territory.y + Math.sin(angle) * radius, 18, sim.height - 18);
        this.territory.timer = rng.float(4, 11);
      }
      this.targetX = this.territory.targetX;
      this.targetY = this.territory.targetY;
      this.addSeek(this.targetX, this.targetY, 118);
    } else if (this.state === 'rest') {
      this.vx *= Math.pow(0.18, dt);
      this.vy *= Math.pow(0.18, dt);
      this.energy = Math.min(this.maxEnergy, this.energy + (this.kind === KIND.CARNIVORE ? 1.5 : 1.0) * dt);
      this.restDebt = Math.max(0, this.restDebt - dt * 0.18);
    } else {
      this.addWander(rng, 72, dt);
      if (this.kind === KIND.HERBIVORE) this.applyHerding(52, 0.06, 0.32);
    }

    this.addBoundarySteering(sim);
  }

  integrate(dt, sim) {
    const weatherMove = sim.environment.weather.movement;
    const stateBoost = this.state === 'flee' || this.state === 'hunt' ? 1.18 : (this.state === 'rest' ? 0.28 : 1);
    const ageDrag = this.stageScale;
    const maxSpeed = this.genes.speed * sim.settings.animalSpeed * weatherMove * stateBoost * ageDrag;

    this.vx += this.ax * dt;
    this.vy += this.ay * dt;
    const damping = this.state === 'rest' ? 0.4 : 0.82;
    this.vx *= Math.pow(damping, dt);
    this.vy *= Math.pow(damping, dt);

    const speed = length(this.vx, this.vy);
    if (speed > maxSpeed) {
      const scale = maxSpeed / (speed || 1);
      this.vx *= scale;
      this.vy *= scale;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.x < this.radius) {
      this.x = this.radius;
      this.vx = Math.abs(this.vx) * 0.55;
    } else if (this.x > sim.width - this.radius) {
      this.x = sim.width - this.radius;
      this.vx = -Math.abs(this.vx) * 0.55;
    }
    if (this.y < this.radius) {
      this.y = this.radius;
      this.vy = Math.abs(this.vy) * 0.55;
    } else if (this.y > sim.height - this.radius) {
      this.y = sim.height - this.radius;
      this.vy = -Math.abs(this.vy) * 0.55;
    }

    this.stateTime += dt;
  }

  metabolize(dt, sim) {
    const speed = length(this.vx, this.vy);
    const basal = (this.kind === KIND.HERBIVORE ? 0.22 : 0.34) * this.genes.metabolism;
    const movement = speed * speed * 0.000026 * this.genes.metabolism;
    const ageCost = this.age > this.maxAge * 0.72 ? 0.07 : 0;
    this.energy -= (basal + movement + ageCost) * sim.settings.energyCost * dt;
  }

  addSeek(tx, ty, force) {
    this.targetX = tx;
    this.targetY = ty;
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.ax += (dx / d) * force;
    this.ay += (dy / d) * force;
  }

  addFlee(tx, ty, force) {
    const dx = this.x - tx;
    const dy = this.y - ty;
    const d = Math.hypot(dx, dy) || 1;
    this.ax += (dx / d) * force;
    this.ay += (dy / d) * force;
  }

  addWander(rng, force, dt) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderAngle += rng.float(-0.9, 0.9);
      this.wanderTimer = rng.float(0.45, 1.6);
    }
    this.ax += Math.cos(this.wanderAngle) * force;
    this.ay += Math.sin(this.wanderAngle) * force;
  }

  applyHerding(force, cohesionWeight, separationWeight) {
    const s = this.sense;
    if (s.groupCount <= 0) return;
    const inv = 1 / s.groupCount;
    const cx = s.groupX * inv;
    const cy = s.groupY * inv;
    this.ax += (cx - this.x) * cohesionWeight;
    this.ay += (cy - this.y) * cohesionWeight;
    this.ax += s.separateX * separationWeight * force;
    this.ay += s.separateY * separationWeight * force;
    this.ax += (s.alignX * inv - this.vx) * 0.22;
    this.ay += (s.alignY * inv - this.vy) * 0.22;
  }

  addBoundarySteering(sim) {
    const margin = 95;
    const force = 132;
    if (this.x < margin) this.ax += force;
    else if (this.x > sim.width - margin) this.ax -= force;
    if (this.y < margin) this.ay += force;
    else if (this.y > sim.height - margin) this.ay -= force;
  }

  tryEatPlant(dt, sim, plant) {
    if (!plant || !plant.alive) return;
    const reach = this.radius + plant.radius + 4;
    if (distanceSq(this.x, this.y, plant.x, plant.y) > reach * reach) return;
    const gained = plant.consume((24 + this.genes.digestion * 18) * dt);
    if (gained > 0) {
      this.energy = Math.min(this.maxEnergy, this.energy + gained * this.genes.digestion);
      this.lastMealAge = 0;
      sim.noteConsumption(KIND.PLANT, gained);
    }
  }

  tryCatchPrey(sim, prey) {
    if (!prey || !prey.alive) return;
    const reach = this.radius + prey.radius + 3;
    if (distanceSq(this.x, this.y, prey.x, prey.y) > reach * reach) return;
    const speedAdvantage = clamp((this.genes.speed - prey.genes.speed + 28) / 68, 0.18, 0.92);
    const success = speedAdvantage * this.genes.aggression * (0.78 + this.hunger * 0.42);
    if (sim.rng.chance(clamp(success, 0.24, 0.97))) {
      sim.killPrey(this, prey);
      this.energy = Math.min(this.maxEnergy, this.energy + prey.maxEnergy * 0.68 * this.genes.digestion);
      this.lastMealAge = 0;
    } else {
      prey.addFlee(this.x, this.y, 220);
      this.energy -= 0.8;
    }
  }

  visionRange(sim) {
    return this.genes.vision * sim.settings.visionScale * sim.environment.weather.visibility * (0.72 + sim.environment.light * 0.28);
  }

  setState(state) {
    if (this.state === state) return;
    this.previousState = this.state;
    this.state = state;
    this.stateTime = 0;
  }
}
