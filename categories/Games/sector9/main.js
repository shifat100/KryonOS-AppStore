/* =========================================================
   SECTOR-9: Human Army FPS (3D / 2D) - KryonOS Duktape ES5.1
   ========================================================= */

var G = (typeof System !== "undefined" && typeof System.fillScreen === "function")
  ? System
  : (typeof Graphics !== "undefined" ? Graphics : System);

var FM = (typeof FastMath !== "undefined") ? FastMath : Math;
var GLOBAL_OBJ = (function () { return this; })();

var SCREEN_W = 320;
var SCREEN_H = 240;
var HUD_H = 22;

var CLIP_X0 = 0;
var CLIP_X1 = SCREEN_W - 1;

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
      CLIP_X1 = SCREEN_W - 1;
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
   2. MATH, ARMY & BUNKER PALETTES, DOUBLE-BUFFER GRAPHICS
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

var WALL_SHADES = [];
(function initWallShades() {
  var bases = [
    [0, 0, 0],
    [116, 128, 152],
    [76, 118, 168],
    [154, 94, 72],
    [214, 58, 62]
  ];
  var t, s, sh, b, sideMul, fog;
  for (t = 0; t <= 4; t++) {
    WALL_SHADES[t] = [[], []];
    b = bases[t];
    for (s = 0; s < 2; s++) {
      sideMul = (s === 0) ? 1.0 : 0.72;
      for (sh = 0; sh < 16; sh++) {
        fog = 1.0 - (sh / 15) * 0.78;
        WALL_SHADES[t][s][sh] = rgb565(
          (b[0] * sideMul * fog) | 0,
          (b[1] * sideMul * fog) | 0,
          (b[2] * sideMul * fog) | 0
        );
      }
    }
  }
})();

var CEIL_BANDS = [
  rgb565(18, 22, 34),
  rgb565(14, 18, 28),
  rgb565(10, 14, 22),
  rgb565(8, 10, 16)
];
var FLOOR_BANDS = [
  rgb565(16, 20, 26),
  rgb565(26, 32, 42),
  rgb565(38, 46, 58),
  rgb565(50, 58, 72)
];

var C_HUD_BG       = rgb565(14, 18, 28);
var C_HUD_BDR      = rgb565(64, 82, 116);
var C_FOV_CONE     = rgb565(38, 56, 84);
var C_MAP_FLOOR    = rgb565(28, 34, 46);
var C_SHADOW       = rgb565(16, 20, 26);

var C_GUN_BODY     = rgb565(66, 76, 94);
var C_GUN_DARK     = rgb565(36, 42, 54);
var C_GUN_COIL     = rgb565(74, 222, 255);
var C_MUZZLE       = rgb565(255, 226, 84);

// Human Army Soldier Colors
var C_ARMY_OLIVE   = rgb565(84, 108, 54);
var C_ARMY_OLIVE_DK= rgb565(54, 72, 34);
var C_ARMY_VEST    = rgb565(62, 74, 46);
var C_ARMY_HELM    = rgb565(68, 92, 44);

var C_ARMY_TAN     = rgb565(178, 148, 98);
var C_ARMY_TAN_DK  = rgb565(126, 98, 62);
var C_ARMY_BERET   = rgb565(198, 34, 42);

var C_ARMY_SPEC    = rgb565(46, 52, 66);
var C_ARMY_SPEC_DK = rgb565(28, 32, 42);

var C_SKIN         = rgb565(232, 182, 138);
var C_SKIN_DK      = rgb565(184, 134, 96);
var C_BOOT         = rgb565(24, 22, 20);
var C_RIFLE        = rgb565(42, 46, 54);
var C_RIFLE_WOOD   = rgb565(124, 76, 40);

var C_BLUE         = rgb565(46, 126, 242);
var C_GREEN        = rgb565(58, 224, 96);
var C_RED          = rgb565(238, 56, 66);
var C_GOLD         = rgb565(255, 210, 44);
var C_CYAN         = rgb565(82, 224, 255);
var C_WHITE        = rgb565(255, 255, 255);
var C_BLACK        = rgb565(12, 14, 20);
var C_RING_BG      = rgb565(172, 198, 242);

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
  if (x < CLIP_X0 || x > CLIP_X1 || y < 0 || y >= SCREEN_H) return;
  G.drawPixel(x, y, c);
}

function gDrawLine(x0, y0, x1, y1, c) {
  G.drawLine(x0 | 0, y0 | 0, x1 | 0, y1 | 0, c);
}

function gFillRect(x, y, w, h, c) {
  if (w <= 0 || h <= 0) return;
  G.fillRect(x | 0, y | 0, w | 0, h | 0, c);
}

function drawClippedRect(x, y, w, h, c) {
  var x0 = Math.max(CLIP_X0, x | 0);
  var x1 = Math.min(CLIP_X1, ((x + w) | 0) - 1);
  if (x1 < x0 || h <= 0) return;
  gFillRect(x0, y | 0, x1 - x0 + 1, h | 0, c);
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

function drawClippedCircle(cx, cy, r, c) {
  var ir = Math.round(r);
  if (ir <= 0) { gDrawPixel(cx, cy, c); return; }
  if (CLIP_X0 <= 0 && CLIP_X1 >= SCREEN_W - 1) {
    gFillCircle(cx, cy, ir, c);
    return;
  }
  var icx = Math.round(cx), icy = Math.round(cy);
  var dy, py, dx, x0, x1;
  for (dy = -ir; dy <= ir; dy++) {
    py = icy + dy;
    if (py < HUD_H || py >= SCREEN_H) continue;
    dx = Math.round(FM.sqrt(Math.max(0, ir * ir - dy * dy)));
    x0 = Math.max(CLIP_X0, icx - dx);
    x1 = Math.min(CLIP_X1, icx + dx);
    if (x1 >= x0) gDrawLine(x0, py, x1, py, c);
  }
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

function fillQuad(x0, y0, x1, y1, x2, y2, x3, y3, color) {
  _qx[0] = x0; _qy[0] = y0;
  _qx[1] = x1; _qy[1] = y1;
  _qx[2] = x2; _qy[2] = y2;
  _qx[3] = x3; _qy[3] = y3;

  var minY = y0, maxY = y0, i;
  for (i = 1; i < 4; i++) {
    if (_qy[i] < minY) minY = _qy[i];
    if (_qy[i] > maxY) maxY = _qy[i];
  }
  var yStart = Math.max(HUD_H, Math.floor(minY));
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
      if (rightX < CLIP_X0 || leftX > CLIP_X1) continue;
      if (leftX < CLIP_X0) leftX = CLIP_X0;
      if (rightX > CLIP_X1) rightX = CLIP_X1;
      gDrawLine(Math.round(leftX), y, Math.round(rightX), y, color);
    }
  }
}

function fillTri(x0, y0, x1, y1, x2, y2, color) {
  fillQuad(x0, y0, x1, y1, x2, y2, x2, y2, color);
}

function drawLimb(ax, ay, bx, by, wA, wB, col) {
  var dx = bx - ax;
  var dy = by - ay;
  var len = FM.sqrt(dx * dx + dy * dy);
  if (len < 0.7) {
    drawClippedCircle(ax, ay, Math.max(1, Math.round(wA)), col);
    return;
  }
  var nx = -dy / len;
  var ny = dx / len;
  fillQuad(
    ax + nx * wA, ay + ny * wA,
    ax - nx * wA, ay - ny * wA,
    bx - nx * wB, by - ny * wB,
    bx + nx * wB, by + ny * wB,
    col
  );
  if (wA >= 1.4) drawClippedCircle(ax, ay, Math.round(wA), col);
  if (wB >= 1.4) drawClippedCircle(bx, by, Math.round(wB), col);
}

function drawClippedEllipse(cx, cy, rx, ry, color) {
  var iry = Math.round(ry);
  if (iry <= 0 || rx <= 0) return;
  var icx = Math.round(cx), icy = Math.round(cy);
  var dy, py, norm, sq, dx, x0, x1;
  for (dy = -iry; dy <= iry; dy++) {
    py = icy + dy;
    if (py < HUD_H || py >= SCREEN_H) continue;
    norm = dy / iry;
    sq = Math.max(0, 1 - norm * norm);
    dx = Math.round(rx * FM.sqrt(sq));
    x0 = Math.max(CLIP_X0, icx - dx);
    x1 = Math.min(CLIP_X1, icx + dx);
    if (x1 >= x0) gDrawLine(x0, py, x1, py, color);
  }
}

/* ---------------------------------------------------------
   3. PERSISTENT BEST SCORE
   --------------------------------------------------------- */
var BEST_FILE = "sector9_best.txt";
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
   4. BUNKER MAPS (12x12)
   --------------------------------------------------------- */
var MAP_W = 12;
var MAP_H = 12;

var LEVELS = [
  [
    "111111111111",
    "1P....2...A1",
    "1.33.11.33.1",
    "1....E.....1",
    "1121.22.1211",
    "1M...E....K1",
    "1.33....33.1",
    "1..B....E..1",
    "1.22.11.22.1",
    "1A........M1",
    "1.3..B..3..1",
    "111114111111"
  ],
  [
    "111111111111",
    "1P..3..E..M1",
    "1.2.3.22.2.1",
    "1.2...E....1",
    "1...22.33..1",
    "1A.B....Z.K1",
    "1...22.33..1",
    "1.2...E....1",
    "1.2.3.22.2.1",
    "1M..B.....A1",
    "1...3..3...1",
    "111114111111"
  ],
  [
    "111111111111",
    "1P..2..B..A1",
    "1.3.2.33.2.1",
    "1..E.....E.1",
    "122.1..1.221",
    "1K..Z..M..B1",
    "122.1..1.221",
    "1.E......E.1",
    "1.3.2.33.2.1",
    "1A...Z....M1",
    "1....3.....1",
    "111114111111"
  ]
];

var worldMap = [];

/* ---------------------------------------------------------
   5. GAME STATE, RAYCASTER & HUMAN ARMY SPRITE POOLS
   --------------------------------------------------------- */
var STATE_TITLE = 0;
var STATE_PLAY = 1;
var STATE_CLEAR = 2;
var STATE_GAME_OVER = 3;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;
var controlLockUntil = 0;

var is3DMode = true;
var modeToastText = "";
var modeToastUntil = 0;

function toggle2D3D(now) {
  is3DMode = !is3DMode;
  modeToastText = is3DMode ? "3D FPS" : "2D TOP";
  modeToastUntil = now + 1500;
}

var levelNum = 1;
var score = 0;
var clearTimer = 0;
var msgText = "";
var msgUntil = 0;

var player = {
  x: 1.5, y: 1.5,
  ang: 0.4,
  hp: 100,
  ammo: 24,
  hasKey: false,
  walkPhase: 0,
  recoil: 0,
  shootCool: 0,
  hitmarker: 0,
  hurtFlash: 0,
  fwdInput: 0,
  turnInput: 0
};

var STRIP_W = 4;
var NUM_COLS = 80;
var zBuf = [];

var MAX_SPR = 16;
var sprites = [];
var sprOrder = [];
(function initSprPool() {
  var i;
  for (i = 0; i < MAX_SPR; i++) {
    sprites.push({
      active: false, kind: 0, x: 0, y: 0,
      hp: 2, maxHp: 2, flash: 0, fireCd: 1.5,
      distSq: 0, dirA: 0,
      walkPhase: 0, isMoving: false,
      aimFlash: 0, dying: 0
    });
    sprOrder.push(i);
  }
})();

// Pre-allocated soldier skeleton joints
var _sk = {
  px: 0, py: 0, nx: 0, ny: 0, hx: 0, hy: 0,
  shLx: 0, shLy: 0, shRx: 0, shRy: 0,
  elLx: 0, elLy: 0, elRx: 0, elRy: 0,
  haLx: 0, haLy: 0, haRx: 0, haRy: 0,
  hpLx: 0, hpLy: 0, hpRx: 0, hpRy: 0,
  knLx: 0, knLy: 0, knRx: 0, knRy: 0,
  ftLx: 0, ftLy: 0, ftRx: 0, ftRy: 0
};

var MAX_BULLETS = 10;
var bullets = [];
(function initBullets() {
  var i;
  for (i = 0; i < MAX_BULLETS; i++) {
    bullets.push({ active: false, fromPlayer: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  }
})();

var MAX_FX = 18;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: C_CYAN });
  }
})();

function spawnFx(x, y, color, count) {
  var i, s = 0, a, sp, pt;
  for (i = 0; i < MAX_FX && s < count; i++) {
    pt = fxPool[i];
    if (!pt.active) {
      a = (6.2831853 * s) / count + FM.random() * 0.5;
      sp = 1.4 + FM.random() * 2.6;
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

function addScore(pts) {
  score += pts;
  if (score > bestScore) {
    bestScore = score;
    saveBestScore();
  }
}

function showMsg(txt, now, durMs) {
  msgText = txt;
  msgUntil = now + (durMs || 1500);
}

function getTile(gx, gy) {
  if (gx < 0 || gy < 0 || gx >= MAP_W || gy >= MAP_H) return 1;
  return worldMap[gy * MAP_W + gx];
}

function isBlocked(x, y) {
  var gx = Math.floor(x);
  var gy = Math.floor(y);
  var t = getTile(gx, gy);
  if (t === 0) return false;
  if (t === 4 && player.hasKey) return false;
  return true;
}

function spawnSprite(kind, x, y) {
  var i, s;
  for (i = 0; i < MAX_SPR; i++) {
    s = sprites[i];
    if (!s.active) {
      s.active = true;
      s.kind = kind;
      s.x = x; s.y = y;
      s.flash = 0;
      s.fireCd = 1.0 + FM.random() * 1.5;
      s.dirA = FM.random() * 6.28;
      s.walkPhase = FM.random() * 6.28;
      s.isMoving = false;
      s.aimFlash = 0;
      s.dying = 0;
      if (kind === 0) { s.hp = 2; s.maxHp = 2; }
      else if (kind === 1) { s.hp = 3 + (levelNum > 2 ? 1 : 0); s.maxHp = s.hp; }
      else if (kind === 2) { s.hp = 6; s.maxHp = 6; }
      else { s.hp = 1; s.maxHp = 1; }
      return;
    }
  }
}

function loadLevel(lvl) {
  levelNum = lvl;
  var map = LEVELS[(lvl - 1) % LEVELS.length];
  var x, y, ch, i;

  for (i = 0; i < MAX_SPR; i++) sprites[i].active = false;
  for (i = 0; i < MAX_BULLETS; i++) bullets[i].active = false;
  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;

  player.hasKey = false;
  player.recoil = 0;
  player.shootCool = 0;
  player.hitmarker = 0;
  player.hurtFlash = 0;

  for (y = 0; y < MAP_H; y++) {
    for (x = 0; x < MAP_W; x++) {
      ch = map[y].charAt(x);
      i = y * MAP_W + x;
      if (ch === "1") worldMap[i] = 1;
      else if (ch === "2") worldMap[i] = 2;
      else if (ch === "3") worldMap[i] = 3;
      else if (ch === "4") worldMap[i] = 4;
      else {
        worldMap[i] = 0;
        if (ch === "P") { player.x = x + 0.5; player.y = y + 0.5; player.ang = 0.25; }
        else if (ch === "E") spawnSprite(0, x + 0.5, y + 0.5);
        else if (ch === "B") spawnSprite(1, x + 0.5, y + 0.5);
        else if (ch === "Z") spawnSprite(2, x + 0.5, y + 0.5);
        else if (ch === "K") spawnSprite(10, x + 0.5, y + 0.5);
        else if (ch === "M") spawnSprite(11, x + 0.5, y + 0.5);
        else if (ch === "A") spawnSprite(12, x + 0.5, y + 0.5);
      }
    }
  }
  showMsg("SECTOR " + lvl + ": FIND KEY!", nowMs(), 2200);
}

function startNewGame() {
  controlLockUntil = nowMs() + 260;
  score = 0;
  player.hp = 100;
  player.ammo = 24;
  isPaused = false;
  gameState = STATE_PLAY;
  loadLevel(1);
}

/* ---------------------------------------------------------
   6. COMBAT, ARMY AI & MOVEMENT SIMULATION
   --------------------------------------------------------- */
function hasLOS(x0, y0, x1, y1) {
  var dx = x1 - x0;
  var dy = y1 - y0;
  var steps = 8, k, tx, ty;
  for (k = 1; k < steps; k++) {
    tx = x0 + (dx * k) / steps;
    ty = y0 + (dy * k) / steps;
    if (getTile(Math.floor(tx), Math.floor(ty)) > 0) return false;
  }
  return true;
}

function firePlayerWeapon(now) {
  if (gameState !== STATE_PLAY || isPaused || player.shootCool > 0) return;

  var usePlasma = (player.ammo > 0);
  if (usePlasma) player.ammo--;
  player.shootCool = usePlasma ? 0.22 : 0.34;
  player.recoil = 1.0;

  var dirX = FM.cos(player.ang);
  var dirY = FM.sin(player.ang);

  var i, b;
  for (i = 0; i < MAX_BULLETS; i++) {
    b = bullets[i];
    if (!b.active) {
      b.active = true;
      b.fromPlayer = true;
      b.x = player.x + dirX * 0.3;
      b.y = player.y + dirY * 0.3;
      b.vx = dirX * 11.0;
      b.vy = dirY * 11.0;
      b.life = 1.2;
      break;
    }
  }

  var bestIdx = -1, bestDist = 999;
  var s, dx, dy, dist, angTo, diffA;
  for (i = 0; i < MAX_SPR; i++) {
    s = sprites[i];
    if (!s.active || s.kind >= 10 || s.dying > 0) continue;
    dx = s.x - player.x;
    dy = s.y - player.y;
    dist = FM.sqrt(dx * dx + dy * dy);
    if (dist > 8.5) continue;
    angTo = Math.atan2(dy, dx);
    diffA = angTo - player.ang;
    while (diffA > 3.14159) diffA -= 6.28318;
    while (diffA < -3.14159) diffA += 6.28318;
    if (Math.abs(diffA) < (0.16 / Math.max(0.5, dist * 0.25)) && dist < bestDist && hasLOS(player.x, player.y, s.x, s.y)) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    var tgt = sprites[bestIdx];
    tgt.hp -= 1;
    tgt.flash = 0.16;
    player.hitmarker = 0.18;
    spawnFx(SCREEN_W >> 1, ((SCREEN_H - HUD_H) >> 1) + HUD_H, C_GOLD, 6);
    if (tgt.hp <= 0) {
      tgt.dying = 0.36; // Trigger falling collapse animation!
      var pts = (tgt.kind === 2) ? 200 : ((tgt.kind === 1) ? 100 : 50);
      addScore(pts);
      spawnFx(SCREEN_W >> 1, ((SCREEN_H - HUD_H) >> 1) + HUD_H, C_RED, 12);
    }
  }
}

function updateSimulation(dt, now) {
  var i, pt;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (!pt.active) continue;
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life -= dt * 2.4;
    if (pt.life <= 0) pt.active = false;
  }

  if (gameState === STATE_CLEAR) {
    clearTimer -= dt;
    if (clearTimer <= 0) {
      gameState = STATE_PLAY;
      loadLevel(levelNum + 1);
    }
    return;
  }

  if (gameState !== STATE_PLAY || isPaused) return;

  if (player.recoil > 0) player.recoil = Math.max(0, player.recoil - dt * 5.0);
  if (player.shootCool > 0) player.shootCool = Math.max(0, player.shootCool - dt);
  if (player.hitmarker > 0) player.hitmarker = Math.max(0, player.hitmarker - dt);
  if (player.hurtFlash > 0) player.hurtFlash = Math.max(0, player.hurtFlash - dt);

  player.ang += player.turnInput * 2.55 * dt;
  var moveSpd = 2.9 * player.fwdInput;
  if (Math.abs(moveSpd) > 0.1) {
    player.walkPhase += dt * 11;
    var nx = player.x + FM.cos(player.ang) * moveSpd * dt;
    var ny = player.y + FM.sin(player.ang) * moveSpd * dt;
    var pad = 0.24;
    if (!isBlocked(nx + (nx > player.x ? pad : -pad), player.y)) player.x = nx;
    if (!isBlocked(player.x, ny + (ny > player.y ? pad : -pad))) player.y = ny;
  }

  if (player.hasKey) {
    var gx = Math.floor(player.x);
    var gy = Math.floor(player.y);
    if (getTile(gx, gy) === 4 || (player.y > MAP_H - 1.35 && Math.abs(player.x - 5.5) < 0.75)) {
      addScore(300 * levelNum);
      clearTimer = 1.6;
      gameState = STATE_CLEAR;
      return;
    }
  }

  var s, dx, dy, dist, dSq;
  for (i = 0; i < MAX_SPR; i++) {
    s = sprites[i];
    if (!s.active) continue;
    if (s.flash > 0) s.flash = Math.max(0, s.flash - dt);
    if (s.aimFlash > 0) s.aimFlash = Math.max(0, s.aimFlash - dt);

    dx = player.x - s.x;
    dy = player.y - s.y;
    dSq = dx * dx + dy * dy;
    s.distSq = dSq;

    if (s.dying > 0) {
      s.dying -= dt;
      if (s.dying <= 0) {
        s.active = false;
        if (s.kind === 2) spawnSprite(11, s.x, s.y);
      }
      continue;
    }

    if (s.kind >= 10) {
      if (dSq < 0.36) {
        s.active = false;
        if (s.kind === 10) {
          player.hasKey = true;
          addScore(100);
          showMsg("KEYCARD! GO TO EXIT!", now, 2200);
        } else if (s.kind === 11) {
          player.hp = Math.min(100, player.hp + 35);
          showMsg("+35 HEALTH", now, 1200);
        } else if (s.kind === 12) {
          player.ammo = Math.min(50, player.ammo + 14);
          showMsg("+14 AMMO", now, 1200);
        }
      }
      continue;
    }

    dist = FM.sqrt(dSq);
    s.isMoving = false;
    if (dist < 7.2 && hasLOS(s.x, s.y, player.x, player.y)) {
      s.dirA = Math.atan2(dy, dx);
      if (dist > 1.35) {
        var eSpd = (s.kind === 0) ? 1.15 : ((s.kind === 1) ? 0.85 : 0.65);
        var enx = s.x + (dx / dist) * eSpd * dt;
        var eny = s.y + (dy / dist) * eSpd * dt;
        if (getTile(Math.floor(enx), Math.floor(s.y)) === 0) { s.x = enx; s.isMoving = true; }
        if (getTile(Math.floor(s.x), Math.floor(eny)) === 0) { s.y = eny; s.isMoving = true; }
        if (s.isMoving) s.walkPhase += dt * 9.5;
      }

      s.fireCd -= dt;
      if (s.fireCd <= 0) {
        s.fireCd = Math.max(0.85, (s.kind === 2 ? 1.15 : 1.75) - levelNum * 0.12) + FM.random() * 0.6;
        s.aimFlash = 0.22;
        var k, b;
        for (k = 0; k < MAX_BULLETS; k++) {
          b = bullets[k];
          if (!b.active) {
            b.active = true;
            b.fromPlayer = false;
            b.x = s.x;
            b.y = s.y;
            var bSpd = 3.2 + levelNum * 0.35;
            b.vx = (dx / Math.max(0.2, dist)) * bSpd;
            b.vy = (dy / Math.max(0.2, dist)) * bSpd;
            b.life = 2.4;
            break;
          }
        }
      }
    }
  }

  var b, bx, by;
  for (i = 0; i < MAX_BULLETS; i++) {
    b = bullets[i];
    if (!b.active) continue;
    b.life -= dt;
    if (b.life <= 0) { b.active = false; continue; }

    bx = b.x + b.vx * dt;
    by = b.y + b.vy * dt;
    if (getTile(Math.floor(bx), Math.floor(by)) > 0) {
      b.active = false;
      continue;
    }
    b.x = bx;
    b.y = by;

    if (!b.fromPlayer) {
      var pdx = b.x - player.x;
      var pdy = b.y - player.y;
      if (pdx * pdx + pdy * pdy < 0.16) {
        b.active = false;
        player.hp -= (8 + levelNum * 2);
        player.hurtFlash = 0.25;
        if (player.hp <= 0) {
          player.hp = 0;
          gameState = STATE_GAME_OVER;
          return;
        }
      }
    }
  }
}

/* ---------------------------------------------------------
   7. RIGGED HUMAN ARMY SOLDIER & 3D/2D RENDERERS
   --------------------------------------------------------- */
function drawArmySoldier3D(sp, sx, floorY, sprH) {
  var u = sprH / 38.0; // Base scale unit (standing height ~ 38*u)

  // Compact silhouette when very far away (> 7 tiles)
  if (sprH < 12) {
    var sw = Math.max(2, Math.round(5 * u));
    var sh = Math.max(4, Math.round(sprH * 0.78));
    var c0 = (sp.flash > 0) ? C_WHITE : ((sp.kind === 0) ? C_ARMY_OLIVE : ((sp.kind === 1) ? C_ARMY_TAN : C_ARMY_SPEC));
    drawClippedRect(sx - sw, floorY - sh, sw * 2, sh, c0);
    drawClippedRect(sx - sw, floorY - sh - 2, sw * 2, 2, (sp.kind === 1) ? C_ARMY_BERET : C_ARMY_HELM);
    return;
  }

  // Uniform palette by soldier class
  var hitFl = (sp.flash > 0);
  var clothC  = hitFl ? C_WHITE : ((sp.kind === 0) ? C_ARMY_OLIVE : ((sp.kind === 1) ? C_ARMY_TAN : C_ARMY_SPEC));
  var vestC   = hitFl ? C_WHITE : ((sp.kind === 0) ? C_ARMY_VEST  : ((sp.kind === 1) ? C_ARMY_TAN_DK : C_ARMY_SPEC_DK));
  var helmC   = hitFl ? C_WHITE : ((sp.kind === 0) ? C_ARMY_HELM  : ((sp.kind === 1) ? C_ARMY_BERET : C_ARMY_SPEC_DK));
  var skinC   = hitFl ? C_WHITE : C_SKIN;
  var wideMul = (sp.kind === 2) ? 1.24 : 1.0;

  // Rig Pose Angles & Collapse State
  var fallProg = (sp.dying > 0) ? clamp(1.0 - (sp.dying / 0.36), 0, 1) : 0;
  var flinch = (sp.flash > 0 && sp.dying <= 0) ? -0.22 : 0;
  var stride = (sp.isMoving && fallProg === 0) ? FM.sin(sp.walkPhase) : 0;
  var bob = Math.abs(stride) * 1.4 * u;

  var bodyRot = flinch + fallProg * 1.38;
  var spAng = bodyRot - 1.5707963;
  var ux = FM.cos(spAng), uy = FM.sin(spAng);
  var rx = -uy, ry = ux;

  // Ground shadow anchored at floorY
  drawClippedEllipse(sx + fallProg * 10 * u, floorY, Math.max(4, (8 + fallProg * 8) * u), Math.max(2, 2.8 * u), C_SHADOW);

  // Pelvis drops smoothly to floor during death collapse
  var legH = 16.0 * u;
  var pelvY = floorY - lerp(legH - bob, 4.0 * u, fallProg);
  var pelvX = sx + fallProg * 4 * u;

  _sk.px = pelvX; _sk.py = pelvY;
  _sk.nx = pelvX + ux * (13.5 * u);
  _sk.ny = pelvY + uy * (13.5 * u);
  _sk.hx = _sk.nx + ux * (4.2 * u);
  _sk.hy = _sk.ny + uy * (4.2 * u);

  var shHalf = 5.4 * wideMul * u;
  var hpHalf = 3.2 * wideMul * u;
  _sk.shLx = _sk.nx - rx * shHalf; _sk.shLy = _sk.ny - ry * shHalf;
  _sk.shRx = _sk.nx + rx * shHalf; _sk.shRy = _sk.ny + ry * shHalf;
  _sk.hpLx = _sk.px - rx * hpHalf; _sk.hpLy = _sk.py - ry * hpHalf;
  _sk.hpRx = _sk.px + rx * hpHalf; _sk.hpRy = _sk.py + ry * hpHalf;

  // 2-Bone Legs (Combat stance + marching stride)
  var downAng = bodyRot + 1.5707963;
  var thL = downAng + 0.24 - stride * 0.28 - fallProg * 0.2;
  var shL = thL - 0.16 + Math.max(0, stride) * 0.35;
  var thR = downAng - 0.24 + stride * 0.28 + fallProg * 0.35;
  var shR = thR + 0.16 + Math.max(0, -stride) * 0.35;

  var thighLen = 8.2 * u, shinLen = 7.8 * u;
  _sk.knLx = _sk.hpLx + FM.cos(thL) * thighLen;
  _sk.knLy = _sk.hpLy + FM.sin(thL) * thighLen;
  _sk.ftLx = _sk.knLx + FM.cos(shL) * shinLen;
  _sk.ftLy = _sk.knLy + FM.sin(shL) * shinLen;

  _sk.knRx = _sk.hpRx + FM.cos(thR) * thighLen;
  _sk.knRy = _sk.hpRy + FM.sin(thR) * thighLen;
  _sk.ftRx = _sk.knRx + FM.cos(shR) * shinLen;
  _sk.ftRy = _sk.knRy + FM.sin(shR) * shinLen;

  // 2-Bone Arms holding rifle across chest / aiming forward
  var recoilKick = (sp.aimFlash > 0) ? 1.8 * u : 0;
  var aimLift = (sp.aimFlash > 0) ? -1.4 * u : 0;
  var gunX = _sk.px + ux * (9.5 * u) - rx * (1.2 * u) - ux * recoilKick;
  var gunY = _sk.py + uy * (9.5 * u) - ry * (1.2 * u) + aimLift;

  // Left arm reaches across to support rifle barrel; Right arm holds trigger grip
  _sk.elLx = _sk.shLx - rx * (1.5 * u) + ux * (-4.5 * u);
  _sk.elLy = _sk.shLy - ry * (1.5 * u) + uy * (-4.5 * u);
  _sk.haLx = gunX - rx * (2.8 * u);
  _sk.haLy = gunY - ry * (2.8 * u);

  _sk.elRx = _sk.shRx + rx * (1.8 * u) + ux * (-4.2 * u);
  _sk.elRy = _sk.shRy + ry * (1.8 * u) + uy * (-4.2 * u);
  _sk.haRx = gunX + rx * (2.2 * u);
  _sk.haRy = gunY + ry * (2.2 * u);

  // 1. Draw Legs & Combat Boots
  drawLimb(_sk.hpLx, _sk.hpLy, _sk.knLx, _sk.knLy, 2.2 * u, 1.8 * u, clothC);
  drawLimb(_sk.knLx, _sk.knLy, _sk.ftLx, _sk.ftLy, 1.7 * u, 1.4 * u, clothC);
  drawClippedCircle(_sk.ftLx, _sk.ftLy, Math.max(2, Math.round(2.0 * u)), C_BOOT);

  drawLimb(_sk.hpRx, _sk.hpRy, _sk.knRx, _sk.knRy, 2.2 * u, 1.8 * u, clothC);
  drawLimb(_sk.knRx, _sk.knRy, _sk.ftRx, _sk.ftRy, 1.7 * u, 1.4 * u, clothC);
  drawClippedCircle(_sk.ftRx, _sk.ftRy, Math.max(2, Math.round(2.0 * u)), C_BOOT);

  // 2. Draw Torso + Tactical Vest + Waist Belt
  fillQuad(_sk.shLx, _sk.shLy, _sk.shRx, _sk.shRy, _sk.hpRx, _sk.hpRy, _sk.hpLx, _sk.hpLy, vestC);
  drawLimb(_sk.hpLx, _sk.hpLy, _sk.hpRx, _sk.hpRy, 1.0 * u, 1.0 * u, C_BOOT);

  // 3. Neck, Head, Face/Goggles & Helmet/Beret
  drawLimb(_sk.nx, _sk.ny, _sk.hx, _sk.hy, 1.5 * u, 1.5 * u, C_SKIN_DK);
  var headR = Math.max(2, Math.round(3.7 * u));
  drawClippedCircle(_sk.hx, _sk.hy, headR, skinC);

  if (sp.kind === 1) {
    // Red Commando Beret tilted + dark tactical goggles
    drawClippedCircle(_sk.hx + ux * (headR * 0.45) - rx * (0.8 * u), _sk.hy + uy * (headR * 0.45), Math.max(2, headR), helmC);
    drawLimb(_sk.hx - rx * (headR * 0.65), _sk.hy - ry * (headR * 0.65), _sk.hx + rx * (headR * 0.65), _sk.hy + ry * (headR * 0.65), 1.0 * u, 1.0 * u, C_BLACK);
  } else if (sp.kind === 2) {
    // Heavy Spec-Ops Kevlar Helmet + Glowing Red Visor Strip
    drawClippedCircle(_sk.hx + ux * (headR * 0.35), _sk.hy + uy * (headR * 0.35), Math.max(2, headR + 1), helmC);
    drawLimb(_sk.hx - rx * (headR * 0.65), _sk.hy - ry * (headR * 0.65), _sk.hx + rx * (headR * 0.65), _sk.hy + ry * (headR * 0.65), 1.0 * u, 1.0 * u, C_RED);
  } else {
    // Classic Army Steel Helmet + Eyes
    drawClippedCircle(_sk.hx + ux * (headR * 0.45), _sk.hy + uy * (headR * 0.45), Math.max(2, headR), helmC);
    gDrawPixel(_sk.hx - rx * (1.2 * u), _sk.hy, C_BLACK);
    gDrawPixel(_sk.hx + rx * (1.2 * u), _sk.hy, C_BLACK);
  }

  // 4. Arms (Sleeves -> Hands)
  drawLimb(_sk.shLx, _sk.shLy, _sk.elLx, _sk.elLy, 1.8 * u, 1.5 * u, clothC);
  drawLimb(_sk.elLx, _sk.elLy, _sk.haLx, _sk.haLy, 1.4 * u, 1.2 * u, skinC);

  drawLimb(_sk.shRx, _sk.shRy, _sk.elRx, _sk.elRy, 1.8 * u, 1.5 * u, clothC);
  drawLimb(_sk.elRx, _sk.elRy, _sk.haRx, _sk.haRy, 1.4 * u, 1.2 * u, skinC);

  // 5. Assault Rifle / Heavy Weapon + Muzzle Flash
  if (fallProg < 0.7) {
    var stkX = _sk.haRx + rx * (2.6 * u);
    var stkY = _sk.haRx ? (_sk.haRy + ry * (2.6 * u)) : _sk.haRy;
    var brlX = _sk.haLx - rx * (5.2 * u);
    var brlY = _sk.haLy - ry * (5.2 * u);
    drawLimb(stkX, stkY, _sk.haLx, _sk.haLy, 1.4 * u, 1.3 * u, (sp.kind === 0) ? C_RIFLE_WOOD : C_RIFLE);
    drawLimb(_sk.haLx, _sk.haLy, brlX, brlY, 1.0 * u, 0.9 * u, C_RIFLE);

    if (sp.aimFlash > 0.08) {
      drawClippedCircle(brlX, brlY, Math.max(2, Math.round(3.6 * u)), C_MUZZLE);
      drawClippedCircle(brlX, brlY, Math.max(1, Math.round(1.8 * u)), C_WHITE);
    }
  }

  // 6. Soldier Health Bar above helmet if wounded
  if (sp.hp < sp.maxHp && sp.dying <= 0) {
    var barW = Math.max(8, Math.round(12 * u));
    var barY = Math.round(_sk.hy - headR - 5);
    drawClippedRect(sx - (barW >> 1), barY, barW, 2, C_BLACK);
    drawClippedRect(sx - (barW >> 1), barY, Math.max(1, Math.round((barW * sp.hp) / sp.maxHp)), 2, C_GREEN);
  }
}

function sortSpritesFarToNear() {
  var i, j, keyIdx;
  for (i = 1; i < MAX_SPR; i++) {
    keyIdx = sprOrder[i];
    j = i - 1;
    while (j >= 0 && sprites[sprOrder[j]].distSq < sprites[keyIdx].distSq) {
      sprOrder[j + 1] = sprOrder[j];
      j--;
    }
    sprOrder[j + 1] = keyIdx;
  }
}

function draw3DFirstPerson(now) {
  var viewH = SCREEN_H - HUD_H;
  var halfViewH = viewH >> 1;
  var horizonY = HUD_H + halfViewH + Math.round(FM.sin(player.walkPhase) * (Math.abs(player.fwdInput) > 0.1 ? 2.5 : 0));

  var bandH = Math.ceil(halfViewH / 4) + 1;
  var b;
  for (b = 0; b < 4; b++) {
    gFillRect(0, HUD_H + b * bandH, SCREEN_W, bandH, CEIL_BANDS[b]);
    gFillRect(0, horizonY + b * bandH, SCREEN_W, bandH, FLOOR_BANDS[b]);
  }

  var dirX = FM.cos(player.ang);
  var dirY = FM.sin(player.ang);
  var planeX = -dirY * 0.66;
  var planeY = dirX * 0.66;

  var c, camX, rdx, rdy, mapX, mapY, ddx, ddy, stepX, stepY, sdx, sdy, hit, side, steps;
  var perpDist, lineH, drawStart, drawEnd, wallX, shade, colC, trimC, sx;

  for (c = 0; c < NUM_COLS; c++) {
    camX = (2 * c) / NUM_COLS - 1;
    rdx = dirX + planeX * camX;
    rdy = dirY + planeY * camX;

    mapX = Math.floor(player.x);
    mapY = Math.floor(player.y);

    ddx = (rdx === 0) ? 1e6 : Math.abs(1 / rdx);
    ddy = (rdy === 0) ? 1e6 : Math.abs(1 / rdy);

    if (rdx < 0) { stepX = -1; sdx = (player.x - mapX) * ddx; }
    else { stepX = 1; sdx = (mapX + 1.0 - player.x) * ddx; }

    if (rdy < 0) { stepY = -1; sdy = (player.y - mapY) * ddy; }
    else { stepY = 1; sdy = (mapY + 1.0 - player.y) * ddy; }

    hit = 0; side = 0; steps = 0;
    while (hit === 0 && steps < 22) {
      steps++;
      if (sdx < sdy) {
        sdx += ddx; mapX += stepX; side = 0;
      } else {
        sdy += ddy; mapY += stepY; side = 1;
      }
      hit = getTile(mapX, mapY);
    }
    if (hit === 0) hit = 1;

    perpDist = (side === 0) ? (sdx - ddx) : (sdy - ddy);
    if (perpDist < 0.08) perpDist = 0.08;
    zBuf[c] = perpDist;

    lineH = Math.round(viewH / perpDist);
    drawStart = Math.max(HUD_H, horizonY - (lineH >> 1));
    drawEnd = Math.min(SCREEN_H - 1, horizonY + (lineH >> 1));

    wallX = (side === 0) ? (player.y + perpDist * rdy) : (player.x + perpDist * rdx);
    wallX -= Math.floor(wallX);

    shade = clamp(Math.floor(perpDist * 1.45), 0, 15);
    if (hit === 4 && player.hasKey) {
      colC = C_GREEN;
    } else if (wallX < 0.05 || wallX > 0.95) {
      colC = C_BLACK;
    } else {
      colC = WALL_SHADES[hit][side][shade];
    }

    sx = c * STRIP_W;
    gFillRect(sx, drawStart, STRIP_W, drawEnd - drawStart + 1, colC);

    if ((hit === 2 || hit === 4) && lineH >= 14) {
      trimC = (hit === 4) ? (player.hasKey ? C_GREEN : C_RED) : C_CYAN;
      gFillRect(sx, horizonY - Math.max(1, (lineH * 0.06) | 0), STRIP_W, Math.max(2, (lineH * 0.12) | 0), trimC);
    }
  }

  sortSpritesFarToNear();
  var invDet = 1.0 / (planeX * dirY - dirX * planeY);
  var i, sp, dx, dy, tx, ty, sprScreenX, sprH, floorY, colIdx, visL, visR;

  for (i = 0; i < MAX_SPR; i++) {
    sp = sprites[sprOrder[i]];
    if (!sp.active) continue;

    dx = sp.x - player.x;
    dy = sp.y - player.y;
    tx = invDet * (dirY * dx - dirX * dy);
    ty = invDet * (-planeY * dx + planeX * dy);
    if (ty <= 0.24) continue;

    sprScreenX = Math.round((SCREEN_W * 0.5) * (1 + tx / ty));
    sprH = Math.round((viewH * 0.78) / ty);
    if (sprH < 4) continue;

    // Find contiguous visible Z-buffer bounds for wall clipping!
    var halfSpan = Math.max(4, (sprH * 0.34) | 0);
    var colL = clamp(Math.floor((sprScreenX - halfSpan) / STRIP_W), 0, NUM_COLS - 1);
    var colR = clamp(Math.floor((sprScreenX + halfSpan) / STRIP_W), 0, NUM_COLS - 1);

    visL = 9999; visR = -1;
    for (colIdx = colL; colIdx <= colR; colIdx++) {
      if (ty < zBuf[colIdx]) {
        if (colIdx < visL) visL = colIdx;
        if (colIdx > visR) visR = colIdx;
      }
    }
    if (visL > visR) continue;

    CLIP_X0 = visL * STRIP_W;
    CLIP_X1 = Math.min(SCREEN_W - 1, (visR + 1) * STRIP_W - 1);

    floorY = horizonY + Math.round((viewH * 0.50) / ty);

    if (sp.kind >= 10) {
      var pr = Math.max(2, Math.round(sprH * 0.16));
      var py = floorY - pr - 2;
      if (sp.kind === 10) {
        var ky = py - Math.round(Math.abs(FM.sin(now * 0.008)) * 4);
        drawClippedRect(sprScreenX - pr, ky - (pr >> 1), pr * 2, pr, C_GOLD);
        drawClippedCircle(sprScreenX - (pr >> 1), ky, Math.max(1, pr >> 2), C_BLACK);
      } else if (sp.kind === 11) {
        drawClippedRect(sprScreenX - pr, py - pr, pr * 2, pr * 2, C_WHITE);
        drawClippedRect(sprScreenX - (pr >> 1), py - 1, pr, 3, C_RED);
        drawClippedRect(sprScreenX - 1, py - (pr >> 1), 3, pr, C_RED);
      } else {
        drawClippedRect(sprScreenX - (pr >> 1), py - pr, pr, pr * 2, C_BLUE);
        drawClippedRect(sprScreenX - (pr >> 1), py - pr, pr, Math.max(2, pr >> 1), C_CYAN);
      }
    } else {
      drawArmySoldier3D(sp, sprScreenX, floorY, sprH);
    }
  }

  CLIP_X0 = 0;
  CLIP_X1 = SCREEN_W - 1;

  var blt;
  for (i = 0; i < MAX_BULLETS; i++) {
    blt = bullets[i];
    if (!blt.active) continue;
    dx = blt.x - player.x;
    dy = blt.y - player.y;
    tx = invDet * (dirY * dx - dirX * dy);
    ty = invDet * (-planeY * dx + planeX * dy);
    if (ty <= 0.25) continue;
    var bx = Math.round((SCREEN_W * 0.5) * (1 + tx / ty));
    var bc = clamp(Math.floor(bx / STRIP_W), 0, NUM_COLS - 1);
    if (ty >= zBuf[bc]) continue;
    var br = Math.max(2, Math.round(5 / ty));
    gFillCircle(bx, horizonY, br, blt.fromPlayer ? C_CYAN : C_GOLD);
  }

  var gunBobX = Math.round(FM.cos(player.walkPhase * 0.5) * (Math.abs(player.fwdInput) > 0.1 ? 4 : 0));
  var gunBobY = Math.round(Math.abs(FM.sin(player.walkPhase)) * (Math.abs(player.fwdInput) > 0.1 ? 4 : 0)) + Math.round(player.recoil * 10);
  var gx = (SCREEN_W >> 1) + gunBobX;
  var gy = SCREEN_H - 26 + gunBobY;

  if (player.recoil > 0.65) {
    gFillCircle(gx, gy - 14, 10, C_MUZZLE);
    gFillCircle(gx, gy - 14, 5, C_WHITE);
  }

  gFillRect(gx - 12, gy, 24, 30, C_GUN_DARK);
  gFillRect(gx - 8, gy - 10, 16, 22, C_GUN_BODY);
  gFillRect(gx - 3, gy - 14, 6, 10, C_GUN_COIL);

  var chX = SCREEN_W >> 1, chY = HUD_H + halfViewH;
  gDrawLine(chX - 5, chY, chX - 2, chY, C_WHITE);
  gDrawLine(chX + 2, chY, chX + 5, chY, C_WHITE);
  gDrawLine(chX, chY - 5, chX, chY - 2, C_WHITE);
  gDrawLine(chX, chY + 2, chX, chY + 5, C_WHITE);

  if (player.hitmarker > 0) {
    gDrawLine(chX - 5, chY - 5, chX - 2, chY - 2, C_GOLD);
    gDrawLine(chX + 5, chY - 5, chX + 2, chY - 2, C_GOLD);
    gDrawLine(chX - 5, chY + 5, chX - 2, chY + 2, C_GOLD);
    gDrawLine(chX + 5, chY + 5, chX + 2, chY + 2, C_GOLD);
  }
}

function draw2DTacticalView() {
  beginFrame(C_MAP_FLOOR);
  var tilePx = 22;
  var camX = SCREEN_W >> 1;
  var camY = HUD_H + ((SCREEN_H - HUD_H) >> 1);

  var f1 = player.ang - 0.55;
  var f2 = player.ang + 0.55;
  fillTri(
    camX, camY,
    camX + FM.cos(f1) * 95, camY + FM.sin(f1) * 95,
    camX + FM.cos(f2) * 95, camY + FM.sin(f2) * 95,
    C_FOV_CONE
  );

  var x, y, sx, sy, t, col;
  for (y = 0; y < MAP_H; y++) {
    sy = camY + Math.round((y - player.y) * tilePx);
    if (sy + tilePx < HUD_H || sy >= SCREEN_H) continue;
    for (x = 0; x < MAP_W; x++) {
      sx = camX + Math.round((x - player.x) * tilePx);
      if (sx + tilePx < 0 || sx >= SCREEN_W) continue;
      t = getTile(x, y);
      if (t > 0) {
        col = (t === 4) ? (player.hasKey ? C_GREEN : C_RED) : WALL_SHADES[t][0][2];
        gFillRect(sx, sy, tilePx, tilePx, col);
        gDrawRect(sx, sy, tilePx, tilePx, C_BLACK);
      }
    }
  }

  var i, sp, ex, ey;
  for (i = 0; i < MAX_SPR; i++) {
    sp = sprites[i];
    if (!sp.active) continue;
    ex = camX + Math.round((sp.x - player.x) * tilePx);
    ey = camY + Math.round((sp.y - player.y) * tilePx);
    if (sp.kind === 10) gFillRect(ex - 4, ey - 3, 8, 6, C_GOLD);
    else if (sp.kind === 11) gFillRect(ex - 4, ey - 4, 8, 8, C_WHITE);
    else if (sp.kind === 12) gFillRect(ex - 3, ey - 4, 6, 8, C_CYAN);
    else {
      // Top-down Human Army Soldier silhouette (Shoulders + Helmet + Rifle Barrel)
      var fx = FM.cos(sp.dirA), fy = FM.sin(sp.dirA);
      var rx = -fy, ry = fx;
      var ec = (sp.flash > 0) ? C_WHITE : ((sp.kind === 0) ? C_ARMY_OLIVE : ((sp.kind === 1) ? C_ARMY_TAN : C_ARMY_SPEC));
      var hc = (sp.kind === 1) ? C_ARMY_BERET : ((sp.kind === 2) ? C_ARMY_SPEC_DK : C_ARMY_HELM);
      drawLimb(ex - rx * 5, ey - ry * 5, ex + rx * 5, ey + ry * 5, 2.5, 2.5, ec);
      gFillCircle(ex, ey, 4, hc);
      gDrawLine(ex + rx * 2, ey + ry * 2, ex + fx * 10, ey + fy * 10, C_RIFLE);
      if (sp.aimFlash > 0.08) gFillCircle(ex + fx * 11, ey + fy * 11, 2, C_MUZZLE);
    }
  }

  var blt;
  for (i = 0; i < MAX_BULLETS; i++) {
    blt = bullets[i];
    if (!blt.active) continue;
    gFillCircle(
      camX + Math.round((blt.x - player.x) * tilePx),
      camY + Math.round((blt.y - player.y) * tilePx),
      2, blt.fromPlayer ? C_CYAN : C_GOLD
    );
  }

  gFillCircle(camX, camY, 6, C_GREEN);
  gDrawLine(camX, camY, camX + FM.cos(player.ang) * 12, camY + FM.sin(player.ang) * 12, C_WHITE);
}

function drawMiniRadar() {
  if (!is3DMode) return;
  var rx = SCREEN_W - 42, ry = HUD_H + 4, sc = 3;
  gFillRect(rx, ry, MAP_W * sc, MAP_H * sc, C_HUD_BG);
  gDrawRect(rx, ry, MAP_W * sc, MAP_H * sc, C_HUD_BDR);
  var x, y, t;
  for (y = 0; y < MAP_H; y++) {
    for (x = 0; x < MAP_W; x++) {
      t = getTile(x, y);
      if (t === 4) gFillRect(rx + x * sc, ry + y * sc, sc, sc, player.hasKey ? C_GREEN : C_RED);
      else if (t > 0) gFillRect(rx + x * sc, ry + y * sc, sc, sc, C_HUD_BDR);
    }
  }
  var i, sp;
  for (i = 0; i < MAX_SPR; i++) {
    sp = sprites[i];
    if (!sp.active || sp.dying > 0) continue;
    if (sp.kind === 10) gDrawPixel(rx + (sp.x * sc), ry + (sp.y * sc), C_GOLD);
    else if (sp.kind < 10) gDrawPixel(rx + (sp.x * sc), ry + (sp.y * sc), C_RED);
  }
  gFillRect(rx + (player.x * sc) - 1, ry + (player.y * sc) - 1, 3, 3, C_GREEN);
}

function drawHoldIndicator(now) {
  if (!isHolding || holdTriggered) return;
  var elapsed = now - holdStartTime;
  if (elapsed < 350) return;
  var progress = Math.min(1, elapsed / HOLD_DURATION);
  var rad = 16, segs = 12, i, a0, a1;
  var active = Math.floor(segs * progress);
  for (i = 0; i < segs; i++) {
    a0 = -1.5708 + (i * 6.2832) / segs;
    a1 = a0 + 6.2832 / segs;
    gDrawLine(holdX + rad * FM.cos(a0), holdY + rad * FM.sin(a0), holdX + rad * FM.cos(a1), holdY + rad * FM.sin(a1), i < active ? C_CYAN : C_RING_BG);
  }
}

function drawHUD(now) {
  gFillRect(0, 0, SCREEN_W, HUD_H, C_HUD_BG);
  gDrawLine(0, HUD_H - 1, SCREEN_W, HUD_H - 1, C_HUD_BDR);

  gFillRoundRect(4, 3, 18, 16, 4, C_HUD_BDR);
  gDrawText("X", 10, 7, C_WHITE, C_HUD_BDR, 1);

  gFillRoundRect(25, 3, 24, 16, 4, C_HUD_BDR);
  gDrawText(is3DMode ? "3D" : "2D", 31, 7, C_GOLD, C_HUD_BDR, 1);

  gFillRoundRect(52, 3, 16, 16, 4, showTouchDebug ? C_RED : C_HUD_BDR);
  gDrawText("?", 57, 7, C_WHITE, showTouchDebug ? C_RED : C_HUD_BDR, 1);

  var hpCol = (player.hp > 55) ? C_GREEN : ((player.hp > 25) ? C_GOLD : C_RED);
  gDrawText("HP:" + player.hp, 72, 7, hpCol, C_HUD_BG, 1);
  gDrawText("AM:" + player.ammo, 118, 7, player.ammo > 0 ? C_CYAN : C_GOLD, C_HUD_BG, 1);

  if (player.hasKey) {
    gFillRect(160, 6, 10, 10, C_GOLD);
    gDrawText("K", 162, 7, C_BLACK, C_GOLD, 1);
  }

  var scTxt = "S:" + score;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 5, 7, C_WHITE, C_HUD_BG, 1);

  if (modeToastText && now < modeToastUntil) {
    gFillRoundRect(25, HUD_H + 4, 56, 16, 6, C_HUD_BG);
    gDrawText(modeToastText, 32, HUD_H + 8, C_GOLD, C_HUD_BG, 1);
  } else if (msgText && now < msgUntil) {
    var mw = msgText.length * 6 + 12;
    gFillRoundRect((SCREEN_W - mw) >> 1, HUD_H + 4, mw, 16, 5, C_HUD_BG);
    gDrawText(msgText, ((SCREEN_W - mw) >> 1) + 6, HUD_H + 8, C_GOLD, C_HUD_BG, 1);
  }

  if (gameState === STATE_PLAY) {
    gFillRoundRect(SCREEN_W - 56, SCREEN_H - 28, 50, 22, 6, C_RED);
    gDrawRoundRect(SCREEN_W - 56, SCREEN_H - 28, 50, 22, 6, C_WHITE);
    gDrawText("FIRE", SCREEN_W - 43, SCREEN_H - 21, C_WHITE, C_RED, 1);
  }
}

var lastRawTouch = { down: false, x: 0, y: 0 };

function drawScene(now) {
  if (is3DMode) {
    beginFrame(CEIL_BANDS[0]);
    draw3DFirstPerson(now);
    drawMiniRadar();
  } else {
    draw2DTacticalView();
  }

  var i, pt;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (pt.active) gFillCircle(pt.x, pt.y, Math.max(1, (pt.life * 2.5) | 0), pt.color);
  }

  if (player.hurtFlash > 0) {
    gDrawRect(0, HUD_H, SCREEN_W, SCREEN_H - HUD_H, C_RED);
    gDrawRect(1, HUD_H + 1, SCREEN_W - 2, SCREEN_H - HUD_H - 2, C_RED);
  }

  drawHUD(now);
  drawHoldIndicator(now);

  if (gameState === STATE_TITLE) {
    var tw = Math.min(SCREEN_W - 20, 236);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 96) >> 1;
    gFillRoundRect(tx, ty, tw, 96, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 96, 10, C_GOLD);
    gDrawText("SECTOR-9: ARMY FPS", tx + ((tw - 144) >> 1), ty + 10, C_GOLD, C_HUD_BG, 2);
    gDrawText("Left Drag: Move/Turn | FIRE: Shoot", tx + ((tw - 204) >> 1), ty + 34, C_WHITE, C_HUD_BG, 1);
    gDrawText("WASD/Arrows + 5/Space | 0 = 2D/3D", tx + ((tw - 198) >> 1), ty + 48, C_CYAN, C_HUD_BG, 1);
    gDrawText("Tap or Press 5 to Enter Bunker", tx + ((tw - 180) >> 1), ty + 64, C_GREEN, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 80, C_RING_BG, C_HUD_BG, 1);
  } else if (gameState === STATE_CLEAR) {
    var cw = 180, cx = (SCREEN_W - cw) >> 1, cy = (SCREEN_H - 40) >> 1;
    gFillRoundRect(cx, cy, cw, 40, 8, C_HUD_BG);
    gDrawRoundRect(cx, cy, cw, 40, 8, C_GREEN);
    gDrawText("SECTOR " + levelNum + " CLEAR!", cx + 22, cy + 13, C_GREEN, C_HUD_BG, 2);
  } else if (isPaused) {
    var pw = 110, px = (SCREEN_W - pw) >> 1, py = (SCREEN_H - 34) >> 1;
    gFillRoundRect(px, py, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(px, py, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", px + 30, py + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 214);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 70) >> 1;
    gFillRoundRect(gx2, gy2, gw, 70, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 70, 10, C_RED);
    gDrawText("DOWN! SCORE: " + score + " B:" + bestScore, gx2 + ((gw - 150) >> 1), gy2 + 14, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(gx2 + ((gw - 96) >> 1), gy2 + 36, 96, 22, 6, C_GOLD);
    gDrawText("RETRY", gx2 + ((gw - 30) >> 1), gy2 + 43, C_BLACK, C_GOLD, 1);
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
   8. INPUT HANDLING (FPS Touch + Trackball + Keyboard)
   --------------------------------------------------------- */
var touchWasDown = false;
var touchConsumed = false;
var lastTouchDownTime = 0;
var touchOriginX = 0, touchOriginY = 0;
var touchLastX = 0;
var touchOnRightLook = false;
var keyFwdTimer = 0, keyTurnTimer = 0;

var isHolding = false, holdTriggered = false, holdStartTime = 0, holdX = 0, holdY = 0;
var HOLD_DURATION = 1200;

function handleInput(now, dt) {
  if (keyFwdTimer > 0)  { keyFwdTimer -= dt;  if (keyFwdTimer <= 0)  player.fwdInput = 0; }
  if (keyTurnTimer > 0) { keyTurnTimer -= dt; if (keyTurnTimer <= 0) player.turnInput = 0; }

  if (isHolding && !holdTriggered && (now - holdStartTime >= HOLD_DURATION)) {
    holdTriggered = true;
    isHolding = false;
    touchConsumed = true;
    toggle2D3D(now);
  }

  var ts = halReadTouch(now);
  lastRawTouch.down = ts.pressed;
  if (ts.pressed) {
    lastRawTouch.x = ts.x | 0;
    lastRawTouch.y = ts.y | 0;
    lastTouchDownTime = now;

    var tx = ts.x, ty = ts.y;

    if (!touchWasDown) {
      touchWasDown = true;
      touchConsumed = false;
      touchOriginX = tx;
      touchOriginY = ty;
      touchLastX = tx;
      touchOnRightLook = (tx > SCREEN_W * 0.52);

      isHolding = true;
      holdTriggered = false;
      holdStartTime = now;
      holdX = tx; holdY = ty;

      if (ty <= HUD_H + 4) {
        isHolding = false;
        touchConsumed = true;
        if (tx <= 23) { shouldExit = true; return; }
        if (tx <= 50) { toggle2D3D(now); return; }
        if (tx <= 69) { showTouchDebug = !showTouchDebug; return; }
        if (gameState === STATE_PLAY) {
          isPaused = !isPaused;
          if (!isPaused) controlLockUntil = now + 260;
          return;
        }
      }

      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
        isHolding = false;
        touchConsumed = true;
        startNewGame();
        return;
      }
      if (isPaused) {
        isHolding = false;
        touchConsumed = true;
        isPaused = false;
        controlLockUntil = now + 260;
        return;
      }

      if (gameState === STATE_PLAY && ty >= SCREEN_H - 32 && tx >= SCREEN_W - 60 && now >= controlLockUntil) {
        isHolding = false;
        touchConsumed = true;
        firePlayerWeapon(now);
        return;
      }
    }

    if (isHolding && (Math.abs(tx - holdX) > 10 || Math.abs(ty - holdY) > 10)) {
      isHolding = false;
    }

    if (!touchConsumed && gameState === STATE_PLAY && !isPaused && now >= controlLockUntil && ty > HUD_H + 4) {
      if (!touchOnRightLook) {
        var dx = tx - touchOriginX;
        var dy = touchOriginY - ty;
        player.turnInput = clamp(dx / 26, -1.0, 1.0);
        player.fwdInput  = clamp(dy / 26, -1.0, 1.0);
        if (Math.abs(player.turnInput) < 0.15) player.turnInput = 0;
        if (Math.abs(player.fwdInput) < 0.15)  player.fwdInput = 0;
      } else {
        var dLook = tx - touchLastX;
        player.ang += dLook * 0.015;
        touchLastX = tx;
      }
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    if (!touchConsumed && gameState === STATE_PLAY && !isPaused && !holdTriggered &&
        touchOnRightLook && (now - holdStartTime < 350) && Math.abs(lastRawTouch.x - touchOriginX) < 12 &&
        now >= controlLockUntil) {
      firePlayerWeapon(now);
    }
    touchWasDown = false;
    touchConsumed = false;
    isHolding = false;
    if (keyFwdTimer <= 0) player.fwdInput = 0;
    if (keyTurnTimer <= 0) player.turnInput = 0;
  }

  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (gameState === STATE_PLAY) {
      if (tb.dx !== 0) { player.turnInput = clamp(tb.dx, -1, 1); keyTurnTimer = 0.14; }
      if (tb.dy < 0) { player.fwdInput = clamp(-tb.dy, -1, 1); keyFwdTimer = 0.16; }
    }
    if (tb.click && now >= controlLockUntil) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) { isPaused = false; controlLockUntil = now + 260; }
      else if (gameState === STATE_PLAY) firePlayerWeapon(now);
    }
  }

  var key = halReadKey();
  if (key) {
    if (key === "q" || key === "Q" || key === "Escape" || key === "ESC") {
      shouldExit = true; return;
    }
    if (key === "0" || key === "m" || key === "M") {
      toggle2D3D(now); return;
    }
    if (key === "i" || key === "I") {
      showTouchDebug = !showTouchDebug; return;
    }
    if (key === "p" || key === "P") {
      if (gameState === STATE_PLAY) { isPaused = !isPaused; if (!isPaused) controlLockUntil = now + 260; }
      return;
    }

    if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") {
      player.fwdInput = 1; keyFwdTimer = 0.18;
    } else if (key === "8" || key === "s" || key === "S" || key === "DOWN" || key === "ArrowDown") {
      player.fwdInput = -1; keyFwdTimer = 0.18;
    } else if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") {
      player.turnInput = -1; keyTurnTimer = 0.16;
    } else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") {
      player.turnInput = 1; keyTurnTimer = 0.16;
    } else if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (now < controlLockUntil) return;
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) { isPaused = false; controlLockUntil = now + 260; }
      else if (gameState === STATE_PLAY) firePlayerWeapon(now);
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
  STRIP_W = Math.max(3, Math.floor(SCREEN_W / 80));
  NUM_COLS = Math.ceil(SCREEN_W / STRIP_W);
  var c;
  for (c = 0; c < NUM_COLS; c++) zBuf.push(999);

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

    handleInput(now, dt);
    if (shouldExit) break;

    updateSimulation(dt, now);
    drawScene(now);

    System.delay(16);
  }

  releaseDoubleBuffer();
}

main();