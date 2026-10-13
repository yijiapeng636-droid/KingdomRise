/**
 * Phaser 运行时的集成场景。
 *
 * 当前场景负责装配核心世界、固定步长模拟、输入意图、摄像机、绘制、DOM HUD 和
 * Developer Console。游戏规则仍委托给 core 命令模块；场景保留的重置与验证逻辑
 * 是现阶段调试入口，不代表已经形成通用的存档、场景或系统调度能力。
 */
import type { EntityId } from 'bitecs';
import Phaser from 'phaser';
import { cancelGatherCommand, issueGatherCommand, stepGathering } from '../../core/commands/gathering';
import { issueMoveCommand, stepMovement } from '../../core/commands/movement';
import { GAME_CONFIG } from '../../core/config/gameConfig';
import { despawnUnit, gameWorld, spawnUnit, type GatherTaskState } from '../../core/ecs/world';
import { GridMap, type GridPosition, type WorldPosition, worldPixelsToPosition } from '../../core/map/GridMap';
import { CameraController } from '../camera/CameraController';
import {
  DeveloperConsole,
  type DeveloperAction,
  type DeveloperEntitySnapshot,
  type DeveloperSnapshot,
  type ScenarioName,
} from '../debug/DeveloperConsole';
import { GameInputController } from '../input/GameInputController';
import { FloatingPanel } from '../ui/FloatingPanel';

// GridMap 与 ECS 分别保存阻塞格和设施实体；当前通过同一初始化列表手动保持占地一致。
const OBSTACLES: readonly GridPosition[] = [
  { x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }, { x: 7, y: 7 },
  { x: 8, y: 7 }, { x: 9, y: 7 },
  { x: 13, y: 11 }, { x: 13, y: 12 }, { x: 13, y: 13 }, { x: 12, y: 13 },
  GAME_CONFIG.gathering.resourcePosition,
  GAME_CONFIG.gathering.warehousePosition,
];

const GATHER_STATUS: Record<GatherTaskState, string> = {
  'moving-to-resource': '前往资源点',
  gathering: '采集中',
  'moving-to-warehouse': '运送资源',
  'warehouse-full': '仓库已满',
  'resource-empty': '资源已耗尽',
  blocked: '路径受阻',
};

interface UnitView {
  container: Phaser.GameObjects.Container;
  selectionRing: Phaser.GameObjects.Graphics;
  name: string;
}

export class GameScene extends Phaser.Scene {
  readonly #map = new GridMap(GAME_CONFIG.mapWidth, GAME_CONFIG.mapHeight, OBSTACLES);
  readonly #unitViews = new Map<EntityId, UnitView>();
  #mapGraphics!: Phaser.GameObjects.Graphics;
  #path!: Phaser.GameObjects.Graphics;
  #status!: HTMLElement;
  #message!: HTMLElement;
  #statusPanel!: FloatingPanel;
  #cameraController!: CameraController;
  #inputController!: GameInputController;
  #resourceLabel!: Phaser.GameObjects.Text;
  #warehouseLabel!: Phaser.GameObjects.Text;
  #console!: DeveloperConsole;
  #selectedUnit: EntityId | null = null;
  #mapEditing = false;
  #paused = false;
  #stepRequests = 0;
  #timeScale = 1;
  #accumulator = 0;
  #simulationTicks = 0;
  #consoleElapsedMs = 0;
  #fps = 60;

  constructor() {
    super('game');
  }

  /** 创建视图与输入适配器，并将其生命周期绑定到 Phaser 场景。 */
  create(): void {
    const mapWidth = this.#map.width * GAME_CONFIG.tileSize;
    const mapHeight = this.#map.height * GAME_CONFIG.tileSize;
    const { Position } = gameWorld.components;
    this.#cameraController = new CameraController(this.cameras.main, { x: 0, y: 0, width: mapWidth, height: mapHeight });
    this.cameras.main.centerOn(
      (Position.x[gameWorld.leader]! + 0.5) * GAME_CONFIG.tileSize,
      (Position.y[gameWorld.leader]! + 0.5) * GAME_CONFIG.tileSize,
    );
    this.#cameraController.constrainToWorld();
    this.#drawMap();
    this.#path = this.add.graphics();
    this.#createWorldObjects();
    for (const unit of gameWorld.units) this.#createUnitView(unit);
    this.#createHud();
    this.#bindDeveloperConsole();
    this.#inputController = new GameInputController(this.input, this.#cameraController, {
      onPrimary: (pointer) => this.#handlePrimaryPointer(pointer),
      onSecondary: (pointer) => this.#handleSecondaryPointer(pointer),
    });
    this.#renderState();
    this.#console.update(this.#createDeveloperSnapshot());
    this.scale.on(Phaser.Scale.Events.RESIZE, this.#handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.#handleResize, this);
      this.#inputController.destroy();
      this.#statusPanel.destroy();
      this.#console.destroy();
    });
  }

  /**
   * Phaser 每帧入口。摄像机和渲染按帧更新，核心世界则以固定频率推进。
   * 单帧最多累计 0.25 秒真实时间，再乘模拟倍速，避免长时间挂起后补算过多 Tick。
   */
  update(_time: number, deltaMs: number): void {
    const step = 1 / GAME_CONFIG.simulationHz;
    const instantFps = deltaMs > 0 ? 1000 / deltaMs : this.#fps;
    this.#fps = this.#fps * 0.9 + instantFps * 0.1;
    this.#cameraController.update(deltaMs);
    if (this.#paused) {
      if (this.#stepRequests > 0) {
        this.#stepSimulation(step);
        this.#stepRequests -= 1;
      }
    } else {
      this.#accumulator += Math.min(deltaMs / 1000, 0.25) * this.#timeScale;
      while (this.#accumulator >= step) {
        this.#stepSimulation(step);
        this.#accumulator -= step;
      }
    }
    this.#renderState();
    this.#consoleElapsedMs += deltaMs;
    if (this.#consoleElapsedMs >= 100) {
      this.#console.update(this.#createDeveloperSnapshot());
      this.#consoleElapsedMs = 0;
    }
  }

  #stepSimulation(step: number): void {
    // 顺序是确定的：按 units 数组遍历，每个单位先移动、后采集。
    // 因资源和仓库共享，该遍历顺序也会决定同一 Tick 内的资源竞争结果。
    for (const unit of gameWorld.units) {
      stepMovement(gameWorld, this.#map, unit, step);
      stepGathering(gameWorld, this.#map, unit, step);
    }
    this.#simulationTicks += 1;
  }

  #handlePrimaryPointer(pointer: Phaser.Input.Pointer): void {
    if (this.#mapEditing) {
      this.#toggleObstacle(pointer);
      return;
    }
    const clickedUnit = this.#findUnitAt(pointer);
    if (clickedUnit !== null) {
      this.#selectedUnit = clickedUnit;
      this.#message.textContent = `已选中${this.#unitViews.get(clickedUnit)!.name}`;
      return;
    }
    if (this.#isEntityAt(pointer, gameWorld.resourceNode)) {
      if (this.#selectedUnit === null) {
        this.#message.textContent = '请先选择一个角色';
        return;
      }
      const accepted = issueGatherCommand(gameWorld, this.#map, this.#selectedUnit, gameWorld.resourceNode, gameWorld.warehouse);
      this.#message.textContent = accepted ? '开始采集木材' : '无法采集：资源耗尽、仓库已满或路径受阻';
      this.#console.log(`Command: #${this.#selectedUnit} 采集 ${accepted ? '已接受' : '被拒绝'}`, accepted ? 'ok' : 'warning');
      return;
    }
    this.#selectedUnit = null;
    this.#message.textContent = '未选择单位';
  }

  #handleSecondaryPointer(pointer: Phaser.Input.Pointer): void {
    if (this.#mapEditing || this.#selectedUnit === null) return;
    const target = this.#toWorldPosition(pointer);
    cancelGatherCommand(gameWorld, this.#selectedUnit);
    const accepted = issueMoveCommand(gameWorld, this.#map, this.#selectedUnit, target);
    this.#message.textContent = accepted ? `移动至 (${target.x.toFixed(1)}, ${target.y.toFixed(1)})` : '目标不可到达';
    this.#console.log(
      `Command: #${this.#selectedUnit} 移动 (${target.x.toFixed(1)}, ${target.y.toFixed(1)}) ${accepted ? '已接受' : '被拒绝'}`,
      accepted ? 'ok' : 'warning',
    );
  }

  #bindDeveloperConsole(): void {
    const root = document.querySelector<HTMLElement>('#developer-console');
    const viewport = document.querySelector<HTMLElement>('#game-ui');
    if (!root) throw new Error('Developer Console root is missing.');
    if (!viewport) throw new Error('Game UI root is missing.');
    this.#console = new DeveloperConsole(root, viewport, (action) => this.#handleDeveloperAction(action));
  }

  #handleDeveloperAction(action: DeveloperAction): void {
    if (action.type === 'toggle-pause') {
      this.#paused = !this.#paused;
      this.#console.log(this.#paused ? 'Simulation: 已暂停' : 'Simulation: 已继续');
    } else if (action.type === 'step') {
      this.#paused = true;
      this.#stepRequests += 1;
      this.#console.log('Simulation: 执行 1 tick');
    } else if (action.type === 'set-speed') {
      this.#timeScale = action.speed;
      this.#console.log(`Simulation: 速度设为 ${action.speed}×`);
    } else if (action.type === 'spawn-unit') {
      this.#spawnResident();
    } else if (action.type === 'set-map-editing') {
      this.#mapEditing = action.enabled;
      this.#message.textContent = action.enabled ? '地图编辑：左键切换障碍格' : '地图编辑已关闭';
      this.#console.log(`Map: 编辑模式${action.enabled ? '开启' : '关闭'}`);
    } else if (action.type === 'gather-all') {
      this.#gatherAll();
    } else if (action.type === 'reset') {
      this.#resetWorld();
    } else if (action.type === 'run-scenario') {
      this.#runScenario(action.scenario);
    }
  }

  #drawMap(): void {
    this.#mapGraphics ??= this.add.graphics();
    const graphics = this.#mapGraphics.clear();
    const size = GAME_CONFIG.tileSize;
    graphics.fillStyle(0x202b25, 1).fillRect(0, 0, this.#map.width * size, this.#map.height * size);
    graphics.lineStyle(1, 0x3d4c43, 0.8);
    for (let y = 0; y < this.#map.height; y += 1) {
      for (let x = 0; x < this.#map.width; x += 1) graphics.strokeRect(x * size, y * size, size, size);
    }
    graphics.fillStyle(0x536257, 1);
    for (const { x, y } of this.#map.getBlocked()) {
      graphics.fillRoundedRect(x * size + 5, y * size + 5, size - 10, size - 10, 7);
    }
  }

  #createUnitView(unit: EntityId): void {
    if (this.#unitViews.has(unit)) return;
    const isLeader = unit === gameWorld.leader;
    const residentNumber = gameWorld.units.filter((candidate) => candidate !== gameWorld.leader).indexOf(unit) + 1;
    const name = isLeader ? '领袖' : `居民 ${residentNumber}`;
    const marker = this.add.graphics();
    marker.fillStyle(isLeader ? 0xd7b760 : 0x68a9cf, 1).fillCircle(0, 0, 15);
    marker.lineStyle(3, isLeader ? 0xffe29a : 0xa9dcf5, 0.9).strokeCircle(0, 0, 20);
    const selectionRing = this.add.graphics();
    selectionRing.lineStyle(2, 0x8ee3a1, 1).strokeCircle(0, 0, 26);
    const label = this.add.text(0, -34, name, {
      color: isLeader ? '#fff1be' : '#cdeeff', fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    }).setOrigin(0.5);
    const container = this.add.container(0, 0, [selectionRing, marker, label]);
    this.#unitViews.set(unit, { container, selectionRing, name });
  }

  #createWorldObjects(): void {
    const { Position } = gameWorld.components;
    const size = GAME_CONFIG.tileSize;
    const resourceMarker = this.add.graphics();
    resourceMarker.fillStyle(0x5f3d24, 1).fillRect(-5, -4, 10, 24);
    resourceMarker.fillStyle(0x4f8a55, 1).fillCircle(0, -10, 19);
    this.#resourceLabel = this.add.text(0, -39, '', {
      color: '#c8edca', fontFamily: 'system-ui, sans-serif', fontSize: '13px',
    }).setOrigin(0.5);
    this.add.container((Position.x[gameWorld.resourceNode]! + 0.5) * size, (Position.y[gameWorld.resourceNode]! + 0.5) * size, [resourceMarker, this.#resourceLabel]);
    const warehouseMarker = this.add.graphics();
    warehouseMarker.fillStyle(0x9b6a3e, 1).fillRoundedRect(-20, -18, 40, 36, 5);
    warehouseMarker.lineStyle(3, 0xd8a565, 1).strokeRect(-12, -10, 24, 22);
    this.#warehouseLabel = this.add.text(0, -36, '', {
      color: '#f0d0a6', fontFamily: 'system-ui, sans-serif', fontSize: '13px',
    }).setOrigin(0.5);
    this.add.container((Position.x[gameWorld.warehouse]! + 0.5) * size, (Position.y[gameWorld.warehouse]! + 0.5) * size, [warehouseMarker, this.#warehouseLabel]);
  }

  #createHud(): void {
    const viewport = document.querySelector<HTMLElement>('#game-ui');
    if (!viewport) throw new Error('Game UI root is missing.');
    const content = document.createElement('div');
    content.className = 'character-status';
    this.#status = document.createElement('pre');
    this.#message = document.createElement('p');
    this.#message.textContent = '左键选择角色，再点击资源点';
    content.append(this.#status, this.#message);
    this.#statusPanel = new FloatingPanel(viewport, {
      title: '角色状态',
      triggerLabel: '展开或收起角色状态',
      triggerText: '♟',
      content,
    });
  }

  #renderState(): void {
    const { Position, Health, MoveOrder, ResourceNode, Warehouse, Carrier, GatherTask } = gameWorld.components;
    const focusedUnit = this.#selectedUnit ?? gameWorld.leader;
    const focusedView = this.#unitViews.get(focusedUnit)!;
    const x = Position.x[focusedUnit]!;
    const y = Position.y[focusedUnit]!;
    const order = MoveOrder[focusedUnit];
    const task = GatherTask[focusedUnit];
    const size = GAME_CONFIG.tileSize;
    for (const unit of gameWorld.units) {
      const view = this.#unitViews.get(unit)!;
      view.container.setPosition((Position.x[unit]! + 0.5) * size, (Position.y[unit]! + 0.5) * size);
      view.selectionRing.setVisible(unit === this.#selectedUnit);
    }
    this.#status.textContent = [
      `${focusedView.name} · ${focusedUnit === gameWorld.leader ? '开拓者' : '居民'}`,
      `状态  ${task ? GATHER_STATUS[task.state] : order ? '移动中' : '待机'}`,
      `生命  ${Health.current[focusedUnit]}/${Health.maximum[focusedUnit]}`,
      `携带  ${Carrier.amount[focusedUnit]!.toFixed(1)}/${Carrier.capacity[focusedUnit]}`,
      `木材  ${ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(1)}`,
      `仓库  ${Warehouse.stored[gameWorld.warehouse]!.toFixed(1)}/${Warehouse.capacity[gameWorld.warehouse]}`,
      `坐标  (${x.toFixed(1)}, ${y.toFixed(1)})`,
    ].join('\n');
    this.#resourceLabel.setText(`木材 ${ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(0)}`);
    this.#warehouseLabel.setText(`仓库 ${Warehouse.stored[gameWorld.warehouse]!.toFixed(0)}/${Warehouse.capacity[gameWorld.warehouse]}`);
    this.#path.clear();
    // 绘制的是 movement 已裁剪后的剩余连续航点，不是 A* 返回的原始逐格路径。
    for (const unit of gameWorld.units) {
      const unitOrder = MoveOrder[unit];
      if (!unitOrder || !this.#shouldShowPath(unit, unitOrder.source)) continue;
      this.#path.lineStyle(3, unit === this.#selectedUnit ? 0xd7b760 : 0x68a9cf, 0.75).beginPath();
      this.#path.moveTo((Position.x[unit]! + 0.5) * size, (Position.y[unit]! + 0.5) * size);
      for (const point of unitOrder.path.slice(unitOrder.nextIndex)) {
        this.#path.lineTo((point.x + 0.5) * size, (point.y + 0.5) * size);
      }
      this.#path.strokePath();
    }
  }

  #shouldShowPath(unit: EntityId, source: 'manual' | 'task'): boolean {
    if (source === 'manual' && unit === this.#selectedUnit) return true;
    return this.#console.pathMode === 'all' || (this.#console.pathMode === 'selected' && unit === this.#selectedUnit);
  }

  #spawnResident(): void {
    const position = this.#findSpawnPosition();
    if (!position) {
      this.#console.log('ECS: 没有可用的居民生成位置', 'error');
      return;
    }
    const unit = spawnUnit(gameWorld, position.x, position.y);
    this.#createUnitView(unit);
    this.#selectedUnit = unit;
    this.#message.textContent = `已生成并选中${this.#unitViews.get(unit)!.name}`;
    this.#console.log(`ECS: 生成居民 #${unit} @ (${position.x}, ${position.y})`, 'ok');
  }

  #findSpawnPosition(): WorldPosition | null {
    const { Position } = gameWorld.components;
    const origin = this.#selectedUnit ?? gameWorld.leader;
    const candidates: WorldPosition[] = [];
    for (let y = 0; y < this.#map.height; y += 1) {
      for (let x = 0; x < this.#map.width; x += 1) candidates.push({ x, y });
    }
    candidates.sort((a, b) => Math.hypot(a.x - Position.x[origin]!, a.y - Position.y[origin]!) - Math.hypot(b.x - Position.x[origin]!, b.y - Position.y[origin]!));
    return candidates.find((candidate) => this.#map.isPointWalkable(candidate, GAME_CONFIG.unitRadius)
      && gameWorld.units.every((unit) => Math.hypot(candidate.x - Position.x[unit]!, candidate.y - Position.y[unit]!) >= 1)) ?? null;
  }

  #toggleObstacle(pointer: Phaser.Input.Pointer): void {
    const cell = this.#map.worldToGrid(this.#toWorldPosition(pointer));
    if (!this.#map.isInside(cell)) return;
    const { Position } = gameWorld.components;
    const isProtected = [gameWorld.resourceNode, gameWorld.warehouse].some((entity) => Position.x[entity] === cell.x && Position.y[entity] === cell.y);
    const isOccupied = gameWorld.units.some((unit) => {
      const unitCell = this.#map.worldToGrid({ x: Position.x[unit]!, y: Position.y[unit]! });
      return unitCell.x === cell.x && unitCell.y === cell.y;
    });
    if (isProtected || isOccupied) {
      this.#console.log(`Map: (${cell.x}, ${cell.y}) 被实体占用，不能修改`, 'warning');
      return;
    }
    const blocked = this.#map.isWalkable(cell);
    this.#map.setBlocked(cell, blocked);
    for (const unit of gameWorld.units) cancelGatherCommand(gameWorld, unit);
    this.#drawMap();
    this.#message.textContent = `障碍格 (${cell.x}, ${cell.y}) ${blocked ? '已添加' : '已移除'}`;
    this.#console.log(`Map: ${blocked ? '添加' : '移除'}障碍 (${cell.x}, ${cell.y})；活动命令已取消`, 'ok');
  }

  #gatherAll(): void {
    const accepted = gameWorld.units.filter((unit) => issueGatherCommand(gameWorld, this.#map, unit, gameWorld.resourceNode, gameWorld.warehouse)).length;
    this.#message.textContent = `已向 ${accepted}/${gameWorld.units.length} 个角色下达采集指令`;
    this.#console.log(`Command: 群体采集 ${accepted}/${gameWorld.units.length} 已接受`, accepted > 0 ? 'ok' : 'warning');
  }

  #resetWorld(announce = true): void {
    // 调试重置直接恢复当前原型的已知初始状态：前两个单位被视为内建单位，
    // 后续动态单位销毁；这不是可扩展的世界反序列化流程。
    for (const unit of [...gameWorld.units]) cancelGatherCommand(gameWorld, unit);
    for (const unit of gameWorld.units.slice(2)) {
      this.#unitViews.get(unit)?.container.destroy();
      this.#unitViews.delete(unit);
      despawnUnit(gameWorld, unit);
    }
    for (const cell of this.#map.getBlocked()) this.#map.setBlocked(cell, false);
    for (const cell of OBSTACLES) this.#map.setBlocked(cell, true);
    const { Position, Health, Carrier, ResourceNode, Warehouse } = gameWorld.components;
    const starts = [{ x: 5, y: 5 }, { x: 4, y: 6 }];
    gameWorld.units.forEach((unit, index) => {
      Position.x[unit] = starts[index]!.x;
      Position.y[unit] = starts[index]!.y;
      Health.current[unit] = Health.maximum[unit]!;
      Carrier.amount[unit] = 0;
    });
    ResourceNode.remaining[gameWorld.resourceNode] = ResourceNode.initial[gameWorld.resourceNode]!;
    Warehouse.stored[gameWorld.warehouse] = 0;
    this.#selectedUnit = null;
    this.#paused = false;
    this.#mapEditing = false;
    this.#timeScale = 1;
    this.#stepRequests = 0;
    this.#accumulator = 0;
    this.#simulationTicks = 0;
    this.#console.setPathMode('off');
    this.#console.setScenarioResult('尚未运行验证场景');
    this.#drawMap();
    this.#message.textContent = '场景已恢复为初始状态';
    if (announce) this.#console.log('World: 已恢复初始状态，无需刷新页面', 'ok');
  }

  #runScenario(scenario: ScenarioName): void {
    // 验证场景会先重置并直接改写测试所需状态，仅用于交互式观察，不替代自动化测试。
    this.#resetWorld(false);
    let passed = true;
    let result = '';
    if (scenario === 'multi-gather') {
      this.#gatherAll();
      result = '双人采集已启动：观察共享资源、仓库和任务状态';
    } else if (scenario === 'detour') {
      this.#selectedUnit = gameWorld.leader;
      this.#console.setPathMode('selected');
      passed = issueMoveCommand(gameWorld, this.#map, gameWorld.leader, { x: 10, y: 5 });
      result = passed ? '绕路命令已接受：路线应绕过中部障碍墙' : '绕路命令被拒绝';
    } else if (scenario === 'warehouse-near-full') {
      gameWorld.components.Warehouse.stored[gameWorld.warehouse] = GAME_CONFIG.gathering.warehouseCapacity - 5;
      this.#gatherAll();
      result = '仓库仅余 5 容量：验证并发交付不会超出上限';
    } else {
      for (let y = 0; y < this.#map.height; y += 1) this.#map.setBlocked({ x: 11, y }, true);
      gameWorld.components.Position.x[gameWorld.leader] = 5;
      gameWorld.components.Position.y[gameWorld.leader] = 10;
      this.#selectedUnit = gameWorld.leader;
      passed = !issueMoveCommand(gameWorld, this.#map, gameWorld.leader, { x: 15, y: 10 });
      result = passed ? '阻断验证通过：寻路正确拒绝不可达目标' : '阻断验证失败：不可达命令被接受';
      this.#drawMap();
    }
    this.#console.setScenarioResult(result, passed);
    this.#console.log(`Scenario: ${result}`, passed ? 'ok' : 'error');
    this.#message.textContent = result;
  }

  #handleResize(): void {
    this.#cameraController.constrainToWorld();
  }

  #createDeveloperSnapshot(): DeveloperSnapshot {
    // 调试台只消费字符串化快照；它不持有 ECS 状态，也不通过快照反向修改世界。
    const { Position, Health, MoveOrder, ResourceNode, Warehouse, Carrier, GatherTask } = gameWorld.components;
    const entities: DeveloperEntitySnapshot[] = gameWorld.units.map((unit) => {
      const order = MoveOrder[unit];
      const task = GatherTask[unit];
      return {
        id: unit,
        kind: this.#unitViews.get(unit)!.name,
        position: `${Position.x[unit]!.toFixed(1)}, ${Position.y[unit]!.toFixed(1)}`,
        state: task ? GATHER_STATUS[task.state] : order ? `移动·${order.source}` : '待机',
        detail: `HP ${Health.current[unit]} · 携带 ${Carrier.amount[unit]!.toFixed(1)} · 路径 ${order ? order.path.length - order.nextIndex : 0}`,
        selected: unit === this.#selectedUnit,
      };
    });
    entities.push({
      id: gameWorld.resourceNode, kind: '资源点',
      position: `${Position.x[gameWorld.resourceNode]}, ${Position.y[gameWorld.resourceNode]}`,
      state: ResourceNode.remaining[gameWorld.resourceNode]! > 0 ? '可采集' : '已耗尽',
      detail: `剩余 ${ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(1)}`, selected: false,
    }, {
      id: gameWorld.warehouse, kind: '仓库',
      position: `${Position.x[gameWorld.warehouse]}, ${Position.y[gameWorld.warehouse]}`,
      state: Warehouse.stored[gameWorld.warehouse]! < Warehouse.capacity[gameWorld.warehouse]! ? '可用' : '已满',
      detail: `${Warehouse.stored[gameWorld.warehouse]!.toFixed(1)}/${Warehouse.capacity[gameWorld.warehouse]}`, selected: false,
    });
    const activeOrders = gameWorld.units.filter((unit) => MoveOrder[unit]).length;
    const activeGathering = gameWorld.units.filter((unit) => GatherTask[unit]).length;
    const blockedTasks = gameWorld.units.filter((unit) => GatherTask[unit]?.state === 'blocked').length;
    const invalidPositions = gameWorld.units.filter((unit) => !this.#map.isPointWalkable({ x: Position.x[unit]!, y: Position.y[unit]! }, GAME_CONFIG.unitRadius)).length;
    const renderSynced = this.#unitViews.size === gameWorld.units.length;
    return {
      paused: this.#paused, speed: this.#timeScale, fps: this.#fps, ticks: this.#simulationTicks,
      unitCount: gameWorld.units.length, activeOrders, mapEditing: this.#mapEditing,
      resource: ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(1),
      warehouse: `${Warehouse.stored[gameWorld.warehouse]!.toFixed(1)}/${Warehouse.capacity[gameWorld.warehouse]}`,
      entities,
      systems: [
        { name: 'ECS', status: 'ok', detail: `${gameWorld.units.length + 2} 实体 · ${gameWorld.units.length} 居民` },
        { name: 'Command', status: activeGathering > 0 ? 'active' : 'ok', detail: `${activeGathering} 个采集任务` },
        { name: 'PathFinding', status: blockedTasks > 0 ? 'warning' : activeOrders > 0 ? 'active' : 'ok', detail: `${activeOrders} 条路线 · ${blockedTasks} 个阻塞` },
        { name: 'Simulation', status: this.#paused ? 'warning' : 'active', detail: `${this.#timeScale}× · ${GAME_CONFIG.simulationHz} Hz` },
        { name: 'Collision', status: invalidPositions > 0 ? 'warning' : 'ok', detail: invalidPositions > 0 ? `${invalidPositions} 个非法位置` : '单位均在可通行区域' },
        { name: 'Render', status: renderSynced ? 'ok' : 'warning', detail: renderSynced ? '视图与 ECS 同步' : '视图数量不一致' },
      ],
    };
  }

  #toWorldPosition(pointer: Phaser.Input.Pointer): WorldPosition {
    // 输入先经 Phaser 摄像机从屏幕坐标转为世界像素，再换算为格中心为整数的连续坐标。
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return worldPixelsToPosition(point.x, point.y, GAME_CONFIG.tileSize);
  }

  #findUnitAt(pointer: Phaser.Input.Pointer): EntityId | null {
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    for (const [unit, view] of this.#unitViews) {
      if (Phaser.Math.Distance.Between(point.x, point.y, view.container.x, view.container.y) <= 26) return unit;
    }
    return null;
  }

  #isEntityAt(pointer: Phaser.Input.Pointer, entity: EntityId): boolean {
    const pointerPosition = this.#toWorldPosition(pointer);
    const { Position } = gameWorld.components;
    return Phaser.Math.Distance.Between(pointerPosition.x, pointerPosition.y, Position.x[entity]!, Position.y[entity]!) <= 0.6;
  }
}
