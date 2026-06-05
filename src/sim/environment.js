import { TAU, clamp, lerp, pickWeighted } from '../core/math.js';

export const BIOMES = {
  meadow: {
    id: 'meadow',
    name: 'Pradaria',
    color: '#426f3e',
    accent: '#8fd16a',
    plantGrowth: 1.22,
    plantCapacity: 1.14,
    cover: 0.4,
    moisture: 0.54
  },
  forest: {
    id: 'forest',
    name: 'Bosque',
    color: '#2f5e48',
    accent: '#6fc98c',
    plantGrowth: 1.0,
    plantCapacity: 1.36,
    cover: 0.72,
    moisture: 0.68
  },
  wetland: {
    id: 'wetland',
    name: 'Brejo',
    color: '#315d63',
    accent: '#6fcac5',
    plantGrowth: 1.32,
    plantCapacity: 1.22,
    cover: 0.58,
    moisture: 0.88
  },
  scrub: {
    id: 'scrub',
    name: 'Campo seco',
    color: '#75633f',
    accent: '#c4a35a',
    plantGrowth: 0.68,
    plantCapacity: 0.72,
    cover: 0.24,
    moisture: 0.3
  }
};

export const SEASONS = [
  { id: 'spring', name: 'Primavera', growth: 1.34, temp: 0.66, rainBias: 1.16 },
  { id: 'summer', name: 'Verao', growth: 1.05, temp: 0.88, rainBias: 0.82 },
  { id: 'autumn', name: 'Outono', growth: 0.86, temp: 0.54, rainBias: 0.98 },
  { id: 'winter', name: 'Inverno', growth: 0.54, temp: 0.34, rainBias: 1.05 }
];

export const WEATHER = {
  clear: { id: 'clear', name: 'Claro', growth: 1.0, movement: 1.0, visibility: 1.0, moisture: -0.02 },
  rain: { id: 'rain', name: 'Chuva', growth: 1.22, movement: 0.94, visibility: 0.9, moisture: 0.12 },
  storm: { id: 'storm', name: 'Tempestade', growth: 0.92, movement: 0.82, visibility: 0.68, moisture: 0.22 },
  drought: { id: 'drought', name: 'Seca', growth: 0.48, movement: 1.02, visibility: 1.04, moisture: -0.2 },
  cold: { id: 'cold', name: 'Frio', growth: 0.64, movement: 0.9, visibility: 0.96, moisture: 0.0 }
};

const BIOME_LIST = Object.values(BIOMES);

export class Environment {
  constructor(width, height, rng) {
    this.width = width;
    this.height = height;
    this.cellSize = 96;
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    this.cells = [];
    this.time = 0;
    this.seasonIndex = 0;
    this.seasonProgress = 0;
    this.seasonLength = 210;
    this.dayLength = 105;
    this.dayPhase = 0.25;
    this.light = 1;
    this.temperature = 0.65;
    this.moisture = 0.55;
    this.weather = WEATHER.clear;
    this.weatherTimer = 0;
    this.weatherDuration = 28;
    this._rng = rng;
    this._noiseA = rng.float(0, TAU);
    this._noiseB = rng.float(0, TAU);
    this.generate(rng);
  }

  reset(width, height, rng) {
    this.width = width;
    this.height = height;
    this.cols = Math.ceil(width / this.cellSize);
    this.rows = Math.ceil(height / this.cellSize);
    this.cells.length = 0;
    this.time = 0;
    this.seasonIndex = 0;
    this.seasonProgress = 0;
    this.dayPhase = 0.25;
    this.light = 1;
    this.temperature = 0.65;
    this.moisture = 0.55;
    this.weather = WEATHER.clear;
    this.weatherTimer = 0;
    this.weatherDuration = 20;
    this._rng = rng;
    this._noiseA = rng.float(0, TAU);
    this._noiseB = rng.float(0, TAU);
    this.generate(rng);
  }

  generate(rng) {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const nx = this.cols <= 1 ? 0 : x / (this.cols - 1);
        const ny = this.rows <= 1 ? 0 : y / (this.rows - 1);
        const ridge = Math.sin(nx * 8.8 + this._noiseA) * 0.26 + Math.cos(ny * 7.3 + this._noiseB) * 0.23;
        const basin = Math.sin((nx + ny) * 6.1 + this._noiseB) * 0.18;
        const moisture = clamp(0.5 + ridge + basin + rng.float(-0.18, 0.18), 0, 1);
        const elevation = clamp(0.48 + Math.cos(nx * 5.2 - this._noiseA) * 0.2 + Math.sin(ny * 4.9) * 0.18 + rng.float(-0.16, 0.16), 0, 1);
        let biome = BIOMES.meadow;
        if (moisture > 0.73 && elevation < 0.78) biome = BIOMES.wetland;
        else if (moisture > 0.54 && elevation < 0.72) biome = BIOMES.forest;
        else if (moisture < 0.34 || elevation > 0.82) biome = BIOMES.scrub;

        this.cells.push({
          x,
          y,
          biome,
          moisture,
          elevation,
          fertility: clamp((moisture * 0.72 + (1 - Math.abs(elevation - 0.44)) * 0.28) * biome.plantCapacity, 0.2, 1.65)
        });
      }
    }
  }

  update(dt, rng) {
    this.time += dt;
    const seasonPosition = (this.time / this.seasonLength) % SEASONS.length;
    this.seasonIndex = Math.floor(seasonPosition);
    this.seasonProgress = seasonPosition - this.seasonIndex;
    this.dayPhase = (this.time / this.dayLength) % 1;

    const sun = Math.sin(this.dayPhase * TAU - Math.PI * 0.5);
    this.light = clamp(0.24 + Math.max(0, sun) * 0.76, 0.16, 1);

    this.weatherTimer += dt;
    if (this.weatherTimer >= this.weatherDuration) {
      this.weatherTimer = 0;
      this.weatherDuration = rng.float(18, 45);
      this.weather = this.pickWeather(rng);
    }

    const season = this.season;
    this.temperature = clamp(season.temp + (this.light - 0.55) * 0.25 + (this.weather.id === 'cold' ? -0.22 : 0), 0, 1);
    this.moisture = clamp(0.5 + (season.rainBias - 1) * 0.25 + this.weather.moisture, 0, 1);
  }

  pickWeather(rng) {
    const season = this.season;
    const droughtBias = season.id === 'summer' ? 1.45 : 0.72;
    const coldBias = season.id === 'winter' ? 1.75 : 0.45;
    const rainBias = season.rainBias;
    return pickWeighted(rng, Object.values(WEATHER), weather => {
      if (weather.id === 'rain') return 2.4 * rainBias;
      if (weather.id === 'storm') return 0.72 * rainBias;
      if (weather.id === 'drought') return 0.72 * droughtBias;
      if (weather.id === 'cold') return 0.55 * coldBias;
      return 4.2;
    });
  }

  get season() {
    return SEASONS[this.seasonIndex] || SEASONS[0];
  }

  getBiomeAt(x, y) {
    const cx = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    const cell = this.cells[cy * this.cols + cx];
    return cell ? cell.biome : BIOMES.meadow;
  }

  getCellAt(x, y) {
    const cx = clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return this.cells[cy * this.cols + cx] || this.cells[0];
  }

  getGrowthMultiplier(biome) {
    const season = this.season;
    const temperatureComfort = 1 - Math.abs(this.temperature - 0.62) * 0.72;
    const lightFactor = lerp(0.38, 1, this.light);
    const moistureDelta = 1 - Math.abs((this.moisture + biome.moisture) * 0.5 - 0.62) * 0.75;
    return clamp(season.growth * this.weather.growth * lightFactor * temperatureComfort * moistureDelta, 0.05, 2.35);
  }

  randomPlantPoint(rng) {
    const cell = pickWeighted(rng, this.cells, item => item.fertility * item.biome.plantCapacity);
    const x = clamp((cell.x + rng.next()) * this.cellSize, 18, this.width - 18);
    const y = clamp((cell.y + rng.next()) * this.cellSize, 18, this.height - 18);
    return { x, y, biome: cell.biome };
  }

  randomAnimalPoint(rng, kind) {
    const cell = pickWeighted(rng, this.cells, item => {
      if (kind === 'carnivore') return 0.5 + item.biome.cover * 0.9 + item.fertility * 0.35;
      return 0.5 + item.fertility * 1.1;
    });
    const x = clamp((cell.x + rng.next()) * this.cellSize, 24, this.width - 24);
    const y = clamp((cell.y + rng.next()) * this.cellSize, 24, this.height - 24);
    return { x, y, biome: cell.biome };
  }
}

export { BIOME_LIST };

