/**
 * 可拖动浮动面板及其纯布局计算。
 *
 * 面板只管理 DOM 容器、开合和定位，不解释承载内容的业务；传入的 content 会暂时
 * 移入面板，并在销毁时尽量恢复到原父节点中的原位置。
 */
export interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export interface PanelPlacement extends Point {
  horizontal: 'left' | 'right';
  vertical: 'above' | 'below';
}

/** 浮动面板的内容、可访问名称和初始外观配置。 */
export interface FloatingPanelOptions {
  title: string;
  triggerLabel: string;
  triggerText: string;
  content: HTMLElement;
  initialPosition?: Point;
  showHeader?: boolean;
  bodyClass?: string;
}

const TRIGGER_SIZE = 52;
const VIEWPORT_MARGIN = 12;
const PANEL_GAP = 10;
const DRAG_THRESHOLD = 5;

/** 将触发按钮限制在可见视口内；返回坐标以 viewport 左上角为原点。 */
export function clampFloatingPosition(position: Point, viewport: Size, triggerSize = TRIGGER_SIZE): Point {
  return {
    x: clamp(position.x, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - triggerSize - VIEWPORT_MARGIN)),
    y: clamp(position.y, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - triggerSize - VIEWPORT_MARGIN)),
  };
}

/**
 * 优先把面板放在触发按钮右侧和下方；空间不足时翻转方向，最终再钳制到视口边距内。
 */
export function calculatePanelPlacement(trigger: Point, triggerSize: number, panel: Size, viewport: Size): PanelPlacement {
  const placeRight = viewport.width - trigger.x - triggerSize >= panel.width + PANEL_GAP + VIEWPORT_MARGIN;
  const placeBelow = viewport.height - trigger.y >= panel.height + VIEWPORT_MARGIN;
  const x = placeRight ? trigger.x + triggerSize + PANEL_GAP : trigger.x - panel.width - PANEL_GAP;
  const y = placeBelow ? trigger.y : trigger.y + triggerSize - panel.height;

  return {
    x: clamp(x, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - panel.width - VIEWPORT_MARGIN)),
    y: clamp(y, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - panel.height - VIEWPORT_MARGIN)),
    horizontal: placeRight ? 'right' : 'left',
    vertical: placeBelow ? 'below' : 'above',
  };
}

/** 管理一个带独立触发按钮、可拖动且自动避开视口边缘的 DOM 面板。 */
export class FloatingPanel {
  readonly #viewport: HTMLElement;
  readonly #root: HTMLElement;
  readonly #trigger: HTMLButtonElement;
  readonly #panel: HTMLElement;
  readonly #resizeObserver: ResizeObserver;
  readonly #content: HTMLElement;
  readonly #contentParent: Node | null;
  readonly #contentNextSibling: Node | null;
  #position: Point;
  #dragStart: { pointerId: number; pointer: Point; position: Point } | null = null;
  #dragging = false;
  #open = false;

  constructor(viewport: HTMLElement, options: FloatingPanelOptions) {
    this.#viewport = viewport;
    this.#position = options.initialPosition ?? { x: 18, y: 18 };
    this.#content = options.content;
    this.#contentParent = options.content.parentNode;
    this.#contentNextSibling = options.content.nextSibling;
    this.#root = document.createElement('section');
    this.#root.className = 'floating-panel';
    this.#root.innerHTML = `
      <button type="button" class="floating-panel__trigger" aria-expanded="false"></button>
      <div class="floating-panel__body" role="dialog">
        <header class="floating-panel__header"><strong></strong><button type="button" aria-label="收起面板">×</button></header>
      </div>`;
    this.#trigger = this.#get('.floating-panel__trigger');
    this.#panel = this.#get('.floating-panel__body');
    this.#trigger.textContent = options.triggerText;
    this.#trigger.title = options.triggerLabel;
    this.#trigger.setAttribute('aria-label', options.triggerLabel);
    this.#panel.setAttribute('aria-label', options.title);
    if (options.bodyClass) this.#panel.classList.add(options.bodyClass);
    const header = this.#get<HTMLElement>('.floating-panel__header');
    if (options.showHeader === false) {
      header.remove();
    } else {
      this.#get<HTMLElement>('.floating-panel__header strong').textContent = options.title;
      this.#get<HTMLButtonElement>('.floating-panel__header button').addEventListener('click', (event) => {
        event.stopPropagation();
        this.setOpen(false);
      });
    }
    this.#panel.append(options.content);
    viewport.append(this.#root);

    this.#trigger.addEventListener('pointerdown', this.#onPointerDown);
    this.#trigger.addEventListener('pointermove', this.#onPointerMove);
    this.#trigger.addEventListener('pointerup', this.#onPointerUp);
    this.#trigger.addEventListener('pointercancel', this.#onPointerCancel);
    this.#trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      // 指针点击已在 pointerup 中处理；detail === 0 保留键盘触发按钮的开合行为。
      if (event.detail === 0) this.toggle();
    });
    this.#resizeObserver = new ResizeObserver(() => this.#layout());
    this.#resizeObserver.observe(viewport);
    this.#resizeObserver.observe(this.#panel);
    this.#layout();
  }

  setOpen(open: boolean): void {
    this.#open = open;
    this.#root.classList.toggle('is-open', open);
    this.#trigger.setAttribute('aria-expanded', String(open));
    if (open) this.#layoutPanel();
  }

  toggle(): void {
    this.setOpen(!this.#open);
  }

  /** 断开尺寸监听、恢复传入内容的原 DOM 归属，并移除面板容器。 */
  destroy(): void {
    this.#resizeObserver.disconnect();
    if (this.#contentParent) {
      if (this.#contentNextSibling?.parentNode === this.#contentParent) {
        this.#contentParent.insertBefore(this.#content, this.#contentNextSibling);
      } else {
        this.#contentParent.appendChild(this.#content);
      }
    }
    this.#root.remove();
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.#dragStart = {
      pointerId: event.pointerId,
      pointer: { x: event.clientX, y: event.clientY },
      position: { ...this.#position },
    };
    this.#dragging = false;
    this.#trigger.setPointerCapture(event.pointerId);
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragStart || event.pointerId !== this.#dragStart.pointerId) return;
    const deltaX = event.clientX - this.#dragStart.pointer.x;
    const deltaY = event.clientY - this.#dragStart.pointer.y;
    if (!this.#dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

    event.preventDefault();
    event.stopPropagation();
    this.#dragging = true;
    this.#root.classList.add('is-dragging');
    this.#position = {
      x: this.#dragStart.position.x + deltaX,
      y: this.#dragStart.position.y + deltaY,
    };
    this.#layout();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (!this.#dragStart || event.pointerId !== this.#dragStart.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    this.#trigger.releasePointerCapture(event.pointerId);
    const wasDragging = this.#dragging;
    this.#dragStart = null;
    this.#dragging = false;
    this.#root.classList.remove('is-dragging');
    if (!wasDragging) this.toggle();
  };

  readonly #onPointerCancel = (): void => {
    this.#dragStart = null;
    this.#dragging = false;
    this.#root.classList.remove('is-dragging');
  };

  #layout(): void {
    this.#root.style.setProperty('--floating-viewport-width', `${this.#viewport.clientWidth}px`);
    this.#root.style.setProperty('--floating-viewport-height', `${this.#viewport.clientHeight}px`);
    this.#position = clampFloatingPosition(this.#position, {
      width: this.#viewport.clientWidth,
      height: this.#viewport.clientHeight,
    });
    this.#root.style.transform = `translate3d(${this.#position.x}px, ${this.#position.y}px, 0)`;
    if (this.#open) this.#layoutPanel();
  }

  #layoutPanel(): void {
    const placement = calculatePanelPlacement(
      this.#position,
      TRIGGER_SIZE,
      { width: this.#panel.offsetWidth, height: this.#panel.offsetHeight },
      { width: this.#viewport.clientWidth, height: this.#viewport.clientHeight },
    );
    this.#panel.style.left = `${placement.x - this.#position.x}px`;
    this.#panel.style.top = `${placement.y - this.#position.y}px`;
    this.#panel.dataset.horizontal = placement.horizontal;
    this.#panel.dataset.vertical = placement.vertical;
  }

  #get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Floating panel element missing: ${selector}`);
    return element;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
