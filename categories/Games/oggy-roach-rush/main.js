/* =========================================================
   Oggy & The Cockroaches: Roach Rush (KryonOS Duktape ES5.1)
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
   2. MATH, COLOR PALETTE & DOUBLE-BUFFER GRAPHICS (RGB565)
   --------------------------------------------------------- */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function rgb565(r, g, b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// Oggy cartoon house color palette
var C_WALL_MINT   = rgb565(178, 226, 232);
var C_BASEBOARD   = rgb565(204, 148, 186);
var C_FLOOR_A     = rgb565(246, 224, 236);
var C_FLOOR_B     = rgb565(234, 206, 224);

var C_HUD_BG      = rgb565(46, 32, 68);
var C_HUD_BDR     = rgb565(112, 84, 152);

var C_FRIDGE      = rgb565(246, 250, 255);
var C_FRIDGE_SHD  = rgb565(198, 212, 228);
var C_FRIDGE_LINE = rgb565(140, 156, 176);

var C_VENT_BG     = rgb565(40, 44, 54);
var C_VENT_RIM    = rgb565(150, 158, 174);

var C_OGGY_BLUE   = rgb565(68, 166, 238);
var C_OGGY_DARK   = rgb565(36, 118, 186);
var C_OGGY_NOSE   = rgb565(236, 44, 56);
var C_OGGY_EYE    = rgb565(82, 198, 92);

var C_SWAT_RED    = rgb565(232, 52, 62);
var C_SWAT_GOLD   = rgb565(255, 208, 44);
var C_SWAT_HANDLE = rgb565(212, 168, 96);

var C_JOEY        = rgb565(158, 72, 168);
var C_JOEY_HEAD   = rgb565(192, 118, 208);
var C_DEEDEE      = rgb565(82, 148, 226);
var C_DEEDEE_BELLY= rgb565(242, 144, 62);
var C_MARKY       = rgb565(116, 196, 86);
var C_MARKY_DARK  = rgb565(72, 142, 56);

var C_PINK        = rgb565(248, 112, 176);
var C_YELLOW      = rgb565(255, 218, 48);
var C_GOLD        = rgb565(255, 204, 34);
var C_BANANA      = rgb565(255, 226, 56);
var C_BANANA_DARK = rgb565(172, 128, 18);
var C_SPRAY_RED   = rgb565(234, 42, 42);
var C_FOOD        = rgb565(255, 192, 44);
var C_FOOD_MEAT   = rgb565(220, 112, 58);

var C_WHITE       = rgb565(255, 255, 255);
var C_BLACK       = rgb565(18, 18, 18);
var C_CYAN        = rgb565(96, 228, 255);

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
var BEST_FILE = "oggy_best.txt";
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
   4. ARENA LAYOUT & GAME STATE
   --------------------------------------------------------- */
var HUD_H = 22;
var WALL_H = 24;
var ARENA_TOP = HUD_H + WALL_H;
var ARENA_BOTTOM = SCREEN_H - 6;
var FRIDGE_X = 6;
var FRIDGE_W = 28;
var FRIDGE_Y = 80;
var FRIDGE_H = 68;
var VENTS = [
  { x: 300, y: 70 },
  { x: 300, y: 135 },
  { x: 300, y: 200 }
];

function computeArenaLayout() {
  ARENA_TOP = HUD_H + 22;
  ARENA_BOTTOM = SCREEN_H - 6;
  FRIDGE_X = 6;
  FRIDGE_W = Math.max(22, Math.min(30, (SCREEN_W * 0.09) | 0));
  FRIDGE_H = Math.max(52, Math.min(74, ((ARENA_BOTTOM - ARENA_TOP) * 0.38) | 0));
  FRIDGE_Y = ARENA_TOP + (((ARENA_BOTTOM - ARENA_TOP) - FRIDGE_H) >> 1);

  var midH = ARENA_BOTTOM - ARENA_TOP;
  VENTS[0].x = SCREEN_W - 14; VENTS[0].y = ARENA_TOP + ((midH * 0.20) | 0);
  VENTS[1].x = SCREEN_W - 14; VENTS[1].y = ARENA_TOP + ((midH * 0.52) | 0);
  VENTS[2].x = SCREEN_W - 14; VENTS[2].y = ARENA_TOP + ((midH * 0.84) | 0);
}

var STATE_TITLE = 0;
var STATE_PLAY = 1;
var STATE_WAVE_CLEAR = 2;
var STATE_GAME_OVER = 3;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;

var wave = 1;
var score = 0;
var snacks = 5;
var waveSwats = 0;
var waveGoal = 8;
var waveBannerTimer = 0;
var fridgeShake = 0;

var sprayTimer = 0;
var sprayPickup = { active: false, x: 160, y: 120, timer: 8.0 };

var oggy = {
  x: 90, y: 130,
  faceX: 1, faceY: 0,
  swatTimer: 0,
  swatCool: 0,
  slipTimer: 0,
  hitCountThisSwing: 0
};

var tapTarget = { active: false, x: 0, y: 0 };
var inputMove = { dx: 0, dy: 0 };

// Cockroach types: 0 = Joey, 1 = Dee Dee, 2 = Marky
var MAX_ROACHES = 6;
var roaches = [];
(function initRoaches() {
  var i;
  for (i = 0; i < MAX_ROACHES; i++) {
    roaches.push({
      active: false, type: 0, x: 0, y: 0, vx: 0, vy: 0,
      hp: 1, carrying: false, state: 0, // 0=toFridge, 1=fleeToVent
      ventIdx: 0, zigPhase: 0, flash: 0, peelTimer: 5.0
    });
  }
})();

var spawnTimer = 0.6;

// Banana peels (Marky's trap)
var MAX_PEELS = 2;
var peels = [];
(function initPeels() {
  var i;
  for (i = 0; i < MAX_PEELS; i++) {
    peels.push({ active: false, x: 0, y: 0, life: 0 });
  }
})();

// Particle pool
var MAX_FX = 20;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: C_SWAT_GOLD });
  }
})();

// Floating popup pool
var popups = [
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD }
];

function spawnFx(x, y, color, count) {
  var i, s = 0, a, sp, pt;
  for (i = 0; i < MAX_FX && s < count; i++) {
    pt = fxPool[i];
    if (!pt.active) {
      a = (6.2831853 * s) / count + FM.random() * 0.5;
      sp = 1.2 + FM.random() * 2.4;
      pt.active = true;
      pt.x = x; pt.y = y;
      pt.vx = FM.cos(a) * sp;
      pt.vy = FM.sin(a) * sp;
      pt.life = 1.0;
      pt.color = color;
      s++;
    }
  }
}

function spawnPopup(x, y, txt, color) {
  var i, p;
  for (i = 0; i < popups.length; i++) {
    p = popups[i];
    if (!p.active) {
      p.active = true;
      p.x = clamp(x - 14, 4, SCREEN_W - 64);
      p.y = clamp(y - 10, ARENA_TOP + 4, SCREEN_H - 16);
      p.txt = txt;
      p.life = 1.0;
      p.color = color;
      return;
    }
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
   5. WAVE & ENTITY LOGIC
   --------------------------------------------------------- */
function clearArenaEntities() {
  var i;
  for (i = 0; i < MAX_ROACHES; i++) roaches[i].active = false;
  for (i = 0; i < MAX_PEELS; i++) peels[i].active = false;
  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;
  for (i = 0; i < popups.length; i++) popups[i].active = false;
}

function setupWave(w) {
  wave = w;
  waveSwats = 0;
  waveGoal = 6 + w * 3;
  spawnTimer = 0.5;
  sprayTimer = 0;
  sprayPickup.active = false;
  sprayPickup.timer = 7.5;
  tapTarget.active = false;
  clearArenaEntities();

  oggy.x = FRIDGE_X + FRIDGE_W + 46;
  oggy.y = ARENA_TOP + ((ARENA_BOTTOM - ARENA_TOP) >> 1);
  oggy.faceX = 1;
  oggy.faceY = 0;
  oggy.swatTimer = 0;
  oggy.swatCool = 0;
  oggy.slipTimer = 0;
}

function startNewGame() {
  score = 0;
  snacks = 5;
  isPaused = false;
  fridgeShake = 0;
  gameState = STATE_PLAY;
  setupWave(1);
}

function spawnRoach() {
  var i, r = null;
  for (i = 0; i < MAX_ROACHES; i++) {
    if (!roaches[i].active) { r = roaches[i]; break; }
  }
  if (!r) return;

  var vIdx = Math.floor(FM.random() * 3) % 3;
  var vent = VENTS[vIdx];
  var rType = Math.floor(FM.random() * 3) % 3;

  r.active = true;
  r.type = rType;
  r.ventIdx = vIdx;
  r.x = vent.x;
  r.y = vent.y;
  r.carrying = false;
  r.state = 0;
  r.zigPhase = FM.random() * 6.28;
  r.flash = 0;
  r.peelTimer = 4.0 + FM.random() * 4.0;
  r.hp = (rType === 0 && wave >= 3) ? 2 : 1; // Joey gets extra tough from Wave 3+
}

function spawnBananaPeel(x, y) {
  var i;
  for (i = 0; i < MAX_PEELS; i++) {
    if (!peels[i].active) {
      peels[i].active = true;
      peels[i].x = clamp(x, FRIDGE_X + FRIDGE_W + 24, SCREEN_W - 26);
      peels[i].y = clamp(y, ARENA_TOP + 16, ARENA_BOTTOM - 16);
      peels[i].life = 11.0;
      return;
    }
  }
}

function anyRoachCarrying() {
  var i;
  for (i = 0; i < MAX_ROACHES; i++) {
    if (roaches[i].active && roaches[i].carrying) return true;
  }
  return false;
}

function triggerSwat() {
  if (gameState !== STATE_PLAY || isPaused || oggy.slipTimer > 0) return;
  if (oggy.swatCool > 0) return;

  oggy.swatTimer = 0.16;
  oggy.swatCool = 0.23;
  oggy.hitCountThisSwing = 0;

  var reach = (sprayTimer > 0) ? 38 : 24;
  var sx = oggy.x + oggy.faceX * 14;
  var sy = oggy.y + oggy.faceY * 14;

  var i, r, dx1, dy1, dx2, dy2, dSq1, dSq2, rSq = reach * reach;
  for (i = 0; i < MAX_ROACHES; i++) {
    r = roaches[i];
    if (!r.active) continue;

    dx1 = r.x - sx; dy1 = r.y - sy;
    dx2 = r.x - oggy.x; dy2 = r.y - oggy.y;
    dSq1 = dx1 * dx1 + dy1 * dy1;
    dSq2 = dx2 * dx2 + dy2 * dy2;

    if (dSq1 <= rSq || dSq2 <= (reach * 0.8) * (reach * 0.8)) {
      if (sprayTimer > 0) r.hp = 0;
      else r.hp -= 1;

      if (r.carrying) {
        r.carrying = false;
        if (snacks < 5) snacks++;
        addScore(30);
        spawnPopup(r.x, r.y - 8, "SAVED +30", C_CYAN);
      }

      if (r.hp <= 0) {
        r.active = false;
        oggy.hitCountThisSwing++;
        waveSwats++;
        var pts = 20 * oggy.hitCountThisSwing;
        addScore(pts);
        spawnFx(r.x, r.y, (sprayTimer > 0) ? C_SWAT_GOLD : C_PINK, 9);
        spawnPopup(r.x, r.y, (oggy.hitCountThisSwing >= 2 ? "COMBO +" : "SMACK +") + pts, C_GOLD);

        if (waveSwats >= waveGoal) {
          addScore(100 * wave);
          if (snacks < 5) snacks++;
          gameState = STATE_WAVE_CLEAR;
          waveBannerTimer = 1.5;
          return;
        }
      } else {
        // Knockback armored Joey
        r.flash = 0.25;
        r.x = clamp(r.x + 26, FRIDGE_X + FRIDGE_W + 10, SCREEN_W - 14);
        addScore(10);
        spawnFx(r.x, r.y, C_WHITE, 5);
        spawnPopup(r.x, r.y, "BONK!", C_WHITE);
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
    pt.life -= dt * 2.4;
    if (pt.life <= 0) pt.active = false;
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (!pp.active) continue;
    pp.y -= dt * 18;
    pp.life -= dt * 1.25;
    if (pp.life <= 0) pp.active = false;
  }

  if (gameState === STATE_WAVE_CLEAR) {
    waveBannerTimer -= dt;
    if (waveBannerTimer <= 0) {
      gameState = STATE_PLAY;
      setupWave(wave + 1);
    }
    return;
  }

  if (gameState !== STATE_PLAY || isPaused) return;

  if (fridgeShake > 0) fridgeShake = Math.max(0, fridgeShake - dt);
  if (sprayTimer > 0) sprayTimer = Math.max(0, sprayTimer - dt);
  if (oggy.swatTimer > 0) oggy.swatTimer = Math.max(0, oggy.swatTimer - dt);
  if (oggy.swatCool > 0) oggy.swatCool = Math.max(0, oggy.swatCool - dt);

  // Move Oggy
  if (oggy.slipTimer > 0) {
    oggy.slipTimer = Math.max(0, oggy.slipTimer - dt);
  } else {
    var oSpeed = (sprayTimer > 0) ? 148 : 114;
    var mvx = 0, mvy = 0;

    if (inputMove.dx !== 0 || inputMove.dy !== 0) {
      mvx = inputMove.dx;
      mvy = inputMove.dy;
      var mLen = FM.sqrt(mvx * mvx + mvy * mvy);
      if (mLen > 0) { mvx /= mLen; mvy /= mLen; }
    } else if (tapTarget.active) {
      var tdx = tapTarget.x - oggy.x;
      var tdy = tapTarget.y - oggy.y;
      var dist = FM.sqrt(tdx * tdx + tdy * tdy);
      if (dist > 6) {
        mvx = tdx / dist;
        mvy = tdy / dist;
      } else {
        tapTarget.active = false;
      }
    }

    if (mvx !== 0 || mvy !== 0) {
      oggy.x += mvx * oSpeed * dt;
      oggy.y += mvy * oSpeed * dt;
      oggy.faceX = mvx;
      oggy.faceY = mvy;
      oggy.x = clamp(oggy.x, FRIDGE_X + FRIDGE_W + 10, SCREEN_W - 14);
      oggy.y = clamp(oggy.y, ARENA_TOP + 12, ARENA_BOTTOM - 12);
    }
  }

  // Check Bug Spray pickup
  if (!sprayPickup.active) {
    sprayPickup.timer -= dt;
    if (sprayPickup.timer <= 0) {
      sprayPickup.active = true;
      sprayPickup.x = FRIDGE_X + FRIDGE_W + 50 + FM.random() * Math.max(40, SCREEN_W - FRIDGE_W - 110);
      sprayPickup.y = ARENA_TOP + 24 + FM.random() * Math.max(30, ARENA_BOTTOM - ARENA_TOP - 48);
    }
  } else {
    var sdx = oggy.x - sprayPickup.x;
    var sdy = oggy.y - sprayPickup.y;
    if (sdx * sdx + sdy * sdy <= 22 * 22) {
      sprayPickup.active = false;
      sprayPickup.timer = 13.0;
      sprayTimer = 6.0;
      addScore(25);
      spawnFx(oggy.x, oggy.y, C_SPRAY_RED, 12);
      spawnPopup(oggy.x, oggy.y, "MEGA SWAT!", C_SPRAY_RED);
    }
  }

  // Check Banana Peels
  for (i = 0; i < MAX_PEELS; i++) {
    if (!peels[i].active) continue;
    peels[i].life -= dt;
    if (peels[i].life <= 0) { peels[i].active = false; continue; }
    if (oggy.slipTimer <= 0 && sprayTimer <= 0) {
      var pdx = oggy.x - peels[i].x;
      var pdy = oggy.y - peels[i].y;
      if (pdx * pdx + pdy * pdy <= 14 * 14) {
        peels[i].active = false;
        oggy.slipTimer = 0.75;
        tapTarget.active = false;
        spawnFx(oggy.x, oggy.y, C_BANANA, 8);
        spawnPopup(oggy.x, oggy.y, "WHOOPS!", C_BANANA);
      }
    }
  }

  // Spawn cockroaches
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnRoach();
    spawnTimer = Math.max(0.75, 1.9 - wave * 0.16);
  }

  // Update cockroaches & auto-swat assist when tapping directly on a roach
  var r, targetX, targetY, rdx, rdy, rDist, rSpeed, zig, autoSwatHit = false;
  var fridgeDoorX = FRIDGE_X + FRIDGE_W + 6;
  var fridgeMidY = FRIDGE_Y + (FRIDGE_H >> 1);

  for (i = 0; i < MAX_ROACHES; i++) {
    r = roaches[i];
    if (!r.active) continue;
    if (r.flash > 0) r.flash = Math.max(0, r.flash - dt);

    // Base speeds per character
    if (r.type === 0) rSpeed = 62 + wave * 4.5;       // Joey (fast)
    else if (r.type === 1) rSpeed = 48 + wave * 3.5;  // Dee Dee (steady fridge thief)
    else rSpeed = 54 + wave * 4.0;                    // Marky (zigzags)

    if (r.carrying) rSpeed *= 0.88; // Slightly heavier carrying cake!

    if (r.state === 0) {
      targetX = fridgeDoorX;
      targetY = fridgeMidY + (r.ventIdx - 1) * 14;
    } else {
      targetX = VENTS[r.ventIdx].x + 2;
      targetY = VENTS[r.ventIdx].y;
    }

    rdx = targetX - r.x;
    rdy = targetY - r.y;
    rDist = FM.sqrt(rdx * rdx + rdy * rdy);

    if (rDist > 1) {
      r.vx = rdx / rDist;
      r.vy = rdy / rDist;
      r.zigPhase += dt * 7.5;
      zig = (r.type === 2) ? FM.sin(r.zigPhase) * 32 : ((r.type === 0) ? FM.sin(r.zigPhase * 1.3) * 14 : 0);
      r.x += r.vx * rSpeed * dt;
      r.y += (r.vy * rSpeed + zig) * dt;
      r.y = clamp(r.y, ARENA_TOP + 10, ARENA_BOTTOM - 10);
    }

    // Marky drops Banana Peels on Wave 2+
    if (wave >= 2 && r.type === 2 && !r.carrying) {
      r.peelTimer -= dt;
      if (r.peelTimer <= 0) {
        r.peelTimer = 7.5;
        spawnBananaPeel(r.x, r.y);
      }
    }

    // Reached Fridge
    if (r.state === 0 && r.x <= fridgeDoorX + 6) {
      if (snacks > 0) {
        snacks--;
        r.carrying = true;
        r.state = 1;
        fridgeShake = 0.35;
        spawnFx(fridgeDoorX, r.y, C_FOOD, 6);
        spawnPopup(fridgeDoorX + 6, r.y, "-1 FOOD!", C_SWAT_RED);
      } else {
        r.state = 1;
      }
    } else if (r.state === 1 && r.x >= VENTS[r.ventIdx].x - 4) {
      r.active = false;
      if (r.carrying) {
        spawnPopup(r.x - 42, r.y, "ESCAPED!", C_SWAT_RED);
        if (snacks <= 0 && !anyRoachCarrying()) {
          gameState = STATE_GAME_OVER;
          return;
        }
      }
    }

    // Auto-swat if player tapped to move & reached swat range of a roach
    if (tapTarget.active && oggy.swatCool <= 0 && oggy.slipTimer <= 0) {
      var odx = r.x - oggy.x;
      var ody = r.y - oggy.y;
      var swatRng = (sprayTimer > 0) ? 34 : 22;
      if (odx * odx + ody * ody <= swatRng * swatRng) {
        oggy.faceX = (odx !== 0 || ody !== 0) ? (odx / Math.max(1, FM.sqrt(odx * odx + ody * ody))) : 1;
        oggy.faceY = (odx !== 0 || ody !== 0) ? (ody / Math.max(1, FM.sqrt(odx * odx + ody * ody))) : 0;
        autoSwatHit = true;
      }
    }
  }

  if (autoSwatHit) {
    triggerSwat();
  }
}

/* ---------------------------------------------------------
   6. CARTOON RENDERING (House, Fridge, Oggy, 3 Roaches)
   --------------------------------------------------------- */
function drawBackground() {
  // Mint wall strip + pink baseboard
  gFillRect(0, HUD_H, SCREEN_W, ARENA_TOP - HUD_H - 4, C_WALL_MINT);
  gFillRect(0, ARENA_TOP - 4, SCREEN_W, 4, C_BASEBOARD);

  // Checkered cartoon living-room floor
  var tileW = 24;
  var r, c, fy, fx, col;
  for (fy = ARENA_TOP; fy < SCREEN_H; fy += tileW) {
    r = ((fy - ARENA_TOP) / tileW) | 0;
    for (fx = 0; fx < SCREEN_W; fx += tileW) {
      c = (fx / tileW) | 0;
      col = (((r + c) & 1) === 0) ? C_FLOOR_A : C_FLOOR_B;
      gFillRect(fx, fy, Math.min(tileW, SCREEN_W - fx), Math.min(tileW, SCREEN_H - fy), col);
    }
  }

  // Oggy's Refrigerator (shakes when raided!)
  var sh = (fridgeShake > 0) ? (((fridgeShake * 60) | 0) & 1 ? 2 : -2) : 0;
  var fx0 = FRIDGE_X + sh;
  var fy0 = FRIDGE_Y;
  gFillRoundRect(fx0 + 2, fy0 + 2, FRIDGE_W, FRIDGE_H, 4, C_FRIDGE_SHD);
  gFillRoundRect(fx0, fy0, FRIDGE_W, FRIDGE_H, 4, C_FRIDGE);
  gDrawRoundRect(fx0, fy0, FRIDGE_W, FRIDGE_H, 4, C_FRIDGE_LINE);
  // Freezer line + silver handles
  var splitY = fy0 + ((FRIDGE_H * 0.34) | 0);
  gDrawLine(fx0 + 2, splitY, fx0 + FRIDGE_W - 2, splitY, C_FRIDGE_LINE);
  gFillRect(fx0 + FRIDGE_W - 5, fy0 + 6, 2, 10, C_FRIDGE_LINE);
  gFillRect(fx0 + FRIDGE_W - 5, splitY + 6, 2, 14, C_FRIDGE_LINE);

  // Snack count dots on fridge door
  var s;
  for (s = 0; s < 5; s++) {
    gFillCircle(fx0 + 7 + (s % 2) * 7, splitY + 12 + ((s >> 1) * 10), 3, s < snacks ? C_FOOD : C_FRIDGE_SHD);
  }

  // 3 Cockroach Vents on right wall
  var i, vx, vy;
  for (i = 0; i < 3; i++) {
    vx = VENTS[i].x - 4;
    vy = VENTS[i].y - 10;
    gFillRoundRect(vx, vy, 14, 20, 3, C_VENT_BG);
    gDrawRoundRect(vx, vy, 14, 20, 3, C_VENT_RIM);
    gDrawLine(vx + 2, vy + 6, vx + 11, vy + 6, C_VENT_RIM);
    gDrawLine(vx + 2, vy + 10, vx + 11, vy + 10, C_VENT_RIM);
    gDrawLine(vx + 2, vy + 14, vx + 11, vy + 14, C_VENT_RIM);
  }
}

function drawRoachSprite(r, now) {
  var x = r.x | 0;
  var y = r.y | 0;
  var w = (r.type === 1) ? 11 : 9;
  var h = (r.type === 2) ? 6 : 7;

  var bodyC, headC, eye1C, eye2C;
  if (r.flash > 0) {
    bodyC = C_WHITE; headC = C_WHITE; eye1C = C_BLACK; eye2C = C_BLACK;
  } else if (r.type === 0) {
    // Joey: purple body, pink & yellow mismatched eyes
    bodyC = C_JOEY; headC = C_JOEY_HEAD; eye1C = C_PINK; eye2C = C_YELLOW;
  } else if (r.type === 1) {
    // Dee Dee: plump blue/orange, green eyes
    bodyC = C_DEEDEE; headC = C_DEEDEE_BELLY; eye1C = C_OGGY_EYE; eye2C = C_OGGY_EYE;
  } else {
    // Marky: green, pink eyes
    bodyC = C_MARKY; headC = C_MARKY_DARK; eye1C = C_PINK; eye2C = C_PINK;
  }

  // Scurrying legs
  var step = (((now / 60) | 0) & 1) ? 2 : -2;
  gDrawLine(x - 4, y - h - 2 + step, x + 4, y + h + 2 - step, C_BLACK);
  gDrawLine(x, y - h - 3 - step, x, y + h + 3 + step, C_BLACK);
  gDrawLine(x + 4, y - h - 2 + step, x - 4, y + h + 2 - step, C_BLACK);

  // Body & head
  gFillRoundRect(x - w, y - h, w * 2, h * 2, 4, bodyC);
  var dirSign = (r.state === 0) ? -1 : 1;
  gFillCircle(x + dirSign * (w - 2), y, 5, headC);

  // Antennae
  gDrawLine(x + dirSign * (w + 1), y - 2, x + dirSign * (w + 7), y - 7 + step, C_BLACK);
  gDrawLine(x + dirSign * (w + 1), y + 2, x + dirSign * (w + 7), y + 7 - step, C_BLACK);

  // Cartoon eyes
  gFillCircle(x + dirSign * (w - 1), y - 2, 2, eye1C);
  gFillCircle(x + dirSign * (w - 1), y + 2, 2, eye2C);

  // Stolen snack riding on back
  if (r.carrying) {
    gFillCircle(x - dirSign * 3, y - h - 2, 4, C_FOOD_MEAT);
    gFillCircle(x - dirSign * 3, y - h - 3, 2, C_FOOD);
  }
}

function drawOggySprite(now) {
  var x = oggy.x | 0;
  var y = oggy.y | 0;
  var r = 11;

  // Tall blue ears
  fillTri(x - 9, y - 4, x - 3, y - 9, x - 8, y - 18, C_OGGY_DARK);
  fillTri(x + 9, y - 4, x + 3, y - 9, x + 8, y - 18, C_OGGY_DARK);

  // Blue head/body + white belly/muzzle
  gFillCircle(x, y, r, (sprayTimer > 0 && (((now / 90) | 0) & 1)) ? C_SWAT_GOLD : C_OGGY_BLUE);
  gFillCircle(x, y + 4, 6, C_WHITE);

  // Big oval eyes
  gFillCircle(x - 4, y - 3, 3, C_WHITE);
  gFillCircle(x + 4, y - 3, 3, C_WHITE);
  gFillCircle(x - 4 + (oggy.faceX * 1.2), y - 3 + (oggy.faceY * 1.2), 1, C_OGGY_EYE);
  gFillCircle(x + 4 + (oggy.faceX * 1.2), y - 3 + (oggy.faceY * 1.2), 1, C_OGGY_EYE);

  // Oggy's signature big red nose
  gFillCircle(x + oggy.faceX * 2, y + 1 + oggy.faceY, 4, C_OGGY_NOSE);

  // Flyswatter
  var swingAng = 0;
  if (oggy.swatTimer > 0) {
    swingAng = FM.sin((oggy.swatTimer / 0.16) * 3.14159) * 1.1;
  }
  var baseA = Math.atan2(oggy.faceY, oggy.faceX) + swingAng;
  var swLen = (sprayTimer > 0) ? 26 : 17;
  var hx = x + FM.cos(baseA) * swLen;
  var hy = y + FM.sin(baseA) * swLen;
  gDrawLine(x + oggy.faceX * 7, y + oggy.faceY * 7, hx, hy, C_SWAT_HANDLE);
  var swRad = (sprayTimer > 0) ? 8 : 5;
  gFillRoundRect(hx - swRad, hy - swRad, swRad * 2, swRad * 2, 2, (sprayTimer > 0) ? C_SWAT_GOLD : C_SWAT_RED);
  gDrawRect(hx - swRad + 2, hy - swRad + 2, swRad * 2 - 4, swRad * 2 - 4, C_WHITE);

  // Dizzy stars if slipped on banana peel
  if (oggy.slipTimer > 0) {
    var a1 = now * 0.014;
    gFillCircle(x + FM.cos(a1) * 12, y - 14, 2, C_YELLOW);
    gFillCircle(x + FM.cos(a1 + 3.14) * 12, y - 14, 2, C_YELLOW);
  }
}

function drawHUD() {
  gFillRect(0, 0, SCREEN_W, HUD_H, C_HUD_BG);
  gDrawLine(0, HUD_H - 1, SCREEN_W, HUD_H - 1, C_HUD_BDR);

  gFillRoundRect(4, 3, 20, 16, 4, C_HUD_BDR);
  gDrawText("X", 11, 7, C_WHITE, C_HUD_BDR, 1);

  gFillRoundRect(27, 3, 18, 16, 4, showTouchDebug ? C_SWAT_RED : C_HUD_BDR);
  gDrawText("?", 33, 7, C_WHITE, showTouchDebug ? C_SWAT_RED : C_HUD_BDR, 1);

  gDrawText("F:" + snacks, 50, 7, snacks > 1 ? C_FOOD : C_SWAT_RED, C_HUD_BG, 1);
  gDrawText("W" + wave + ":" + waveSwats + "/" + waveGoal, 82, 7, C_CYAN, C_HUD_BG, 1);

  var scTxt = "S:" + score + " B:" + bestScore;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 6, 7, C_WHITE, C_HUD_BG, 1);

  // Bottom-right manual SWAT button for touchscreen players
  if (gameState === STATE_PLAY) {
    var sbX = SCREEN_W - 56;
    var sbY = SCREEN_H - 26;
    var sbCol = (sprayTimer > 0) ? C_SWAT_GOLD : C_SWAT_RED;
    gFillRoundRect(sbX, sbY, 50, 20, 6, sbCol);
    gDrawRoundRect(sbX, sbY, 50, 20, 6, C_WHITE);
    gDrawText("SWAT", sbX + 13, sbY + 6, (sprayTimer > 0) ? C_BLACK : C_WHITE, sbCol, 1);
  }
}

var lastRawTouch = { down: false, x: 0, y: 0 };

function drawScene(now) {
  beginFrame(C_FLOOR_A);
  drawBackground();

  // Banana peels
  var i, pl;
  for (i = 0; i < MAX_PEELS; i++) {
    pl = peels[i];
    if (!pl.active) continue;
    fillTri(pl.x - 6, pl.y + 4, pl.x + 6, pl.y + 4, pl.x, pl.y - 5, C_BANANA);
    gDrawPixel(pl.x, pl.y - 5, C_BANANA_DARK);
  }

  // Bug Spray pickup
  if (sprayPickup.active) {
    var spY = sprayPickup.y + FM.sin(now * 0.007) * 2;
    gFillRoundRect(sprayPickup.x - 6, spY - 8, 12, 16, 2, C_SPRAY_RED);
    gFillRect(sprayPickup.x - 3, spY - 11, 6, 3, C_WHITE);
    gDrawText("!", sprayPickup.x - 2, spY - 4, C_YELLOW, C_SPRAY_RED, 1);
  }

  // Tap target marker
  if (tapTarget.active && gameState === STATE_PLAY) {
    gFillCircle(tapTarget.x, tapTarget.y, 3, C_CYAN);
  }

  // Cockroaches
  for (i = 0; i < MAX_ROACHES; i++) {
    if (roaches[i].active) drawRoachSprite(roaches[i], now);
  }

  // Oggy
  drawOggySprite(now);

  // Particles & Popups
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
    var tw = Math.min(SCREEN_W - 20, 226);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 92) >> 1;
    gFillRoundRect(tx, ty, tw, 92, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 92, 10, C_GOLD);
    gDrawText("OGGY: ROACH RUSH", tx + ((tw - 128) >> 1), ty + 10, C_GOLD, C_HUD_BG, 2);
    gDrawText("Guard Fridge! Tap Roaches to Swat", tx + ((tw - 204) >> 1), ty + 34, C_WHITE, C_HUD_BG, 1);
    gDrawText("Keys/Trackball + 5/Space to Swat", tx + ((tw - 192) >> 1), ty + 48, C_CYAN, C_HUD_BG, 1);
    gDrawText("Tap or Press 5 to Start", tx + ((tw - 138) >> 1), ty + 62, C_YELLOW, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 77, C_VENT_RIM, C_HUD_BG, 1);
  } else if (gameState === STATE_WAVE_CLEAR) {
    var cw = 160;
    var cx = (SCREEN_W - cw) >> 1;
    var cy = (SCREEN_H - 40) >> 1;
    gFillRoundRect(cx, cy, cw, 40, 8, C_HUD_BG);
    gDrawRoundRect(cx, cy, cw, 40, 8, C_GOLD);
    gDrawText("WAVE " + wave + " CLEAR!", cx + 28, cy + 13, C_GOLD, C_HUD_BG, 2);
  } else if (isPaused && gameState === STATE_PLAY) {
    var pw = 110;
    var pxx = (SCREEN_W - pw) >> 1;
    var pyy = (SCREEN_H - 34) >> 1;
    gFillRoundRect(pxx, pyy, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(pxx, pyy, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", pxx + 30, pyy + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 210);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 68) >> 1;
    gFillRoundRect(gx2, gy2, gw, 68, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 68, 10, C_SWAT_RED);
    gDrawText("FRIDGE EMPTY! SCORE: " + score, gx2 + ((gw - 150) >> 1), gy2 + 14, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(gx2 + ((gw - 96) >> 1), gy2 + 34, 96, 22, 6, C_GOLD);
    gDrawText("PLAY AGAIN", gx2 + ((gw - 60) >> 1), gy2 + 41, C_BLACK, C_GOLD, 1);
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
   7. INPUT HANDLING (Touch + Trackball + Keyboard)
   --------------------------------------------------------- */
var touchWasDown = false;
var lastTouchDownTime = 0;
var keyHoldTimer = 0;

function handleInput(now, dt) {
  // Decay keyboard/trackball pulse movement cleanly
  if (keyHoldTimer > 0) {
    keyHoldTimer -= dt;
    if (keyHoldTimer <= 0) {
      inputMove.dx = 0;
      inputMove.dy = 0;
    }
  }

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

      if (ty <= HUD_H + 4) {
        if (tx <= 26) { shouldExit = true; return; }
        if (tx <= 48) { showTouchDebug = !showTouchDebug; return; }
        if (gameState === STATE_PLAY) { isPaused = !isPaused; return; }
      }

      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
        startNewGame();
        return;
      }
      if (isPaused) {
        isPaused = false;
        return;
      }

      // Bottom-right SWAT button
      if (gameState === STATE_PLAY && tx >= SCREEN_W - 60 && ty >= SCREEN_H - 30) {
        triggerSwat();
        return;
      }
    }

    if (gameState === STATE_PLAY && !isPaused && ty > HUD_H + 4) {
      inputMove.dx = 0;
      inputMove.dy = 0;
      tapTarget.active = true;
      tapTarget.x = clamp(tx, FRIDGE_X + FRIDGE_W + 10, SCREEN_W - 14);
      tapTarget.y = clamp(ty, ARENA_TOP + 12, ARENA_BOTTOM - 12);
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    touchWasDown = false;
  }

  // Trackball
  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (tb.dx !== 0 || tb.dy !== 0) {
      tapTarget.active = false;
      inputMove.dx = tb.dx;
      inputMove.dy = tb.dy;
      keyHoldTimer = 0.14;
    }
    if (tb.click) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) isPaused = false;
      else triggerSwat();
    }
  }

  // Keyboard / T9
  var key = halReadKey();
  if (key) {
    if (key === "q" || key === "Q" || key === "Escape" || key === "ESC") {
      shouldExit = true; return;
    }
    if (key === "i" || key === "I") {
      showTouchDebug = !showTouchDebug; return;
    }
    if (key === "p" || key === "P") {
      if (gameState === STATE_PLAY) isPaused = !isPaused;
      return;
    }

    var kdx = 0, kdy = 0;
    if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") kdy = -1;
    else if (key === "8" || key === "s" || key === "S" || key === "DOWN" || key === "ArrowDown") kdy = 1;
    else if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") kdx = -1;
    else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") kdx = 1;

    if (kdx !== 0 || kdy !== 0) {
      if (gameState === STATE_TITLE) startNewGame();
      tapTarget.active = false;
      inputMove.dx = kdx;
      inputMove.dy = kdy;
      keyHoldTimer = 0.16;
      return;
    }

    if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) isPaused = false;
      else triggerSwat();
    } else if (key === "r" || key === "R" || key === "#") {
      startNewGame();
    }
  }
}

/* ---------------------------------------------------------
   8. MAIN LOOP
   --------------------------------------------------------- */
function main() {
  discoverHAL();
  computeArenaLayout();
  loadBestScore();
  initDoubleBuffer();
  setupWave(1);

  var prevTime = nowMs();
  var now, dt;

  while (!shouldExit) {
    now = nowMs();
    dt = (now - prevTime) * 0.001;
    prevTime = now;
    if (dt < 0) dt = 0;
    if (dt > 0.08) dt = 0.08;

    handleInput(now, dt);
    if (shouldExit) break;

    updateSimulation(dt);
    drawScene(now);

    System.delay(16);
  }

  releaseDoubleBuffer();
}

main();