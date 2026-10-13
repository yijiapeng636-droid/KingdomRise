/**
 * Developer Console 的 DOM 适配层。
 *
 * 本模块把控件操作转换为带类型的 `DeveloperAction`，并渲染场景提供的只读快照；
 * 它不直接导入或修改核心世界。具体调试动作及验证场景仍由 GameScene 执行。
 */
import { FloatingPanel } from '../ui/FloatingPanel';

/** 当前可由调试台启动的交互式验证场景。 */
export type ScenarioName = 'multi-gather' | 'detour' | 'warehouse-near-full' | 'blocked-path';
export type PathMode = 'off' | 'selected' | 'all';

/** 调试台发给场景的用户意图；不携带核心状态引用。 */
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

/** 场景生成、调试台消费的只读展示数据结构。 */
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

/** 绑定既有调试 DOM，并通过 FloatingPanel 管理其显示与位置。 */
export class DeveloperConsole {
  readonly #root: HTMLElement;
  readonly #floatingPanel: FloatingPanel;
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

  constructor(root: HTMLElement, viewport: HTMLElement, onAction: (action: DeveloperAction) => void) {
    this.#root = root;
    this.#onAction = onAction;
    root.hidden = false;
    this.#floatingPanel = new FloatingPanel(viewport, {
      title: '世界调试台',
      triggerLabel: '展开或收起开发者控制台',
      triggerText: '⌘',
      content: root,
      initialPosition: { x: viewport.clientWidth - 70, y: 18 },
      showHeader: false,
      bodyClass: 'floating-panel__body--developer',
    });
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

  destroy(): void {
    this.#floatingPanel.destroy();
    this.#root.hidden = true;
  }

  /** 将最新场景快照整体写入状态区、实体表和系统列表。 */
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

  /** 在事件列表顶部追加带本地时间的记录，并只保留最近 60 条。 */
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
      this.#floatingPanel.toggle();
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
