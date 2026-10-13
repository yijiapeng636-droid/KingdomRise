import type { EntityId } from 'bitecs';
import Phaser from 'phaser';
import { cancelGatherCommand, issueGatherCommand, stepGathering } from '../../core/commands/gathering';
import { issueMoveCommand, stepMovement } from '../../core/commands/movement';
import { GAME_CONFIG } from '../../core/config/gameConfig';
import { despawnUnit, gameWorld, spawnUnit, type GatherTaskState } from '../../core/ecs/world';
import { GridMap, type GridPosition, type WorldPosition, worldPixelsToPosition } from '../../core/map/GridMap';
import {
  DeveloperConsole,
  type DeveloperAction,
  type DeveloperEntitySnapshot,
  type DeveloperSnapshot,
  type ScenarioName,
} from '../debug/DeveloperConsole';

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
  #status!: Phaser.GameObjects.Text;
  #message!: Phaser.GameObjects.Text;
  #resourceLabel!: Phaser.GameObjects.Text;
  #warehouseLabel!: Phaser.GameObjects.Text;
  #console!: DeveloperConsole;
  #selectedUnit: EntityId | null = null;
  #panning = false;
  #mapEditing = false;
  #paused = false;
  #stepRequests = 0;
  #timeScale = 1;
  #panX = 0;
  #panY = 0;
  #accumulator = 0;
  #simulationTicks = 0;
  #consoleElapsedMs = 0;
  #fps = 60;

  constructor() {
    super('game');
  }

  create(): void {
    const mapWidth = this.#map.width * GAME_CONFIG.tileSize;
    const mapHeight = this.#map.height * GAME_CONFIG.tileSize;
    const { Position } = gameWorld.components;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
    this.cameras.main.centerOn(
      (Position.x[gameWorld.leader]! + 0.5) * GAME_CONFIG.tileSize,
      (Position.y[gameWorld.leader]! + 0.5) * GAME_CONFIG.tileSize,
    );
    this.input.mouse?.disableContextMenu();
    this.#drawMap();
    this.#path = this.add.graphics();
    this.#createWorldObjects();
    for (const unit of gameWorld.units) this.#createUnitView(unit);
    this.#createHud();
    this.#bindDeveloperConsole();
    this.#bindInput();
    this.#renderState();
    this.#console.update(this.#createDeveloperSnapshot());
  }

  update(_time: number, deltaMs: number): void {
    const step = 1 / GAME_CONFIG.simulationHz;
    const instantFps = deltaMs > 0 ? 1000 / deltaMs : this.#fps;
    this.#fps = this.#fps * 0.9 + instantFps * 0.1;
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
    for (const unit of gameWorld.units) {
      stepMovement(gameWorld, unit, step);
      stepGathering(gameWorld, this.#map, unit, step);
    }
    this.#simulationTicks += 1;
  }

  #bindInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 1) {
        this.#panning = true;
        this.#panX = pointer.x;
        this.#panY = pointer.y;
        return;
      }
      if (this.#mapEditing) {
        if (pointer.button === 0) this.#toggleObstacle(pointer);
        return;
      }
      if (pointer.button === 0) {
        const clickedUnit = this.#findUnitAt(pointer);
        if (clickedUnit !== null) {
          this.#selectedUnit = clickedUnit;
          this.#message.setText(`已选中${this.#unitViews.get(clickedUnit)!.name}`);
          return;
        }
        if (this.#isEntityAt(pointer, gameWorld.resourceNode)) {
          if (this.#selectedUnit === null) {
            this.#message.setText('请先选择一个角色');
            return;
          }
          const accepted = issueGatherCommand(gameWorld, this.#map, this.#selectedUnit, gameWorld.resourceNode, gameWorld.warehouse);
          this.#message.setText(accepted ? '开始采集木材' : '无法采集：资源耗尽、仓库已满或路径受阻');
          this.#console.log(`Command: #${this.#selectedUnit} 采集 ${accepted ? '已接受' : '被拒绝'}`, accepted ? 'ok' : 'warning');
          return;
        }
        this.#selectedUnit = null;
        this.#message.setText('未选择单位');
        return;
      }
      if (pointer.button === 2 && this.#selectedUnit !== null) {
        const target = this.#toWorldPosition(pointer);
        cancelGatherCommand(gameWorld, this.#selectedUnit);
        const accepted = issueMoveCommand(gameWorld, this.#map, this.#selectedUnit, target);
        this.#message.setText(accepted ? `移动至 (${target.x.toFixed(1)}, ${target.y.toFixed(1)})` : '目标不可到达');
        this.#console.log(
          `Command: #${this.#selectedUnit} 移动 (${target.x.toFixed(1)}, ${target.y.toFixed(1)}) ${accepted ? '已接受' : '被拒绝'}`,
          accepted ? 'ok' : 'warning',
        );
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.#panning || !pointer.middleButtonDown()) return;
      const camera = this.cameras.main;
      camera.scrollX += (this.#panX - pointer.x) / camera.zoom;
      camera.scrollY += (this.#panY - pointer.y) / camera.zoom;
      this.#panX = pointer.x;
      this.#panY = pointer.y;
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 1) this.#panning = false;
    });
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      const camera = this.cameras.main;
      camera.setZoom(Phaser.Math.Clamp(camera.zoom - dy * 0.001, 0.6, 1.8));
    });
  }

  #bindDeveloperConsole(): void {
    const root = document.querySelector<HTMLElement>('#developer-console');
    if (!root) throw new Error('Developer Console root is missing.');
    this.#console = new DeveloperConsole(root, (action) => this.#handleDeveloperAction(action));
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
      this.#message.setText(action.enabled ? '地图编辑：左键切换障碍格' : '地图编辑已关闭');
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
    this.add.rectangle(18, 18, 230, 220, 0x111713, 0.92).setOrigin(0).setScrollFactor(0);
    this.#status = this.add.text(34, 31, '', {
      color: '#dfe9e2', fontFamily: 'system-ui, sans-serif', fontSize: '15px', lineSpacing: 7,
    }).setScrollFactor(0);
    this.#message = this.add.text(34, 207, '左键选择角色，再点击资源点', {
      color: '#d7b760', fontFamily: 'system-ui, sans-serif', fontSize: '13px',
    }).setScrollFactor(0);
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
    this.#status.setText([
      `${focusedView.name} · ${focusedUnit === gameWorld.leader ? '开拓者' : '居民'}`,
      `状态  ${task ? GATHER_STATUS[task.state] : order ? '移动中' : '待机'}`,
      `生命  ${Health.current[focusedUnit]}/${Health.maximum[focusedUnit]}`,
      `携带  ${Carrier.amount[focusedUnit]!.toFixed(1)}/${Carrier.capacity[focusedUnit]}`,
      `木材  ${ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(1)}`,
      `仓库  ${Warehouse.stored[gameWorld.warehouse]!.toFixed(1)}/${Warehouse.capacity[gameWorld.warehouse]}`,
      `坐标  (${x.toFixed(1)}, ${y.toFixed(1)})`,
    ]);
    this.#resourceLabel.setText(`木材 ${ResourceNode.remaining[gameWorld.resourceNode]!.toFixed(0)}`);
    this.#warehouseLabel.setText(`仓库 ${Warehouse.stored[gameWorld.warehouse]!.toFixed(0)}/${Warehouse.capacity[gameWorld.warehouse]}`);
    this.#path.clear();
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
    this.#message.setText(`已生成并选中${this.#unitViews.get(unit)!.name}`);
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
    this.#message.setText(`障碍格 (${cell.x}, ${cell.y}) ${blocked ? '已添加' : '已移除'}`);
    this.#console.log(`Map: ${blocked ? '添加' : '移除'}障碍 (${cell.x}, ${cell.y})；活动命令已取消`, 'ok');
  }

  #gatherAll(): void {
    const accepted = gameWorld.units.filter((unit) => issueGatherCommand(gameWorld, this.#map, unit, gameWorld.resourceNode, gameWorld.warehouse)).length;
    this.#message.setText(`已向 ${accepted}/${gameWorld.units.length} 个角色下达采集指令`);
    this.#console.log(`Command: 群体采集 ${accepted}/${gameWorld.units.length} 已接受`, accepted > 0 ? 'ok' : 'warning');
  }

  #resetWorld(announce = true): void {
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
    this.#message.setText('场景已恢复为初始状态');
    if (announce) this.#console.log('World: 已恢复初始状态，无需刷新页面', 'ok');
  }

  #runScenario(scenario: ScenarioName): void {
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
    this.#message.setText(result);
  }

  #createDeveloperSnapshot(): DeveloperSnapshot {
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
