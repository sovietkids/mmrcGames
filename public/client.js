// public/client.js
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.module.js';
// import { EffectComposer } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/EffectComposer.js';
// import { RenderPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/RenderPass.js';
// import { UnrealBloomPass } from 'https://unpkg.com/three@0.128.0/examples/jsm/postprocessing/UnrealBloomPass.js';

// === 1. Three.js セットアップ ===
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcccccc, 100, 300); // 霧を追加 (色, 開始距離, 終了距離)
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.shadowMap.enabled = true; // 影を有効にする
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// 基本的な照明を追加
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3); // 環境光をさらに弱める
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(50, 50, 50);
directionalLight.castShadow = true; // 平行光源が影を落とすようにする
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// // --- ポストプロセッシング設定 ---
// const composer = new EffectComposer(renderer);
// const renderPass = new RenderPass(scene, camera);
// composer.addPass(renderPass);

// const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
// bloomPass.threshold = 0.95; // ブルームの閾値をさらに厳しくする
// bloomPass.strength = 0.3; // ブルームの強さを少し弱める
// bloomPass.radius = 0.3; // ブルームのにじみ半径
// composer.addPass(bloomPass);

// 地面を作成
const planeGeometry = new THREE.PlaneGeometry(500, 500); // 地面を広げる
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0x556b2f }); // 草地のような色
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.position.y = 0; // 地面の高さを0に
plane.receiveShadow = true; // 地面が影を受け取るようにする
scene.add(plane);

// --- スカイボックス ---
const loader = new THREE.CubeTextureLoader();
loader.setPath('skybox/');
const textureCube = loader.load(['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg']);
scene.background = textureCube;
scene.environment = textureCube; // 反射にも使用

// === 2. Socket.IO 接続と同期オブジェクト ===
const socket = io();
const otherPlayers = {}; // 他のプレイヤーのキューブオブジェクトを格納
const buildings = []; // 当たり判定用にビルを格納する配列
const impactEffects = []; // 着弾エフェクトを管理する配列
const npcs = []; // NPCを管理する配列
const bullets = []; // 弾丸を管理する配列

// --- テクスチャ読み込み ---
const textureLoader = new THREE.TextureLoader();
const otherPlayerTexture = textureLoader.load('textures/japan.png');
const npcTexture = textureLoader.load('textures/germany.png');

// --- 名前設定 ---
const myName = prompt("名前を入力してください") || `Player${Math.floor(Math.random() * 1000)}`;
socket.emit('setMyName', myName);

// 自分自身のプレイヤーオブジェクト
let player = null; 

// 自分自身のプレイヤーを作成する関数
function createPlayer(playerInfo) {
    // 一人称視点なので、プレイヤー自身の体は透明なオブジェクトとして扱う
    const geometry = new THREE.SphereGeometry(0.9, 32, 16); // 球体に変更
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const playerMesh = new THREE.Mesh(geometry, material); 
    playerMesh.castShadow = true; // プレイヤーが影を落とす
    // プレイヤーの足元がy=0になるように、中心をモデルの高さの半分だけ上に設定
    playerMesh.position.set(playerInfo.x, playerInfo.y + 0.9, playerInfo.z);
    scene.add(playerMesh);
    playerMesh.userData.velocity = new THREE.Vector3(); // 速度を記録するためのプロパティを初期化
    return playerMesh;
}

// 他のプレイヤーのキューブを作成する関数
function addOtherPlayer(playerInfo) {
    const geometry = new THREE.SphereGeometry(0.9, 32, 16); // 球体に変更
    const material = new THREE.MeshStandardMaterial({ map: otherPlayerTexture, roughness: 0.7 }); // テクスチャを適用
    const playerCube = new THREE.Mesh(geometry, material);
    playerCube.castShadow = true; // 他のプレイヤーも影を落とす
    playerCube.userData.id = playerInfo.id; // どのプレイヤーか識別するためのIDをセット
    // 他のプレイヤーも足元を合わせる
    playerCube.position.set(playerInfo.x, playerInfo.y + 0.9, playerInfo.z);
    playerCube.rotation.y = playerInfo.rotationY;
    scene.add(playerCube);
    otherPlayers[playerInfo.id] = playerCube;

    // --- 名前ラベルの作成 ---
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = 'Bold 48px Arial';
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.fillText(playerInfo.name, 0, 48);
    const texture = new THREE.CanvasTexture(canvas);

    const labelMaterial = new THREE.SpriteMaterial({ map: texture });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(3, 1.5, 1.0);
    label.position.set(playerInfo.x, playerInfo.y + 2.0, playerInfo.z); // 球体に合わせて高さを調整

    playerCube.userData.nameLabel = label; // ラベルを紐づける
    scene.add(label);
}

// ワールド情報を受け取ってビルとNPCを生成
socket.on('worldSetup', (worldData) => {
    createWorld(worldData.buildings);
    createNPCs(worldData.npcs);
    createEnterableBuilding(); // これは固定配置なのでクライアント側でOK
});

// サーバーから初期プレイヤーリストを受け取る
socket.on('currentPlayers', (players) => {
    for (let id in players) {
        if (id === socket.id) {
            // サーバーから与えられた自分の情報でプレイヤーを作成
            player = createPlayer(players[id]);
        } else {
            addOtherPlayer(players[id]);
        }
    }
});

// 新しいプレイヤーの接続通知
socket.on('newPlayer', (playerInfo) => {
    if (playerInfo.id !== socket.id) {
        addOtherPlayer(playerInfo);
        console.log('New player connected:', playerInfo.id);
    }
});

// プレイヤーの移動通知
socket.on('playerMoved', (playerInfo) => {
    const playerCube = otherPlayers[playerInfo.id];
    if (playerCube) {
        // 自分のプレイヤーがリスポーンした場合の処理
        if (playerInfo.id === socket.id && player) {
            player.position.set(playerInfo.x, playerInfo.y + 0.9, playerInfo.z);
            
            // --- ダメージエフェクト ---
            const damageOverlay = document.getElementById('damage-overlay');
            damageOverlay.style.opacity = 0.6;
            setTimeout(() => {
                damageOverlay.style.transition = 'opacity 0.5s';
                damageOverlay.style.opacity = 0;
            }, 100);
            setTimeout(() => { damageOverlay.style.transition = ''; }, 600); // トランジションをリセット
            // --- ここまで ---

            console.log("リスポーンしました。");
            return;
        }

        // 受信した座標にキューブを移動
        playerCube.position.x = playerInfo.x; 
        playerCube.position.y = playerInfo.y + 0.9; // 足元を合わせる
        playerCube.position.z = playerInfo.z;
        playerCube.rotation.y = playerInfo.rotationY; // 回転も同期
        playerCube.userData.nameLabel.position.set(playerInfo.x, playerInfo.y + 2.0, playerInfo.z); // 名前ラベルも移動
    }
});

// プレイヤーの切断通知
socket.on('playerDisconnected', (playerId) => {
    const playerCube = otherPlayers[playerId];
    if (playerCube) {
        scene.remove(playerCube);
        scene.remove(playerCube.userData.nameLabel); // 名前ラベルも削除
        delete otherPlayers[playerId];
        console.log('Player disconnected:', playerId);
    }
});

// 他のプレイヤーが撃った通知
socket.on('playerShot', (data) => {
    // 他のプレイヤーが撃った弾を自分の世界に生成
    const { shooterId, bulletData } = data;
    createBullet(bulletData.position, bulletData.velocity, shooterId);
});

// 着弾エフェクトを作成する関数
function createImpactEffect(position) {
    const effectGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const effectMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true });
    const effect = new THREE.Mesh(effectGeometry, effectMaterial);
    effect.position.copy(position);
    scene.add(effect);
    impactEffects.push(effect); // 管理配列に追加
}

// 弾丸を作成する関数
function createBullet(position, velocity, shooterId) {
    const bulletGeometry = new THREE.SphereGeometry(0.1, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    bullet.position.copy(position);

    bullet.userData = {
        velocity: velocity,
        shooterId: shooterId, // 誰が撃ったか
        life: 100 // 弾の寿命（フレーム数）
    };

    scene.add(bullet);
    bullets.push(bullet);
}

// NPCの同期更新
socket.on('npcUpdate', (serverNpcs) => {
    serverNpcs.forEach(serverNpc => {
        const clientNpc = npcs.find(n => n.userData.id === serverNpc.id);
        if (clientNpc) {
            clientNpc.position.x = serverNpc.x;
            clientNpc.position.y = serverNpc.y;
            clientNpc.position.z = serverNpc.z;
            clientNpc.rotation.y = serverNpc.rotationY;
        }
    });
});

// NPCが倒された通知を受け取る
socket.on('npcWasKilled', (npcId) => {
    const npcToRemove = npcs.find(npc => npc.userData.id === npcId);
    if (npcToRemove) {
        scene.remove(npcToRemove);
        // npcs配列から削除
        const index = npcs.indexOf(npcToRemove);
        if (index > -1) {
            npcs.splice(index, 1);
        }
    }
});

// === 3. 操作ロジック ===
const moveSpeed = 0.08;
const gravity = -0.015;
const jumpStrength = 0.3;
let velocityY = 0;
let onGround = true;

// --- スコープ機能 ---
let isScoped = false;
const normalFov = 75;
const scopedFov = 30;

// --- スコアシステム ---
let score = 0;
const scoreUI = document.getElementById('score-ui');

function updateScoreUI() {
    scoreUI.textContent = `SCORE: ${score}`;
}

// UI要素を取得
const ammoUI = document.getElementById('ammo-ui');

function updateAmmoUI() {
    ammoUI.textContent = "∞"; // 無限弾薬の表示
    updateScoreUI(); // スコアも一緒に更新
}

const keys = {};

// キー押下状態の管理
document.addEventListener('keydown', (event) => {
    keys[event.key.toLowerCase()] = true;
});
document.addEventListener('mousedown', (event) => {
    if (event.button === 2) { // 右クリック
        isScoped = !isScoped;
    }
});
document.addEventListener('keyup', (event) => {
    keys[event.key.toLowerCase()] = false;
});

// --- チャットシステム ---
const chatContainer = document.getElementById('chat-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let isChatting = false;

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value) {
        socket.emit('chatMessage', chatInput.value);
        chatInput.value = '';
    }
    chatInput.blur(); // 入力後フォーカスを外す
    isChatting = false;
});

chatInput.addEventListener('focus', () => {
    isChatting = true;
});
chatInput.addEventListener('blur', () => {
    isChatting = false;
});

socket.on('newChatMessage', (data) => {
    const item = document.createElement('div');
    if (data.system) {
        item.textContent = `[ANNOUNCEMENT] ${data.message}`;
        item.style.color = 'yellow';
    } else {
        item.textContent = `${data.senderName}: ${data.message}`;
    }
    chatContainer.appendChild(item);
    chatContainer.scrollTop = chatContainer.scrollHeight; // 自動スクロール
});

// --- 三人称視点カメラとマウス操作 ---
let cameraAngle = { x: 0, y: 0 };
const cameraDistance = 5; // プレイヤーからの距離

document.addEventListener('mousemove', (event) => {
    if (isChatting) return; // チャット中は視点操作しない
    const sensitivity = isScoped ? 0.5 : 1.0; // スコープ中は感度を下げる
    // マウスの移動量に応じてカメラの角度を更新
    cameraAngle.x -= event.movementX * 0.002 * sensitivity;
    cameraAngle.y -= event.movementY * 0.002 * sensitivity;

    // カメラの上下の角度制限を広げる (真上・真下近くまで)
    cameraAngle.y = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, cameraAngle.y));
});

// --- 全画面表示、ポインターロック、射撃 ---
document.addEventListener('click', () => {
    if (document.pointerLockElement !== document.body) {
        // マウスカーソルをロックして非表示にする
        document.body.requestPointerLock();
    } else {
        // --- 射撃処理 ---
        if (!player || isChatting) return; // チャット中は撃てない
        
        const bulletVelocity = 2.0; // 弾の速度
        const bulletDirection = new THREE.Vector3();
        camera.getWorldDirection(bulletDirection);

        const startPosition = new THREE.Vector3();
        camera.getWorldPosition(startPosition);

        const velocity = bulletDirection.clone().multiplyScalar(bulletVelocity);

        // 自分の弾を生成
        createBullet(startPosition, velocity, socket.id);

        // サーバーに発射情報を送信
        socket.emit('shoot', { position: startPosition, velocity: velocity });
    }
});

// === NPC作成 ===
function createNPCs(serverNpcs) {
    const npcGeometry = new THREE.SphereGeometry(0.9, 32, 16); // 球体に変更
    const npcMaterial = new THREE.MeshStandardMaterial({ map: npcTexture, roughness: 0.7 }); // テクスチャを適用

    serverNpcs.forEach(serverNpc => {
        const npc = new THREE.Mesh(npcGeometry, npcMaterial);
        npc.castShadow = true;
        npc.position.set(serverNpc.x, serverNpc.y, serverNpc.z);

        // AIのためのプロパティ
        npc.userData = {
            id: serverNpc.id, // サーバーから受け取ったID
            state: 'WANDERING', // 'WANDERING' or 'ATTACKING'
            shootCooldown: 0
        };

        scene.add(npc);
        npcs.push(npc);
    });
}

// === ワールド作成 ===
function createWorld(serverBuildings) {
    // 道路
    const roadGeometry = new THREE.PlaneGeometry(10, 500);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01; // 地面より少しだけ上
    road.receiveShadow = true;
    scene.add(road);

    // --- ビルの窓テクスチャを生成 ---
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#555'; // ビルの壁の色
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#aae'; // 窓の色
    for (let y = 8; y < canvas.height; y += 24) {
        for (let x = 8; x < canvas.width; x += 24) {
            context.fillRect(x, y, 12, 16);
        }
    }
    const buildingTexture = new THREE.CanvasTexture(canvas);
    buildingTexture.wrapS = THREE.RepeatWrapping;
    buildingTexture.wrapT = THREE.RepeatWrapping;
    buildingTexture.repeat.set(2, 4); // テクスチャの繰り返し回数

    // ビルを生成
    const buildingMaterials = [
        new THREE.MeshStandardMaterial({ map: buildingTexture, roughness: 0.8 }), // 通常のビル
        new THREE.MeshStandardMaterial({ color: 0xddddff, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.7 }), // ガラス張りビル
        new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.2 }), // メタリックなビル
    ];

    serverBuildings.forEach(buildingData => {
        const { type, height, width, depth, x, z } = buildingData;
        let randomMaterial;
        if (type === 'glass') randomMaterial = buildingMaterials[1];
        else if (type === 'metal') randomMaterial = buildingMaterials[2];
        else randomMaterial = buildingMaterials[0];

        const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
        const building = new THREE.Mesh(buildingGeometry, randomMaterial);

        // サーバーから受け取った位置に配置
        building.position.set(x, height / 2, z);
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);

        // --- ランダムビルを壁の集合体に変換して、ドアを作る ---
        const doorWidth = 3;
        const doorHeight = 4;
        const wallThickness = 0.2;

        // 奥、左右、上の壁を当たり判定に追加
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, height / 2, z - depth / 2), new THREE.Vector3(width, height, wallThickness))); // 奥
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x - width / 2, height / 2, z), new THREE.Vector3(wallThickness, height, depth))); // 左
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x + width / 2, height / 2, z), new THREE.Vector3(wallThickness, height, depth))); // 右
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, height / 2, z + depth / 2), new THREE.Vector3(width - doorWidth, height, wallThickness))); // 手前(ドア脇)
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, doorHeight + (height - doorHeight) / 2, z + depth / 2), new THREE.Vector3(doorWidth, height - doorHeight, wallThickness))); // 手前(ドア上)
        // 床と天井も追加
        buildings.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(x, 0, z), new THREE.Vector3(width, wallThickness, depth))); // 床
    });
}
function createEnterableBuilding() {
    const wallThickness = 0.5;
    const buildingSize = { width: 15, height: 8, depth: 20 };
    const door = { width: 3, height: 4 };
    const position = { x: 30, y: 0, z: 30 };

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.9 });

    // 壁を生成するヘルパー関数
    const createWall = (w, h, d, pX, pY, pZ) => {
        const wallGeo = new THREE.BoxGeometry(w, h, d);
        const wall = new THREE.Mesh(wallGeo, wallMaterial);
        wall.position.set(position.x + pX, position.y + pY, position.z + pZ);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
        buildings.push(new THREE.Box3().setFromObject(wall));
    };

    // 床と天井
    createWall(buildingSize.width, wallThickness, buildingSize.depth, 0, wallThickness / 2, 0); // 床
    createWall(buildingSize.width, wallThickness, buildingSize.depth, 0, buildingSize.height, 0); // 天井

    // 壁 (奥と手前)
    createWall(buildingSize.width, buildingSize.height, wallThickness, 0, buildingSize.height / 2, -buildingSize.depth / 2); // 奥壁
    // 手前の壁 (ドア部分を分割)
    const frontWallSideWidth = (buildingSize.width - door.width) / 2;
    createWall(frontWallSideWidth, buildingSize.height, wallThickness, - (door.width / 2 + frontWallSideWidth / 2), buildingSize.height / 2, buildingSize.depth / 2); // ドア左
    createWall(frontWallSideWidth, buildingSize.height, wallThickness,   (door.width / 2 + frontWallSideWidth / 2), buildingSize.height / 2, buildingSize.depth / 2); // ドア右
    createWall(door.width, buildingSize.height - door.height, wallThickness, 0, door.height + (buildingSize.height - door.height) / 2, buildingSize.depth / 2); // ドア上

    // 壁 (左右)
    createWall(wallThickness, buildingSize.height, buildingSize.depth, -buildingSize.width / 2, buildingSize.height / 2, 0); // 左壁
    createWall(wallThickness, buildingSize.height, buildingSize.depth,  buildingSize.width / 2, buildingSize.height / 2, 0); // 右壁

    // --- 内装 ---
    const tableGeo = new THREE.BoxGeometry(4, 1, 2);
    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const table = new THREE.Mesh(tableGeo, tableMaterial);
    table.position.set(position.x, position.y + 1, position.z);
    table.castShadow = true; table.receiveShadow = true;
    scene.add(table);
    buildings.push(new THREE.Box3().setFromObject(table)); // テーブルも当たり判定の対象に

    const chairGeo = new THREE.BoxGeometry(1, 2, 1);
    const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xCD853F });
    const createChair = (pX, pZ) => {
        const chair = new THREE.Mesh(chairGeo, chairMaterial);
        chair.position.set(position.x + pX, position.y + 1, position.z + pZ);
        chair.castShadow = true; chair.receiveShadow = true;
        scene.add(chair);
        buildings.push(new THREE.Box3().setFromObject(chair));
    };
    createChair(-2, 2);
    createChair(2, 2);
}

// === 4. ゲームループと同期送信 ===
function animate() {
    camera.rotation.order = 'YXZ'; // 回転の順序をYXZに設定 (重要)
    requestAnimationFrame(animate);

    // プレイヤーがまだ作成されていなければ何もしない
    if (!player) return;

    const oldPos = player.position.clone(); // 移動前の位置を保存
    const oldRot = player.rotation.clone();

    // --- プレイヤーの水平移動処理 ---
    if (!isChatting) { // チャット中は移動しない
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        
        // カメラのY軸回転だけをプレイヤーの移動方向の基準にする
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0;
        cameraDirection.normalize();

        forward.set(cameraDirection.x, 0, cameraDirection.z);
        right.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();

        if (keys['w']) {
            player.position.addScaledVector(forward, moveSpeed);
        }
        if (keys['s']) {
            player.position.addScaledVector(forward, -moveSpeed);
        }
        if (keys['a']) {
            player.position.addScaledVector(right, moveSpeed); // Dの処理をAに
        }
        if (keys['d']) {
            player.position.addScaledVector(right, -moveSpeed); // Aの処理をDに
        }
    }

    // --- ジャンプと重力処理 ---
    if (keys[' '] && onGround && !isChatting) {
        velocityY = jumpStrength;
        onGround = false;
    }

    // 重力を適用
    velocityY += gravity;
    player.position.y += velocityY;

    // 地面との衝突判定
    if (player.position.y - 0.9 <= 0) { // プレイヤーの足元が地面(y=0)以下になったら
        player.position.y = 0.9; // 地面にめり込まないように位置を補正
        velocityY = 0;
        onGround = true;
    }

    // --- 新しい当たり判定ロジック ---
    const playerCollider = new THREE.Box3().setFromObject(player);

    for (const buildingBox of buildings) {
        if (playerCollider.intersectsBox(buildingBox)) {
            const intersection = playerCollider.intersect(buildingBox);
            const penetration = new THREE.Vector3();
            intersection.getSize(penetration);

            const newPos = player.position.clone();
            const oldPosCenter = oldPos.clone().add(new THREE.Vector3(0, 0.9, 0)); // プレイヤーの中心
            const buildingCenter = new THREE.Vector3();
            buildingBox.getCenter(buildingCenter);

            // どの軸のめり込みが最も小さいかで、押し出す方向を決める
            if (penetration.x < penetration.z) {
                // X軸方向に押し出す
                const sign = Math.sign(oldPosCenter.x - buildingCenter.x);
                newPos.x += penetration.x * sign;
            } else {
                // Z軸方向に押し出す
                const sign = Math.sign(oldPosCenter.z - buildingCenter.z);
                newPos.z += penetration.z * sign;
            }
            player.position.copy(newPos);
        }
    }

    // --- 弾丸の更新と当たり判定 ---
    for (let i = bullets.length - 1; i >= 0; i--) {
        const bullet = bullets[i];
        bullet.position.add(bullet.userData.velocity);
        bullet.userData.life--;

        let hit = false;

        // 判定の重複を防ぐため、当たり判定は弾を撃った本人のクライアントが行う
        if (bullet.userData.shooterId === socket.id) {
            // 自分が撃った弾が「他のプレイヤー」や「NPC」に当たったか
            for (const id in otherPlayers) {
                if (bullet.position.distanceTo(otherPlayers[id].position) < 1.0) { // 当たり判定を球体に合わせる
                    socket.emit('playerHit', id);
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                for (const npc of npcs) {
                    if (bullet.position.distanceTo(npc.position) < 1.0) { // 当たり判定を球体に合わせる
                        socket.emit('npcKilled', npc.userData.id);
                        hit = true;
                        break;
                    }
                }
            }
        } else {
            // 他人が撃った弾が「自分」に当たったか
            if (player) {
                if (bullet.position.distanceTo(player.position) < 1.0) { // 当たり判定を球体に合わせる
                    socket.emit('playerHit', socket.id); // 自分がやられたことをサーバーに通知
                    hit = true;
                }
            }
        }

        // 全ての弾丸で、壁との当たり判定を処理
        const bulletCollider = new THREE.Box3().setFromObject(bullet);
        for (const buildingBox of buildings) {
            if (bulletCollider.intersectsBox(buildingBox)) {
                hit = true;
                break;
            }
        }

        // 弾が何かに当たったか、寿命が尽きたら消す
        if (hit || bullet.userData.life <= 0) {
            createImpactEffect(bullet.position); // 着弾エフェクト
            scene.remove(bullet);
            bullets.splice(i, 1);
        }
    }

    // --- エフェクトの更新 ---
    for (let i = impactEffects.length - 1; i >= 0; i--) {
        const effect = impactEffects[i];
        effect.material.opacity -= 0.04; // 徐々に透明にする
        if (effect.material.opacity <= 0) {
            scene.remove(effect);
            impactEffects.splice(i, 1);
        }
    }

    // --- NPCの更新 ---
    // クライアント側でのNPCの移動ロジックは不要になったため削除
    // 代わりに、サーバーから送られてくる位置情報に基づいて表示が更新される
    for (const npc of npcs) {
        const distanceToPlayer = player.position.distanceTo(npc.position);
        const detectionRange = 60;
        const attackRange = 50;

        // プレイヤーが索敵範囲内にいるかチェック
        if (distanceToPlayer < detectionRange) {
            // プレイヤーとNPCの間に壁がないかチェック（視線チェック）
            // パフォーマンス改善：毎回オブジェクトを生成するのではなく、バウンディングボックスの中心を使う
            const raycaster = new THREE.Raycaster(npc.position, player.position.clone().sub(npc.position).normalize());
            let isObstructed = false;
            for (const buildingBox of buildings) {
                if (raycaster.ray.intersectsBox(buildingBox)) {
                    isObstructed = true;
                    break;
                }
            }
            const intersects = isObstructed ? [{distance: 0}] : []; // 簡易的な模倣

            if (intersects.length === 0 || intersects[0].distance > distanceToPlayer) {
                // 視線が通っている場合
                npc.userData.state = 'ATTACKING';
            } else {
                npc.userData.state = 'WANDERING';
            }
        } else {
            npc.userData.state = 'WANDERING';
        }

        if (npc.userData.state === 'ATTACKING') {
            // 攻撃状態の処理
            npc.lookAt(player.position); // プレイヤーの方を向く
            npc.userData.shootCooldown--;
            if (npc.userData.shootCooldown <= 0 && distanceToPlayer < attackRange) {
                const bulletVelocity = 1.5;
                let direction = new THREE.Vector3().subVectors(player.position, npc.position).normalize();
                // プレイヤーの未来位置を少し予測して偏差撃ち
                direction = direction.add(player.userData.velocity.clone().multiplyScalar(distanceToPlayer / 50));
                const startPosition = npc.position.clone().add(direction.multiplyScalar(1.5)); // NPCの少し前から発射
                createBullet(startPosition, direction.normalize().multiplyScalar(bulletVelocity), npc.userData.id);
                npc.userData.shootCooldown = 100; // 100フレームのクールダウン
            }
        }
    }

    // --- プレイヤーの向きを更新 ---
    player.rotation.y = cameraAngle.x;

    // --- カメラを一人称視点に更新 ---
    camera.position.set(player.position.x, player.position.y + 0.7, player.position.z); // 目線の高さに調整
    camera.rotation.y = cameraAngle.x; // マウスの左右移動
    camera.rotation.x = cameraAngle.y; // マウスの上下移動
    player.userData.velocity = player.position.clone().sub(oldPos); // プレイヤーの速度を記録

    // 位置や向きが変わったら、サーバーに送信
    if (!player.position.equals(oldPos) || player.rotation.y !== oldRot.y) {
        socket.emit('playerMovement', {
            x: player.position.x,
            y: player.position.y - 0.9, // サーバーには足元の座標(y=0基準)を送信
            z: player.position.z, 
            rotationY: player.rotation.y
        });
    }

    // スコープに合わせてFOVを滑らかに更新
    const targetFov = isScoped ? scopedFov : normalFov;
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.1);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera); // 通常のレンダリングに戻す
}

// ウィンドウリサイズ対応
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // composer.setSize(window.innerWidth, window.innerHeight);
});

updateAmmoUI(); // 初期UI表示
animate(); // ゲームループ開始