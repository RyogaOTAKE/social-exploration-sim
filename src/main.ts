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
    foodCount: 4,
    singlePheromoneMode: false
};

// 巣の情報
interface Nest {
    x: number;
    y: number;
    r: number;
}
let nests: Nest[] = [];

interface FoodSource {
    x: number;
    y: number;
    r: number;
}
let foodSources: FoodSource[] = [];

function initFoods() {
    foodSources = [];
    // ランダム配置
    for (let i = 0; i < params.foodCount; i++) {
        foodSources.push({
            x: Math.random() * (WIDTH - 100) + 50,
            y: Math.random() * (HEIGHT - 100) + 50,
            r: 30
        });
    }
}

function initNests() {
    nests = [];
    // 巣が重ならないように、また画面内に収まるように配置
    // シンプルにランダム配置するが、既存の巣と近すぎる場合は再抽選するなどの工夫が可能
    // ここでは簡易的にランダム配置
    for (let i = 0; i < params.nestCount; i++) {
        if (i === 0) {
            // 1つ目は中央
            nests.push({ x: WIDTH / 2, y: HEIGHT / 2, r: 20 });
        } else {
            nests.push({
                x: Math.random() * (WIDTH - 100) + 50,
                y: Math.random() * (HEIGHT - 100) + 50,
                r: 20
            });
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

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.state = AgentState.FORAGING;
        this.pheromoneStrength = 1.0;
    }

    update(grid: PheromoneGrid) {
        // 1. センサーによる方向転換
        this.sense(grid);

        // 2. ランダムなゆらぎ
        this.angle += (Math.random() - 0.5) * 0.2;

        // 3. 移動
        this.x += Math.cos(this.angle) * params.moveSpeed;
        this.y += Math.sin(this.angle) * params.moveSpeed;

        // 4. 壁でのバウンス処理
        this.handleBoundaries(grid);

        // 5. フェロモン塗布 & 状態更新
        this.handleStateAndPheromones(grid);
    }

    sense(grid: PheromoneGrid) {
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
        if (vCenter > vLeft && vCenter > vRight) {
            // そのまま進む
        } else if (vCenter < vLeft && vCenter < vRight) {
            // 左右どちらも強い -> ランダムに大きく旋回
            this.angle += (Math.random() - 0.5) * 2 * params.turnSpeed;
        } else if (vLeft > vRight) {
            this.angle -= params.turnSpeed;
        } else if (vRight > vLeft) {
            this.angle += params.turnSpeed;
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
            } else {
                // 歩くたびにフェロモン強度が下がる（巣から遠ざかるほど薄くなる＝勾配ができる）
                this.pheromoneStrength = Math.max(0, this.pheromoneStrength - 0.005);
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
                this.state = AgentState.FORAGING;
                this.pheromoneStrength = 1.0; // 巣フェロモン強度MAX
                this.angle += Math.PI; // 反転
            } else {
                // 歩くたびに強度が下がる（餌場から遠ざかるほど薄くなる）
                this.pheromoneStrength = Math.max(0, this.pheromoneStrength - 0.005);
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
// alpha: falseでパフォーマンス向上

const grid = new PheromoneGrid(WIDTH, HEIGHT);
let agents: Agent[] = [];

// エージェント初期化
function initAgents() {
    agents = [];
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

    document.getElementById('resetBtn')?.addEventListener('click', () => {
        grid.reset();
        initNests(); // 巣の位置も再抽選
        initFoods();
        initAgents();
    });
}

// 描画ループ
function loop() {
    // エージェントの段階的スポーン
    if (agents.length < params.agentCount) {
        const spawnRate = 5; // 1フレームに追加する数
        for (let i = 0; i < spawnRate; i++) {
            if (agents.length >= params.agentCount) break;
            const nest = nests[Math.floor(Math.random() * nests.length)];
            agents.push(new Agent(nest.x, nest.y));
        }
    }

    // 1. フェロモン蒸発
    grid.evaporate(params.evaporationRate);

    // 2. エージェント更新
    for (const agent of agents) {
        agent.update(grid);
    }

    // 3. 描画
    // ImageDataを使って高速に描画
    const imgData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const data = imgData.data;

    // 背景とフェロモンを描画
    for (let i = 0; i < grid.homeGrid.length; i++) {
        const homeIntensity = grid.homeGrid[i];
        const foodIntensity = grid.foodGrid[i];
        
        const idx = i * 4;
        
        // 視覚化: Home(青) + Food(赤)
        // 背景は黒に近いグレー
        // intensityが 0~1 なので 255を掛ける
        
        data[idx] = Math.min(255, foodIntensity * 255 * 2);     // R: Food
        data[idx + 1] = Math.min(255, (homeIntensity + foodIntensity) * 30); // G: 少し混ぜて明るく
        data[idx + 2] = Math.min(255, homeIntensity * 255 * 2); // B: Home
        data[idx + 3] = 255; // Alpha
    }

    // エージェントを描画（白い点）
    // 多数のエージェントを描く場合、canvas API(fillRect等)は遅いので
    // 直接ピクセルを塗る
    for (const agent of agents) {
        const x = Math.floor(agent.x);
        const y = Math.floor(agent.y);
        const idx = (y * WIDTH + x) * 4;
        if (idx >= 0 && idx < data.length) {
            data[idx] = 255;
            data[idx + 1] = 255;
            data[idx + 2] = 255;
        }
    }
    
    // 巣と餌の位置をマーカーとして描画（ピクセル操作の上書き）
    // ここはわかりやすさのためにContext APIを使いたいが、putImageDataした後でないと消える
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