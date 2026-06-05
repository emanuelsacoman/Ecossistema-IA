import { clamp, distanceSq, length } from '../core/math.js';
import { KIND, STATE_LABELS } from '../sim/entities.js';

export class Renderer {
  constructor(canvas, simulation) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = simulation;
    this.dpr = 1;
    this.width = 1;
    this.height = 1;
    this.camera = {
      x: simulation.width * 0.5,
      y: simulation.height * 0.5,
      zoom: 0.62
    };
    this.viewBounds = { left: 0, right: 0, top: 0, bottom: 0 };
    this.drag = {
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0
    };
    this.initEvents();
    this.resize();
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const point = this.eventPoint(event);
      const before = this.screenToWorld(point.x, point.y);
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      this.camera.zoom = clamp(this.camera.zoom * factor, 0.22, 2.2);
      this.camera.x = before.x - (point.x - this.width * 0.5) / this.camera.zoom;
      this.camera.y = before.y - (point.y - this.height * 0.5) / this.camera.zoom;
      this.clampCamera();
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', event => {
      const point = this.eventPoint(event);
      this.drag.active = true;
      this.drag.moved = false;
      this.drag.startX = point.x;
      this.drag.startY = point.y;
      this.drag.lastX = point.x;
      this.drag.lastY = point.y;
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener('pointermove', event => {
      if (!this.drag.active) return;
      const point = this.eventPoint(event);
      const dx = point.x - this.drag.lastX;
      const dy = point.y - this.drag.lastY;
      if (Math.abs(point.x - this.drag.startX) + Math.abs(point.y - this.drag.startY) > 5) this.drag.moved = true;
      if (this.drag.moved) {
        this.sim.followId = null;
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
        this.clampCamera();
      }
      this.drag.lastX = point.x;
      this.drag.lastY = point.y;
    });

    this.canvas.addEventListener('pointerup', event => {
      const point = this.eventPoint(event);
      if (!this.drag.moved) {
        const world = this.screenToWorld(point.x, point.y);
        this.sim.selectEntityAt(world.x, world.y);
      }
      this.drag.active = false;
    });
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));
    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
    }
    this.dpr = dpr;
    this.width = width;
    this.height = height;
    this.clampCamera();
  }

  screenToWorld(x, y) {
    return {
      x: this.camera.x + (x - this.width * 0.5) / this.camera.zoom,
      y: this.camera.y + (y - this.height * 0.5) / this.camera.zoom
    };
  }

  clampCamera() {
    const halfW = this.width * 0.5 / this.camera.zoom;
    const halfH = this.height * 0.5 / this.camera.zoom;
    this.camera.x = halfW >= this.sim.width * 0.5 ? this.sim.width * 0.5 : clamp(this.camera.x, halfW, this.sim.width - halfW);
    this.camera.y = halfH >= this.sim.height * 0.5 ? this.sim.height * 0.5 : clamp(this.camera.y, halfH, this.sim.height - halfH);
  }

  centerOn(entity, immediate = false) {
    if (!entity) return;
    if (immediate) {
      this.camera.x = entity.x;
      this.camera.y = entity.y;
    } else {
      this.camera.x += (entity.x - this.camera.x) * 0.08;
      this.camera.y += (entity.y - this.camera.y) * 0.08;
    }
    this.clampCamera();
  }

  render() {
    this.resize();
    const followed = this.sim.followedEntity;
    if (followed) this.centerOn(followed);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = '#121411';
    ctx.fillRect(0, 0, this.width, this.height);

    this.computeViewBounds();

    ctx.save();
    this.applyCameraTransform(ctx);
    this.drawBiomes(ctx);
    if (this.sim.settings.showGrid) this.drawSpatialGrid(ctx);
    this.drawTerritories(ctx);
    if (this.sim.settings.showVision) this.drawVision(ctx);
    if (this.sim.settings.showTargets) this.drawTargets(ctx);
    this.drawPlants(ctx);
    this.drawAnimals(ctx);
    this.drawSelection(ctx);
    this.drawNightOverlay(ctx);
    ctx.restore();

    this.drawHud(ctx);
  }

  computeViewBounds() {
    const halfW = this.width * 0.5 / this.camera.zoom;
    const halfH = this.height * 0.5 / this.camera.zoom;
    this.viewBounds.left = this.camera.x - halfW - 80;
    this.viewBounds.right = this.camera.x + halfW + 80;
    this.viewBounds.top = this.camera.y - halfH - 80;
    this.viewBounds.bottom = this.camera.y + halfH + 80;
  }

  applyCameraTransform(ctx) {
    ctx.translate(this.width * 0.5, this.height * 0.5);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  inView(entity, pad = 0) {
    return entity.x >= this.viewBounds.left - pad &&
      entity.x <= this.viewBounds.right + pad &&
      entity.y >= this.viewBounds.top - pad &&
      entity.y <= this.viewBounds.bottom + pad;
  }

  drawBiomes(ctx) {
    const env = this.sim.environment;
    if (!this.sim.settings.showBiomes) {
      ctx.fillStyle = '#243422';
      ctx.fillRect(0, 0, this.sim.width, this.sim.height);
      return;
    }

    for (let i = 0; i < env.cells.length; i++) {
      const cell = env.cells[i];
      const x = cell.x * env.cellSize;
      const y = cell.y * env.cellSize;
      if (x > this.viewBounds.right || y > this.viewBounds.bottom || x + env.cellSize < this.viewBounds.left || y + env.cellSize < this.viewBounds.top) continue;
      ctx.fillStyle = cell.biome.color;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(x, y, env.cellSize + 1, env.cellSize + 1);
      ctx.globalAlpha = 0.1 + cell.fertility * 0.08;
      ctx.fillStyle = cell.biome.accent;
      const marker = 8 + (cell.fertility % 1) * 13;
      ctx.beginPath();
      ctx.arc(x + env.cellSize * 0.32, y + env.cellSize * 0.38, marker, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(10, 18, 14, 0.38)';
    ctx.lineWidth = 18;
    ctx.strokeRect(0, 0, this.sim.width, this.sim.height);
  }

  drawSpatialGrid(ctx) {
    const size = this.sim.animalGrid.cellSize;
    const left = Math.floor(this.viewBounds.left / size) * size;
    const right = Math.ceil(this.viewBounds.right / size) * size;
    const top = Math.floor(this.viewBounds.top / size) * size;
    const bottom = Math.ceil(this.viewBounds.bottom / size) * size;
    ctx.beginPath();
    for (let x = left; x <= right; x += size) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = top; y <= bottom; y += size) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.strokeStyle = 'rgba(238, 230, 197, 0.16)';
    ctx.lineWidth = 1 / this.camera.zoom;
    ctx.stroke();
  }

  drawTerritories(ctx) {
    if (!this.sim.settings.enableTerritory) return;
    for (let i = 0; i < this.sim.animals.length; i++) {
      const animal = this.sim.animals[i];
      if (animal.kind !== KIND.CARNIVORE || !animal.territory || !this.inView(animal, animal.territory.radius)) continue;
      ctx.beginPath();
      ctx.arc(animal.territory.x, animal.territory.y, animal.territory.radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(236, 95, 73, 0.15)';
      ctx.lineWidth = 1.5 / this.camera.zoom;
      ctx.setLineDash([10 / this.camera.zoom, 8 / this.camera.zoom]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawVision(ctx) {
    for (let i = 0; i < this.sim.animals.length; i++) {
      const animal = this.sim.animals[i];
      if (!this.inView(animal, animal.visionRange(this.sim))) continue;
      ctx.beginPath();
      ctx.arc(animal.x, animal.y, animal.visionRange(this.sim), 0, Math.PI * 2);
      ctx.strokeStyle = animal.kind === KIND.CARNIVORE ? 'rgba(244, 91, 76, 0.12)' : 'rgba(104, 190, 174, 0.13)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.stroke();
    }
  }

  drawTargets(ctx) {
    for (let i = 0; i < this.sim.animals.length; i++) {
      const animal = this.sim.animals[i];
      if (!this.inView(animal, 160)) continue;
      if (!animal.target && animal.state !== 'patrol') continue;
      const tx = animal.target ? animal.target.x : animal.targetX;
      const ty = animal.target ? animal.target.y : animal.targetY;
      ctx.beginPath();
      ctx.moveTo(animal.x, animal.y);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = animal.kind === KIND.CARNIVORE ? 'rgba(255, 186, 124, 0.28)' : 'rgba(202, 236, 179, 0.24)';
      ctx.lineWidth = 1 / this.camera.zoom;
      ctx.stroke();
    }
  }

  drawPlants(ctx) {
    for (let i = 0; i < this.sim.plants.length; i++) {
      const plant = this.sim.plants[i];
      if (!this.inView(plant, 20)) continue;
      this.drawPlant(ctx, plant);
    }
  }

  drawPlant(ctx, plant) {
    const biome = this.sim.environment.getBiomeAt(plant.x, plant.y);
    const maturity = clamp(plant.biomass / (plant.maxBiomass || 1), 0, 1);
    const radius = plant.radius;
    ctx.save();
    ctx.translate(plant.x, plant.y);
    ctx.globalAlpha = 0.72 + maturity * 0.28;
    ctx.fillStyle = 'rgba(12, 21, 13, 0.22)';
    ctx.beginPath();
    ctx.ellipse(1.5, radius * 0.35, radius * 1.15, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = maturity > 0.55 ? biome.accent : '#9ab56c';
    ctx.lineWidth = clamp(radius * 0.18, 1, 2.2);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.45);
    ctx.lineTo(0, -radius * 0.65);
    ctx.stroke();
    ctx.fillStyle = maturity > 0.62 ? biome.accent : '#84a85a';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.35, -radius * 0.15, radius * 0.55, radius * 0.28, -0.55, 0, Math.PI * 2);
    ctx.ellipse(radius * 0.34, -radius * 0.32, radius * 0.52, radius * 0.25, 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (plant.mature) {
      ctx.fillStyle = 'rgba(236, 232, 161, 0.8)';
      ctx.beginPath();
      ctx.arc(0, -radius * 0.75, Math.max(1.4, radius * 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawAnimals(ctx) {
    for (let i = 0; i < this.sim.animals.length; i++) {
      const animal = this.sim.animals[i];
      if (!this.inView(animal, 40)) continue;
      this.drawAnimal(ctx, animal);
    }
  }

  drawAnimal(ctx, animal) {
    const speed = length(animal.vx, animal.vy);
    const angle = speed > 2 ? Math.atan2(animal.vy, animal.vx) : animal.wanderAngle;
    const r = animal.radius;
    const selected = animal.id === this.sim.selectedId;
    let fill = animal.kind === KIND.CARNIVORE ? '#d95a46' : '#64b9ad';
    let accent = animal.kind === KIND.CARNIVORE ? '#ffc082' : '#c9e994';
    if (animal.state === 'flee') {
      fill = '#d6b44c';
      accent = '#fff2a3';
    } else if (animal.state === 'hunt') {
      fill = '#e24a3f';
      accent = '#ffe0a8';
    } else if (animal.state === 'mate') {
      accent = '#f3a7c9';
    } else if (animal.state === 'rest') {
      fill = animal.kind === KIND.CARNIVORE ? '#a86558' : '#6f9f94';
    }

    ctx.save();
    ctx.translate(animal.x, animal.y);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(8, 13, 12, 0.22)';
    ctx.beginPath();
    ctx.ellipse(1.5, r * 0.45, r * 1.22, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fill;
    ctx.strokeStyle = selected ? '#fff7c4' : 'rgba(17, 25, 21, 0.5)';
    ctx.lineWidth = selected ? 2.4 / this.camera.zoom : 1.2 / this.camera.zoom;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.2, r * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(r * 0.96, -r * 0.22, r * 0.24, 0, Math.PI * 2);
    ctx.arc(r * 0.96, r * 0.22, r * 0.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = animal.kind === KIND.CARNIVORE ? '#3b1712' : '#173934';
    ctx.beginPath();
    ctx.arc(r * 1.18, -r * 0.18, Math.max(1.1, r * 0.08), 0, Math.PI * 2);
    ctx.arc(r * 1.18, r * 0.18, Math.max(1.1, r * 0.08), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    this.drawEnergyBar(ctx, animal);
    if (this.sim.settings.showDebug && this.camera.zoom > 0.34) this.drawAnimalDebug(ctx, animal);
  }

  drawEnergyBar(ctx, animal) {
    const width = animal.kind === KIND.CARNIVORE ? 26 : 22;
    const height = 3.4;
    const x = animal.x - width * 0.5;
    const y = animal.y - animal.radius - 10;
    const t = clamp(animal.energy / animal.maxEnergy, 0, 1);
    ctx.fillStyle = 'rgba(8, 12, 11, 0.45)';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = t > 0.55 ? '#9be36d' : (t > 0.25 ? '#e3bd4f' : '#e45d4e');
    ctx.fillRect(x, y, width * t, height);
  }

  drawAnimalDebug(ctx, animal) {
    ctx.save();
    ctx.font = `${11 / this.camera.zoom}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255, 250, 223, 0.92)';
    const label = `${animal.id} ${STATE_LABELS[animal.state] || animal.state}`;
    ctx.fillText(label, animal.x, animal.y - animal.radius - 17 / this.camera.zoom);
    ctx.restore();
  }

  drawSelection(ctx) {
    const selected = this.sim.selectedEntity;
    if (!selected) return;
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, selected.radius + 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 247, 196, 0.95)';
    ctx.lineWidth = 2.2 / this.camera.zoom;
    ctx.stroke();
  }

  drawNightOverlay(ctx) {
    const darkness = clamp(1 - this.sim.environment.light, 0, 1);
    if (darkness <= 0.04) return;
    ctx.fillStyle = `rgba(15, 24, 39, ${darkness * 0.44})`;
    ctx.fillRect(this.viewBounds.left, this.viewBounds.top, this.viewBounds.right - this.viewBounds.left, this.viewBounds.bottom - this.viewBounds.top);
  }

  drawHud(ctx) {
    const env = this.sim.environment;
    ctx.save();
    ctx.fillStyle = 'rgba(18, 20, 17, 0.72)';
    ctx.fillRect(14, 14, 230, 54);
    ctx.fillStyle = '#f0ead2';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(`${env.season.name} | ${env.weather.name}`, 26, 36);
    ctx.fillStyle = '#b9c7af';
    ctx.fillText(`Luz ${Math.round(env.light * 100)}% | zoom ${this.camera.zoom.toFixed(2)}x`, 26, 55);
    ctx.restore();
  }
}
