export type ScenarioName = 'multi-gather' | 'detour' | 'warehouse-near-full' | 'blocked-path';
export type PathMode = 'off' | 'selected' | 'all';

export type DeveloperAction =
  | { type: 'toggle-pause' }
  | { type: 'step' }
  | { type: 'set-speed'; speed: number }
  | { type: 'spawn-unit' }
  | { type: 'set-map-editing'; enabled: boolean }
  | { type: 'gather-all' }
  | { type: 'reset' }
  | { type: 'run-scenario'; scenario: ScenarioName };

export interface DeveloperEntitySnapshot {
  id: number;
  kind: string;
  position: string;
  state: string;
  detail: string;
  selected: boolean;
}

export interface DeveloperSystemSnapshot {
  name: string;
  status: 'ok' | 'active' | 'warning';
  detail: string;
}

export interface DeveloperSnapshot {
  paused: boolean;
  speed: number;
  fps: number;
  ticks: number;
  unitCount: number;
  activeOrders: number;
  mapEditing: boolean;
  resource: string;
  warehouse: string;
  entities: DeveloperEntitySnapshot[];
  systems: DeveloperSystemSnapshot[];
}

export class DeveloperConsole {
  readonly #root: HTMLElement;
  readonly #onAction: (action: DeveloperAction) => void;
  readonly #pathMode: HTMLSelectElement;
  readonly #speed: HTMLSelectElement;
  readonly #mapEditing: HTMLInputElement;
  readonly #pauseButton: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #entities: HTMLElement;
  readonly #systems: HTMLElement;
  readonly #events: HTMLElement;
  readonly #scenarioResult: HTMLElement;

  constructor(root: HTMLElement, onAction: (action: DeveloperAction) => void) {
    this.#root = root;
    this.#onAction = onAction;
    this.#pathMode = this.#get('#dev-path-mode');
    this.#speed = this.#get('#dev-speed');
    this.#mapEditing = this.#get('#dev-map-edit');
    this.#pauseButton = this.#get('[data-dev-action="toggle-pause"]');
    this.#status = this.#get('#dev-runtime-status');
    this.#entities = this.#get('#dev-entities');
    this.#systems = this.#get('#dev-systems');
    this.#events = this.#get('#dev-events');
    this.#scenarioResult = this.#get('#dev-scenario-result');
    this.#bind();
    this.log('Developer Console 已连接', 'ok');
  }

  get pathMode(): PathMode {
    return this.#pathMode.value as PathMode;
  }

  setPathMode(mode: PathMode): void {
    this.#pathMode.value = mode;
  }

  update(snapshot: DeveloperSnapshot): void {
    this.#status.textContent = snapshot.paused ? 'PAUSED' : 'RUNNING';
    this.#status.dataset.state = snapshot.paused ? 'paused' : 'running';
    this.#pauseButton.textContent = snapshot.paused ? '继续' : '暂停';
    this.#speed.value = String(snapshot.speed);
    this.#mapEditing.checked = snapshot.mapEditing;
    this.#setText('#dev-fps', snapshot.fps.toFixed(0));
    this.#setText('#dev-ticks', String(snapshot.ticks));
    this.#setText('#dev-unit-count', String(snapshot.unitCount));
    this.#setText('#dev-order-count', String(snapshot.activeOrders));
    this.#setText('#dev-resource', snapshot.resource);
    this.#setText('#dev-warehouse', snapshot.warehouse);

    this.#entities.replaceChildren(...snapshot.entities.map((entity) => {
      const row = document.createElement('tr');
      if (entity.selected) row.classList.add('is-selected');
      for (const value of [`#${entity.id} ${entity.kind}`, entity.position, entity.state, entity.detail]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));

    this.#systems.replaceChildren(...snapshot.systems.map((system) => {
      const item = document.createElement('li');
      item.innerHTML = `<span class="dev-system-dot ${system.status}"></span><strong></strong><small></small>`;
      item.querySelector('strong')!.textContent = system.name;
      item.querySelector('small')!.textContent = system.detail;
      return item;
    }));
  }

  log(message: string, level: 'info' | 'ok' | 'warning' | 'error' = 'info'): void {
    const item = document.createElement('li');
    item.dataset.level = level;
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    item.textContent = `${time}  ${message}`;
    this.#events.prepend(item);
    while (this.#events.children.length > 60) this.#events.lastElementChild?.remove();
  }

  setScenarioResult(message: string, passed?: boolean): void {
    this.#scenarioResult.textContent = message;
    this.#scenarioResult.dataset.state = passed === undefined ? 'idle' : passed ? 'passed' : 'failed';
  }

  #bind(): void {
    this.#root.querySelectorAll<HTMLButtonElement>('[data-dev-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const type = button.dataset.devAction;
        if (type === 'toggle-pause' || type === 'step' || type === 'spawn-unit' || type === 'gather-all' || type === 'reset') {
          this.#onAction({ type });
        }
      });
    });
    this.#root.querySelectorAll<HTMLButtonElement>('[data-dev-scenario]').forEach((button) => {
      button.addEventListener('click', () => this.#onAction({
        type: 'run-scenario',
        scenario: button.dataset.devScenario as ScenarioName,
      }));
    });
    this.#speed.addEventListener('change', () => this.#onAction({ type: 'set-speed', speed: Number(this.#speed.value) }));
    this.#mapEditing.addEventListener('change', () => this.#onAction({
      type: 'set-map-editing',
      enabled: this.#mapEditing.checked,
    }));
    this.#get<HTMLButtonElement>('[data-dev-action="clear-events"]').addEventListener('click', () => this.#events.replaceChildren());
    this.#get<HTMLButtonElement>('[data-dev-action="collapse"]').addEventListener('click', () => {
      this.#root.classList.toggle('is-collapsed');
    });
  }

  #setText(selector: string, value: string): void {
    this.#get(selector).textContent = value;
  }

  #get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Developer Console element missing: ${selector}`);
    return element;
  }
}
