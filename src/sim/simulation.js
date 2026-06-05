import { clamp, createRng, distanceSq, formatTime } from '../core/math.js';
import { SpatialHashGrid } from '../core/spatial-hash-grid.js';
import { createAnimalGenes, createPlantGenes, inheritAnimalGenes, inheritPlantGenes } from '../core/genes.js';
import { Environment } from './environment.js';
import { Animal, KIND, Plant } from './entities.js';

export const PRESETS = {
  balanced: {
    name: 'Equilibrado',
    seed: 'serra-verde',
    herbivores: 88,
    carnivores: 18,
    plants: 720,
    plantCap: 1250,
    plantGrowth: 1,
    plantRegen: 2.6,
    energyCost: 1
  },
  lush: {
    name: 'Abundante',
    seed: 'chuva-lenta',
    herbivores: 130,
    carnivores: 16,
    plants: 1020,
    plantCap: 1700,
    plantGrowth: 1.22,
    plantRegen: 3.4,
    energyCost: 0.92
  },
  harsh: {
    name: 'Severo',
    seed: 'vento-seco',
    herbivores: 58,
    carnivores: 15,
    plants: 420,
    plantCap: 760,
    plantGrowth: 0.76,
    plantRegen: 1.55,
    energyCost: 1.14
  },
  predator: {
    name: 'Predadores',
    seed: 'fronteira-rubra',
    herbivores: 145,
    carnivores: 34,
    plants: 900,
    plantCap: 1450,
    plantGrowth: 1.08,
    plantRegen: 2.9,
    energyCost: 1.03
  }
};

export function createDefaultSettings() {
  return {
    seed: PRESETS.balanced.seed,
    preset: 'balanced',
    paused: false,
    timeScale: 1,
    animalSpeed: 1,
    energyCost: 1,
    plantGrowth: 1,
    plantRegen: 2.6,
    plantCap: 1250,
    visionScale: 1,
    mutationRate: 0.12,
    lifeSpeed: 1,
    enableFlocking: true,
    enableTerritory: true,
    enableMemory: true,
    showVision: false,
    showTargets: true,
    showDebug: false,
    showGrid: false,
    showBiomes: true,
    initialHerbivores: 88,
    initialCarnivores: 18,
    initialPlants: 720
  };
}

export class Simulation {
  constructor(settings = {}) {
    this.width = 2400;
    this.height = 1500;
    this.settings = { ...createDefaultSettings(), ...settings };
    this.rng = createRng(this.settings.seed);
    this.environment = new Environment(this.width, this.height, this.rng);
    this.plants = [];
    this.animals = [];
    this.nextId = 1;
    this.time = 0;
    this.plantAccumulator = 0;
    this.plantGrid = new SpatialHashGrid(86);
    this.animalGrid = new SpatialHashGrid(118);
    this._queryPlants = [];
    this._queryAnimals = [];
    this._birthQueue = [];
    this._seedQueue = [];
    this.selectedId = null;
    this.followId = null;
    this.events = [];
    this.counters = {
      births: 0,
      deaths: 0,
      predations: 0,
      plantEnergy: 0,
      plantDeaths: 0
    };
    this.stats = {
      accumulator: 0,
      interval: 0.5,
      maxHistory: 260,
      current: this.createEmptyStats(),
      history: []
    };
    this.reset(this.settings.seed, this.settings.preset);
  }

  createEmptyStats() {
    return {
      time: 0,
      plants: 0,
      herbivores: 0,
      carnivores: 0,
      biomass: 0,
      maturePlants: 0,
      avgEnergy: 0,
      avgAge: 0,
      births: 0,
      deaths: 0,
      predations: 0,
      plantEnergy: 0,
      animalGridCells: 0,
      plantGridCells: 0
    };
  }

  applySettings(nextSettings) {
    Object.assign(this.settings, nextSettings);
  }

  applyPreset(name) {
    const preset = PRESETS[name] || PRESETS.balanced;
    this.settings.preset = name;
    this.settings.seed = preset.seed;
    this.settings.initialHerbivores = preset.herbivores;
    this.settings.initialCarnivores = preset.carnivores;
    this.settings.initialPlants = preset.plants;
    this.settings.plantCap = preset.plantCap;
    this.settings.plantGrowth = preset.plantGrowth;
    this.settings.plantRegen = preset.plantRegen;
    this.settings.energyCost = preset.energyCost;
    this.reset(this.settings.seed, name);
  }

  reset(seed = this.settings.seed, presetName = this.settings.preset) {
    const preset = PRESETS[presetName] || PRESETS.balanced;
    this.settings.seed = seed || preset.seed;
    this.rng = createRng(this.settings.seed);
    this.environment.reset(this.width, this.height, this.rng);
    this.plants.length = 0;
    this.animals.length = 0;
    this._birthQueue.length = 0;
    this._seedQueue.length = 0;
    this.events.length = 0;
    this.stats.history.length = 0;
    this.stats.accumulator = 0;
    this.nextId = 1;
    this.time = 0;
    this.plantAccumulator = 0;
    this.selectedId = null;
    this.followId = null;
    this.counters.births = 0;
    this.counters.deaths = 0;
    this.counters.predations = 0;
    this.counters.plantEnergy = 0;
    this.counters.plantDeaths = 0;

    const plantCount = this.settings.initialPlants ?? preset.plants;
    const herbCount = this.settings.initialHerbivores ?? preset.herbivores;
    const carnCount = this.settings.initialCarnivores ?? preset.carnivores;

    for (let i = 0; i < plantCount; i++) this.spawnPlantRandom({ matureBias: true, silent: true });
    for (let i = 0; i < herbCount; i++) this.spawnAnimalRandom(KIND.HERBIVORE, { adultBias: true, silent: true });
    for (let i = 0; i < carnCount; i++) this.spawnAnimalRandom(KIND.CARNIVORE, { adultBias: true, silent: true });

    this.rebuildGrids();
    this.captureStats(true);
    this.log('system', `Simulacao reiniciada com seed "${this.settings.seed}"`);
  }

  update(frameDt) {
    if (this.settings.paused) return;
    const scaled = clamp(frameDt, 0, 0.08) * this.settings.timeScale;
    let remaining = scaled;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 30);
      this.step(dt);
      remaining -= dt;
    }
  }

  step(dt) {
    const oldWeather = this.environment.weather.id;
    const oldSeason = this.environment.season.id;
    this.environment.update(dt, this.rng);
    this.time = this.environment.time;
    if (oldWeather !== this.environment.weather.id) this.log('weather', `Clima mudou para ${this.environment.weather.name}`);
    if (oldSeason !== this.environment.season.id) this.log('season', `Estacao: ${this.environment.season.name}`);

    this.rebuildGrids();
    for (let i = 0; i < this.plants.length; i++) this.plants[i].update(dt, this);

    this.rebuildGrids();
    for (let i = 0; i < this.animals.length; i++) this.animals[i].update(dt, this);

    this.flushQueues();
    this.sweepDead();
    this.regeneratePlants(dt);
    this.rebuildGrids();
    this.captureStats(false, dt);
  }

  stepOnce() {
    this.step(1 / 24);
  }

  rebuildGrids() {
    this.plantGrid.rebuild(this.plants);
    this.animalGrid.rebuild(this.animals);
  }

  spawnPlantRandom(options = {}) {
    if (this.plants.length >= this.settings.plantCap) return null;
    const point = this.environment.randomPlantPoint(this.rng);
    return this.spawnPlant(point.x, point.y, null, options);
  }

  spawnPlant(x, y, genes = null, options = {}) {
    if (this.plants.length >= this.settings.plantCap) return null;
    const biome = this.environment.getBiomeAt(x, y);
    const plantGenes = genes || createPlantGenes(this.rng, biome);
    const plant = new Plant(this.nextId++, x, y, biome, plantGenes, this.rng, {
      age: options.matureBias ? this.rng.float(14, 70) : options.age,
      biomass: options.matureBias ? this.rng.float(14, plantGenes.plantMass * biome.plantCapacity) : options.biomass
    });
    this.plants.push(plant);
    if (!options.silent) this.log('birth', `Nova planta em ${biome.name}`, plant.id);
    return plant;
  }

  spawnAnimalRandom(kind, options = {}) {
    const point = this.environment.randomAnimalPoint(this.rng, kind);
    const genes = createAnimalGenes(kind, this.rng);
    return this.spawnAnimal(kind, point.x, point.y, genes, options);
  }

  spawnAnimal(kind, x, y, genes, options = {}) {
    const animal = new Animal(this.nextId++, x, y, kind, genes, this.rng, {
      newborn: !options.adultBias,
      age: options.adultBias ? this.rng.float(18, kind === KIND.HERBIVORE ? 78 : 96) : options.age,
      energy: options.energy,
      parents: options.parents,
      generation: options.generation || 1
    });
    this.animals.push(animal);
    if (!options.silent) {
      this.counters.births++;
      this.log('birth', `${kind === KIND.HERBIVORE ? 'Herbivoro' : 'Carnivoro'} nasceu`, animal.id);
    }
    return animal;
  }

  perceive(animal) {
    const sense = animal.sense;
    sense.nearestPlant = null;
    sense.nearestPlantD2 = Infinity;
    sense.nearestPrey = null;
    sense.nearestPreyD2 = Infinity;
    sense.nearestThreat = null;
    sense.nearestThreatD2 = Infinity;
    sense.mate = null;
    sense.mateD2 = Infinity;
    sense.groupCount = 0;
    sense.groupX = 0;
    sense.groupY = 0;
    sense.alignX = 0;
    sense.alignY = 0;
    sense.separateX = 0;
    sense.separateY = 0;
    sense.predatorCount = 0;

    const vision = animal.visionRange(this);
    const visionSq = vision * vision;

    const nearbyAnimals = this.animalGrid.queryRadius(animal.x, animal.y, vision, this._queryAnimals);
    for (let i = 0; i < nearbyAnimals.length; i++) {
      const other = nearbyAnimals[i];
      if (other === animal || !other.alive) continue;
      const d2 = distanceSq(animal.x, animal.y, other.x, other.y);
      if (d2 > visionSq) continue;

      if (animal.kind === KIND.HERBIVORE && other.kind === KIND.CARNIVORE) {
        sense.predatorCount++;
        if (d2 < sense.nearestThreatD2) {
          sense.nearestThreatD2 = d2;
          sense.nearestThreat = other;
        }
      } else if (animal.kind === KIND.CARNIVORE && other.kind === KIND.HERBIVORE) {
        if (d2 < sense.nearestPreyD2 && other.alive) {
          sense.nearestPreyD2 = d2;
          sense.nearestPrey = other;
        }
      }

      if (other.kind === animal.kind) {
        const groupRadius = animal.kind === KIND.HERBIVORE ? 78 : 44;
        if (d2 < groupRadius * groupRadius) {
          sense.groupCount++;
          sense.groupX += other.x;
          sense.groupY += other.y;
          sense.alignX += other.vx;
          sense.alignY += other.vy;
          const d = Math.sqrt(d2) || 1;
          if (d < (animal.radius + other.radius) * 3.4) {
            sense.separateX += (animal.x - other.x) / d;
            sense.separateY += (animal.y - other.y) / d;
          }
        }
        if (other.isAdult && other.reproductionCooldown <= 0 && animal.reproductionCooldown <= 0) {
          if (d2 < sense.mateD2) {
            sense.mateD2 = d2;
            sense.mate = other;
          }
        }
      }
    }

    if (animal.kind === KIND.HERBIVORE) {
      const nearbyPlants = this.plantGrid.queryRadius(animal.x, animal.y, vision, this._queryPlants);
      let bestScore = Infinity;
      for (let i = 0; i < nearbyPlants.length; i++) {
        const plant = nearbyPlants[i];
        if (!plant.alive || plant.biomass < 2.5) continue;
        const d2 = distanceSq(animal.x, animal.y, plant.x, plant.y);
        if (d2 > visionSq) continue;
        const score = d2 / (plant.biomass + 8);
        if (score < bestScore) {
          bestScore = score;
          sense.nearestPlantD2 = d2;
          sense.nearestPlant = plant;
        }
      }
    }
  }

  canAnimalReproduce(animal) {
    const current = this.stats.current;
    if (!animal.isAdult || animal.reproductionCooldown > 0) return false;
    if (animal.kind === KIND.HERBIVORE) {
      const biomassPerHerb = current.biomass / Math.max(1, current.herbivores);
      const plantRatio = current.plants / Math.max(1, this.settings.plantCap);
      const grazerLimit = Math.max(42, current.maturePlants * 0.44 + current.carnivores * 4);
      return biomassPerHerb > 34 && plantRatio > 0.28 && current.herbivores < grazerLimit;
    }

    const preyPerCarn = current.herbivores / Math.max(1, current.carnivores);
    const naturalLimit = Math.max(8, current.herbivores * 0.42);
    return preyPerCarn > 2.8 && current.carnivores < naturalLimit;
  }

  reproduceAnimal(a, b) {
    if (!a.alive || !b.alive || a.kind !== b.kind) return false;
    if (!this.canAnimalReproduce(a) || !this.canAnimalReproduce(b)) return false;
    const cost = a.kind === KIND.HERBIVORE ? 46 : 48;
    if (a.energy < cost || b.energy < cost) return false;

    a.energy -= cost;
    b.energy -= cost;
    const cooldown = a.kind === KIND.HERBIVORE ? 24 : 26;
    a.reproductionCooldown = cooldown / a.genes.fertility;
    b.reproductionCooldown = cooldown / b.genes.fertility;

    const genes = inheritAnimalGenes(a.kind, this.rng, a.genes, b.genes, this.settings.mutationRate);
    const x = clamp((a.x + b.x) * 0.5 + this.rng.float(-10, 10), 20, this.width - 20);
    const y = clamp((a.y + b.y) * 0.5 + this.rng.float(-10, 10), 20, this.height - 20);
    this._birthQueue.push({
      kind: a.kind,
      x,
      y,
      genes,
      options: {
        parents: [a.id, b.id],
        generation: Math.max(a.generation, b.generation) + 1
      }
    });
    return true;
  }

  killPrey(predator, prey) {
    if (!prey.alive) return;
    prey.alive = false;
    prey.deathReason = `predacao por #${predator.id}`;
    this.counters.predations++;
    this.log('predation', `Carnivoro #${predator.id} capturou herbivoro #${prey.id}`, predator.id);
  }

  noteConsumption(kind, energy) {
    if (kind === KIND.PLANT) this.counters.plantEnergy += energy;
  }

  plantPressureAt(x, y, radius) {
    const nearby = this.plantGrid.queryRadius(x, y, radius, this._queryPlants);
    const radiusSq = radius * radius;
    let pressure = 0;
    for (let i = 0; i < nearby.length; i++) {
      const plant = nearby[i];
      if (!plant.alive) continue;
      if (distanceSq(x, y, plant.x, plant.y) <= radiusSq) pressure += plant.radius / 8;
    }
    return pressure;
  }

  canSeedPlant() {
    return this.plants.length + this._seedQueue.length < this.settings.plantCap;
  }

  queuePlantSeed(parent) {
    if (!this.canSeedPlant()) return;
    const angle = this.rng.float(0, Math.PI * 2);
    const distance = this.rng.float(14, parent.genes.seedSpread);
    const x = clamp(parent.x + Math.cos(angle) * distance, 14, this.width - 14);
    const y = clamp(parent.y + Math.sin(angle) * distance, 14, this.height - 14);
    this._seedQueue.push({
      x,
      y,
      genes: inheritPlantGenes(this.rng, parent.genes, this.settings.mutationRate)
    });
  }

  flushQueues() {
    for (let i = 0; i < this._seedQueue.length; i++) {
      const seed = this._seedQueue[i];
      this.spawnPlant(seed.x, seed.y, seed.genes, { silent: true, biomass: this.rng.float(2.5, 7) });
    }
    this._seedQueue.length = 0;

    for (let i = 0; i < this._birthQueue.length; i++) {
      const birth = this._birthQueue[i];
      this.spawnAnimal(birth.kind, birth.x, birth.y, birth.genes, birth.options);
    }
    this._birthQueue.length = 0;
  }

  sweepDead() {
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const animal = this.animals[i];
      if (animal.alive) continue;
      this.counters.deaths++;
      if (this.selectedId === animal.id) this.selectedId = null;
      if (this.followId === animal.id) this.followId = null;
      const label = animal.kind === KIND.HERBIVORE ? 'Herbivoro' : 'Carnivoro';
      this.log('death', `${label} #${animal.id} morreu: ${animal.deathReason || 'desconhecido'}`, animal.id);
      this.animals.splice(i, 1);
    }

    for (let i = this.plants.length - 1; i >= 0; i--) {
      const plant = this.plants[i];
      if (plant.alive) continue;
      this.counters.plantDeaths++;
      if (this.selectedId === plant.id) this.selectedId = null;
      this.plants.splice(i, 1);
    }
  }

  regeneratePlants(dt) {
    const current = this.stats.current;
    const cap = this.settings.plantCap;
    const deficit = Math.max(0, cap - this.plants.length);
    if (deficit <= 0) return;

    const herbPressure = current.herbivores / Math.max(1, current.plants * 0.12);
    const averageGrowth = this.environment.season.growth * this.environment.weather.growth * (0.45 + this.environment.light * 0.55);
    const rate = this.settings.plantRegen * averageGrowth * clamp(0.65 + herbPressure * 0.22, 0.35, 1.85);
    this.plantAccumulator += rate * dt;

    let safety = 0;
    while (this.plantAccumulator >= 1 && this.plants.length < cap && safety < 18) {
      this.spawnPlantRandom({ silent: true, biomass: this.rng.float(2, 9) });
      this.plantAccumulator -= 1;
      safety++;
    }
  }

  captureStats(force = false, dt = 0) {
    this.stats.accumulator += dt;
    if (!force && this.stats.accumulator < this.stats.interval) return;
    this.stats.accumulator = 0;

    let herbivores = 0;
    let carnivores = 0;
    let energy = 0;
    let age = 0;
    for (let i = 0; i < this.animals.length; i++) {
      const animal = this.animals[i];
      if (animal.kind === KIND.HERBIVORE) herbivores++;
      else carnivores++;
      energy += animal.energy / animal.maxEnergy;
      age += animal.age / animal.maxAge;
    }

    let biomass = 0;
    let maturePlants = 0;
    for (let i = 0; i < this.plants.length; i++) {
      const plant = this.plants[i];
      biomass += plant.biomass;
      if (plant.mature) maturePlants++;
    }

    const totalAnimals = Math.max(1, this.animals.length);
    this.stats.current = {
      time: this.time,
      plants: this.plants.length,
      herbivores,
      carnivores,
      biomass,
      maturePlants,
      avgEnergy: energy / totalAnimals,
      avgAge: age / totalAnimals,
      births: this.counters.births,
      deaths: this.counters.deaths,
      predations: this.counters.predations,
      plantEnergy: this.counters.plantEnergy,
      plantDeaths: this.counters.plantDeaths,
      animalGridCells: this.animalGrid.cellCount,
      plantGridCells: this.plantGrid.cellCount
    };

    this.stats.history.push({ ...this.stats.current });
    if (this.stats.history.length > this.stats.maxHistory) this.stats.history.shift();
  }

  selectEntityAt(x, y) {
    let best = null;
    let bestD2 = Infinity;
    const animals = this.animalGrid.queryRadius(x, y, 34, this._queryAnimals);
    for (let i = 0; i < animals.length; i++) {
      const animal = animals[i];
      const d2 = distanceSq(x, y, animal.x, animal.y);
      const hit = animal.radius + 10;
      if (d2 <= hit * hit && d2 < bestD2) {
        best = animal;
        bestD2 = d2;
      }
    }

    if (!best) {
      const plants = this.plantGrid.queryRadius(x, y, 24, this._queryPlants);
      for (let i = 0; i < plants.length; i++) {
        const plant = plants[i];
        const d2 = distanceSq(x, y, plant.x, plant.y);
        const hit = plant.radius + 8;
        if (d2 <= hit * hit && d2 < bestD2) {
          best = plant;
          bestD2 = d2;
        }
      }
    }

    this.selectedId = best ? best.id : null;
    return best;
  }

  getEntityById(id) {
    if (!id) return null;
    for (let i = 0; i < this.animals.length; i++) if (this.animals[i].id === id) return this.animals[i];
    for (let i = 0; i < this.plants.length; i++) if (this.plants[i].id === id) return this.plants[i];
    return null;
  }

  get selectedEntity() {
    return this.getEntityById(this.selectedId);
  }

  get followedEntity() {
    return this.getEntityById(this.followId);
  }

  log(type, message, entityId = null) {
    this.events.unshift({
      type,
      message,
      entityId,
      time: this.time,
      stamp: formatTime(this.time)
    });
    if (this.events.length > 100) this.events.pop();
  }
}
