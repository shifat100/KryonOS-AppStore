/* =========================================================
   Cheese Chase (Tom & Jerry style) for KryonOS (Duktape ES5.1)
   ========================================================= */

var G = (typeof System !== "undefined" && typeof System.fillScreen === "function")
  ? System
  : (typeof Graphics !== "undefined" ? Graphics : System);

var FM = (typeof FastMath !== "undefined") ? FastMath : Math;
var GLOBAL_OBJ = (function () { return this; })();

var SCREEN_W = 320;
var SCREEN_H = 240;

/* ---------------------------------------------------------
   1. RUNTIME & HAL AUTO-DISCOVERY ADAPTER
   --------------------------------------------------------- */
var touchModeLabel = "T:NONE";
var touchDiscoveredKeys = "";
var _touchReaderFn = null;
var _cbTouch = { active: false, x: 0, y: 0, ts: 0 };
var _touchState = { pressed: false, x: 0, y: 0 };

function nowMs() {
  if (typeof System !== "undefined" && typeof System.millis === "function") {
    return System.millis();
  }
  return Date.now();
}

function halInitScreenSize() {
  var objs = [];
  if (typeof Display !== "undefined") objs.push(Display);
  if (typeof Device !== "undefined") objs.push(Device);
  if (typeof System !== "undefined") objs.push(System);

  var i, o, w, h;
  for (i = 0; i < objs.length; i++) {
    o = objs[i];
    if (!o) continue;
    w = 0; h = 0;
    if (typeof o.getWidth === "function") w = o.getWidth();
    else if (typeof o.getScreenWidth === "function") w = o.getScreenWidth();
    else if (typeof o.width === "function") w = o.width();
    else if (typeof o.width === "number") w = o.width;
    else if (typeof o.screenWidth === "number") w = o.screenWidth;

    if (typeof o.getHeight === "function") h = o.getHeight();
    else if (typeof o.getScreenHeight === "function") h = o.getScreenHeight();
    else if (typeof o.height === "function") h = o.height();
    else if (typeof o.height === "number") h = o.height;
    else if (typeof o.screenHeight === "number") h = o.screenHeight;

    if (w >= 64 && h >= 64) {
      SCREEN_W = w | 0;
      SCREEN_H = h | 0;
      return;
    }
  }
}

var _flagKeys = ["pressed", "touched", "down", "isTouched", "isPressed", "active", "valid", "state", "status", "isDown", "hit"];

function parseTouchResult(res, out) {
  if (!res || typeof res !== "object") return false;

  if (typeof res.length === "number") {
    if (res.length >= 3) {
      if (!res[0]) return false;
      out.pressed = true;
      out.x = Number(res[1]) || 0;
      out.y = Number(res[2]) || 0;
      return true;
    }
    if (res.length === 2) {
      var ax = Number(res[0]);
      var ay = Number(res[1]);
      if (!isNaN(ax) && !isNaN(ay) && ax >= 0 && ay >= 0 && !(ax === 0 && ay === 0)) {
        out.pressed = true;
        out.x = ax;
        out.y = ay;
        return true;
      }
    }
    return false;
  }

  var hasFlag = false;
  var isDown = false;
  var i, k;
  for (i = 0; i < _flagKeys.length; i++) {
    k = _flagKeys[i];
    if (typeof res[k] !== "undefined") {
      hasFlag = true;
      if (res[k]) isDown = true;
      break;
    }
  }

  if (hasFlag) {
    if (!isDown) return false;
    out.pressed = true;
    out.x = (typeof res.x === "number") ? res.x : ((typeof res.tx === "number") ? res.tx : 0);
    out.y = (typeof res.y === "number") ? res.y : ((typeof res.ty === "number") ? res.ty : 0);
    return true;
  }

  if (typeof res.z === "number") {
    if (res.z <= 0) return false;
    out.pressed = true;
    out.x = res.x || 0;
    out.y = res.y || 0;
    return true;
  }

  if (typeof res.x === "number" && typeof res.y === "number" && res.x >= 0 && res.y >= 0) {
    if (res.x === 0 && res.y === 0) return false;
    out.pressed = true;
    out.x = res.x;
    out.y = res.y;
    return true;
  }

  return false;
}

function tryBindPairedTouch(obj, label) {
  if (!obj) return null;
  var stateNames = ["isTouched", "touched", "isPressed", "pressed", "isDown", "available", "hasTouch"];
  var xNames = ["getX", "getTouchX", "touchX", "x"];
  var yNames = ["getY", "getTouchY", "touchY", "y"];
  var stateFn = null;
  var i, xFn = null, yFn = null, xProp = null, yProp = null;

  for (i = 0; i < stateNames.length; i++) {
    if (typeof obj[stateNames[i]] === "function") {
      stateFn = stateNames[i];
      break;
    }
  }
  if (!stateFn) return null;

  for (i = 0; i < xNames.length; i++) {
    if (typeof obj[xNames[i]] === "function" && typeof obj[yNames[i]] === "function") {
      xFn = xNames[i];
      yFn = yNames[i];
      break;
    }
  }
  if (!xFn && typeof obj.x === "number" && typeof obj.y === "number") {
    xProp = "x"; yProp = "y";
  }
  if (!xFn && !xProp) return null;

  touchModeLabel = label + "." + stateFn;
  return function (out) {
    if (!obj[stateFn]()) return false;
    out.pressed = true;
    if (xFn) {
      out.x = Number(obj[xFn]()) || 0;
      out.y = Number(obj[yFn]()) || 0;
    } else {
      out.x = Number(obj[xProp]) || 0;
      out.y = Number(obj[yProp]) || 0;
    }
    return true;
  };
}

function tryBindPointTouch(obj, label, fnList) {
  if (!obj) return null;
  var i, fn;
  for (i = 0; i < fnList.length; i++) {
    fn = fnList[i];
    if (typeof obj[fn] === "function") {
      touchModeLabel = label + "." + fn;
      return (function (targetObj, methodName) {
        return function (out) {
          var res = targetObj[methodName]();
          return parseTouchResult(res, out);
        };
      })(obj, fn);
    }
  }
  return null;
}

function tryBindTouchCallback(obj, label) {
  if (!obj) return false;
  var cbNames = ["onTouch", "onTap", "onPress", "setTouchCallback"];
  var i, name;
  for (i = 0; i < cbNames.length; i++) {
    name = cbNames[i];
    if (typeof obj[name] === "function") {
      try {
        obj[name](function (a, b, c) {
          if (typeof a === "object" && a) {
            _cbTouch.x = a.x || 0;
            _cbTouch.y = a.y || 0;
            _cbTouch.active = (typeof a.pressed !== "undefined") ? !!a.pressed :
              ((typeof a.touched !== "undefined") ? !!a.touched : true);
          } else if (typeof a === "number" && typeof b === "number") {
            _cbTouch.x = a;
            _cbTouch.y = b;
            _cbTouch.active = (typeof c !== "undefined") ? !!c : true;
          }
          _cbTouch.ts = nowMs();
        });
        touchModeLabel = label + "." + name;
        return true;
      } catch (e) {}
    }
  }
  return false;
}

function scanObjectKeys(obj, prefix, outArr) {
  if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return;
  try {
    var names = Object.getOwnPropertyNames(obj);
    var i, k, low;
    for (i = 0; i < names.length; i++) {
      k = names[i];
      low = k.toLowerCase();
      if (low.indexOf("touch") >= 0 || low.indexOf("input") >= 0 || low.indexOf("tap") >= 0 || low.indexOf("point") >= 0) {
        outArr.push(prefix + k);
      }
    }
  } catch (e) {}
}

function discoverHAL() {
  halInitScreenSize();

  var candidates = [];
  if (typeof Touch !== "undefined") candidates.push({ obj: Touch, name: "Touch", generic: true });
  if (typeof System !== "undefined" && typeof System.touch !== "undefined") candidates.push({ obj: System.touch, name: "Sys.touch", generic: true });
  if (typeof Input !== "undefined") candidates.push({ obj: Input, name: "Input", generic: true });
  if (typeof System !== "undefined" && typeof System.input !== "undefined") candidates.push({ obj: System.input, name: "Sys.input", generic: true });
  if (typeof System !== "undefined") candidates.push({ obj: System, name: "System", generic: false });
  if (typeof Display !== "undefined") candidates.push({ obj: Display, name: "Display", generic: false });

  var genericFns = ["getTouch", "readTouch", "getTouchPoint", "getPoint", "getXY", "getState", "read", "get", "poll", "sample", "touch"];
  var specificFns = ["getTouch", "readTouch", "getTouchPoint", "pollTouch", "touch"];

  var i, c, fn;
  for (i = 0; i < candidates.length; i++) {
    c = candidates[i];
    fn = tryBindPointTouch(c.obj, c.name, c.generic ? genericFns : specificFns);
    if (fn) { _touchReaderFn = fn; break; }
    fn = tryBindPairedTouch(c.obj, c.name);
    if (fn) { _touchReaderFn = fn; break; }
  }

  var cbAttached = false;
  for (i = 0; i < candidates.length; i++) {
    if (tryBindTouchCallback(candidates[i].obj, candidates[i].name)) {
      cbAttached = true;
      break;
    }
  }

  var found = [];
  scanObjectKeys(GLOBAL_OBJ, "G:", found);
  if (typeof System !== "undefined") scanObjectKeys(System, "S:", found);
  if (typeof Touch !== "undefined") scanObjectKeys(Touch, "T:", found);
  if (typeof Display !== "undefined") scanObjectKeys(Display, "D:", found);
  if (typeof Input !== "undefined") scanObjectKeys(Input, "I:", found);
  touchDiscoveredKeys = found.slice(0, 6).join(" ");

  if (!_touchReaderFn && !cbAttached) {
    touchModeLabel = found.length > 0 ? ("?" + found[0]) : "T:NONE";
  }
}

function halReadTouch(now) {
  _touchState.pressed = false;
  if (_touchReaderFn) {
    try {
      if (_touchReaderFn(_touchState)) return _touchState;
    } catch (e) {}
  }
  if (_cbTouch.active && (now - _cbTouch.ts) < 250) {
    _touchState.pressed = true;
    _touchState.x = _cbTouch.x;
    _touchState.y = _cbTouch.y;
    return _touchState;
  }
  return _touchState;
}

function halReadKey() {
  var k = null;
  if (typeof Keyboard !== "undefined") {
    if (typeof Keyboard.read === "function") k = Keyboard.read();
    else if (typeof Keyboard.getKey === "function") k = Keyboard.getKey();
    else if (typeof Keyboard.available === "function" && Keyboard.available()) {
      k = (typeof Keyboard.getChar === "function") ? Keyboard.getChar() : null;
    }
  } else if (typeof System !== "undefined" && typeof System.getKey === "function") {
    k = System.getKey();
  }
  if (!k) return "";
  if (typeof k === "object") {
    if (k.key) return String(k.key);
    if (k.char) return String(k.char);
    if (typeof k.code === "number" && k.code > 0) return String.fromCharCode(k.code);
    return "";
  }
  return String(k);
}

var _tbState = { dx: 0, dy: 0, click: false };

function halReadTrackball() {
  _tbState.dx = 0;
  _tbState.dy = 0;
  _tbState.click = false;
  if (typeof Trackball === "undefined") return _tbState;

  var r = null;
  if (typeof Trackball.read === "function") r = Trackball.read();
  else if (typeof Trackball.get === "function") r = Trackball.get();
  else if (typeof Trackball.poll === "function") r = Trackball.poll();

  if (r) {
    if (r.up) _tbState.dy = -1;
    else if (r.down) _tbState.dy = 1;
    else if (typeof r.dy === "number") _tbState.dy = r.dy;

    if (r.left) _tbState.dx = -1;
    else if (r.right) _tbState.dx = 1;
    else if (typeof r.dx === "number") _tbState.dx = r.dx;

    _tbState.click = !!(r.click || r.enter || r.pressed);
  }
  return _tbState;
}

/* ---------------------------------------------------------
   2. COLOR PALETTE & DOUBLE-BUFFER GRAPHICS (RGB565)
   --------------------------------------------------------- */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rgb565(r, g, b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

var C_BG         = rgb565(248, 241, 224);
var C_FLOOR_LINE = rgb565(235, 224, 200);
var C_HUD_BG     = rgb565(42, 34, 28);
var C_HUD_BDR    = rgb565(92, 74, 58);

var C_WALL_BASE  = rgb565(126, 84, 52);
var C_WALL_TOP   = rgb565(166, 118, 76);
var C_WALL_DARK  = rgb565(84, 52, 30);

var C_HOLE_ARCH  = rgb565(32, 22, 16);
var C_HOLE_RIM   = rgb565(150, 102, 62);

var C_CHEESE     = rgb565(255, 204, 34);
var C_CHEESE_RIND= rgb565(222, 152, 14);
var C_CHEESE_HOLE= rgb565(198, 134, 12);

var C_TRAP_WOOD  = rgb565(178, 122, 68);
var C_TRAP_WIRE  = rgb565(190, 198, 210);
var C_TRAP_BAIT  = rgb565(228, 52, 42);

var C_PEPPER     = rgb565(242, 48, 32);
var C_PEPPER_HI  = rgb565(255, 142, 60);
var C_LEAF       = rgb565(58, 178, 66);

var C_JERRY      = rgb565(176, 108, 56);
var C_JERRY_DARK = rgb565(128, 72, 32);
var C_JERRY_PINK = rgb565(246, 162, 168);
var C_JERRY_PWR  = rgb565(255, 118, 24);
var C_JERRY_PWR2 = rgb565(255, 214, 72);

var C_TOM        = rgb565(104, 126, 158);
var C_TOM_LIGHT  = rgb565(146, 166, 194);
var C_BUTCH      = rgb565(64, 68, 78);
var C_BUTCH_LIGHT= rgb565(110, 116, 128);
var C_CAT_SCARED = rgb565(64, 118, 238);
var C_CAT_EYE    = rgb565(240, 222, 58);

var C_WHITE      = rgb565(255, 255, 255);
var C_BLACK      = rgb565(18, 18, 18);
var C_HEART      = rgb565(238, 54, 68);
var C_GOLD       = rgb565(255, 214, 52);
var C_CYAN       = rgb565(90, 210, 255);

var renderMode = "direct";

function initDoubleBuffer() {
  if (typeof Kryon3D !== "undefined" && typeof Kryon3D.begin === "function") {
    if (Kryon3D.begin(SCREEN_W, SCREEN_H, 16)) {
      renderMode = "k3d";
      return;
    }
  }
  if (typeof G.createSprite === "function" && typeof G.bindSprite === "function") {
    try {
      if (G.createSprite(SCREEN_W, SCREEN_H)) {
        G.bindSprite(true);
        renderMode = "sprite";
        return;
      }
    } catch (e) {}
  }
  renderMode = "direct";
}

function releaseDoubleBuffer() {
  if (renderMode === "k3d" && typeof Kryon3D !== "undefined" && typeof Kryon3D.end === "function") {
    Kryon3D.end();
  } else if (renderMode === "sprite" && typeof G.bindSprite === "function") {
    G.bindSprite(false);
  }
}

function beginFrame(bgColor) {
  if (renderMode === "k3d") Kryon3D.clear(bgColor);
  else G.fillScreen(bgColor);
}

function endFrame() {
  if (renderMode === "k3d") Kryon3D.render(0, 0);
  else if (renderMode === "sprite" && typeof G.pushSprite === "function") G.pushSprite(0, 0);
}

function gDrawPixel(x, y, c) {
  x = x | 0; y = y | 0;
  if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return;
  G.drawPixel(x, y, c);
}

function gDrawLine(x0, y0, x1, y1, c) {
  G.drawLine(x0 | 0, y0 | 0, x1 | 0, y1 | 0, c);
}

function gFillRect(x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  G.fillRect(x | 0, y | 0, w | 0, h | 0, c);
}

function gDrawRect(x, y, w, h, c) {
  x = x | 0; y = y | 0; w = w | 0; h = h | 0;
  if (w <= 0 || h <= 0) return;
  if (typeof G.drawRect === "function") {
    G.drawRect(x, y, w, h, c);
  } else {
    gDrawLine(x, y, x + w - 1, y, c);
    gDrawLine(x, y + h - 1, x + w - 1, y + h - 1, c);
    gDrawLine(x, y, x, y + h - 1, c);
    gDrawLine(x + w - 1, y, x + w - 1, y + h - 1, c);
  }
}

function gDrawRoundRect(x, y, w, h, r, c) {
  if (typeof G.drawRoundRect === "function") {
    G.drawRoundRect(x | 0, y | 0, w | 0, h | 0, r | 0, c);
  } else {
    gDrawRect(x, y, w, h, c);
  }
}

function gFillRoundRect(x, y, w, h, r, c) {
  if (typeof G.fillRoundRect === "function") {
    G.fillRoundRect(x | 0, y | 0, w | 0, h | 0, r | 0, c);
  } else {
    gFillRect(x, y, w, h, c);
  }
}

function gFillCircle(x, y, r, c) {
  r = r | 0;
  if (r <= 0) { gDrawPixel(x, y, c); return; }
  G.fillCircle(x | 0, y | 0, r, c);
}

function gDrawText(txt, x, y, fg, bg, font) {
  if (typeof G.setTextColor === "function") {
    if (typeof bg === "number" && bg >= 0) G.setTextColor(fg, bg);
    else G.setTextColor(fg);
  }
  G.drawString(String(txt), x | 0, y | 0, font || 1);
}

var _qx = [0, 0, 0, 0];
var _qy = [0, 0, 0, 0];

function fillTri(x0, y0, x1, y1, x2, y2, color) {
  _qx[0] = x0; _qy[0] = y0;
  _qx[1] = x1; _qy[1] = y1;
  _qx[2] = x2; _qy[2] = y2;
  _qx[3] = x2; _qy[3] = y2;

  var minY = y0, maxY = y0, i;
  for (i = 1; i < 3; i++) {
    if (_qy[i] < minY) minY = _qy[i];
    if (_qy[i] > maxY) maxY = _qy[i];
  }
  var yStart = Math.max(0, Math.floor(minY));
  var yEnd = Math.min(SCREEN_H - 1, Math.ceil(maxY));

  var y, j, leftX, rightX, ix, yA, yB;
  for (y = yStart; y <= yEnd; y++) {
    leftX = 99999;
    rightX = -99999;
    for (i = 0; i < 4; i++) {
      j = (i + 1) & 3;
      yA = _qy[i]; yB = _qy[j];
      if ((yA <= y && yB > y) || (yB <= y && yA > y)) {
        ix = _qx[i] + ((y - yA) * (_qx[j] - _qx[i])) / (yB - yA);
        if (ix < leftX) leftX = ix;
        if (ix > rightX) rightX = ix;
      }
    }
    if (leftX <= rightX) {
      if (rightX < 0 || leftX >= SCREEN_W) continue;
      if (leftX < 0) leftX = 0;
      if (rightX >= SCREEN_W) rightX = SCREEN_W - 1;
      gDrawLine(Math.round(leftX), y, Math.round(rightX), y, color);
    }
  }
}

/* ---------------------------------------------------------
   3. PERSISTENT HIGH SCORE
   --------------------------------------------------------- */
var BEST_FILE = "cheese_best.txt";
var bestScore = 0;

function loadBestScore() {
  try {
    if (typeof FS !== "undefined" && FS.exists(BEST_FILE)) {
      var raw = FS.readTextFile(BEST_FILE);
      if (raw !== null) {
        var parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed >= 0) bestScore = parsed;
      }
    }
  } catch (e) {}
}

function saveBestScore() {
  try {
    if (typeof FS !== "undefined") FS.writeTextFile(BEST_FILE, String(bestScore));
  } catch (e) {}
}

/* ---------------------------------------------------------
   4. MAZE MAPS (15 cols x 11 rows)
   --------------------------------------------------------- */
var MAP_COLS = 15;
var MAP_ROWS = 11;

var MAPS = [
  [
    "###############",
    "#C..C..#..C..C#",
    "#.##.#.#.#.##.#",
    "#..C.C.M.C.C..#",
    "#.##.#.#.#.##.#",
    "H.C..C.P.C..C.H",
    "#.##.#.#.#.##.#",
    "#..C.C.J.C.C..#",
    "#.C..#.#.#..C.#",
    "#C..C..#..C..C#",
    "###############"
  ],
  [
    "###############",
    "#C..C.C.C.C..C#",
    "#.##.##.##.##.#",
    "#..C...M...C..#",
    "#.#.##.#.##.#.#",
    "H.C....P....C.H",
    "#.#.##.#.##.#.#",
    "#..C...J...C..#",
    "#.##.##.##.##.#",
    "#C..C.C.C.C..C#",
    "###############"
  ],
  [
    "###############",
    "#C.B...M...C.C#",
    "#.###.#.#.###.#",
    "#..C..C.C..C..#",
    "#.#.##.#.##.#.#",
    "H.C..C.P.C..C.H",
    "#.#.##.#.##.#.#",
    "#..C..CJC..C..#",
    "#.###.#.#.###.#",
    "#C.C...C...C.C#",
    "###############"
  ]
];

var grid = [];
var cheeses = [];
var traps = [];
var trapTimers = [];

var HUD_H = 22;
var tileSize = 18;
var boardX = 0;
var boardY = HUD_H;
var isPortraitPad = false;

function computeLayout() {
  var availH = SCREEN_H - HUD_H;
  if (SCREEN_H > SCREEN_W) {
    availH = Math.max(120, SCREEN_H - HUD_H - 78);
    isPortraitPad = true;
  } else {
    isPortraitPad = false;
  }
  tileSize = Math.max(10, Math.min(Math.floor(SCREEN_W / MAP_COLS), Math.floor(availH / MAP_ROWS)));
  boardX = (SCREEN_W - MAP_COLS * tileSize) >> 1;
  boardY = HUD_H + ((availH - MAP_ROWS * tileSize) >> 1);
}

/* ---------------------------------------------------------
   5. GAME ENTITIES & STATE
   --------------------------------------------------------- */
var STATE_TITLE = 0;
var STATE_PLAY = 1;
var STATE_LEVEL_CLEAR = 2;
var STATE_GAME_OVER = 3;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;

var level = 1;
var score = 0;
var lives = 3;
var cheeseLeft = 0;

var powerTimer = 0;
var pepper = { active: false, tx: 7, ty: 5, respawn: 0 };
var levelBannerTimer = 0;

var jerry = {
  tx: 7, ty: 7, nx: 7, ny: 7, p: 0,
  dx: 0, dy: 0, qdx: 0, qdy: 0,
  faceX: 1, faceY: 0,
  sx: 7, sy: 7, invuln: 0
};

var cats = [
  { active: false, isButch: false, tx: 7, ty: 3, nx: 7, ny: 3, p: 0, dx: 1, dy: 0, sx: 7, sy: 3, stun: 0, modeTimer: 0 },
  { active: false, isButch: true,  tx: 3, ty: 1, nx: 3, ny: 1, p: 0, dx: 1, dy: 0, sx: 3, sy: 1, stun: 0, modeTimer: 0 }
];

var MAX_FX = 18;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: C_CHEESE });
  }
})();

function spawnFx(gx, gy, color, count) {
  var px = boardX + (gx + 0.5) * tileSize;
  var py = boardY + (gy + 0.5) * tileSize;
  var i, spawned = 0, a, sp, pt;
  for (i = 0; i < MAX_FX && spawned < count; i++) {
    pt = fxPool[i];
    if (!pt.active) {
      a = (6.2831853 * spawned) / count + FM.random() * 0.5;
      sp = 1.0 + FM.random() * 2.2;
      pt.active = true;
      pt.x = px;
      pt.y = py;
      pt.vx = FM.cos(a) * sp;
      pt.vy = FM.sin(a) * sp;
      pt.life = 1.0;
      pt.color = color;
      spawned++;
    }
  }
}

var popups = [
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD }
];

function spawnPopup(gx, gy, txt, color) {
  var i, p;
  for (i = 0; i < popups.length; i++) {
    p = popups[i];
    if (!p.active) {
      p.active = true;
      p.x = boardX + (gx + 0.2) * tileSize;
      p.y = boardY + gy * tileSize;
      p.txt = txt;
      p.life = 1.0;
      p.color = color;
      return;
    }
  }
}

function idx(x, y) {
  return y * MAP_COLS + x;
}

function isWallForJerry(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  return grid[idx(x, y)] === 1;
}

function isWallForCat(x, y) {
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return true;
  return grid[idx(x, y)] !== 0;
}

function countOpenNeighbors(x, y) {
  var c = 0;
  if (!isWallForCat(x + 1, y)) c++;
  if (!isWallForCat(x - 1, y)) c++;
  if (!isWallForCat(x, y + 1)) c++;
  if (!isWallForCat(x, y - 1)) c++;
  return c;
}

function loadLevel(lvl) {
  level = lvl;
  var map = MAPS[(lvl - 1) % MAPS.length];
  var x, y, ch, i;
  cheeseLeft = 0;
  powerTimer = 0;
  pepper.active = false;
  pepper.respawn = 1.0;

  cats[0].active = true;
  cats[1].active = (lvl >= 3);

  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;
  for (i = 0; i < popups.length; i++) popups[i].active = false;

  for (y = 0; y < MAP_ROWS; y++) {
    for (x = 0; x < MAP_COLS; x++) {
      ch = map[y].charAt(x);
      i = idx(x, y);
      cheeses[i] = 0;
      traps[i] = 0;
      trapTimers[i] = 0;

      if (ch === "#") {
        grid[i] = 1;
      } else if (ch === "H") {
        grid[i] = 2;
      } else {
        grid[i] = 0;
        if (ch === "C") {
          cheeses[i] = 1;
          cheeseLeft++;
        } else if (ch === "J") {
          jerry.sx = x; jerry.sy = y;
        } else if (ch === "M") {
          cats[0].sx = x; cats[0].sy = y;
        } else if (ch === "B") {
          cats[1].sx = x; cats[1].sy = y;
        } else if (ch === "P") {
          pepper.tx = x; pepper.ty = y;
          pepper.active = true;
        }
      }
    }
  }

  if (lvl >= 3 && map === MAPS[0]) {
    cats[1].sx = 1; cats[1].sy = 1;
  } else if (lvl >= 3 && map === MAPS[1]) {
    cats[1].sx = 13; cats[1].sy = 1;
  }

  if (lvl >= 2) {
    var wantTraps = Math.min(4, 1 + lvl);
    var candidates = [];
    for (y = 1; y < MAP_ROWS - 1; y++) {
      for (x = 1; x < MAP_COLS - 1; x++) {
        i = idx(x, y);
        if (grid[i] === 0 && countOpenNeighbors(x, y) >= 3 &&
            !(x === pepper.tx && y === pepper.ty) &&
            (Math.abs(x - jerry.sx) + Math.abs(y - jerry.sy) >= 4)) {
          candidates.push(i);
        }
      }
    }
    var placed = 0, pick, tIdx;
    while (placed < wantTraps && candidates.length > 0) {
      pick = Math.floor(FM.random() * candidates.length);
      tIdx = candidates[pick];
      candidates.splice(pick, 1);
      traps[tIdx] = 1;
      placed++;
    }
  }

  resetPositions(true);
}

function resetPositions(clearInvuln) {
  jerry.tx = jerry.sx; jerry.ty = jerry.sy;
  jerry.nx = jerry.sx; jerry.ny = jerry.sy;
  jerry.p = 0; jerry.dx = 0; jerry.dy = 0;
  jerry.qdx = 0; jerry.qdy = 0;
  jerry.faceX = 1; jerry.faceY = 0;
  jerry.invuln = clearInvuln ? 1.2 : 2.0;

  var i, c;
  for (i = 0; i < cats.length; i++) {
    c = cats[i];
    c.tx = c.sx; c.ty = c.sy;
    c.nx = c.sx; c.ny = c.sy;
    c.p = 0;
    c.dx = (i === 0) ? 1 : -1;
    c.dy = 0;
    c.stun = 0;
    c.modeTimer = 0;
  }
}

function startNewGame() {
  score = 0;
  lives = 3;
  isPaused = false;
  gameState = STATE_PLAY;
  loadLevel(1);
}

function queueJerryDir(dx, dy) {
  if (gameState === STATE_TITLE) {
    startNewGame();
  }
  if (gameState !== STATE_PLAY || isPaused) return;
  jerry.qdx = dx;
  jerry.qdy = dy;

  if (jerry.dx === -dx && jerry.dy === -dy && jerry.p > 0) {
    var tmpX = jerry.tx, tmpY = jerry.ty;
    jerry.tx = jerry.nx; jerry.ty = jerry.ny;
    jerry.nx = tmpX; jerry.ny = tmpY;
    jerry.p = 1 - jerry.p;
    jerry.dx = dx; jerry.dy = dy;
    jerry.faceX = dx; jerry.faceY = dy;
  } else if (jerry.dx === 0 && jerry.dy === 0 && !isWallForJerry(jerry.tx + dx, jerry.ty + dy)) {
    jerry.dx = dx; jerry.dy = dy;
    jerry.nx = jerry.tx + dx; jerry.ny = jerry.ty + dy;
    jerry.p = 0;
    jerry.faceX = dx; jerry.faceY = dy;
  }
}

function addScore(pts) {
  score += pts;
  if (score > bestScore) {
    bestScore = score;
    saveBestScore();
  }
}

/* ---------------------------------------------------------
   6. SIMULATION STEP
   --------------------------------------------------------- */
function updateJerry(dt) {
  if (jerry.invuln > 0) jerry.invuln = Math.max(0, jerry.invuln - dt);

  var speed = (powerTimer > 0) ? 6.6 : 5.2;

  if (jerry.dx !== 0 || jerry.dy !== 0) {
    jerry.p += speed * dt;
    while (jerry.p >= 1.0) {
      jerry.p -= 1.0;
      jerry.tx = jerry.nx;
      jerry.ty = jerry.ny;

      if (grid[idx(jerry.tx, jerry.ty)] === 2) {
        if (jerry.tx === 0 && jerry.dx < 0) jerry.tx = MAP_COLS - 2;
        else if (jerry.tx === MAP_COLS - 1 && jerry.dx > 0) jerry.tx = 1;
        spawnFx(jerry.tx, jerry.ty, C_CYAN, 6);
      }

      var ti = idx(jerry.tx, jerry.ty);
      if (cheeses[ti] === 1) {
        cheeses[ti] = 0;
        cheeseLeft--;
        addScore(10);
        spawnFx(jerry.tx, jerry.ty, C_CHEESE, 6);
        spawnPopup(jerry.tx, jerry.ty, "+10", C_GOLD);
        if (cheeseLeft <= 0) {
          addScore(100 * level);
          gameState = STATE_LEVEL_CLEAR;
          levelBannerTimer = 1.4;
          return;
        }
      }

      if (pepper.active && jerry.tx === pepper.tx && jerry.ty === pepper.ty) {
        pepper.active = false;
        pepper.respawn = 12.0;
        powerTimer = 5.5;
        addScore(25);
        spawnFx(jerry.tx, jerry.ty, C_PEPPER_HI, 10);
        spawnPopup(jerry.tx, jerry.ty, "SPICY!", C_PEPPER);
      }

      if (traps[ti] === 1 && jerry.invuln <= 0 && powerTimer <= 0) {
        traps[ti] = -1;
        trapTimers[ti] = 6.0;
        spawnFx(jerry.tx, jerry.ty, C_TRAP_BAIT, 10);
        spawnPopup(jerry.tx, jerry.ty, "SNAP!", C_TRAP_BAIT);
        hurtJerry();
        return;
      }

      if ((jerry.qdx !== 0 || jerry.qdy !== 0) && !isWallForJerry(jerry.tx + jerry.qdx, jerry.ty + jerry.qdy)) {
        jerry.dx = jerry.qdx;
        jerry.dy = jerry.qdy;
        jerry.faceX = jerry.dx;
        jerry.faceY = jerry.dy;
        jerry.nx = jerry.tx + jerry.dx;
        jerry.ny = jerry.ty + jerry.dy;
      } else if (!isWallForJerry(jerry.tx + jerry.dx, jerry.ty + jerry.dy)) {
        jerry.nx = jerry.tx + jerry.dx;
        jerry.ny = jerry.ty + jerry.dy;
      } else {
        jerry.dx = 0;
        jerry.dy = 0;
        jerry.nx = jerry.tx;
        jerry.ny = jerry.ty;
        jerry.p = 0;
        break;
      }
    }
  } else if ((jerry.qdx !== 0 || jerry.qdy !== 0) && !isWallForJerry(jerry.tx + jerry.qdx, jerry.ty + jerry.qdy)) {
    jerry.dx = jerry.qdx;
    jerry.dy = jerry.qdy;
    jerry.faceX = jerry.dx;
    jerry.faceY = jerry.dy;
    jerry.nx = jerry.tx + jerry.dx;
    jerry.ny = jerry.ty + jerry.dy;
    jerry.p = 0;
  }
}

var _dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function chooseCatDir(c, jx, jy) {
  var scared = (powerTimer > 0);
  var targetX = jx;
  var targetY = jy;

  var scatter = ((c.modeTimer % 11.0) > 8.2);
  if (scatter && !scared) {
    targetX = c.isButch ? 1 : (MAP_COLS - 2);
    targetY = c.isButch ? (MAP_ROWS - 2) : 1;
  }

  var bestIdx = -1;
  var bestScoreVal = scared ? -999999 : 999999;
  var i, d, nx, ny, dist, rev;

  for (i = 0; i < 4; i++) {
    d = _dirs[i];
    nx = c.tx + d[0];
    ny = c.ty + d[1];
    if (isWallForCat(nx, ny)) continue;

    rev = (d[0] === -c.dx && d[1] === -c.dy);
    dist = Math.abs(nx - targetX) + Math.abs(ny - targetY);
    if (rev) dist += (scared ? -40 : 40);
    dist += (FM.random() * 0.9);

    if (scared) {
      if (dist > bestScoreVal) { bestScoreVal = dist; bestIdx = i; }
    } else {
      if (dist < bestScoreVal) { bestScoreVal = dist; bestIdx = i; }
    }
  }

  if (bestIdx >= 0) {
    c.dx = _dirs[bestIdx][0];
    c.dy = _dirs[bestIdx][1];
    c.nx = c.tx + c.dx;
    c.ny = c.ty + c.dy;
  } else {
    c.dx = 0; c.dy = 0;
    c.nx = c.tx; c.ny = c.ty;
  }
}

function hurtJerry() {
  lives--;
  if (lives <= 0) {
    gameState = STATE_GAME_OVER;
  } else {
    resetPositions(false);
  }
}

function updateCats(dt) {
  var jx = lerp(jerry.tx, jerry.nx, jerry.p);
  var jy = lerp(jerry.ty, jerry.ny, jerry.p);
  var i, c, speed, cx, cy, ti;

  for (i = 0; i < cats.length; i++) {
    c = cats[i];
    if (!c.active) continue;

    if (c.stun > 0) {
      c.stun = Math.max(0, c.stun - dt);
      continue;
    }

    c.modeTimer += dt;
    if (powerTimer > 0) speed = 3.2;
    else speed = Math.min(5.0, (c.isButch ? 3.8 : 4.1) + (level - 1) * 0.25);

    c.p += speed * dt;
    while (c.p >= 1.0) {
      c.p -= 1.0;
      c.tx = c.nx;
      c.ty = c.ny;

      ti = idx(c.tx, c.ty);
      if (traps[ti] === 1) {
        traps[ti] = -1;
        trapTimers[ti] = 6.0;
        c.stun = 3.5;
        c.p = 0;
        addScore(50);
        spawnFx(c.tx, c.ty, C_GOLD, 10);
        spawnPopup(c.tx, c.ty, "TRAP +50", C_GOLD);
        break;
      }

      chooseCatDir(c, jx, jy);
    }

    cx = lerp(c.tx, c.nx, c.p);
    cy = lerp(c.ty, c.ny, c.p);
    if (Math.abs(jx - cx) < 0.62 && Math.abs(jy - cy) < 0.62) {
      if (powerTimer > 0) {
        c.stun = 4.0;
        c.tx = c.sx; c.ty = c.sy;
        c.nx = c.sx; c.ny = c.sy;
        c.p = 0;
        addScore(50);
        spawnFx(cx, cy, C_GOLD, 12);
        spawnPopup(cx, cy, "BONK +50", C_GOLD);
      } else if (jerry.invuln <= 0) {
        spawnFx(jx, jy, C_HEART, 10);
        hurtJerry();
        return;
      }
    }
  }
}

function updateSimulation(dt) {
  var i, pt, pp;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (!pt.active) continue;
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life -= dt * 2.2;
    if (pt.life <= 0) pt.active = false;
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (!pp.active) continue;
    pp.y -= dt * 16;
    pp.life -= dt * 1.25;
    if (pp.life <= 0) pp.active = false;
  }

  if (gameState === STATE_LEVEL_CLEAR) {
    levelBannerTimer -= dt;
    if (levelBannerTimer <= 0) {
      gameState = STATE_PLAY;
      loadLevel(level + 1);
    }
    return;
  }

  if (gameState !== STATE_PLAY || isPaused) return;

  if (powerTimer > 0) powerTimer = Math.max(0, powerTimer - dt);

  if (!pepper.active) {
    pepper.respawn -= dt;
    if (pepper.respawn <= 0) pepper.active = true;
  }

  for (i = 0; i < traps.length; i++) {
    if (traps[i] === -1) {
      trapTimers[i] -= dt;
      if (trapTimers[i] <= 0) traps[i] = 1;
    }
  }

  updateJerry(dt);
  if (gameState === STATE_PLAY) updateCats(dt);
}

/* ---------------------------------------------------------
   7. DRAWING SPRITES & BOARD
   --------------------------------------------------------- */
function drawCheese(px, py, ts, now) {
  var bob = FM.sin(now * 0.006 + px * 0.2) * 1.3;
  var pad = Math.max(2, (ts * 0.16) | 0);
  var x0 = px + pad;
  var y0 = py + ts - pad + bob;
  var x1 = px + ts - pad;
  var y1 = py + ts - pad - 2 + bob;
  var x2 = px + (ts * 0.35) + bob * 0.2;
  var y2 = py + pad + 1 + bob;

  fillTri(x0, y0, x1, y1, x2, y2, C_CHEESE);
  gDrawLine(x0, y0, x1, y1, C_CHEESE_RIND);
  gDrawLine(x0, y0 + 1, x1, y1 + 1, C_CHEESE_RIND);
  var hr = Math.max(1, (ts * 0.09) | 0);
  gFillCircle(px + ts * 0.45, py + ts * 0.62 + bob, hr, C_CHEESE_HOLE);
  gFillCircle(px + ts * 0.65, py + ts * 0.72 + bob, Math.max(1, hr - 1), C_CHEESE_HOLE);
}

function drawMousetrap(px, py, ts, armed) {
  var mx = px + 3;
  var my = py + (ts >> 2) + 1;
  var mw = ts - 6;
  var mh = Math.max(6, (ts >> 1));
  gFillRect(mx, my, mw, mh, C_TRAP_WOOD);
  gDrawRect(mx, my, mw, mh, C_WALL_DARK);
  if (armed) {
    gDrawRect(mx + 2, my + 2, mw - 4, mh - 4, C_TRAP_WIRE);
    gFillCircle(px + (ts >> 1) + 1, py + (ts >> 1), Math.max(1, (ts * 0.11) | 0), C_TRAP_BAIT);
  } else {
    gDrawLine(mx + 1, my, mx + mw - 1, my + mh, C_TRAP_WIRE);
  }
}

function drawPepper(px, py, ts, now) {
  var pulse = FM.sin(now * 0.008) * 1.5;
  var cx = px + (ts >> 1);
  var cy = py + (ts >> 1) + pulse;
  var r = Math.max(3, (ts * 0.27) | 0);
  gFillCircle(cx - 1, cy + 1, r, C_PEPPER);
  gFillCircle(cx + 2, cy - 1, Math.max(2, r - 1), C_PEPPER_HI);
  gFillRect(cx + 1, cy - r - 2, 3, 3, C_LEAF);
}

function drawJerrySprite(gx, gy, now) {
  var cx = boardX + (gx + 0.5) * tileSize;
  var cy = boardY + (gy + 0.5) * tileSize;

  if (jerry.invuln > 0 && (((now / 90) | 0) & 1) === 1) return;

  var pwr = (powerTimer > 0);
  var bodyC = pwr ? ((((now / 80) | 0) & 1) ? C_JERRY_PWR : C_JERRY_PWR2) : C_JERRY;
  var earC  = pwr ? C_PEPPER : C_JERRY_DARK;

  var r = Math.max(4, (tileSize * 0.34) | 0);
  var er = Math.max(2, (tileSize * 0.19) | 0);

  var wag = FM.sin(now * 0.02) * 2.5;
  gDrawLine(
    cx - jerry.faceX * r, cy - jerry.faceY * r,
    cx - jerry.faceX * (r + 5) + jerry.faceY * wag,
    cy - jerry.faceY * (r + 5) + jerry.faceX * wag,
    C_JERRY_PINK
  );

  gFillCircle(cx - r * 0.65, cy - r * 0.65, er, earC);
  gFillCircle(cx + r * 0.65, cy - r * 0.65, er, earC);
  gFillCircle(cx - r * 0.65, cy - r * 0.65, Math.max(1, er - 1), C_JERRY_PINK);
  gFillCircle(cx + r * 0.65, cy - r * 0.65, Math.max(1, er - 1), C_JERRY_PINK);

  gFillCircle(cx, cy + 1, r, bodyC);

  gFillCircle(cx - r * 0.35 + jerry.faceX, cy - 1 + jerry.faceY, 1, C_BLACK);
  gFillCircle(cx + r * 0.35 + jerry.faceX, cy - 1 + jerry.faceY, 1, C_BLACK);
  gFillCircle(cx + jerry.faceX * (r * 0.45), cy + 2 + jerry.faceY * (r * 0.4), Math.max(1, (r * 0.24) | 0), C_JERRY_PINK);
}

function drawCatSprite(c, now) {
  var gx = lerp(c.tx, c.nx, c.p);
  var gy = lerp(c.ty, c.ny, c.p);
  var cx = boardX + (gx + 0.5) * tileSize;
  var cy = boardY + (gy + 0.5) * tileSize;

  var scared = (powerTimer > 0);
  var bodyC = scared ? C_CAT_SCARED : (c.isButch ? C_BUTCH : C_TOM);
  var muzzleC = scared ? C_WHITE : (c.isButch ? C_BUTCH_LIGHT : C_TOM_LIGHT);
  var r = Math.max(5, (tileSize * 0.40) | 0);

  fillTri(cx - r, cy - 2, cx - r * 0.25, cy - r * 0.55, cx - r * 0.85, cy - r * 1.25, bodyC);
  fillTri(cx + r, cy - 2, cx + r * 0.25, cy - r * 0.55, cx + r * 0.85, cy - r * 1.25, bodyC);

  gFillCircle(cx, cy + 1, r, bodyC);
  gFillCircle(cx, cy + 3, Math.max(2, (r * 0.48) | 0), muzzleC);

  var eyeC = scared ? C_WHITE : C_CAT_EYE;
  gFillCircle(cx - r * 0.38, cy - 1, Math.max(1, (r * 0.24) | 0), eyeC);
  gFillCircle(cx + r * 0.38, cy - 1, Math.max(1, (r * 0.24) | 0), eyeC);
  gDrawPixel(cx - r * 0.38, cy - 1, C_BLACK);
  gDrawPixel(cx + r * 0.38, cy - 1, C_BLACK);

  gDrawLine(cx - r - 2, cy + 2, cx - 3, cy + 2, C_WHITE);
  gDrawLine(cx + 3, cy + 2, cx + r + 2, cy + 2, C_WHITE);

  if (c.stun > 0) {
    var a1 = now * 0.012;
    gFillCircle(cx + FM.cos(a1) * r, cy - r - 2, 2, C_GOLD);
    gFillCircle(cx + FM.cos(a1 + 3.14) * r, cy - r - 2, 2, C_GOLD);
  }
}

function drawHUD() {
  gFillRect(0, 0, SCREEN_W, HUD_H, C_HUD_BG);
  gDrawLine(0, HUD_H - 1, SCREEN_W, HUD_H - 1, C_HUD_BDR);

  gFillRoundRect(4, 3, 20, 16, 4, C_HUD_BDR);
  gDrawText("X", 11, 7, C_WHITE, C_HUD_BDR, 1);

  gFillRoundRect(27, 3, 18, 16, 4, showTouchDebug ? C_PEPPER : C_HUD_BDR);
  gDrawText("?", 33, 7, C_WHITE, showTouchDebug ? C_PEPPER : C_HUD_BDR, 1);

  var i, hx;
  for (i = 0; i < 3; i++) {
    hx = 54 + i * 13;
    gFillCircle(hx, 10, 4, i < lives ? C_HEART : C_HUD_BDR);
  }

  gDrawText("L" + level, 96, 7, C_GOLD, C_HUD_BG, 1);

  var scTxt = "S:" + score + " B:" + bestScore;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 6, 7, C_WHITE, C_HUD_BG, 1);

  if (isPortraitPad) {
    var dcx = SCREEN_W >> 1;
    var dcy = SCREEN_H - 39;
    gFillRoundRect(dcx - 20, dcy - 34, 40, 24, 6, C_HUD_BG);
    gDrawText("U", dcx - 3, dcy - 26, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(dcx - 20, dcy + 10, 40, 24, 6, C_HUD_BG);
    gDrawText("D", dcx - 3, dcy + 18, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(dcx - 66, dcy - 12, 40, 24, 6, C_HUD_BG);
    gDrawText("L", dcx - 49, dcy - 4, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(dcx + 26, dcy - 12, 40, 24, 6, C_HUD_BG);
    gDrawText("R", dcx + 43, dcy - 4, C_WHITE, C_HUD_BG, 1);
  }
}

var lastRawTouch = { down: false, x: 0, y: 0 };

function drawScene(now) {
  beginFrame(C_BG);

  var x, y, px, py, val, i;
  for (y = 0; y < MAP_ROWS; y++) {
    py = boardY + y * tileSize;
    gDrawLine(boardX, py, boardX + MAP_COLS * tileSize, py, C_FLOOR_LINE);
    for (x = 0; x < MAP_COLS; x++) {
      px = boardX + x * tileSize;
      i = idx(x, y);
      val = grid[i];

      if (val === 1) {
        gFillRect(px, py, tileSize, tileSize, C_WALL_BASE);
        gFillRect(px + 1, py + 1, tileSize - 2, 3, C_WALL_TOP);
        gDrawRect(px, py, tileSize, tileSize, C_WALL_DARK);
      } else if (val === 2) {
        gFillRect(px, py, tileSize, tileSize, C_WALL_BASE);
        gFillCircle(px + (tileSize >> 1), py + (tileSize >> 1) + 1, Math.max(3, (tileSize * 0.36) | 0), C_HOLE_RIM);
        gFillCircle(px + (tileSize >> 1), py + (tileSize >> 1) + 2, Math.max(2, (tileSize * 0.27) | 0), C_HOLE_ARCH);
      } else {
        if (traps[i] !== 0) drawMousetrap(px, py, tileSize, traps[i] === 1);
        if (cheeses[i] === 1) drawCheese(px, py, tileSize, now);
      }
    }
  }

  if (pepper.active) {
    drawPepper(boardX + pepper.tx * tileSize, boardY + pepper.ty * tileSize, tileSize, now);
  }

  var jgx = lerp(jerry.tx, jerry.nx, jerry.p);
  var jgy = lerp(jerry.ty, jerry.ny, jerry.p);
  drawJerrySprite(jgx, jgy, now);

  for (i = 0; i < cats.length; i++) {
    if (cats[i].active) drawCatSprite(cats[i], now);
  }

  var pt, pp;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (pt.active) gFillCircle(pt.x, pt.y, Math.max(1, (pt.life * 2.5) | 0), pt.color);
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (pp.active) gDrawText(pp.txt, pp.x, pp.y, pp.color, -1, 1);
  }

  drawHUD();

  if (gameState === STATE_TITLE) {
    var tw = Math.min(SCREEN_W - 24, 214);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 86) >> 1;
    gFillRoundRect(tx, ty, tw, 86, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 86, 10, C_GOLD);
    gDrawText("CHEESE CHASE", tx + ((tw - 96) >> 1), ty + 12, C_GOLD, C_HUD_BG, 2);
    gDrawText("Swipe/Tap/Keys to Steer", tx + ((tw - 138) >> 1), ty + 34, C_WHITE, C_HUD_BG, 1);
    gDrawText("Tap or Press 5 to Start", tx + ((tw - 138) >> 1), ty + 49, C_CYAN, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 67, C_TOM_LIGHT, C_HUD_BG, 1);
  } else if (gameState === STATE_LEVEL_CLEAR) {
    var cw = 160;
    var cx = (SCREEN_W - cw) >> 1;
    var cy = (SCREEN_H - 40) >> 1;
    gFillRoundRect(cx, cy, cw, 40, 8, C_HUD_BG);
    gDrawRoundRect(cx, cy, cw, 40, 8, C_GOLD);
    gDrawText("LEVEL " + level + " CLEAR!", cx + 32, cy + 14, C_GOLD, C_HUD_BG, 2);
  } else if (isPaused && gameState === STATE_PLAY) {
    var pw = 110;
    var pxx = (SCREEN_W - pw) >> 1;
    var pyy = (SCREEN_H - 34) >> 1;
    gFillRoundRect(pxx, pyy, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(pxx, pyy, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", pxx + 30, pyy + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 196);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 64) >> 1;
    gFillRoundRect(gx2, gy2, gw, 64, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 64, 10, C_HEART);
    gDrawText("CAUGHT! SCORE: " + score, gx2 + ((gw - 110) >> 1), gy2 + 14, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(gx2 + ((gw - 96) >> 1), gy2 + 32, 96, 22, 6, C_GOLD);
    gDrawText("PLAY AGAIN", gx2 + ((gw - 60) >> 1), gy2 + 39, C_BLACK, C_GOLD, 1);
  }

  if (showTouchDebug) {
    gFillRect(4, HUD_H + 2, SCREEN_W - 8, 28, C_HUD_BG);
    gDrawRect(4, HUD_H + 2, SCREEN_W - 8, 28, C_GOLD);
    gDrawText(SCREEN_W + "x" + SCREEN_H + " " + renderMode + " " + touchModeLabel, 8, HUD_H + 5, C_WHITE, C_HUD_BG, 1);
    var dbg = "D:" + (lastRawTouch.down ? 1 : 0) + " X:" + lastRawTouch.x + " Y:" + lastRawTouch.y + " " + touchDiscoveredKeys;
    gDrawText(dbg.slice(0, 48), 8, HUD_H + 17, C_CYAN, C_HUD_BG, 1);
  }

  endFrame();
}

/* ---------------------------------------------------------
   8. INPUT HANDLING
   --------------------------------------------------------- */
var touchWasDown = false;
var lastTouchDownTime = 0;
var touchStartX = 0, touchStartY = 0;
var touchSwiped = false;

function handlePortraitPadTap(tx, ty) {
  var dcx = SCREEN_W >> 1;
  var dcy = SCREEN_H - 39;
  if (ty < SCREEN_H - 78) return false;
  if (Math.abs(tx - dcx) <= 24 && ty <= dcy - 8) { queueJerryDir(0, -1); return true; }
  if (Math.abs(tx - dcx) <= 24 && ty >= dcy + 8) { queueJerryDir(0, 1); return true; }
  if (tx < dcx - 20 && Math.abs(ty - dcy) <= 18) { queueJerryDir(-1, 0); return true; }
  if (tx > dcx + 20 && Math.abs(ty - dcy) <= 18) { queueJerryDir(1, 0); return true; }
  return false;
}

function steerTowardTap(tx, ty) {
  var jpx = boardX + (lerp(jerry.tx, jerry.nx, jerry.p) + 0.5) * tileSize;
  var jpy = boardY + (lerp(jerry.ty, jerry.ny, jerry.p) + 0.5) * tileSize;
  var dx = tx - jpx;
  var dy = ty - jpy;
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
  if (Math.abs(dx) > Math.abs(dy)) queueJerryDir(dx > 0 ? 1 : -1, 0);
  else queueJerryDir(0, dy > 0 ? 1 : -1);
}

function handleInput(now) {
  var ts = halReadTouch(now);
  lastRawTouch.down = ts.pressed;
  if (ts.pressed) {
    lastRawTouch.x = ts.x | 0;
    lastRawTouch.y = ts.y | 0;
    lastTouchDownTime = now;

    var tx = ts.x;
    var ty = ts.y;

    if (!touchWasDown) {
      touchWasDown = true;
      touchSwiped = false;
      touchStartX = tx;
      touchStartY = ty;

      if (ty <= HUD_H + 4) {
        if (tx <= 26) { shouldExit = true; return; }
        if (tx <= 48) { showTouchDebug = !showTouchDebug; touchSwiped = true; return; }
        if (gameState === STATE_PLAY) { isPaused = !isPaused; touchSwiped = true; return; }
      }

      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
        touchSwiped = true;
        startNewGame();
        return;
      }
      if (isPaused) {
        touchSwiped = true;
        isPaused = false;
        return;
      }
      if (isPortraitPad && handlePortraitPadTap(tx, ty)) {
        touchSwiped = true;
        return;
      }
    } else if (gameState === STATE_PLAY && !isPaused) {
      var dx = tx - touchStartX;
      var dy = ty - touchStartY;
      if (Math.abs(dx) >= 14 || Math.abs(dy) >= 14) {
        touchSwiped = true;
        if (Math.abs(dx) > Math.abs(dy)) queueJerryDir(dx > 0 ? 1 : -1, 0);
        else queueJerryDir(0, dy > 0 ? 1 : -1);
        touchStartX = tx;
        touchStartY = ty;
      }
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    if (!touchSwiped && gameState === STATE_PLAY && !isPaused && lastRawTouch.y > HUD_H + 4) {
      steerTowardTap(lastRawTouch.x, lastRawTouch.y);
    }
    touchWasDown = false;
  }

  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (Math.abs(tb.dx) > Math.abs(tb.dy)) queueJerryDir(tb.dx > 0 ? 1 : -1, 0);
    else if (tb.dy !== 0) queueJerryDir(0, tb.dy > 0 ? 1 : -1);

    if (tb.click) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (gameState === STATE_PLAY) isPaused = !isPaused;
    }
  }

  var key = halReadKey();
  if (key) {
    if (key === "q" || key === "Q" || key === "Escape" || key === "ESC") {
      shouldExit = true; return;
    }
    if (key === "i" || key === "I") {
      showTouchDebug = !showTouchDebug; return;
    }
    if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") {
      queueJerryDir(0, -1);
    } else if (key === "8" || key === "s" || key === "S" || key === "DOWN" || key === "ArrowDown") {
      queueJerryDir(0, 1);
    } else if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") {
      queueJerryDir(-1, 0);
    } else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") {
      queueJerryDir(1, 0);
    } else if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (gameState === STATE_PLAY) isPaused = !isPaused;
    } else if (key === "r" || key === "R" || key === "#") {
      startNewGame();
    }
  }
}

/* ---------------------------------------------------------
   9. MAIN LOOP
   --------------------------------------------------------- */
function main() {
  discoverHAL();
  computeLayout();
  loadBestScore();
  initDoubleBuffer();
  loadLevel(1);

  var prevTime = nowMs();
  var now, dt;

  while (!shouldExit) {
    now = nowMs();
    dt = (now - prevTime) * 0.001;
    prevTime = now;
    if (dt < 0) dt = 0;
    if (dt > 0.08) dt = 0.08;

    handleInput(now);
    if (shouldExit) break;

    updateSimulation(dt);
    drawScene(now);

    System.delay(16);
  }

  releaseDoubleBuffer();
}

main();