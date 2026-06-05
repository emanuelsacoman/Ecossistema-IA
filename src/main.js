import { Renderer } from './render/renderer.js';
import { Simulation } from './sim/simulation.js';
import { UIController } from './ui/ui.js';

const canvas = document.getElementById('ecosystem');

if (!canvas) {
  throw new Error('Canvas #ecosystem nao encontrado.');
}

const simulation = new Simulation();
const renderer = new Renderer(canvas, simulation);
const ui = new UIController(simulation, renderer);

let lastTime = performance.now();

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  simulation.update(dt);
  renderer.render();
  ui.update(false);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.ecosystem = {
  simulation,
  renderer,
  ui
};

