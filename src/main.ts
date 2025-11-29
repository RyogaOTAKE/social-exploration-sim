// --- 設定と定数 ---
const WIDTH = 600;
const HEIGHT = 600;

// フェロモンの種類
enum PheromoneType {
    HOME = 0, // 巣に戻るための匂い（青）
    FOOD = 1  // 餌場に行くための匂い（赤）
}

// エージェントの状態
enum AgentState {
    FORAGING = 0, // 餌を探している（巣の匂いを落とす）
    RETURNING = 1 // 巣に帰っている（餌の匂いを落とす）
}

interface SimParams {
    agentCount: number;
    moveSpeed: number;
    evaporationRate: number;
    sensorAngle: number; // ラジアン
    sensorDist: number;
    turnSpeed: number;   // ラジアン
    nestCount: number;
    foodCount: number;
    singlePheromoneMode: boolean;
    uTurnChance: number;
    excitedSpeedMult: number;
    propagationChance: number;
    excitedDecayRate: number;
    usePheromoneGradient: boolean;
    explorationResistance: number;
    excitedTurnSpeedMult: number;
    spawnRate: number;
    enableSortieRegulation: boolean;
    enableGiveUp: boolean;
}

// デフォルトパラメータ
const params: SimParams = {
    agentCount: 500,
    moveSpeed: 1.5,
    evaporationRate: 0.985,
    sensorAngle: Math.PI / 4,
    sensorDist: 20,
    turnSpeed: 0.2,
    nestCount: 1,
    foodCount: 2,
    singlePheromoneMode: true,
    uTurnChance: 0.01,
    excitedSpeedMult: 2.0,
    propagationChance: 0.1,
    excitedDecayRate: 0.01,
    usePheromoneGradient: true,
    explorationResistance: 0.0,
    excitedTurnSpeedMult: 3.0,
    spawnRate: 5,
    enableSortieRegulation: false,
    enableGiveUp: false
};

// 巣の情報
interface Nest {
    x: number;
    y: number;
    r: number;
    surgeTimer: number;
}
let nests: Nest[] = [];

interface FoodSource {
    x: number;
    y: number;
    r: number;
    surgeTimer: number;
}
let foodSources: FoodSource[] = [];

function initFoods() {
    foodSources = [];
    // ランダム配置
    for (let i = 0; i < params.foodCount; i++) {
        let f: FoodSource;
        let attempts = 0;
        do {
            f = {
                x: Math.random() * (WIDTH - 100) + 50,
                y: Math.random() * (HEIGHT - 100) + 50,
                r: 30,
                surgeTimer: 0
            };
            attempts++;
        } while (isOverlapping(f.x, f.y, f.r) && attempts < 100);
        foodSources.push(f);
    }
}

function initNests() {
    nests = [];
    for (let i = 0; i < params.nestCount; i++) {
        let n: Nest;
        let attempts = 0;
        do {
            if (i === 0 && attempts === 0) {
                n = { x: WIDTH / 2, y: HEIGHT / 2, r: 20, surgeTimer: 0 };
            } else {
                n = {
                    x: Math.random() * (WIDTH - 100) + 50,
                    y: Math.random() * (HEIGHT - 100) + 50,
                    r: 20,
                    surgeTimer: 0
                };
            }
            attempts++;
        } while (isOverlapping(n.x, n.y, n.r) && attempts < 100);
        nests.push(n);
    }
}

interface Obstacle {
    x: number;
    y: number;
    w: number;
    h: number;
}
let obstacles: Obstacle[] = [];

function isOverlapping(x: number, y: number, r: number): boolean {
    for (const obs of obstacles) {
        if (x + r > obs.x && x - r < obs.x + obs.w &&
            y + r > obs.y && y - r < obs.y + obs.h) {
            return true;
        }
    }
    return false;
}

function initMaze() {
    obstacles = [];
    const cellSize = 60; // 少し広めに
    const cols = Math.floor(WIDTH / cellSize);
    const rows = Math.floor(HEIGHT / cellSize);

    // 外周
    obstacles.push({ x: 0, y: 0, w: WIDTH, h: 10 });
    obstacles.push({ x: 0, y: HEIGHT - 10, w: WIDTH, h: 10 });
    obstacles.push({ x: 0, y: 0, w: 10, h: HEIGHT });
    obstacles.push({ x: WIDTH - 10, y: 0, w: 10, h: HEIGHT });

    // 簡易的な壁生成
    for (let y = 2; y < rows - 1; y += 2) {
        for (let x = 2; x < cols - 1; x += 2) {
            const px = x * cellSize;
            const py = y * cellSize;
            obstacles.push({ x: px, y: py, w: 10, h: 10 }); // 柱

            // ランダムに壁を伸ばす
            const dir = Math.floor(Math.random() * 4);
            switch (dir) {
                case 0: obstacles.push({ x: px, y: py - cellSize, w: 10, h: cellSize }); break; // 上
                case 1: obstacles.push({ x: px, y: py, w: 10, h: cellSize }); break; // 下
                case 2: obstacles.push({ x: px - cellSize, y: py, w: cellSize, h: 10 }); break; // 左
                case 3: obstacles.push({ x: px, y: py, w: cellSize, h: 10 }); break; // 右
            }
        }
    }
}

// --- クラス定義 ---

class PheromoneGrid {
    width: number;
    height: number;
    // 1次元配列で管理 (0.0 ~ 1.0)
    homeGrid: Float32Array;
    foodGrid: Float32Array;

    constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
        this.homeGrid = new Float32Array(w * h);
        this.foodGrid = new Float32Array(w * h);
    }

    // フェロモンを落とす
    deposit(x: number, y: number, type: PheromoneType, amount: number) {
        const idx = (Math.floor(y) * this.width) + Math.floor(x);
        if (idx >= 0 && idx < this.homeGrid.length) {
            // 検証モード: 全て HOME として扱う
            const effectiveType = params.singlePheromoneMode ? PheromoneType.HOME : type;

            if (effectiveType === PheromoneType.HOME) {
                // 最大1.0でキャップ
                this.homeGrid[idx] = Math.min(1.0, this.homeGrid[idx] + amount);
            } else {
                this.foodGrid[idx] = Math.min(1.0, this.foodGrid[idx] + amount);
            }
        }
    }

    // 指定位置のフェロモン濃度を取得
    getLevel(x: number, y: number, type: PheromoneType): number {
        // 境界チェック
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
        const idx = (Math.floor(y) * this.width) + Math.floor(x);

        // 検証モード: 常に HOME から取得
        const effectiveType = params.singlePheromoneMode ? PheromoneType.HOME : type;
        
        return effectiveType === PheromoneType.HOME ? this.homeGrid[idx] : this.foodGrid[idx];
    }

    // 全体の蒸発処理
    evaporate(rate: number) {
        for (let i = 0; i < this.homeGrid.length; i++) {
            this.homeGrid[i] *= rate;
            this.foodGrid[i] *= rate;
            
            // 完全に消えたら0にする（浮動小数点誤差対策）
            if (this.homeGrid[i] < 0.001) this.homeGrid[i] = 0;
            if (this.foodGrid[i] < 0.001) this.foodGrid[i] = 0;
        }
    }
    
    reset() {
        this.homeGrid.fill(0);
        this.foodGrid.fill(0);
    }
}

class Agent {
    x: number;
    y: number;
    angle: number; // ラジアン
    state: AgentState;
    
    // 「巣からの距離感」または「餌からの距離感」を表現するためのタイマー
    // これにより、濃いフェロモン（最近通った場所）を作れる
    pheromoneStrength: number;
    excitedLevel: number; // 0:通常, 1:伝播, 2:発信源
    searchTime: number;
    givingUp: boolean;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.state = AgentState.FORAGING;
        this.pheromoneStrength = 1.0;
        this.excitedLevel = 0;
        this.searchTime = 0;
        this.givingUp = false;
    }

    update(grid: PheromoneGrid, nearbyAgents: Agent[]) {
        // 興奮の減衰 (レベル1, 2ともに)
        if (this.excitedLevel > 0 && params.excitedDecayRate > 0) {
            if (Math.random() < params.excitedDecayRate) {
                this.excitedLevel = 0;
            }
        }

        // 接触による興奮伝播 (1次感染者からのみ)
        if (params.propagationChance > 0 && this.excitedLevel === 0) {
            for (const other of nearbyAgents) {
                if (other !== this && other.excitedLevel === 2) {
                     if (Math.random() < params.propagationChance) {
                        this.excitedLevel = 1;
                        break;
                     }
                }
            }
        }

        // 1. センサーによる方向転換
        this.sense(grid);

        // 諦め(Give-up)判定
        if (params.enableGiveUp && this.state === AgentState.FORAGING && this.excitedLevel === 0) {
             const currentHome = grid.getLevel(this.x, this.y, PheromoneType.HOME);
             const currentFood = grid.getLevel(this.x, this.y, PheromoneType.FOOD);
             
             // 道に乗っているか判定
             if (currentHome > 0.05 || currentFood > 0.05) {
                 this.searchTime = 0;
                 this.givingUp = false;
             } else {
                 this.searchTime++;
                 // 約15秒で諦める
                 if (this.searchTime > 900) {
                     this.givingUp = true;
                 }
             }
        }

        // 2. ランダムなゆらぎ
        const wiggle = (this.excitedLevel > 0) ? 0.05 : 0.2;
        this.angle += (Math.random() - 0.5) * wiggle;

        // 3. 移動
        let speed = params.moveSpeed * (this.excitedLevel > 0 ? params.excitedSpeedMult : 1.0);

        // 探索抵抗 (フェロモンがない場所への進みにくさ)
        if (params.explorationResistance > 0) {
            const currentPheromone = Math.max(
                grid.getLevel(this.x, this.y, PheromoneType.HOME),
                grid.getLevel(this.x, this.y, PheromoneType.FOOD)
            );
            const factor = 1.0 - (params.explorationResistance * (1.0 - currentPheromone));
            speed *= Math.max(0, factor);
        }

        const prevX = this.x;
        const prevY = this.y;
        this.x += Math.cos(this.angle) * speed;
        this.y += Math.sin(this.angle) * speed;
        
        // 障害物判定
        this.handleObstacles(prevX, prevY);

        // 4. 壁でのバウンス処理
        this.handleBoundaries(grid);

        // 5. フェロモン塗布 & 状態更新
        this.handleStateAndPheromones(grid);
    }

    handleObstacles(prevX: number, prevY: number) {
        for (const obs of obstacles) {
            if (this.x >= obs.x && this.x <= obs.x + obs.w &&
                this.y >= obs.y && this.y <= obs.y + obs.h) {
                this.x = prevX;
                this.y = prevY;
                this.angle += Math.PI + (Math.random() - 0.5);
                return;
            }
        }
    }

    sense(grid: PheromoneGrid) {
        if (this.givingUp) {
            this.senseAnyPheromone(grid);
            return;
        }

        // 探索中のターゲットフェロモン（餌を探すならFOOD、巣に帰るならHOME）
        const targetType = this.state === AgentState.FORAGING ? PheromoneType.FOOD : PheromoneType.HOME;
        
        const sensorLeftAngle = this.angle - params.sensorAngle;
        const sensorRightAngle = this.angle + params.sensorAngle;

        const getSensorPos = (ang: number) => ({
            x: this.x + Math.cos(ang) * params.sensorDist,
            y: this.y + Math.sin(ang) * params.sensorDist
        });

        const l = getSensorPos(sensorLeftAngle);
        const c = getSensorPos(this.angle);
        const r = getSensorPos(sensorRightAngle);

        const vLeft = grid.getLevel(l.x, l.y, targetType);
        const vCenter = grid.getLevel(c.x, c.y, targetType);
        const vRight = grid.getLevel(r.x, r.y, targetType);

        // 濃度が高い方へ回転
        let turn = params.turnSpeed;
        if (this.excitedLevel > 0) {
            turn *= params.excitedTurnSpeedMult;
        }

        if (vCenter > vLeft && vCenter > vRight) {
            // そのまま進む
        } else if (vCenter < vLeft && vCenter < vRight) {
            // 左右どちらも強い -> ランダムに大きく旋回
            this.angle += (Math.random() - 0.5) * 2 * turn;
        } else if (vLeft > vRight) {
            this.angle -= turn;
        } else if (vRight > vLeft) {
            this.angle += turn;
        }

        // Uターン処理
        if (params.uTurnChance > 0) {
            let doUTurn = Math.random() < params.uTurnChance;
            // 進行方向のフェロモン濃度が薄い場合、Uターンしやすくする
            // 閾値は 0.05 程度とする (最大1.0)
            const forwardPheromone = vCenter + Math.max(vLeft, vRight);
            if (forwardPheromone < 0.05) {
                 // 濃度が薄い場合、確率をブースト (例: 10倍)
                 if (Math.random() < params.uTurnChance * 10) {
                     doUTurn = true;
                 }
            }
            
            if (doUTurn) {
                this.angle += Math.PI;
            }
        }
    }

    senseAnyPheromone(grid: PheromoneGrid) {
        const sensorLeftAngle = this.angle - params.sensorAngle;
        const sensorRightAngle = this.angle + params.sensorAngle;

        const getSensorPos = (ang: number) => ({
            x: this.x + Math.cos(ang) * params.sensorDist,
            y: this.y + Math.sin(ang) * params.sensorDist
        });

        const l = getSensorPos(sensorLeftAngle);
        const c = getSensorPos(this.angle);
        const r = getSensorPos(sensorRightAngle);

        // HOMEとFOODの合算値を感知
        const getSum = (x: number, y: number) => 
            grid.getLevel(x, y, PheromoneType.HOME) + grid.getLevel(x, y, PheromoneType.FOOD);

        const vLeft = getSum(l.x, l.y);
        const vCenter = getSum(c.x, c.y);
        const vRight = getSum(r.x, r.y);

        // 通常より敏感に回転
        const turn = params.turnSpeed * 2.0;

        if (vCenter > vLeft && vCenter > vRight) {
            // そのまま
        } else if (vCenter < vLeft && vCenter < vRight) {
             this.angle += (Math.random() - 0.5) * 2 * turn;
        } else if (vLeft > vRight) {
            this.angle -= turn;
        } else if (vRight > vLeft) {
            this.angle += turn;
        }

        // 何も感じない場合はランダムウォークを強める
        if (vCenter + vLeft + vRight < 0.01) {
             if (Math.random() < 0.05) { 
                 this.angle += (Math.random() - 0.5) * Math.PI;
             }
        }
    }

    handleBoundaries(grid: PheromoneGrid) {
        if (this.x < 0) { this.x = 0; this.angle = Math.PI - this.angle; }
        if (this.x >= grid.width) { this.x = grid.width - 1; this.angle = Math.PI - this.angle; }
        if (this.y < 0) { this.y = 0; this.angle = -this.angle; }
        if (this.y >= grid.height) { this.y = grid.height - 1; this.angle = -this.angle; }
    }

    handleStateAndPheromones(grid: PheromoneGrid) {
        // 最も近い巣を探す
        let closestNest = nests[0];
        let minDist = Infinity;
        
        for (const nest of nests) {
            const d = Math.hypot(this.x - nest.x, this.y - nest.y);
            if (d < minDist) {
                minDist = d;
                closestNest = nest;
            }
        }
        const distToNest = minDist;
        const nestRadius = closestNest.r;

        // 餌にいるか判定
        let onFood = false;
        for (const f of foodSources) {
            if (Math.hypot(this.x - f.x, this.y - f.y) < f.r) {
                onFood = true;
                break;
            }
        }

        // 状態遷移とフェロモン補充
        if (this.state === AgentState.FORAGING) {
            // 餌を探している -> 通った道に「巣のフェロモン(HOME)」を落とす
            // 巣に近いほど濃いフェロモンを落としたいので、時間経過で強度を減衰させる
            grid.deposit(this.x, this.y, PheromoneType.HOME, this.pheromoneStrength);
            
            if (onFood) {
                // 餌を見つけた！
                this.state = AgentState.RETURNING;
                this.pheromoneStrength = 1.0; // 餌フェロモン強度MAX
                this.angle += Math.PI; // 反転
                this.excitedLevel = 2;
            } else {
                // 歩くたびにフェロモン強度が下がる（巣から遠ざかるほど薄くなる＝勾配ができる）
                if (params.usePheromoneGradient) {
                    this.pheromoneStrength = Math.max(0, this.pheromoneStrength - 0.005);
                } else {
                    this.pheromoneStrength = 1.0;
                }
            }

            // 巣にいるなら強度リチャージ
            if (distToNest < nestRadius) {
                this.pheromoneStrength = 1.0;
            }

        } else {
            // 巣に帰っている -> 通った道に「餌のフェロモン(FOOD)」を落とす
            grid.deposit(this.x, this.y, PheromoneType.FOOD, this.pheromoneStrength);

            if (distToNest < nestRadius) {
                // 巣に着いた！
                if (this.state === AgentState.RETURNING && this.excitedLevel === 2) {
                    closestNest.surgeTimer = 600;
                }
                this.state = AgentState.FORAGING;
                this.pheromoneStrength = 1.0; // 巣フェロモン強度MAX
                this.angle += Math.PI; // 反転
                this.excitedLevel = 0;
            } else {
                // 歩くたびに強度が下がる（餌場から遠ざかるほど薄くなる）
                if (params.usePheromoneGradient) {
                    this.pheromoneStrength = Math.max(0, this.pheromoneStrength - 0.005);
                } else {
                    this.pheromoneStrength = 1.0;
                }
            }
            
            // 餌場にいるなら強度リチャージ（餌場内をうろついている間）
            if (onFood) {
                this.pheromoneStrength = 1.0;
            }
        }
    }
}

// --- メイン処理 ---

const canvas = document.getElementById('simCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!; 
const densityCanvas = document.getElementById('densityCanvas') as HTMLCanvasElement;
const densityCtx = densityCanvas.getContext('2d', { alpha: false })!;
// alpha: falseでパフォーマンス向上

// 統計UI要素
const statTotalEl = document.getElementById('stat-total');
const statForagingEl = document.getElementById('stat-foraging');
const statReturningEl = document.getElementById('stat-returning');
const statExcited2El = document.getElementById('stat-excited2');
const statExcited1El = document.getElementById('stat-excited1');

const grid = new PheromoneGrid(WIDTH, HEIGHT);
let agents: Agent[] = [];
let spawnAccumulator = 0;

// エージェント初期化
function initAgents() {
    agents = [];
    spawnAccumulator = 0;
    // 一気に追加せず、loop内で徐々に追加する
}

// UIイベントリスナー設定
function setupUI() {
    const bind = (id: string, key: keyof SimParams, isFloat: boolean = false) => {
        const el = document.getElementById(id) as HTMLInputElement;
        const valEl = document.getElementById(`val-${id}`) as HTMLElement;
        el.addEventListener('input', () => {
            const val = isFloat ? parseFloat(el.value) : parseInt(el.value);
            // @ts-ignore
            params[key] = val;
            valEl.textContent = String(val);

            if (key === 'agentCount') {
                // 数が変わったら再生成（または増減処理だが、簡単のためリセット）
                initAgents();
                grid.reset();
            }
        });
    };

    bind('agentCount', 'agentCount');
    bind('spawnRate', 'spawnRate', true);
    bind('moveSpeed', 'moveSpeed', true);
    bind('evapRate', 'evaporationRate', true);
    bind('sensorAngle', 'sensorAngle', false); // 度数法で受けて内部で変換が必要だが簡易化
    // sensorAngleはスライダーが度数法、paramsはラジアンにするため特殊処理
    const angleEl = document.getElementById('sensorAngle') as HTMLInputElement;
    const angleVal = document.getElementById('val-sensorAngle') as HTMLElement;
    angleEl.addEventListener('input', () => {
        const deg = parseFloat(angleEl.value);
        params.sensorAngle = deg * (Math.PI / 180);
        angleVal.textContent = String(deg);
    });

    bind('sensorDist', 'sensorDist', true);
    bind('uTurnChance', 'uTurnChance', true);
    bind('excitedSpeedMult', 'excitedSpeedMult', true);
    bind('propagationChance', 'propagationChance', true);
    bind('excitedDecayRate', 'excitedDecayRate', true);
    bind('explorationResistance', 'explorationResistance', true);
    bind('excitedTurnSpeedMult', 'excitedTurnSpeedMult', true);

    bind('nestCount', 'nestCount', false);
    const nestCountEl = document.getElementById('nestCount') as HTMLInputElement;
    nestCountEl?.addEventListener('input', () => {
        // 巣の数が変わったら再配置
        initNests();
        initAgents();
        grid.reset();
    });

    bind('foodCount', 'foodCount', false);
    const foodCountEl = document.getElementById('foodCount') as HTMLInputElement;
    foodCountEl?.addEventListener('input', () => {
        initFoods();
        // 餌の位置が変わったらエージェントの挙動も変わるが、リセットまではしなくて良いかもしれない
        // しかしわかりやすさのためリセット推奨
        grid.reset();
        initAgents();
    });

    const singleModeCb = document.getElementById('singlePheromoneMode') as HTMLInputElement;
    if (singleModeCb) {
        singleModeCb.addEventListener('change', () => {
            params.singlePheromoneMode = singleModeCb.checked;
            grid.reset();
            initAgents();
        });
    }

    const gradCb = document.getElementById('usePheromoneGradient') as HTMLInputElement;
    if (gradCb) {
        gradCb.addEventListener('change', () => {
            params.usePheromoneGradient = gradCb.checked;
            grid.reset();
            initAgents();
        });
    }

    const sortieCb = document.getElementById('enableSortieRegulation') as HTMLInputElement;
    if (sortieCb) {
        sortieCb.addEventListener('change', () => {
            params.enableSortieRegulation = sortieCb.checked;
        });
    }

    const giveUpCb = document.getElementById('enableGiveUp') as HTMLInputElement;
    if (giveUpCb) {
        giveUpCb.addEventListener('change', () => {
            params.enableGiveUp = giveUpCb.checked;
        });
    }

    document.getElementById('mazeBtn')?.addEventListener('click', () => {
        initMaze();
        grid.reset();
        initNests();
        initFoods();
        initAgents();
    });

    document.getElementById('clearMazeBtn')?.addEventListener('click', () => {
        obstacles = [];
        grid.reset();
        initNests();
        initFoods();
        initAgents();
    });

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        grid.reset();
        initNests(); // 巣の位置も再抽選
        initFoods();
        initAgents();
    });
}

// 描画ループ
function loop() {
    // タイマー更新
    for (const nest of nests) {
        if (nest.surgeTimer > 0) nest.surgeTimer--;
    }

    // エージェントの段階的スポーン
    if (agents.length < params.agentCount) {
        spawnAccumulator += params.spawnRate;
        const spawnCount = Math.floor(spawnAccumulator);
        spawnAccumulator -= spawnCount;

        for (let i = 0; i < spawnCount; i++) {
            if (agents.length >= params.agentCount) break;
            const nest = nests[Math.floor(Math.random() * nests.length)];
            
            // 規則B: 出撃制御 (Wait and Surge)
            if (params.enableSortieRegulation) {
                if (nest.surgeTimer > 0) {
                    // 動員中: 制限なし
                } else {
                    // 待機中: 偵察のみ
                    if (Math.random() > 0.01) {
                        continue; 
                    }
                }
            }

            agents.push(new Agent(nest.x, nest.y));
        }
    }

    // 1. フェロモン蒸発
    grid.evaporate(params.evaporationRate);

    // 2. エージェント更新
    // 接触判定のための空間分割 (簡易グリッド)
    const cellSize = 10; // 10px単位のグリッド
    const cols = Math.ceil(WIDTH / cellSize);
    const spatialMap = new Map<number, Agent[]>();
    
    // マップ構築
    for (const agent of agents) {
        const cx = Math.floor(agent.x / cellSize);
        const cy = Math.floor(agent.y / cellSize);
        const key = cy * cols + cx;
        if (!spatialMap.has(key)) spatialMap.set(key, []);
        spatialMap.get(key)!.push(agent);
    }

    for (const agent of agents) {
        const cx = Math.floor(agent.x / cellSize);
        const cy = Math.floor(agent.y / cellSize);
        const key = cy * cols + cx;
        const neighbors = spatialMap.get(key) || [];
        agent.update(grid, neighbors);
    }

    // 3. 描画
    
    // --- 密度マップ描画 ---
    densityCtx.fillStyle = 'black';
    densityCtx.fillRect(0, 0, WIDTH, HEIGHT);

    const maxDensity = 5; // この数以上で真っ赤
    for (const [key, agentsInCell] of spatialMap.entries()) {
        const count = agentsInCell.length;
        if (count === 0) continue;
        
        const cx = key % cols;
        const cy = Math.floor(key / cols);
        
        const ratio = Math.min(1.0, count / maxDensity);
        const hue = 240 * (1.0 - ratio); // Blue -> Red
        densityCtx.fillStyle = `hsla(${hue}, 100%, 50%, 0.6)`;
        densityCtx.fillRect(cx * cellSize, cy * cellSize, cellSize, cellSize);
    }

    // --- 通常描画 ---
    const imgData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
        const data = imgData.data;

        // 背景とフェロモンを描画
        for (let i = 0; i < grid.homeGrid.length; i++) {
            const homeIntensity = grid.homeGrid[i];
            const foodIntensity = grid.foodGrid[i];
            
            const idx = i * 4;
            
            data[idx] = Math.min(255, foodIntensity * 255 * 2);     // R: Food
            data[idx + 1] = Math.min(255, (homeIntensity + foodIntensity) * 30); // G
            data[idx + 2] = Math.min(255, homeIntensity * 255 * 2); // B: Home
            data[idx + 3] = 255; // Alpha
        }

        // エージェントを描画（白い点）
        for (const agent of agents) {
            const x = Math.floor(agent.x);
            const y = Math.floor(agent.y);
            const idx = (y * WIDTH + x) * 4;
            if (idx >= 0 && idx < data.length) {
                if (agent.excitedLevel === 2) {
                    // 発信源: オレンジ
                    data[idx] = 255;
                    data[idx + 1] = 150;
                    data[idx + 2] = 50;
                } else if (agent.excitedLevel === 1) {
                    // 伝播: 黄色
                    data[idx] = 255;
                    data[idx + 1] = 255;
                    data[idx + 2] = 100;
                } else {
                    data[idx] = 255;
                    data[idx + 1] = 255;
                    data[idx + 2] = 255;
                }
                data[idx + 3] = 255; // Alpha
            }
        }
        ctx.putImageData(imgData, 0, 0);

    // 重要な場所を円で描画（オーバーレイ）
    ctx.strokeStyle = "rgba(100, 100, 255, 0.5)";
    ctx.lineWidth = 2;
    
    for (const nest of nests) {
        ctx.beginPath();
        ctx.arc(nest.x, nest.y, nest.r, 0, Math.PI*2); // Nest
        ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 100, 100, 0.5)";
    for(const f of foodSources){
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI*2);
        ctx.stroke();
    }

    ctx.fillStyle = "#888";
    for(const obs of obstacles){
        ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    // --- 統計更新 ---
    let cForaging = 0;
    let cReturning = 0;
    let cExcited2 = 0;
    let cExcited1 = 0;

    for (const agent of agents) {
        if (agent.state === AgentState.FORAGING) cForaging++;
        else cReturning++;

        if (agent.excitedLevel === 2) cExcited2++;
        else if (agent.excitedLevel === 1) cExcited1++;
    }

    if (statTotalEl) statTotalEl.textContent = String(agents.length);
    if (statForagingEl) statForagingEl.textContent = String(cForaging);
    if (statReturningEl) statReturningEl.textContent = String(cReturning);
    if (statExcited2El) statExcited2El.textContent = String(cExcited2);
    if (statExcited1El) statExcited1El.textContent = String(cExcited1);

    requestAnimationFrame(loop);
}

// 起動
setupUI();
initNests();
initFoods();
initAgents();
// 初回の角度変換
const angleInput = document.getElementById('sensorAngle') as HTMLInputElement;
params.sensorAngle = parseFloat(angleInput.value) * (Math.PI / 180);

loop();