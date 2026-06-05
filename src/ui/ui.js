import { formatTime } from '../core/math.js';
import { KIND, STATE_LABELS } from '../sim/entities.js';
import { PRESETS } from '../sim/simulation.js';

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function byId(id) {
  return document.getElementById(id);
}

function num(id, fallback) {
  const element = byId(id);
  const value = element ? Number(element.value) : fallback;
  return Number.isFinite(value) ? value : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

export class UIController {
  constructor(simulation, renderer) {
    this.sim = simulation;
    this.renderer = renderer;
    this.lastPanelUpdate = 0;
    this.lastGraphDraw = 0;
    this.graphCanvas = byId('statsCanvas');
    this.graphCtx = this.graphCanvas ? this.graphCanvas.getContext('2d') : null;
    this.bindControls();
    this.syncControlsFromSettings();
    this.update(true);
  }

  bindControls() {
    byId('startBtn')?.addEventListener('click', () => {
      this.sim.settings.paused = false;
      this.update(true);
    });
    byId('pauseBtn')?.addEventListener('click', () => {
      this.sim.settings.paused = true;
      this.update(true);
    });
    byId('stepBtn')?.addEventListener('click', () => {
      this.sim.settings.paused = true;
      this.sim.stepOnce();
      this.renderer.render();
      this.update(true);
    });
    byId('resetBtn')?.addEventListener('click', () => {
      this.sim.reset(byId('seedInput')?.value || this.sim.settings.seed, byId('presetSelect')?.value || this.sim.settings.preset);
      this.renderer.centerOn({ x: this.sim.width * 0.5, y: this.sim.height * 0.5 }, true);
      this.update(true);
    });

    byId('presetSelect')?.addEventListener('change', event => {
      this.sim.applyPreset(event.target.value);
      this.syncControlsFromSettings();
      this.renderer.centerOn({ x: this.sim.width * 0.5, y: this.sim.height * 0.5 }, true);
      this.update(true);
    });
    byId('applySeedBtn')?.addEventListener('click', () => {
      const seed = byId('seedInput')?.value || this.sim.settings.seed;
      this.sim.reset(seed, byId('presetSelect')?.value || this.sim.settings.preset);
      this.update(true);
    });
    byId('randomSeedBtn')?.addEventListener('click', () => {
      const seed = `eco-${Date.now().toString(36)}`;
      const input = byId('seedInput');
      if (input) input.value = seed;
      this.sim.reset(seed, byId('presetSelect')?.value || this.sim.settings.preset);
      this.update(true);
    });

    byId('addPlantBtn')?.addEventListener('click', () => {
      for (let i = 0; i < 25; i++) this.sim.spawnPlantRandom();
      this.sim.rebuildGrids();
      this.update(true);
    });
    byId('addHerbivoreBtn')?.addEventListener('click', () => {
      for (let i = 0; i < 8; i++) this.sim.spawnAnimalRandom(KIND.HERBIVORE);
      this.sim.rebuildGrids();
      this.update(true);
    });
    byId('addCarnivoreBtn')?.addEventListener('click', () => {
      for (let i = 0; i < 3; i++) this.sim.spawnAnimalRandom(KIND.CARNIVORE);
      this.sim.rebuildGrids();
      this.update(true);
    });

    byId('followBtn')?.addEventListener('click', () => {
      const selected = this.sim.selectedEntity;
      if (selected && selected.kind !== KIND.PLANT) this.sim.followId = selected.id;
      this.update(true);
    });
    byId('clearFollowBtn')?.addEventListener('click', () => {
      this.sim.followId = null;
      this.update(true);
    });

    this.bindSlider('timeScale', 'timeScale', value => `${Number(value).toFixed(1)}x`);
    this.bindSlider('animalSpeed', 'animalSpeed', value => `${Number(value).toFixed(2)}x`);
    this.bindSlider('energyCost', 'energyCost', value => `${Number(value).toFixed(2)}x`);
    this.bindSlider('plantGrowth', 'plantGrowth', value => `${Number(value).toFixed(2)}x`);
    this.bindSlider('plantRegen', 'plantRegen', value => `${Number(value).toFixed(1)}/s`);
    this.bindSlider('plantCap', 'plantCap', value => NUMBER_FORMAT.format(value));
    this.bindSlider('visionScale', 'visionScale', value => `${Number(value).toFixed(2)}x`);
    this.bindSlider('mutationRate', 'mutationRate', value => `${Math.round(Number(value) * 100)}%`);
    this.bindSlider('lifeSpeed', 'lifeSpeed', value => `${Number(value).toFixed(2)}x`);

    this.bindToggle('enableFlocking');
    this.bindToggle('enableTerritory');
    this.bindToggle('enableMemory');
    this.bindToggle('showVision');
    this.bindToggle('showTargets');
    this.bindToggle('showDebug');
    this.bindToggle('showGrid');
    this.bindToggle('showBiomes');
  }

  bindSlider(id, settingKey, formatter) {
    const input = byId(id);
    const out = byId(`${id}Out`);
    if (!input) return;
    const apply = () => {
      const value = Number(input.value);
      this.sim.settings[settingKey] = settingKey === 'plantCap' ? Math.round(value) : value;
      if (out) out.textContent = formatter(value);
      this.update(true);
    };
    input.addEventListener('input', apply, { passive: true });
    apply();
  }

  bindToggle(id) {
    const input = byId(id);
    if (!input) return;
    input.addEventListener('change', () => {
      this.sim.settings[id] = input.checked;
      this.update(true);
    });
  }

  syncControlsFromSettings() {
    const presetSelect = byId('presetSelect');
    if (presetSelect) {
      presetSelect.innerHTML = Object.entries(PRESETS)
        .map(([id, preset]) => `<option value="${id}">${escapeHtml(preset.name)}</option>`)
        .join('');
      presetSelect.value = this.sim.settings.preset;
    }

    const seedInput = byId('seedInput');
    if (seedInput) seedInput.value = this.sim.settings.seed;

    const sliders = ['timeScale', 'animalSpeed', 'energyCost', 'plantGrowth', 'plantRegen', 'plantCap', 'visionScale', 'mutationRate', 'lifeSpeed'];
    for (let i = 0; i < sliders.length; i++) {
      const key = sliders[i];
      const input = byId(key);
      if (input) input.value = this.sim.settings[key];
      input?.dispatchEvent(new Event('input'));
    }

    const toggles = ['enableFlocking', 'enableTerritory', 'enableMemory', 'showVision', 'showTargets', 'showDebug', 'showGrid', 'showBiomes'];
    for (let i = 0; i < toggles.length; i++) {
      const key = toggles[i];
      const input = byId(key);
      if (input) input.checked = Boolean(this.sim.settings[key]);
    }
  }

  readInitialCounts() {
    this.sim.settings.initialHerbivores = Math.round(num('initialHerbivores', this.sim.settings.initialHerbivores));
    this.sim.settings.initialCarnivores = Math.round(num('initialCarnivores', this.sim.settings.initialCarnivores));
    this.sim.settings.initialPlants = Math.round(num('initialPlants', this.sim.settings.initialPlants));
  }

  update(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPanelUpdate < 120) return;
    this.lastPanelUpdate = now;
    this.updateRunState();
    this.updateEnvironmentPanel();
    this.updateStatsPanel();
    this.updateInspector();
    this.updateEventLog();
    if (force || now - this.lastGraphDraw > 450) {
      this.lastGraphDraw = now;
      this.drawGraph();
    }
  }

  updateRunState() {
    const state = byId('runState');
    if (state) {
      state.textContent = this.sim.settings.paused ? 'Pausado' : 'Rodando';
      state.dataset.state = this.sim.settings.paused ? 'paused' : 'running';
    }
  }

  updateEnvironmentPanel() {
    const env = this.sim.environment;
    this.setText('envTime', formatTime(this.sim.time));
    this.setText('envSeason', env.season.name);
    this.setText('envWeather', env.weather.name);
    this.setText('envLight', pct(env.light));
    this.setText('envTemp', pct(env.temperature));
    this.setText('envMoisture', pct(env.moisture));
  }

  updateStatsPanel() {
    const current = this.sim.stats.current;
    this.setText('statPlants', NUMBER_FORMAT.format(current.plants));
    this.setText('statMaturePlants', NUMBER_FORMAT.format(current.maturePlants));
    this.setText('statHerbivores', NUMBER_FORMAT.format(current.herbivores));
    this.setText('statCarnivores', NUMBER_FORMAT.format(current.carnivores));
    this.setText('statBiomass', NUMBER_FORMAT.format(current.biomass));
    this.setText('statEnergy', pct(current.avgEnergy));
    this.setText('statBirths', NUMBER_FORMAT.format(current.births));
    this.setText('statDeaths', NUMBER_FORMAT.format(current.deaths));
    this.setText('statPredations', NUMBER_FORMAT.format(current.predations));
    this.setText('statGrid', `${current.animalGridCells}/${current.plantGridCells}`);
  }

  updateInspector() {
    const box = byId('inspectorBody');
    const selected = this.sim.selectedEntity;
    const followBtn = byId('followBtn');
    if (followBtn) followBtn.disabled = !selected || selected.kind === KIND.PLANT;
    if (!box) return;

    if (!selected) {
      box.innerHTML = '<p class="empty-state">Clique em uma entidade no canvas.</p>';
      return;
    }

    if (selected.kind === KIND.PLANT) {
      const biome = this.sim.environment.getBiomeAt(selected.x, selected.y);
      box.innerHTML = `
        <div class="inspector-title">Planta #${selected.id}</div>
        <div class="kv"><span>Bioma</span><strong>${escapeHtml(biome.name)}</strong></div>
        <div class="kv"><span>Biomassa</span><strong>${selected.biomass.toFixed(1)} / ${selected.maxBiomass.toFixed(1)}</strong></div>
        <div class="kv"><span>Maturidade</span><strong>${selected.mature ? 'Madura' : 'Jovem'}</strong></div>
        <div class="kv"><span>Idade</span><strong>${selected.age.toFixed(1)}s</strong></div>
        <div class="kv"><span>Crescimento</span><strong>${selected.genes.plantGrowth.toFixed(2)}</strong></div>
        <div class="kv"><span>Dispersao</span><strong>${selected.genes.seedSpread.toFixed(0)}px</strong></div>
      `;
      return;
    }

    const label = selected.kind === KIND.HERBIVORE ? 'Herbivoro' : 'Carnivoro';
    const utility = Object.entries(selected.utility)
      .filter(([, value]) => value > 0.01)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, value]) => `<div class="utility-row"><span>${escapeHtml(STATE_LABELS[key] || key)}</span><meter min="0" max="1.5" value="${value.toFixed(3)}"></meter></div>`)
      .join('');
    box.innerHTML = `
      <div class="inspector-title">${label} #${selected.id}</div>
      <div class="kv"><span>Estado</span><strong>${escapeHtml(STATE_LABELS[selected.state] || selected.state)}</strong></div>
      <div class="kv"><span>Energia</span><strong>${selected.energy.toFixed(1)} / ${selected.maxEnergy.toFixed(1)}</strong></div>
      <div class="kv"><span>Idade</span><strong>${selected.age.toFixed(1)}s / ${selected.maxAge.toFixed(0)}s</strong></div>
      <div class="kv"><span>Geracao</span><strong>${selected.generation}</strong></div>
      <div class="kv"><span>Genes</span><strong>vel ${selected.genes.speed.toFixed(0)} | vis ${selected.genes.vision.toFixed(0)}</strong></div>
      <div class="kv"><span>Metabolismo</span><strong>${selected.genes.metabolism.toFixed(2)}</strong></div>
      <div class="kv"><span>Fertilidade</span><strong>${selected.genes.fertility.toFixed(2)}</strong></div>
      <div class="kv"><span>Memoria comida</span><strong>${selected.memoryFoodAge < 90 ? `${selected.memoryFoodAge.toFixed(1)}s` : 'vazia'}</strong></div>
      <div class="utility-list">${utility}</div>
    `;
  }

  updateEventLog() {
    const log = byId('eventLog');
    if (!log) return;
    log.innerHTML = this.sim.events.slice(0, 28).map(event => `
      <li data-type="${event.type}">
        <span>${escapeHtml(event.stamp)}</span>
        <strong>${escapeHtml(event.message)}</strong>
      </li>
    `).join('');
  }

  drawGraph() {
    if (!this.graphCanvas || !this.graphCtx) return;
    const canvas = this.graphCanvas;
    const ctx = this.graphCtx;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(240, Math.floor(rect.width));
    const height = Math.max(120, Math.floor(rect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#171914';
    ctx.fillRect(0, 0, width, height);

    const history = this.sim.stats.history;
    if (history.length < 2) return;
    const pad = 12;
    const graphW = width - pad * 2;
    const graphH = height - pad * 2;
    const maxPlants = Math.max(1, ...history.map(item => item.plants));
    const maxAnimals = Math.max(1, ...history.map(item => Math.max(item.herbivores, item.carnivores)));

    ctx.strokeStyle = 'rgba(242, 233, 205, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = pad + graphH * (i / 4);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    const drawLine = (key, max, color) => {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = pad + (i / (history.length - 1)) * graphW;
        const y = pad + graphH - (history[i][key] / max) * graphH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    drawLine('plants', maxPlants, '#96d465');
    drawLine('herbivores', maxAnimals, '#68beae');
    drawLine('carnivores', maxAnimals, '#e45d4e');
  }

  setText(id, value) {
    const element = byId(id);
    if (element) element.textContent = value;
  }
}

