import { clamp } from './math.js';

const LIMITS = {
  speed: [34, 118],
  vision: [70, 260],
  metabolism: [0.55, 1.55],
  fertility: [0.55, 1.55],
  courage: [0.15, 1.2],
  sociability: [0.05, 1.3],
  stamina: [0.55, 1.45],
  size: [0.7, 1.35],
  lifespan: [95, 260],
  digestion: [0.75, 1.35],
  aggression: [0.2, 1.35],
  territory: [130, 420],
  plantGrowth: [0.45, 1.75],
  plantMass: [18, 72],
  droughtTolerance: [0.25, 1.25],
  seedSpread: [20, 150]
};

const BASE = {
  herbivore: {
    speed: 62,
    vision: 155,
    metabolism: 1,
    fertility: 1.08,
    courage: 0.48,
    sociability: 0.92,
    stamina: 1,
    size: 0.92,
    lifespan: 165,
    digestion: 1.08,
    aggression: 0.28,
    territory: 170
  },
  carnivore: {
    speed: 76,
    vision: 190,
    metabolism: 1.1,
    fertility: 0.72,
    courage: 0.88,
    sociability: 0.34,
    stamina: 1.12,
    size: 1.08,
    lifespan: 190,
    digestion: 0.95,
    aggression: 0.95,
    territory: 270
  },
  plant: {
    plantGrowth: 1,
    plantMass: 38,
    lifespan: 180,
    droughtTolerance: 0.75,
    seedSpread: 80
  }
};

function vary(rng, value, key, amount = 0.11) {
  const [min, max] = LIMITS[key];
  return clamp(value + rng.float(-1, 1) * (max - min) * amount, min, max);
}

function mutateValue(rng, value, key, mutationRate, intensity = 0.08) {
  const [min, max] = LIMITS[key];
  let next = value + rng.float(-1, 1) * (max - min) * intensity;
  if (rng.chance(mutationRate)) next += rng.float(-1, 1) * (max - min) * intensity * 2.5;
  return clamp(next, min, max);
}

export function createAnimalGenes(kind, rng) {
  const base = BASE[kind];
  return {
    speed: vary(rng, base.speed, 'speed'),
    vision: vary(rng, base.vision, 'vision'),
    metabolism: vary(rng, base.metabolism, 'metabolism'),
    fertility: vary(rng, base.fertility, 'fertility'),
    courage: vary(rng, base.courage, 'courage'),
    sociability: vary(rng, base.sociability, 'sociability'),
    stamina: vary(rng, base.stamina, 'stamina'),
    size: vary(rng, base.size, 'size'),
    lifespan: vary(rng, base.lifespan, 'lifespan'),
    digestion: vary(rng, base.digestion, 'digestion'),
    aggression: vary(rng, base.aggression, 'aggression'),
    territory: vary(rng, base.territory, 'territory')
  };
}

export function inheritAnimalGenes(kind, rng, a, b, mutationRate = 0.12) {
  const genes = {};
  const base = BASE[kind];
  for (const key of Object.keys(base)) {
    genes[key] = mutateValue(rng, (a[key] + b[key]) * 0.5, key, mutationRate);
  }
  return genes;
}

export function createPlantGenes(rng, biome) {
  const base = BASE.plant;
  const richness = biome ? biome.plantCapacity : 1;
  return {
    plantGrowth: vary(rng, base.plantGrowth * richness, 'plantGrowth', 0.14),
    plantMass: vary(rng, base.plantMass * richness, 'plantMass', 0.16),
    lifespan: vary(rng, base.lifespan, 'lifespan', 0.2),
    droughtTolerance: vary(rng, base.droughtTolerance, 'droughtTolerance', 0.22),
    seedSpread: vary(rng, base.seedSpread, 'seedSpread', 0.2)
  };
}

export function inheritPlantGenes(rng, parentGenes, mutationRate = 0.1) {
  return {
    plantGrowth: mutateValue(rng, parentGenes.plantGrowth, 'plantGrowth', mutationRate),
    plantMass: mutateValue(rng, parentGenes.plantMass, 'plantMass', mutationRate),
    lifespan: mutateValue(rng, parentGenes.lifespan, 'lifespan', mutationRate),
    droughtTolerance: mutateValue(rng, parentGenes.droughtTolerance, 'droughtTolerance', mutationRate),
    seedSpread: mutateValue(rng, parentGenes.seedSpread, 'seedSpread', mutationRate)
  };
}

