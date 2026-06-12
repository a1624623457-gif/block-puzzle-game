// 俄罗斯方块 - 多人对战服务器 (2-4人)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3456;
const RECONNECT_TIMEOUT = 5 * 60 * 1000; // 5分钟重连窗口
const CLEANUP_INTERVAL = 60 * 1000; // 每分钟清理过期房间

// ── HTTP 静态文件服务 ──
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon'
};

const server = http.createServer(function (req, res) {
  var url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  var filePath = path.join(__dirname, url);
  var ext = path.extname(filePath);
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── 图形库（与客户端一致）──
const SHAPES = [
  [[1]],[[1,1]],[[1],[1]],[[1,1,1]],[[1],[1],[1]],
  [[1,0],[1,1]],[[1,1],[0,1]],[[1,1,1,1]],
  [[1],[1],[1],[1]],[[1,1],[1,1]],
  [[1,1],[1,0],[1,0]],[[1,1],[0,1],[0,1]],
  [[1,0,0],[1,1,1]],[[0,0,1],[1,1,1]],
  [[1,0],[1,0],[1,1]],[[0,1],[0,1],[1,1]],
  [[1],[1],[1],[1],[1]],
  [[1,0,0],[1,0,0],[1,1,1]],[[0,0,1],[0,0,1],[1,1,1]],
  [[1,1,1],[1,0,0],[1,0,0]],[[1,1,1],[0,0,1],[0,0,1]],
  [[1,1,0],[0,1,0],[0,1,1]],[[0,1,1],[0,1,0],[1,1,0]],
  [[1,1,1,1,1]],[[1,1,1],[1,1,1]],[[1,1],[1,1],[1,1]],
  [[1,1,1],[1,1,1],[1,1,1]]
];

function cellCount(idx) {
  var m = SHAPES[idx], n = 0;
  for (var r = 0; r < m.length; r++)
    for (var c = 0; c < m[r].length; c++)
      if (m[r][c]) n++;
  return n;
}

// 分类：小(1-3格)、中(4-5格)、大(6+格)
var SMALL = [], MEDIUM = [], LARGE = [];
for (var i = 0; i < SHAPES.length; i++) {
  var cnt = cellCount(i);
  if (cnt <= 3) SMALL.push(i);
  else if (cnt <= 5) MEDIUM.push(i);
  else LARGE.push(i);
}

// 普通难度权重 35/35/30
function weightedPick() {
  var r = Math.random();
  if (r < 0.35) return SMALL[Math.floor(Math.random() * SMALL.length)];
  if (r < 0.70) return MEDIUM[Math.floor(Math.random() * MEDIUM.length)];
  return LARGE[Math.floor(Math.random() * LARGE.length)];
}

// ── 棋盘逻辑 ──
const BOARD = 8;

function createBoard() {
  var b = [];
  for (var r = 0; r < BOARD; r++) { b[r] = []; for (var c = 0; c < BOARD; c++) b[r][c] = null; }
  return b;
}

function canPlace(board, matrix, row, col) {
  for (var r = 0; r < matrix.length; r++)
    for (var c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      var br = row + r, bc = col + c;
      if (br < 0 || br >= BOARD || bc < 0 || bc >= BOARD) return false;
      if (board[br][bc] !== null) return false;
    }
  return true;
}

function canPlaceAnyForPieces(board, pieces) {
  for (var i = 0; i < pieces.length; i++) {
    var m = SHAPES[pieces[i]];
    for (var r = 0; r < BOARD; r++)
      for (var c = 0; c < BOARD; c++)
        if (canPlace(board, m, r, c)) return true;
  }
  return false;
}

function checkClears(board) {
  var rows = [], cols = [];
  for (var r = 0; r < BOARD; r++) {
    var full = true;
    for (var c = 0; c < BOARD; c++) if (board[r][c] === null) { full = false; break; }
    if (full) rows.push(r);
  }
  for (var c = 0; c < BOARD; c++) {
    var full = true;
    for (var r = 0; r < BOARD; r++) if (board[r][c] === null) { full = false; break; }
    if (full) cols.push(c);
  }
  return { rows, cols, total: rows.length + cols.length };
}

function applyClears(board, rows, cols) {
  for (var ri = 0; ri < rows.length; ri++)
    for (var c = 0; c < BOARD; c++) board[rows[ri]][c] = null;
  for (var ci = 0; ci < cols.length; ci++)
    for (var r = 0; r < BOARD; r++) board[r][cols[ci]] = null;
}

function canPlaceAny(board) {
  for (var i = 0; i < SHAPES.length; i++) {
    var m = SHAPES[i];
    for (var r = 0; r < BOARD; r++)
      for (var c = 0; c < BOARD; c++)
        if (canPlace(board, m, r, c)) return true;
  }
  return false;
}

// ── 生成图形（普通难度，保证有解）──
function pickFittingShape(board) {
  for (var t = 0; t < 50; t++) {
    var idx = weightedPick();
    var m = SHAPES[idx];
    for (var r = 0; r < BOARD; r++)
      for (var c = 0; c < BOARD; c++)
        if (canPlace(board, m, r, c)) return idx;
  }
  // 兜底：返回最小的图形
  for (var si = 0; si < SMALL.length; si++) {
    var sm = SHAPES[SMALL[si]];
    for (var r = 0; r < BOARD; r++)
      for (var c = 0; c < BOARD; c++)
        if (canPlace(board, sm, r, c)) return SMALL[si];
  }
  return SMALL[0]; // 极端情况
}

function generatePieces(board, count) {
  var pieces = [];
  var used = {};
  for (var i = 0; i < count; i++) {
    var idx = pickFittingShape(board);
    var tries = 0;
    while (used[idx] && tries < 30) { idx = pickFittingShape(board); tries++; }
    used[idx] = true;
    pieces.push(idx);
  }
  return pieces;
}

// ── 分配图形给玩家 ──
function assignPieces(pieces, playerOrder) {
  var count = pieces.length;
  var pCount = playerOrder.length;
  var assignments = {};
  if (pCount === 2) {
    // 2人4块：每人2块，随机分配
    var indices = [0, 1, 2, 3];
    shuffle(indices);
    assignments[playerOrder[0]] = [indices[0], indices[1]];
    assignments[playerOrder[1]] = [indices[2], indices[3]];
  } else if (pCount === 3) {
    // 3人3块：每人1块
    var indices = [0, 1, 2];
    shuffle(indices);
    for (var i = 0; i < 3; i++) assignments[playerOrder[i]] = [indices[i]];
  } else {
    // 4人4块：每人1块
    var indices = [0, 1, 2, 3];
    shuffle(indices);
    for (var i = 0; i < 4; i++) assignments[playerOrder[i]] = [indices[i]];
  }
  return assignments;
}

function shuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

// ── 房间管理 ──
var rooms = {};

function generateRoomCode() {
  var code;
  for (var t = 0; t < 100; t++) {
    code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms[code]) return code;
  }
  return code; // 极其罕见情况下可能冲突
}

function generateToken() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

function createRoom(playerCount) {
  var code = generateRoomCode();
  var playerOrder = ['A', 'B', 'C', 'D'].slice(0, playerCount);
  var players = {};
  for (var i = 0; i < playerOrder.length; i++) {
    players[playerOrder[i]] = { ws: null, connected: false, ready: false, token: generateToken() };
  }
  rooms[code] = {
    code: code,
    playerCount: playerCount,
    playerOrder: playerOrder,
    players: players,
    game: null,
    createdAt: Date.now(),
    reconnectTimers: {}
  };
  return rooms[code];
}

function getRoom(code) { return rooms[code] || null; }

function deleteRoom(code) {
  var room = rooms[code];
  if (!room) return;
  // 清除所有重连计时器
  for (var pid in room.reconnectTimers) clearTimeout(room.reconnectTimers[pid]);
  // 通知所有在线玩家
  for (var pid in room.players) {
    var p = room.players[pid];
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify({ type: 'room_closed', reason: 'host_left' })); } catch (e) {}
    }
  }
  delete rooms[code];
}

// ── 广播消息 ──
function broadcast(room, msg) {
  var data = JSON.stringify(msg);
  for (var pid in room.players) {
    var p = room.players[pid];
    if (p.ws && p.ws.readyState === 1) {
      try { p.ws.send(data); } catch (e) {}
    }
  }
}

function sendToPlayer(room, playerId, msg) {
  var p = room.players[playerId];
  if (p && p.ws && p.ws.readyState === 1) {
    try { p.ws.send(JSON.stringify(msg)); } catch (e) {}
  }
}

// ── 获取当前轮玩家 ──
function getCurrentPlayer(room) {
  if (!room.game) return null;
  return room.game.turnOrder[room.game.turnIdx];
}

// ── 推进回合 ──
function advanceTurn(room) {
  var g = room.game;
  var currentPid = getCurrentPlayer(room);
  // 检查当前玩家是否放完了他的所有块
  var assignedCount = g.assignments[currentPid] ? g.assignments[currentPid].length : 0;
  if (g.placedThisTurn[currentPid] < assignedCount) return; // 还没放完

  // 移到下一个玩家
  g.turnIdx++;
  if (g.turnIdx >= g.turnOrder.length) {
    // 所有人都放完了 → 新一轮
    startNewRound(room);
  } else {
    // 轮到下一个
    var nextPid = getCurrentPlayer(room);
    broadcast(room, { type: 'turn_change', turn: nextPid });
  }
}

function startNewRound(room) {
  var g = room.game;
  // 检查游戏是否结束
  if (!canPlaceAny(g.board)) {
    g.gameOver = true;
    broadcast(room, { type: 'game_over', finalScore: g.score, highScore: g.highScore });
    return;
  }
  g.round++;
  // 重新洗牌玩家顺序（每轮随机）
  g.turnOrder = room.playerOrder.slice();
  shuffle(g.turnOrder);
  g.turnIdx = 0;
  // 生成新图形
  var pieceCount = room.playerCount === 3 ? 3 : 4;
  g.pieces = generatePieces(g.board, pieceCount);
  // 重新分配
  g.assignments = assignPieces(g.pieces, g.turnOrder);
  // 重置放置计数
  for (var i = 0; i < g.turnOrder.length; i++) g.placedThisTurn[g.turnOrder[i]] = 0;

  broadcast(room, {
    type: 'pieces_refill',
    pieces: g.pieces,
    assignments: g.assignments,
    turn: g.turnOrder[0],
    round: g.round,
    turnOrder: g.turnOrder
  });
}

// ── WebSocket 服务器 ──
var wss = new WebSocketServer({ server: server });
console.log('多人游戏服务器已启动');
console.log('HTTP + WebSocket: http://localhost:' + PORT);

server.listen(PORT);

wss.on('connection', function (ws) {
  var currentRoom = null;
  var currentPlayerId = null;

  ws.on('message', function (raw) {
    var msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    switch (msg.type) {

    case 'create_room':
      if (currentRoom) { sendError(ws, '你已在房间中'); return; }
      var pc = msg.playerCount;
      if (pc < 2 || pc > 4) { sendError(ws, '人数必须为2-4'); return; }
      var room = createRoom(pc);
      currentRoom = room.code;
      currentPlayerId = 'A';
      room.players.A.ws = ws;
      room.players.A.connected = true;
      room.game = {
        board: createBoard(),
        score: 0,
        linesCleared: 0,
        combo: 0,
        pieces: [],
        assignments: {},
        turnOrder: [],
        turnIdx: 0,
        round: 0,
        placedThisTurn: {},
        gameOver: false,
        highScore: msg.highScore || 0
      };
      ws.send(JSON.stringify({
        type: 'room_created',
        room: room.code,
        playerId: 'A',
        token: room.players.A.token,
        playerCount: pc
      }));
      console.log('房间创建: ' + room.code + ' (' + pc + '人)');
      break;

    case 'join_room':
      if (currentRoom) { sendError(ws, '你已在房间中'); return; }
      var r = getRoom(msg.room);
      if (!r) { sendError(ws, '房间不存在'); return; }
      // 找到第一个未连接的玩家槽位
      var assigned = null;
      for (var i = 0; i < r.playerOrder.length; i++) {
        var pid = r.playerOrder[i];
        if (!r.players[pid].connected || !r.players[pid].ws || r.players[pid].ws.readyState !== 1) {
          assigned = pid;
          break;
        }
      }
      if (!assigned) { sendError(ws, '房间已满'); return; }
      // 清除该槽位的重连计时器
      if (r.reconnectTimers[assigned]) { clearTimeout(r.reconnectTimers[assigned]); delete r.reconnectTimers[assigned]; }
      currentRoom = msg.room;
      currentPlayerId = assigned;
      r.players[assigned].ws = ws;
      r.players[assigned].connected = true;
      ws.send(JSON.stringify({
        type: 'room_created',
        room: r.code,
        playerId: assigned,
        token: r.players[assigned].token,
        playerCount: r.playerCount,
        existingPlayers: getPlayerStates(r)
      }));
      // 广播玩家加入
      broadcast(r, { type: 'player_joined', playerId: assigned, playerCount: r.playerCount });
      // 发送当前准备状态
      sendReadyUpdate(r);
      // 如果游戏已在进行中，恢复状态给新玩家
      if (r.game && r.game.round > 0) {
        ws.send(JSON.stringify({
          type: 'game_restored',
          board: r.game.board,
          score: r.game.score,
          linesCleared: r.game.linesCleared,
          combo: r.game.combo,
          pieces: r.game.pieces,
          assignments: r.game.assignments,
          turn: getCurrentPlayer(r),
          round: r.game.round,
          turnOrder: r.game.turnOrder,
          placedThisTurn: r.game.placedThisTurn,
          highScore: r.game.highScore
        }));
      }
      console.log('玩家 ' + assigned + ' 加入房间 ' + r.code);
      break;

    case 'reconnect':
      if (currentRoom) { sendError(ws, '你已在房间中'); return; }
      var rr = getRoom(msg.room);
      if (!rr) { sendError(ws, '房间不存在'); return; }
      // 查找匹配 token 的玩家
      var found = null;
      for (var pid in rr.players) {
        if (rr.players[pid].token === msg.token) {
          found = pid; break;
        }
      }
      if (!found) { sendError(ws, '重连凭证无效'); return; }
      // 清除重连计时器
      if (rr.reconnectTimers[found]) { clearTimeout(rr.reconnectTimers[found]); delete rr.reconnectTimers[found]; }
      currentRoom = rr.code;
      currentPlayerId = found;
      rr.players[found].ws = ws;
      rr.players[found].connected = true;
      // 保持准备状态不变
      ws.send(JSON.stringify({
        type: 'room_created',
        room: rr.code,
        playerId: found,
        token: rr.players[found].token,
        playerCount: rr.playerCount
      }));
      sendReadyUpdate(rr);
      broadcast(rr, { type: 'player_reconnected', playerId: found });
      if (rr.game && rr.game.round > 0) {
        ws.send(JSON.stringify({
          type: 'game_restored',
          board: rr.game.board,
          score: rr.game.score,
          linesCleared: rr.game.linesCleared,
          combo: rr.game.combo,
          pieces: rr.game.pieces,
          assignments: rr.game.assignments,
          turn: getCurrentPlayer(rr),
          round: rr.game.round,
          turnOrder: rr.game.turnOrder,
          placedThisTurn: rr.game.placedThisTurn,
          highScore: rr.game.highScore
        }));
      }
      console.log('玩家 ' + found + ' 重连到房间 ' + rr.code);
      break;

    case 'player_ready':
      if (!currentRoom || !currentPlayerId) return;
      var rr2 = getRoom(currentRoom);
      if (!rr2) return;
      rr2.players[currentPlayerId].ready = true;
      sendReadyUpdate(rr2);
      // 检查是否全员准备
      if (allReady(rr2)) {
        startGame(rr2);
      }
      break;

    case 'player_unready':
      if (!currentRoom || !currentPlayerId) return;
      var rr3 = getRoom(currentRoom);
      if (!rr3) return;
      rr3.players[currentPlayerId].ready = false;
      sendReadyUpdate(rr3);
      break;

    case 'place_piece':
      if (!currentRoom || !currentPlayerId) return;
      var rr4 = getRoom(currentRoom);
      if (!rr4 || !rr4.game) return;
      var g = rr4.game;
      if (g.gameOver) { sendError(ws, '游戏已结束'); return; }
      var turn = getCurrentPlayer(rr4);
      if (currentPlayerId !== turn) { sendError(ws, '还没轮到你'); return; }
      // 检查这个图形是否分配给当前玩家
      var myPieces = g.assignments[currentPlayerId] || [];
      if (myPieces.indexOf(msg.shapeIdx) === -1) { sendError(ws, '这块图形不属于你'); return; }
      // 检查是否已经放完本轮
      if (g.placedThisTurn[currentPlayerId] >= myPieces.length) { sendError(ws, '你本轮已放完'); return; }
      // 放到棋盘
      var matrix = SHAPES[msg.shapeIdx];
      var row = msg.row, col = msg.col;
      if (!canPlace(g.board, matrix, row, col)) { sendError(ws, '无法放置在此位置'); return; }
      // 执行放置
      var colorIdx = msg.shapeIdx;
      for (var r = 0; r < matrix.length; r++)
        for (var c = 0; c < matrix[r].length; c++)
          if (matrix[r][c]) g.board[row + r][col + c] = '#' + colorIdx;
      var cellCnt = 0;
      for (var rr = 0; rr < matrix.length; rr++)
        for (var cc = 0; cc < matrix[rr].length; cc++)
          if (matrix[rr][cc]) cellCnt++;
      g.score += cellCnt * 5;
      g.placedThisTurn[currentPlayerId]++;

      // 检测消除
      var clears = checkClears(g.board);
      if (clears.total > 0) {
        applyClears(g.board, clears.rows, clears.cols);
        var base = { 1: 100, 2: 300, 3: 600, 4: 1000, 5: 1500, 6: 2100, 7: 2800, 8: 3600 };
        g.score += (base[clears.total] || clears.total * 500) * (g.combo + 1);
        g.combo++;
        g.linesCleared += clears.total;
      } else {
        g.combo = 0;
      }

      // 更新最高分
      if (g.score > g.highScore) g.highScore = g.score;

      broadcast(rr4, {
        type: 'board_update',
        board: g.board,
        score: g.score,
        linesCleared: g.linesCleared,
        combo: g.combo,
        clearingRows: clears.rows,
        clearingCols: clears.cols
      });

      // 检查推进
      var assignedCount = g.assignments[currentPlayerId] ? g.assignments[currentPlayerId].length : 0;
      if (g.placedThisTurn[currentPlayerId] >= assignedCount) {
        // 当前玩家放完了
        advanceTurn(rr4);
      }
      break;

    case 'leave_room':
      if (!currentRoom || !currentPlayerId) return;
      var rr5 = getRoom(currentRoom);
      if (!rr5) return;
      if (currentPlayerId === 'A') {
        // 房主退出 → 销毁房间
        deleteRoom(currentRoom);
        console.log('房主退出，房间 ' + currentRoom + ' 已销毁');
      } else {
        // 非房主退出 → 标记断开，保留房间
        rr5.players[currentPlayerId].connected = false;
        rr5.players[currentPlayerId].ws = null;
        if (rr5.game) rr5.players[currentPlayerId].ready = true; // 游戏中保持ready
        broadcast(rr5, { type: 'player_disconnected', playerId: currentPlayerId });
        // 设置重连超时
        rr5.reconnectTimers[currentPlayerId] = setTimeout(function () {
          var r = getRoom(currentRoom);
          if (r && !r.players[currentPlayerId].connected) {
            broadcast(r, { type: 'player_disconnected', playerId: currentPlayerId, timeout: true });
          }
        }, RECONNECT_TIMEOUT);
        console.log('玩家 ' + currentPlayerId + ' 离开房间 ' + currentRoom);
      }
      currentRoom = null;
      currentPlayerId = null;
      break;

    default:
      // 未知消息类型，忽略
      break;
    }
  });

  ws.on('close', function () {
    if (!currentRoom || !currentPlayerId) return;
    var rr6 = getRoom(currentRoom);
    if (!rr6) return;
    if (currentPlayerId === 'A') {
      // 房主断开不立即销毁，给重连机会
      rr6.players.A.connected = false;
      rr6.players.A.ws = null;
      broadcast(rr6, { type: 'player_disconnected', playerId: 'A' });
      rr6.reconnectTimers.A = setTimeout(function () {
        var r = getRoom(currentRoom);
        if (r && !r.players.A.connected) {
          deleteRoom(currentRoom);
          console.log('房主 ' + currentRoom + ' 超时未重连，房间销毁');
        }
      }, RECONNECT_TIMEOUT);
    } else {
      rr6.players[currentPlayerId].connected = false;
      rr6.players[currentPlayerId].ws = null;
      broadcast(rr6, { type: 'player_disconnected', playerId: currentPlayerId });
      rr6.reconnectTimers[currentPlayerId] = setTimeout(function () {
        var r = getRoom(currentRoom);
        if (r && !r.players[currentPlayerId].connected) {
          broadcast(r, { type: 'player_disconnected', playerId: currentPlayerId, timeout: true });
        }
      }, RECONNECT_TIMEOUT);
    }
  });

  ws.on('error', function () {}); // 静默处理
});

// ── 辅助函数 ──
function sendError(ws, msg) {
  try { ws.send(JSON.stringify({ type: 'error', message: msg })); } catch (e) {}
}

function sendReadyUpdate(room) {
  var ready = {};
  for (var pid in room.players) ready[pid] = room.players[pid].ready;
  broadcast(room, { type: 'ready_update', ready: ready });
}

function allReady(room) {
  for (var i = 0; i < room.playerOrder.length; i++) {
    var pid = room.playerOrder[i];
    if (!room.players[pid].connected || !room.players[pid].ready) return false;
  }
  return true;
}

function getPlayerStates(room) {
  var states = {};
  for (var pid in room.players) {
    states[pid] = { connected: room.players[pid].connected, ready: room.players[pid].ready };
  }
  return states;
}

function startGame(room) {
  // 重置游戏状态
  room.game.board = createBoard();
  room.game.score = 0;
  room.game.linesCleared = 0;
  room.game.combo = 0;
  room.game.round = 0;
  room.game.gameOver = false;
  // 随机初始玩家顺序
  room.game.turnOrder = room.playerOrder.slice();
  shuffle(room.game.turnOrder);
  room.game.turnIdx = 0;
  // 初始化放置计数
  room.game.placedThisTurn = {};
  for (var i = 0; i < room.game.turnOrder.length; i++) room.game.placedThisTurn[room.game.turnOrder[i]] = 0;
  // 生成图形
  var pieceCount = room.playerCount === 3 ? 3 : 4;
  room.game.pieces = generatePieces(room.game.board, pieceCount);
  room.game.assignments = assignPieces(room.game.pieces, room.game.turnOrder);
  room.game.round = 1;

  // 发送 game_started 给每个玩家（playerId 各自不同）
  for (var i = 0; i < room.playerOrder.length; i++) {
    var pid = room.playerOrder[i];
    sendToPlayer(room, pid, {
      type: 'game_started',
      playerId: pid,
      board: room.game.board,
      score: room.game.score,
      pieces: room.game.pieces,
      assignments: room.game.assignments,
      turn: room.game.turnOrder[0],
      round: room.game.round,
      turnOrder: room.game.turnOrder,
      highScore: room.game.highScore
    });
  }
  console.log('房间 ' + room.code + ' 游戏开始 (' + room.playerCount + '人)');
}

// ── 定时清理 ──
setInterval(function () {
  var now = Date.now();
  for (var code in rooms) {
    var room = rooms[code];
    // 清理超过1小时的空房间
    var allDisconnected = true;
    for (var pid in room.players) {
      if (room.players[pid].connected) { allDisconnected = false; break; }
    }
    if (allDisconnected && (now - room.createdAt > RECONNECT_TIMEOUT)) {
      deleteRoom(code);
      console.log('清理过期房间: ' + code);
    }
  }
}, CLEANUP_INTERVAL);
