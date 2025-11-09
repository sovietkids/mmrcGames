// server.js

const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
// Socket.IOサーバーをHTTPサーバーにアタッチ
const io = socketio(server);

// 'public' フォルダ内のファイルをクライアントに提供
app.use(express.static('public'));

// 接続中の全プレイヤーデータを保存するオブジェクト
const players = {}; 
const worldData = {
    buildings: [],
    npcs: []
};

// === サーバーサイドでワールドを生成 ===
function createWorldOnServer() {
    // ビルを生成
    const buildingTypes = ['normal', 'glass', 'metal'];
    for (let i = 0; i < 100; i++) {
        const building = {
            type: buildingTypes[Math.floor(Math.random() * buildingTypes.length)],
            height: Math.random() * 50 + 10,
            width: Math.random() * 10 + 5,
            depth: Math.random() * 10 + 5,
            x: (Math.random() - 0.5) * 200 + (Math.random() > 0.5 ? 20 : -20),
            z: (Math.random() - 0.5) * 500,
        };
        // 道路と重ならないようにする簡単なチェック
        if (Math.abs(building.x) < 15) continue;
        worldData.buildings.push(building);
    }

    // NPCを生成
    for (let i = 0; i < 35; i++) {
        const npc = {
            id: `npc_${i}`,
            x: (Math.random() - 0.5) * 400,
            y: 0.9,
            z: (Math.random() - 0.5) * 400,
            rotationY: 0,
            velocity: {
                x: (Math.random() - 0.5) * 0.04,
                z: (Math.random() - 0.5) * 0.04
            }
        };
        worldData.npcs.push(npc);
    }
}

// === サーバーサイドのゲームループ ===
function gameLoop() {
    // NPCの位置を更新
    worldData.npcs.forEach(npc => {
        npc.x += npc.velocity.x;
        npc.z += npc.velocity.z;
        npc.rotationY = Math.atan2(npc.velocity.x, npc.velocity.z);

        // 簡単な境界チェック（ワールド外に出ないように）
        if (npc.x > 250 || npc.x < -250 || npc.z > 250 || npc.z < -250) {
            npc.velocity.x *= -1;
            npc.velocity.z *= -1;
        }
    });
    // 全クライアントにNPCの最新情報を送信
    io.emit('npcUpdate', worldData.npcs);
}

io.on('connection', (socket) => {
    // 名前が設定されるまでプレイヤーを作成しない

    socket.on('setMyName', (name) => {
        console.log(`新しいプレイヤー: ${name} (${socket.id})`);

        // 接続時に新しいプレイヤーを作成し、初期位置と名前を設定
        players[socket.id] = {
            id: socket.id,
            name: name,
            x: 0,
            y: 0,
            z: 0,
            rotationY: 0,
            killstreak: 0, // キルストリーク
            score: 0, // スコア
        };

        // 接続したクライアントに、現在の全プレイヤー情報を送信
        socket.emit('currentPlayers', players);

        // 接続したクライアントに、ワールド情報（ビルとNPC）を送信
        socket.emit('worldSetup', worldData);

        // 他の全クライアントに新しいプレイヤーが参加したことを通知
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });


    // プレイヤーの位置が更新されたら
    socket.on('playerMovement', (movementData) => {
        // サーバー側のプレイヤーデータを更新
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            players[socket.id].z = movementData.z;
            players[socket.id].rotationY = movementData.rotationY; // 回転も更新
        }
        
        // 全クライアントに更新された位置をブロードキャスト
        socket.broadcast.emit('playerMoved', players[socket.id]); // 更新データに回転も含まれる
    });

    // 銃が発射されたら
    socket.on('shoot', (impactPoint) => {
        // 他の全クライアントに発射された弾丸の情報をブロードキャスト
        socket.broadcast.emit('playerShot', { shooterId: socket.id, bulletData: impactPoint });
    });

    // プレイヤーが撃たれた通知
    socket.on('playerHit', (hitPlayerId) => {
        const hitPlayer = players[hitPlayerId];
        if (hitPlayer) {
            // プレイヤーを初期位置にリスポーンさせる
            hitPlayer.x = 0;
            hitPlayer.y = 0;
            hitPlayer.z = 0;
            // 全員にリスポーンしたプレイヤーの位置情報を送信
            io.emit('playerMoved', hitPlayer);

            // キルストリークをリセット
            hitPlayer.killstreak = 0;
        }
    });

    // NPCが倒された通知
    socket.on('npcKilled', (npcId) => {
        // サーバー上のNPCリストから削除
        const index = worldData.npcs.findIndex(npc => npc.id === npcId);
        if (index > -1) {
            worldData.npcs.splice(index, 1);
        }

        // 倒したプレイヤーのスコアとキルストリークを更新
        const killer = players[socket.id];
        if (killer) {
            killer.score += 10;
            killer.killstreak++;

            // キルストリークが3以上、またはスコアが50の倍数に達したらアナウンス
            if (killer.killstreak >= 3) {
                io.emit('newChatMessage', { system: true, message: `${killer.name} が ${killer.killstreak} 連続キルを達成！` });
            } else if (killer.score > 0 && killer.score % 50 === 0) {
                io.emit('newChatMessage', { system: true, message: `${killer.name} が ${killer.score} スコアに到達！` });
            }
        }

        // 他の全クライアントに倒されたNPCのIDをブロードキャストして削除させる
        io.emit('npcWasKilled', npcId);
    });

    // チャットメッセージ受信
    socket.on('chatMessage', (msg) => {
        // 送信者IDとメッセージを全クライアントにブロードキャスト
        const sender = players[socket.id];
        if (sender) {
            io.emit('newChatMessage', { senderName: sender.name, message: msg });
        }
    });

    // クライアントが切断したら
    socket.on('disconnect', () => {
        console.log('プレイヤーが切断しました:', socket.id);
        // プレイヤーデータから削除
        delete players[socket.id];
        // 他のクライアントに切断を通知
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`サーバーが起動しました: http://localhost:${PORT}`);
    createWorldOnServer();
    // サーバーのゲームループを開始 (30fps)
    setInterval(gameLoop, 1000 / 30);
    console.log('複数のブラウザでアクセスして同期を確認してください。');
});