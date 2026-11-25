/* =========================================================
   Penalty Strike Pro - Articulated Rigging (2D/3D) KryonOS
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
   2. MATH, REALISTIC PALETTE & DOUBLE-BUFFER GRAPHICS
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

function lerp565(r1, g1, b1, r2, g2, b2, t) {
  return rgb565(
    (r1 + (r2 - r1) * t) | 0,
    (g1 + (g2 - g1) * t) | 0,
    (b1 + (b2 - b1) * t) | 0
  );
}

var SKY_BANDS = [];
(function initSky() {
  var i;
  for (i = 0; i < 6; i++) {
    SKY_BANDS.push(lerp565(10, 20, 52, 42, 74, 134, i / 5));
  }
})();

var C_STAND_ROOF = rgb565(28, 34, 58);
var C_STAND_UPPER= rgb565(44, 52, 82);
var C_STAND_LOWER= rgb565(32, 40, 64);
var C_FLOOD_POLE = rgb565(96, 108, 132);
var C_FLOOD_GLOW = rgb565(255, 250, 214);
var C_FLOOD_BEAM = rgb565(52, 82, 132);

var C_AD_BLUE    = rgb565(26, 84, 198);
var C_AD_RED     = rgb565(198, 42, 54);
var C_AD_GOLD    = rgb565(228, 174, 34);

var C_CROWD_COLS = [
  rgb565(226, 68, 82),
  rgb565(244, 204, 64),
  rgb565(74, 168, 242),
  rgb565(238, 240, 246),
  rgb565(82, 212, 118)
];

var C_TURF_A     = rgb565(50, 148, 56);
var C_TURF_B     = rgb565(40, 128, 46);
var C_TURF_WORN  = rgb565(78, 124, 54);
var C_TURF_LINE  = rgb565(228, 244, 228);
var C_SHADOW     = rgb565(20, 64, 26);
var C_SHADOW_SOFT= rgb565(30, 88, 36);

var C_NET_SHADOW = rgb565(104, 118, 138);
var C_NET_BACK   = rgb565(168, 182, 202);
var C_NET_MESH   = rgb565(212, 224, 238);
var C_POST_HI    = rgb565(254, 255, 255);
var C_POST_MID   = rgb565(214, 222, 234);
var C_POST_SHD   = rgb565(136, 148, 166);

var C_GK_SHIRT   = rgb565(246, 118, 28);
var C_GK_SHIRT_DK= rgb565(194, 78, 14);
var C_GK_SHORT   = rgb565(24, 30, 44);
var C_GK_SKIN    = rgb565(238, 186, 142);
var C_GK_SKIN_DK = rgb565(198, 144, 102);
var C_GK_HAIR    = rgb565(48, 34, 24);
var C_GK_GLOVE   = rgb565(74, 238, 114);
var C_GK_GLOVE_DK= rgb565(40, 178, 76);

var C_STR_SHIRT  = rgb565(34, 96, 224);
var C_STR_SHIRT2 = rgb565(22, 62, 160);
var C_STR_SHORT  = rgb565(242, 246, 252);
var C_STR_SOCK   = rgb565(28, 78, 192);
var C_STR_SKIN   = rgb565(224, 170, 126);
var C_STR_HAIR   = rgb565(28, 22, 20);
var C_CLEAT      = rgb565(24, 28, 36);

var C_BALL_W     = rgb565(252, 254, 255);
var C_BALL_MID   = rgb565(212, 218, 228);
var C_BALL_SHD   = rgb565(146, 154, 168);
var C_BALL_PENTA = rgb565(28, 32, 42);
var C_FIRE       = rgb565(255, 134, 32);

var C_HUD_BG     = rgb565(18, 24, 40);
var C_HUD_BDR    = rgb565(68, 88, 128);
var C_GREEN      = rgb565(64, 224, 98);
var C_RED        = rgb565(236, 56, 66);
var C_GOLD       = rgb565(255, 210, 44);
var C_CYAN       = rgb565(84, 224, 255);
var C_WHITE      = rgb565(255, 255, 255);
var C_BLACK      = rgb565(16, 18, 24);
var C_RING_BG    = rgb565(172, 198, 242);

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

function drawThickLine(x0, y0, x1, y1, thickness, c) {
  gDrawLine(x0, y0, x1, y1, c);
  if (thickness >= 2) {
    gDrawLine(x0 + 1, y0, x1 + 1, y1, c);
    gDrawLine(x0, y0 + 1, x1, y1 + 1, c);
  }
  if (thickness >= 3) {
    gDrawLine(x0 - 1, y0, x1 - 1, y1, c);
    gDrawLine(x0, y0 - 1, x1, y1 - 1, c);
  }
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

function fillTri(x0, y0, x1, y1, x2, y2, color) {
  fillQuad(x0, y0, x1, y1, x2, y2, x2, y2, color);
}

function drawLimb(ax, ay, bx, by, wA, wB, col) {
  var dx = bx - ax;
  var dy = by - ay;
  var len = FM.sqrt(dx * dx + dy * dy);
  if (len < 0.8) {
    gFillCircle(ax, ay, Math.max(1, Math.round(wA)), col);
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
  if (wA >= 1.3) gFillCircle(ax, ay, Math.round(wA), col);
  if (wB >= 1.3) gFillCircle(bx, by, Math.round(wB), col);
}

function fillEllipse(cx, cy, rx, ry, color) {
  var iry = Math.round(ry);
  if (iry <= 0 || rx <= 0) return;
  var icx = Math.round(cx);
  var icy = Math.round(cy);
  var dy, py, norm, sq, dx, x0, x1;
  for (dy = -iry; dy <= iry; dy++) {
    py = icy + dy;
    if (py < 0 || py >= SCREEN_H) continue;
    norm = dy / iry;
    sq = 1 - norm * norm;
    if (sq < 0) sq = 0;
    dx = Math.round(rx * FM.sqrt(sq));
    x0 = icx - dx;
    x1 = icx + dx;
    if (x1 < 0 || x0 >= SCREEN_W) continue;
    if (x0 < 0) x0 = 0;
    if (x1 >= SCREEN_W) x1 = SCREEN_W - 1;
    gDrawLine(x0, py, x1, py, color);
  }
}

function drawCircleOutline(cx, cy, r, color) {
  var steps = 16;
  var step = 6.2831853 / steps;
  var prevX = cx + r;
  var prevY = cy;
  var i, a, nx, ny;
  for (i = 1; i <= steps; i++) {
    a = i * step;
    nx = cx + r * FM.cos(a);
    ny = cy + r * FM.sin(a);
    gDrawLine(prevX, prevY, nx, ny, color);
    prevX = nx;
    prevY = ny;
  }
}

/* ---------------------------------------------------------
   3. PERSISTENT BEST SCORE
   --------------------------------------------------------- */
var BEST_FILE = "penalty_best.txt";
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
   4. 2D <-> 3D PERSPECTIVE CAMERA
   --------------------------------------------------------- */
var HUD_H = 22;
var is3DMode = true;
var camTilt = 1.0;
var camPanX = 0;
var camShake = 0;
var camShakeX = 0;
var camShakeY = 0;
var modeToastText = "";
var modeToastUntil = 0;

function toggle2D3D(now) {
  is3DMode = !is3DMode;
  modeToastText = is3DMode ? "3D Mode" : "2D Mode";
  modeToastUntil = now + 1500;
}

function projectWorld(wx, wy, wz, out) {
  var top2D = HUD_H + Math.round(SCREEN_H * 0.25);
  var top3D = HUD_H + Math.round(SCREEN_H * 0.34);
  var botY  = SCREEN_H - 18;

  var topY = lerp(top2D, top3D, camTilt);
  var spanY = botY - topY;

  var depthT = 1.0 - wy;
  var perspS = 1.14 / Math.max(0.42, 1.0 + depthT * 0.88);
  var scale = lerp(1.0, perspS, camTilt);

  var wyPersp = wy * 0.38 + wy * wy * 0.62;
  var wyMapped = lerp(wy, wyPersp, camTilt);

  var halfW = SCREEN_W * 0.36;
  var cx = (SCREEN_W * 0.5) + camPanX * (1.0 - wy * 0.5) * camTilt + camShakeX;

  var zPx = Math.round(SCREEN_H * 0.38);
  out.x = cx + wx * halfW * scale * lerp(1.0, 1.28, camTilt);
  out.groundY = topY + wyMapped * spanY + camShakeY;
  out.y = out.groundY - wz * zPx * scale * lerp(0.55, 1.0, camTilt);
  out.scale = scale;
  return out;
}

/* ---------------------------------------------------------
   5. GAME STATE, WIND, RUN-UP & PHYSICS POOLS
   --------------------------------------------------------- */
var STATE_TITLE = 0;
var STATE_AIM = 1;
var STATE_RUNUP = 2;
var STATE_FLIGHT = 3;
var STATE_RESULT = 4;
var STATE_ROUND_CLEAR = 5;
var STATE_GAME_OVER = 6;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;
var shootLockUntil = 0;

var roundNum = 1;
var score = 0;
var streak = 0;
var shotIdx = 0;
var shotMarks = [0, 0, 0, 0, 0];
var goalsInRound = 0;
var goalTarget = 3;

var windX = 0;
var lastShotKmh = 0;

var resultText = "";
var resultColor = C_GOLD;
var resultTimer = 0;
var netRipple = 0;
var netHitWx = 0;
var netHitWz = 0.5;
var postFlash = 0;
var crowdCheerTimer = 0;

var aim = { wx: 0.0, wz: 0.48, dx: 0, dz: 0 };
var powerGauge = { charging: false, val: 0.78, dir: 1 };
var bonusTarget = { active: true, wx: -0.68, wz: 0.74 };
var pendingShot = { wx: 0, wz: 0.5, pwr: 0.8, curve: 0 };

var striker = {
  wx: -0.30, wy: 1.25,
  runTimer: 0,
  kickTimer: 0,
  aimDir: 0
};

var ball = {
  wx: 0, wy: 1.0, wz: 0,
  vwx: 0, vwy: 0, vwz: 0,
  spinSide: 0,
  topSpin: 0,
  spin: 0,
  hitCooldown: 0,
  touchedKeeper: false,
  checkedLine: false,
  scored: false,
  fire: false,
  flightTime: 0
};

var keeper = {
  wx: 0, wz: 0,
  vwz: 0,
  targetWx: 0, targetWz: 0.35,
  diveDir: 0, diveAmt: 0,
  reacted: false, reactTimer: 0,
  idlePhase: 0
};

var MAX_TRAIL = 7;
var trailPool = [];
(function initTrail() {
  var i;
  for (i = 0; i < MAX_TRAIL; i++) {
    trailPool.push({ active: false, wx: 0, wy: 0, wz: 0 });
  }
})();
var trailTick = 0;

var MAX_FX = 26;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: C_GOLD });
  }
})();

var _p0 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p1 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p2 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p3 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p4 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p5 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p6 = { x: 0, y: 0, groundY: 0, scale: 1 };
var _p7 = { x: 0, y: 0, groundY: 0, scale: 1 };

var _sk = {
  px: 0, py: 0, nx: 0, ny: 0, hx: 0, hy: 0,
  shLx: 0, shLy: 0, shRx: 0, shRy: 0,
  elLx: 0, elLy: 0, elRx: 0, elRy: 0,
  haLx: 0, haLy: 0, haRx: 0, haRy: 0,
  hpLx: 0, hpLy: 0, hpRx: 0, hpRy: 0,
  knLx: 0, knLy: 0, knRx: 0, knRy: 0,
  ftLx: 0, ftLy: 0, ftRx: 0, ftRy: 0
};

function spawnFx(x, y, color, count) {
  var i, s = 0, a, sp, pt;
  for (i = 0; i < MAX_FX && s < count; i++) {
    pt = fxPool[i];
    if (!pt.active) {
      a = (6.2831853 * s) / count + FM.random() * 0.5;
      sp = 1.2 + FM.random() * 3.0;
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

function spawnBonusTarget() {
  var side = (FM.random() < 0.5) ? -1 : 1;
  bonusTarget.active = true;
  bonusTarget.wx = side * (0.56 + FM.random() * 0.22);
  bonusTarget.wz = 0.58 + FM.random() * 0.24;
}

function clearTrail() {
  var i;
  for (i = 0; i < MAX_TRAIL; i++) trailPool[i].active = false;
}

function setupShot() {
  gameState = STATE_AIM;
  ball.wx = 0; ball.wy = 1.0; ball.wz = 0;
  ball.vwx = 0; ball.vwy = 0; ball.vwz = 0;
  ball.spinSide = 0;
  ball.topSpin = 0;
  ball.hitCooldown = 0;
  ball.touchedKeeper = false;
  ball.checkedLine = false;
  ball.scored = false;
  ball.flightTime = 0;
  ball.fire = (streak >= 2);
  clearTrail();

  striker.wx = -0.30;
  striker.wy = 1.25;
  striker.runTimer = 0;
  striker.kickTimer = 0;

  keeper.wx = 0; keeper.wz = 0; keeper.vwz = 0;
  keeper.diveDir = 0; keeper.diveAmt = 0;
  keeper.reacted = false;

  powerGauge.charging = false;
  powerGauge.val = 0.78;
  powerGauge.dir = 1;

  windX = (roundNum === 1) ? 0 : ((FM.random() * 2 - 1) * Math.min(0.9, 0.35 + (roundNum - 2) * 0.2));

  aim.wx = clamp(aim.wx, -1.05, 1.05);
  aim.wz = clamp(aim.wz, 0.10, 1.06);
  spawnBonusTarget();
}

function setupRound(rnd) {
  roundNum = rnd;
  shotIdx = 0;
  goalsInRound = 0;
  goalTarget = Math.min(5, 2 + rnd);
  var i;
  for (i = 0; i < 5; i++) shotMarks[i] = 0;
  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;
  aim.wx = 0;
  aim.wz = 0.45;
  lastShotKmh = 0;
  setupShot();
}

function startNewGame() {
  score = 0;
  streak = 0;
  isPaused = false;
  shootLockUntil = nowMs() + 260;
  setupRound(1);
}

function startRunUp(targetWx, targetWz, pwr, curveHint) {
  if (gameState !== STATE_AIM || isPaused) return;
  gameState = STATE_RUNUP;
  powerGauge.charging = false;
  pendingShot.wx = targetWx;
  pendingShot.wz = targetWz;
  pendingShot.pwr = pwr;
  pendingShot.curve = curveHint || 0;
  striker.runTimer = 0.32;
  striker.aimDir = clamp(targetWx, -1, 1);
}

function launchBall() {
  gameState = STATE_FLIGHT;
  striker.kickTimer = 0.42;

  var p = clamp(pendingShot.pwr, 0.40, 1.0);
  lastShotKmh = Math.round(lerp(68, 126, p));

  var speedWy = lerp(1.38, 2.45, p);
  var flightT = 1.0 / speedWy;
  var grav = 2.65;

  var loftExtra = (p > 0.90 && pendingShot.wz > 0.72) ? (p - 0.90) * 1.15 : 0;
  var finalWz = clamp(pendingShot.wz + loftExtra, 0.08, 1.18);

  ball.wx = 0;
  ball.wy = 1.0;
  ball.wz = 0.02;
  ball.vwy = -speedWy;
  ball.spinSide = pendingShot.curve;
  ball.topSpin = (p > 0.75) ? 0.35 : 0;
  ball.vwx = (pendingShot.wx - ball.wx - 0.5 * ball.spinSide * flightT * flightT) / flightT;
  ball.vwz = (finalWz + 0.5 * (grav + ball.topSpin) * flightT * flightT) / flightT;
  ball.flightTime = 0;

  projectWorld(0, 1.0, 0, _p0);
  spawnFx(_p0.x, _p0.groundY, C_TURF_LINE, 5);
  spawnFx(_p0.x, _p0.groundY, C_TURF_WORN, 4);

  keeper.reacted = false;
  keeper.reactTimer = Math.max(0.07, 0.20 - (roundNum - 1) * 0.032);
  var noise = (FM.random() - 0.5) * Math.max(0.42, 1.32 - (roundNum - 1) * 0.22);
  keeper.targetWx = clamp(pendingShot.wx + noise, -0.82, 0.82);
  keeper.targetWz = clamp(finalWz * 0.76, 0.14, 0.76);
}

function finishShot(isGoal, msg, col) {
  resultText = msg;
  resultColor = col;
  resultTimer = 1.45;
  shotMarks[shotIdx] = isGoal ? 1 : -1;
  if (isGoal) {
    goalsInRound++;
    streak++;
    crowdCheerTimer = 1.3;
    camShake = 0.22;
  } else {
    streak = 0;
  }
  gameState = STATE_RESULT;
}

/* ---------------------------------------------------------
   6. REALISTIC SIMULATION STEP
   --------------------------------------------------------- */
function stepBallContainment(dt, grav) {
  ball.vwx *= (1.0 - 0.18 * dt);
  ball.vwy *= (1.0 - 0.15 * dt);
  ball.vwz -= grav * dt;

  ball.wx += ball.vwx * dt;
  ball.wy += ball.vwy * dt;
  ball.wz += ball.vwz * dt;
  ball.spin += (ball.vwy * -9 + ball.spinSide * 6) * dt;

  if (ball.wz <= 0) {
    ball.wz = 0;
    if (ball.vwz < -0.25) {
      ball.vwz = -ball.vwz * 0.52;
      ball.vwx *= 0.80;
      ball.vwy *= 0.78;
      projectWorld(ball.wx, ball.wy, 0, _p0);
      spawnFx(_p0.x, _p0.groundY, C_TURF_WORN, 3);
    } else {
      ball.vwz = 0;
      ball.vwx *= (1.0 - 2.4 * dt);
      ball.vwy *= (1.0 - 2.4 * dt);
    }
  }

  if (ball.scored) {
    if (ball.wy < -0.20) {
      ball.wy = -0.20;
      ball.vwy = Math.abs(ball.vwy) * 0.20;
      ball.vwx *= 0.45;
      ball.vwz *= 0.50;
    }
    if (ball.wx < -0.90) {
      ball.wx = -0.90;
      ball.vwx = Math.abs(ball.vwx) * 0.35;
    } else if (ball.wx > 0.90) {
      ball.wx = 0.90;
      ball.vwx = -Math.abs(ball.vwx) * 0.35;
    }
  }
}

function updateKeeperDive(dt) {
  if (!keeper.reacted) {
    keeper.reactTimer -= dt;
    if (keeper.reactTimer <= 0) {
      keeper.reacted = true;
      keeper.diveDir = (keeper.targetWx > keeper.wx) ? 1 : ((keeper.targetWx < keeper.wx) ? -1 : 0);
      keeper.vwz = clamp(keeper.targetWz * 2.8, 0.6, 1.8);
    }
  } else {
    var kSpeed = 1.25 + (roundNum - 1) * 0.24;
    var kDiff = keeper.targetWx - keeper.wx;
    if (Math.abs(kDiff) > 0.02) {
      keeper.wx += clamp(kDiff * 6.2, -kSpeed, kSpeed) * dt;
    }
    keeper.wz += keeper.vwz * dt;
    keeper.vwz -= 2.8 * dt;
    if (keeper.wz <= 0) {
      keeper.wz = 0;
      keeper.vwz = 0;
    }
    keeper.diveAmt = Math.min(1.0, keeper.diveAmt + dt * 5.6);
  }
}

function updateSimulation(dt) {
  var i, pt;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (!pt.active) continue;
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.vy += 2.2 * dt;
    pt.life -= dt * 1.8;
    if (pt.life <= 0) pt.active = false;
  }

  var targetTilt = is3DMode ? 1.0 : 0.0;
  camTilt += (targetTilt - camTilt) * Math.min(1, dt * 8.0);
  if (Math.abs(targetTilt - camTilt) < 0.005) camTilt = targetTilt;

  if (netRipple > 0) netRipple = Math.max(0, netRipple - dt * 1.45);
  if (postFlash > 0) postFlash = Math.max(0, postFlash - dt * 2.5);
  if (crowdCheerTimer > 0) crowdCheerTimer = Math.max(0, crowdCheerTimer - dt);
  if (striker.kickTimer > 0) striker.kickTimer = Math.max(0, striker.kickTimer - dt);

  if (camShake > 0) {
    camShake = Math.max(0, camShake - dt);
    var mag = camShake * 15;
    camShakeX = (FM.random() - 0.5) * mag;
    camShakeY = (FM.random() - 0.5) * mag;
  } else {
    camShakeX = 0;
    camShakeY = 0;
  }

  if (isPaused) return;

  if (gameState === STATE_ROUND_CLEAR) {
    resultTimer -= dt;
    if (resultTimer <= 0) setupRound(roundNum + 1);
    return;
  }

  if (gameState === STATE_RESULT) {
    stepBallContainment(dt, 2.65);
    if (keeper.wz > 0) updateKeeperDive(dt);

    resultTimer -= dt;
    if (resultTimer <= 0) {
      shotIdx++;
      if (shotIdx >= 5) {
        if (goalsInRound >= goalTarget) {
          addScore(100 * roundNum);
          resultText = "ROUND " + roundNum + " WON!";
          resultColor = C_GOLD;
          resultTimer = 1.5;
          gameState = STATE_ROUND_CLEAR;
        } else {
          gameState = STATE_GAME_OVER;
        }
      } else {
        setupShot();
      }
    }
    return;
  }

  if (gameState === STATE_AIM) {
    aim.wx = clamp(aim.wx + aim.dx * 1.25 * dt, -1.08, 1.08);
    aim.wz = clamp(aim.wz + aim.dz * 1.05 * dt, 0.08, 1.08);
    camPanX += (-aim.wx * 18 - camPanX) * Math.min(1, dt * 5.0);

    keeper.idlePhase += dt * (2.6 + roundNum * 0.45);
    keeper.wx = FM.sin(keeper.idlePhase) * 0.24;

    if (powerGauge.charging) {
      powerGauge.val += powerGauge.dir * 1.35 * dt;
      if (powerGauge.val >= 1.0) { powerGauge.val = 1.0; powerGauge.dir = -1; }
      else if (powerGauge.val <= 0.35) { powerGauge.val = 0.35; powerGauge.dir = 1; }
    }
    return;
  }

  if (gameState === STATE_RUNUP) {
    striker.runTimer -= dt;
    var rProg = 1.0 - clamp(striker.runTimer / 0.32, 0, 1);
    striker.wx = lerp(-0.30, -0.14, rProg);
    striker.wy = lerp(1.25, 1.03, rProg);
    if (striker.runTimer <= 0) {
      launchBall();
    }
    return;
  }

  if (gameState === STATE_FLIGHT) {
    var grav = 2.65;
    ball.flightTime += dt;
    if (ball.hitCooldown > 0) ball.hitCooldown = Math.max(0, ball.hitCooldown - dt);

    if (ball.wy > 0.50 && aim.dx !== 0) {
      ball.spinSide = clamp(ball.spinSide + aim.dx * 2.0 * dt, -1.5, 1.5);
    }
    var windPush = (ball.wz > 0.25) ? (windX * 0.38) : 0;
    ball.vwx += (ball.spinSide + windPush) * dt;
    ball.vwz -= ball.topSpin * dt;

    stepBallContainment(dt, grav);

    trailTick++;
    if ((trailTick & 1) === 0) {
      for (i = MAX_TRAIL - 1; i > 0; i--) {
        trailPool[i].active = trailPool[i - 1].active;
        trailPool[i].wx = trailPool[i - 1].wx;
        trailPool[i].wy = trailPool[i - 1].wy;
        trailPool[i].wz = trailPool[i - 1].wz;
      }
      trailPool[0].active = true;
      trailPool[0].wx = ball.wx;
      trailPool[0].wy = ball.wy;
      trailPool[0].wz = ball.wz;
    }

    camPanX += (-ball.wx * 26 - camPanX) * Math.min(1, dt * 6.0);
    updateKeeperDive(dt);

    if (!ball.touchedKeeper && ball.wy <= 0.07 && ball.wy >= -0.02 && ball.vwy < 0) {
      var kCenterZ = keeper.wz * 0.65 + 0.24;
      var kReachX = 0.24 + keeper.diveAmt * 0.13;
      var kReachZ = 0.44;
      var dxK = ball.wx - keeper.wx;
      var dzK = ball.wz - kCenterZ;

      if (Math.abs(dxK) <= kReachX && Math.abs(dzK) <= kReachZ) {
        ball.touchedKeeper = true;
        projectWorld(ball.wx, 0.04, ball.wz, _p0);
        spawnFx(_p0.x, _p0.y, C_GK_GLOVE, 12);
        camShake = 0.14;

        if (Math.abs(dxK) > kReachX * 0.72) {
          ball.vwx += (dxK >= 0 ? 0.55 : -0.55);
          ball.vwy *= 0.62;
          ball.vwz += 0.35;
        } else {
          ball.vwy = 0.85;
          ball.vwx = (dxK >= 0 ? 0.55 : -0.55);
          ball.vwz = 0.55;
          finishShot(false, "SAVED!", C_RED);
          return;
        }
      }
    }

    if (ball.hitCooldown <= 0 && Math.abs(ball.wy) < 0.09) {
      var pIdx, postWx, dxP, dyP, dSqP, dP, nxP, nyP, dotP;
      for (pIdx = -1; pIdx <= 1; pIdx += 2) {
        postWx = pIdx * 0.95;
        if (ball.wz <= 1.03) {
          dxP = ball.wx - postWx;
          dyP = ball.wy;
          dSqP = dxP * dxP + dyP * dyP;
          if (dSqP < 0.068 * 0.068 && dSqP > 0.00001) {
            dP = FM.sqrt(dSqP);
            nxP = dxP / dP;
            nyP = dyP / dP;
            dotP = ball.vwx * nxP + ball.vwy * nyP;
            if (dotP < 0) {
              ball.vwx = (ball.vwx - 2 * dotP * nxP) * 0.72;
              ball.vwy = (ball.vwy - 2 * dotP * nyP) * 0.72;
              ball.hitCooldown = 0.15;
              postFlash = 0.55;
              camShake = 0.28;
              projectWorld(postWx, 0.0, ball.wz, _p0);
              spawnFx(_p0.x, _p0.y, C_WHITE, 14);
            }
          }
        }
      }

      if (Math.abs(ball.wx) <= 1.01) {
        var dyB = ball.wy;
        var dzB = ball.wz - 0.98;
        var dSqB = dyB * dyB + dzB * dzB;
        if (dSqB < 0.062 * 0.062 && dSqB > 0.00001) {
          var dB = FM.sqrt(dSqB);
          var nyB = dyB / dB;
          var nzB = dzB / dB;
          var dotB = ball.vwy * nyB + ball.vwz * nzB;
          if (dotB < 0) {
            ball.vwy = (ball.vwy - 2 * dotB * nyB) * 0.72;
            ball.vwz = (ball.vwz - 2 * dotB * nzB) * 0.72;
            ball.hitCooldown = 0.15;
            postFlash = 0.55;
            camShake = 0.28;
            projectWorld(ball.wx, 0.0, 0.98, _p0);
            spawnFx(_p0.x, _p0.y, C_WHITE, 14);
          }
        }
      }
    }

    if (!ball.scored && ball.wy <= -0.04 && Math.abs(ball.wx) < 0.91 && ball.wz >= 0 && ball.wz < 0.95) {
      ball.scored = true;
      netRipple = 1.0;
      netHitWx = ball.wx;
      netHitWz = ball.wz;
      var isTopBin = bonusTarget.active &&
        (Math.abs(ball.wx - bonusTarget.wx) < 0.28) &&
        (Math.abs(ball.wz - bonusTarget.wz) < 0.28);
      var pts = isTopBin ? 150 : 50;
      if (streak > 0) pts += streak * 25;
      if (ball.hitCooldown > 0) pts += 40;
      addScore(pts);

      projectWorld(ball.wx, -0.04, ball.wz, _p0);
      spawnFx(_p0.x, _p0.y, isTopBin ? C_GOLD : C_GREEN, 22);
      var gMsg = (ball.hitCooldown > 0 ? "IN OFF POST +" : (isTopBin ? "TOP BIN +" : "GOAL +")) + pts;
      finishShot(true, gMsg, isTopBin ? C_GOLD : C_GREEN);
      return;
    }

    if (!ball.scored) {
      if (ball.wy <= -0.26 || Math.abs(ball.wx) > 1.65) {
        finishShot(false, ball.wz >= 0.94 ? "OVER BAR!" : "WIDE!", C_RED);
        return;
      }
      if (ball.vwy > 0.08 && ball.wy > 0.15) {
        finishShot(false, (postFlash > 0) ? "OFF THE WOODWORK!" : "SAVED!", (postFlash > 0) ? C_GOLD : C_RED);
        return;
      }
      if (ball.flightTime > 2.2) {
        finishShot(false, "MISS!", C_RED);
      }
    }
  }
}

/* ---------------------------------------------------------
   7. STADIUM, GOAL, SKELETAL RIGGED KEEPER & STRIKER
   --------------------------------------------------------- */
function drawStadiumBackdrop(now) {
  var top2D = HUD_H + Math.round(SCREEN_H * 0.25);
  var top3D = HUD_H + Math.round(SCREEN_H * 0.34);
  var horizonY = Math.round(lerp(top2D, top3D, camTilt) + camShakeY);
  var skyH = Math.max(0, horizonY - HUD_H - 22);

  var b, bandH = Math.max(1, Math.ceil(skyH / 6));
  for (b = 0; b < 6; b++) {
    var by = HUD_H + b * bandH;
    if (by >= horizonY - 22) break;
    gFillRect(0, by, SCREEN_W, Math.min(bandH + 1, horizonY - 22 - by), SKY_BANDS[b]);
  }

  var flX = [Math.round(SCREEN_W * 0.14), Math.round(SCREEN_W * 0.86)];
  var flTop = HUD_H + 5;
  var i, lx;
  for (i = 0; i < 2; i++) {
    lx = flX[i] + (camPanX * 0.2 | 0);
    fillTri(lx, flTop + 4, lx - 34, horizonY - 20, lx + 34, horizonY - 20, C_FLOOD_BEAM);
    gFillRect(lx - 1, flTop + 6, 3, Math.max(6, horizonY - 24 - flTop), C_FLOOD_POLE);
    gFillRect(lx - 10, flTop, 20, 7, C_FLOOD_POLE);
    gFillRect(lx - 8, flTop + 1, 16, 5, C_FLOOD_GLOW);
  }

  var standTop = Math.max(HUD_H, horizonY - 24);
  gFillRect(0, standTop, SCREEN_W, 4, C_STAND_ROOF);
  gFillRect(0, standTop + 4, SCREEN_W, 9, C_STAND_UPPER);
  gFillRect(0, standTop + 13, SCREEN_W, 6, C_STAND_LOWER);

  var jumpAmp = (crowdCheerTimer > 0) ? 2.6 : 0.6;
  var cx, colIdx, jy;
  for (cx = 4; cx < SCREEN_W - 4; cx += 7) {
    colIdx = ((cx / 7) | 0);
    jy = Math.round(FM.sin(now * 0.015 + colIdx * 1.7) * jumpAmp);
    gFillRect(cx, standTop + 6 + jy, 4, 4, C_CROWD_COLS[colIdx % 5]);
    gFillRect(cx + 2, standTop + 13 - jy, 4, 4, C_CROWD_COLS[(colIdx + 2) % 5]);
  }

  var adY = Math.max(HUD_H, horizonY - 6);
  var adScroll = ((now * 0.03) | 0) % 48;
  var adCols = (crowdCheerTimer > 0) ? [C_GREEN, C_GOLD, C_GREEN] : [C_AD_BLUE, C_AD_RED, C_AD_GOLD];
  var ax;
  for (ax = -adScroll; ax < SCREEN_W; ax += 48) {
    gFillRect(Math.max(0, ax), adY, Math.min(48, SCREEN_W - ax), 6, adCols[((ax + adScroll) / 48 | 0) % 3]);
    gDrawLine(Math.max(0, ax), adY, Math.min(SCREEN_W, ax + 48), adY, C_WHITE);
  }
}

function drawPitchAndMarkings(now) {
  var bands = 9;
  var b, y0, y1, col;
  for (b = 0; b < bands; b++) {
    y0 = lerp(-0.24, 1.16, b / bands);
    y1 = lerp(-0.24, 1.16, (b + 1) / bands);
    col = (b & 1) ? C_TURF_A : C_TURF_B;
    projectWorld(-2.4, y0, 0, _p0);
    projectWorld( 2.4, y0, 0, _p1);
    projectWorld( 2.4, y1, 0, _p2);
    projectWorld(-2.4, y1, 0, _p3);
    fillQuad(_p0.x, _p0.y, _p1.x, _p1.y, _p2.x, _p2.y, _p3.x, _p3.y, col);
  }

  projectWorld(0, 0.09, 0, _p0);
  fillEllipse(_p0.x, _p0.groundY, Math.round(28 * _p0.scale), Math.max(2, Math.round(5 * _p0.scale)), C_TURF_WORN);

  projectWorld(-0.95, 0.0, 0.0, _p0);
  projectWorld(-0.82, -0.15, 0.0, _p1);
  projectWorld( 1.08, -0.15, 0.0, _p2);
  projectWorld( 0.95, 0.0, 0.0, _p3);
  gDrawLine(_p0.x, _p0.groundY, _p1.x, _p1.groundY, C_SHADOW_SOFT);
  gDrawLine(_p1.x, _p1.groundY, _p2.x, _p2.groundY, C_SHADOW_SOFT);
  gDrawLine(_p3.x, _p3.groundY, _p2.x, _p2.groundY, C_SHADOW_SOFT);

  projectWorld(-2.3, 0.0, 0, _p0);
  projectWorld( 2.3, 0.0, 0, _p1);
  gDrawLine(_p0.x, _p0.groundY, _p1.x, _p1.groundY, C_TURF_LINE);

  projectWorld(-1.25, 0.0, 0, _p0);
  projectWorld(-1.25, 0.34, 0, _p1);
  projectWorld( 1.25, 0.34, 0, _p2);
  projectWorld( 1.25, 0.0, 0, _p3);
  gDrawLine(_p0.x, _p0.groundY, _p1.x, _p1.groundY, C_TURF_LINE);
  gDrawLine(_p1.x, _p1.groundY, _p2.x, _p2.groundY, C_TURF_LINE);
  gDrawLine(_p2.x, _p2.groundY, _p3.x, _p3.groundY, C_TURF_LINE);

  projectWorld(-1.85, 0.0, 0, _p0);
  projectWorld(-1.85, 0.92, 0, _p1);
  projectWorld( 1.85, 0.92, 0, _p2);
  projectWorld( 1.85, 0.0, 0, _p3);
  gDrawLine(_p0.x, _p0.groundY, _p1.x, _p1.groundY, C_TURF_LINE);
  gDrawLine(_p1.x, _p1.groundY, _p2.x, _p2.groundY, C_TURF_LINE);
  gDrawLine(_p2.x, _p2.groundY, _p3.x, _p3.groundY, C_TURF_LINE);

  var a, prevAx, prevAy, awx, awy;
  for (a = 0; a <= 8; a++) {
    var ang = lerp(-1.1, 1.1, a / 8);
    awx = FM.sin(ang) * 0.65;
    awy = 0.92 + FM.cos(ang) * 0.16;
    projectWorld(awx, awy, 0, _p0);
    if (a > 0) gDrawLine(prevAx, prevAy, _p0.x, _p0.groundY, C_TURF_LINE);
    prevAx = _p0.x;
    prevAy = _p0.groundY;
  }

  projectWorld(0, 1.0, 0, _p0);
  fillEllipse(_p0.x, _p0.groundY, 4, 2, C_TURF_LINE);

  var side, cwx, flagBias, fWave;
  flagBias = (windX === 0) ? 6 : (windX > 0 ? 7 : -7);
  fWave = FM.sin(now * (0.008 + Math.abs(windX) * 0.01)) * 2.5;
  for (side = -1; side <= 1; side += 2) {
    cwx = side * 1.98;
    projectWorld(cwx, 0.0, 0.0, _p0);
    projectWorld(cwx, 0.0, 0.25, _p1);
    gDrawLine(_p0.x, _p0.groundY, _p1.x, _p1.y, C_WHITE);
    fillTri(_p1.x, _p1.y, _p1.x, _p1.y + 4, _p1.x + flagBias + fWave, _p1.y + 2, C_RED);
  }
}

function drawGoalCage(now) {
  var ripOsc = (netRipple > 0) ? FM.sin(now * 0.045) * netRipple * 5.0 : 0;
  var flash = (postFlash > 0 && (((now / 60) | 0) & 1));
  var postC = flash ? C_GOLD : C_POST_HI;
  var postRim = flash ? C_RED : C_POST_SHD;

  projectWorld(-0.95, 0.0,  0.0, _p0);
  projectWorld(-0.95, 0.0,  1.0, _p1);
  projectWorld( 0.95, 0.0,  1.0, _p2);
  projectWorld( 0.95, 0.0,  0.0, _p3);

  projectWorld(-0.95, -0.22, 0.0, _p4);
  projectWorld(-0.95, -0.22, 0.96, _p5);
  projectWorld( 0.95, -0.22, 0.96, _p6);
  projectWorld( 0.95, -0.22, 0.0, _p7);

  var i, frac, bx, tx, by, ty, ripX, ripY, distF;
  for (i = 1; i < 8; i++) {
    frac = i / 8;
    distF = Math.max(0, 1.0 - Math.abs((frac * 1.9 - 0.95) - netHitWx) * 1.1);
    ripX = ripOsc * distF;
    bx = lerp(_p4.x, _p7.x, frac) + ripX;
    by = lerp(_p4.y, _p7.y, frac) - Math.abs(ripX) * 0.3;
    tx = lerp(_p5.x, _p6.x, frac) + ripX;
    ty = lerp(_p5.y, _p6.y, frac) - Math.abs(ripX) * 0.3;
    gDrawLine(bx, by, tx, ty, C_NET_BACK);
  }
  for (i = 1; i < 5; i++) {
    frac = i / 5;
    distF = Math.max(0, 1.0 - Math.abs(frac - netHitWz) * 1.4);
    ripY = -Math.abs(ripOsc) * distF * 0.5;
    gDrawLine(lerp(_p4.x, _p5.x, frac), lerp(_p4.y, _p5.y, frac) + ripY,
              lerp(_p7.x, _p6.x, frac), lerp(_p7.y, _p6.y, frac) + ripY, C_NET_BACK);
    gDrawLine(lerp(_p0.x, _p1.x, frac), lerp(_p0.y, _p1.y, frac),
              lerp(_p4.x, _p5.x, frac), lerp(_p4.y, _p5.y, frac), C_NET_MESH);
    gDrawLine(lerp(_p3.x, _p2.x, frac), lerp(_p3.y, _p2.y, frac),
              lerp(_p7.x, _p6.x, frac), lerp(_p7.y, _p6.y, frac), C_NET_MESH);
    gDrawLine(lerp(_p1.x, _p2.x, frac), lerp(_p1.y, _p2.y, frac),
              lerp(_p5.x, _p6.x, frac), lerp(_p5.y, _p6.y, frac), C_NET_MESH);
  }

  gDrawLine(_p4.x, _p4.y, _p7.x, _p7.y, C_NET_SHADOW);
  gDrawLine(_p4.x, _p4.y, _p5.x, _p5.y, C_POST_SHD);
  gDrawLine(_p5.x, _p5.y, _p6.x, _p6.y, C_POST_SHD);
  gDrawLine(_p6.x, _p6.y, _p7.x, _p7.y, C_POST_SHD);
  gDrawLine(_p1.x, _p1.y, _p5.x, _p5.y, C_POST_MID);
  gDrawLine(_p2.x, _p2.y, _p6.x, _p6.y, C_POST_MID);

  if (bonusTarget.active && gameState === STATE_AIM) {
    projectWorld(bonusTarget.wx, -0.02, bonusTarget.wz, _p4);
    var br = Math.max(5, Math.round((8 + FM.sin(now * 0.008) * 1.5) * _p4.scale));
    drawCircleOutline(_p4.x, _p4.y, br, C_GOLD);
    drawCircleOutline(_p4.x, _p4.y, Math.max(3, (br * 0.6) | 0), C_RED);
    gFillCircle(_p4.x, _p4.y, Math.max(2, br >> 2), C_GOLD);
  }

  drawThickLine(_p0.x - 1, _p0.y, _p1.x - 1, _p1.y, 2, postRim);
  drawThickLine(_p0.x + 1, _p0.y, _p1.x + 1, _p1.y, 2, postC);
  drawThickLine(_p3.x + 1, _p3.y, _p2.x + 1, _p2.y, 2, postRim);
  drawThickLine(_p3.x - 1, _p3.y, _p2.x - 1, _p2.y, 2, postC);
  drawThickLine(_p1.x, _p1.y - 1, _p2.x, _p2.y - 1, 2, postRim);
  drawThickLine(_p1.x, _p1.y + 1, _p2.x, _p2.y + 1, 2, postC);
}

function drawGoalkeeper(now) {
  projectWorld(keeper.wx, 0.04, keeper.wz, _p0);
  var s = _p0.scale * (SCREEN_H / 240);
  var gx = _p0.x;
  var gy = _p0.groundY;
  var feetBaseY = _p0.y;

  var dive = keeper.diveAmt;
  var dDir = keeper.diveDir || 1;
  var crouch = (gameState === STATE_AIM) ? Math.abs(FM.sin(now * 0.009)) * 1.8 * s : 0;

  var legLen = 13.0 * s;
  var pelvisY = feetBaseY - lerp(legLen - 2.0 * s - crouch, 5.5 * s, dive);
  var pelvisX = gx;

  var idleSway = (gameState === STATE_AIM) ? FM.sin(now * 0.005) * 0.06 : 0;
  var bodyRot = lerp(idleSway, dDir * 1.36, dive);

  var spAng = bodyRot - 1.5707963;
  var ux = FM.cos(spAng), uy = FM.sin(spAng);
  var rx = -uy, ry = ux;

  var spineLen = 13.5 * s;
  _sk.px = pelvisX; _sk.py = pelvisY;
  _sk.nx = pelvisX + ux * spineLen;
  _sk.ny = pelvisY + uy * spineLen;
  _sk.hx = _sk.nx + ux * (5.2 * s);
  _sk.hy = _sk.ny + uy * (5.2 * s);

  var shHalf = 5.8 * s;
  var hpHalf = 3.6 * s;
  _sk.shLx = _sk.nx - rx * shHalf; _sk.shLy = _sk.ny - ry * shHalf;
  _sk.shRx = _sk.nx + rx * shHalf; _sk.shRy = _sk.ny + ry * shHalf;
  _sk.hpLx = _sk.px - rx * hpHalf; _sk.hpLy = _sk.py - ry * hpHalf;
  _sk.hpRx = _sk.px + rx * hpHalf; _sk.hpRy = _sk.py + ry * hpHalf;

  var thighLen = 7.0 * s;
  var shinLen  = 6.8 * s;
  var downAng = bodyRot + 1.5707963;

  var thLAng = lerp(downAng + 0.36, downAng + dDir * 0.14, dive);
  var shLAng = lerp(downAng - 0.18, downAng + dDir * 0.36, dive);
  var thRAng = lerp(downAng - 0.36, downAng - dDir * 0.12, dive);
  var shRAng = lerp(downAng + 0.18, downAng - dDir * 0.08, dive);

  _sk.knLx = _sk.hpLx + FM.cos(thLAng) * thighLen;
  _sk.knLy = _sk.hpLy + FM.sin(thLAng) * thighLen;
  _sk.ftLx = _sk.knLx + FM.cos(shLAng) * shinLen;
  _sk.ftLy = _sk.knLy + FM.sin(shLAng) * shinLen;

  _sk.knRx = _sk.hpRx + FM.cos(thRAng) * thighLen;
  _sk.knRy = _sk.hpRy + FM.sin(thRAng) * thighLen;
  _sk.ftRx = _sk.knRx + FM.cos(shRAng) * shinLen;
  _sk.ftRy = _sk.knRy + FM.sin(shRAng) * shinLen;

  var uArmLen = 6.8 * s;
  var fArmLen = 6.4 * s;
  var uArmLAng = lerp(downAng + 0.72, spAng - 0.20, dive);
  var fArmLAng = lerp(spAng + 0.35,   spAng - 0.06, dive);
  var uArmRAng = lerp(downAng - 0.72, spAng + 0.20, dive);
  var fArmRAng = lerp(spAng - 0.35,   spAng + 0.06, dive);

  _sk.elLx = _sk.shLx + FM.cos(uArmLAng) * uArmLen;
  _sk.elLy = _sk.shLy + FM.sin(uArmLAng) * uArmLen;
  _sk.haLx = _sk.elLx + FM.cos(fArmLAng) * fArmLen;
  _sk.haLy = _sk.elLy + FM.sin(fArmLAng) * fArmLen;

  _sk.elRx = _sk.shRx + FM.cos(uArmRAng) * uArmLen;
  _sk.elRy = _sk.shRy + FM.sin(uArmRAng) * uArmLen;
  _sk.haRx = _sk.elRx + FM.cos(fArmRAng) * fArmLen;
  _sk.haRy = _sk.elRy + FM.sin(fArmRAng) * fArmLen;

  var shCx = (_sk.hx + _sk.ftLx + _sk.ftRx) / 3;
  var shW = Math.max(8, Math.round(lerp(9 * s, 21 * s, dive)));
  fillEllipse(shCx, gy + 1, shW, Math.max(2, Math.round(3.2 * s)), C_SHADOW);

  drawLimb(_sk.hpLx, _sk.hpLy, _sk.knLx, _sk.knLy, 2.3 * s, 1.9 * s, C_GK_SHORT);
  drawLimb(_sk.knLx, _sk.knLy, _sk.ftLx, _sk.ftLy, 1.7 * s, 1.3 * s, C_WHITE);
  gFillCircle(_sk.knLx, _sk.knLy, Math.max(1, Math.round(1.8 * s)), C_GK_SKIN_DK);
  gFillCircle(_sk.ftLx, _sk.ftLy, Math.max(2, Math.round(2.0 * s)), C_CLEAT);

  drawLimb(_sk.hpRx, _sk.hpLy, _sk.knRx, _sk.knRy, 2.3 * s, 1.9 * s, C_GK_SHORT);
  drawLimb(_sk.knRx, _sk.knRy, _sk.ftRx, _sk.ftRy, 1.7 * s, 1.3 * s, C_WHITE);
  gFillCircle(_sk.knRx, _sk.knRy, Math.max(1, Math.round(1.8 * s)), C_GK_SKIN_DK);
  gFillCircle(_sk.ftRx, _sk.ftRy, Math.max(2, Math.round(2.0 * s)), C_CLEAT);

  fillQuad(_sk.shLx, _sk.shLy, _sk.shRx, _sk.shRy, _sk.hpRx, _sk.hpRy, _sk.hpLx, _sk.hpLy, C_GK_SHIRT);
  gDrawLine(_sk.shRx, _sk.shRy, _sk.hpRx, _sk.hpRy, C_GK_SHIRT_DK);
  gDrawLine(_sk.nx, _sk.ny, _sk.px, _sk.py, C_GK_SHIRT_DK);

  drawLimb(_sk.nx, _sk.ny, _sk.hx, _sk.hy, 1.8 * s, 1.8 * s, C_GK_SKIN_DK);
  var headR = Math.max(3, Math.round(4.6 * s));
  gFillCircle(_sk.hx, _sk.hy, headR, C_GK_SKIN);
  gFillCircle(_sk.hx + ux * (headR * 0.42), _sk.hy + uy * (headR * 0.42), Math.max(2, headR - 1), C_GK_HAIR);
  gDrawPixel(_sk.hx - rx * 1.6, _sk.hy - ry * 1.6, C_BLACK);
  gDrawPixel(_sk.hx + rx * 1.6, _sk.hy + ry * 1.6, C_BLACK);

  drawLimb(_sk.shLx, _sk.shLy, _sk.elLx, _sk.elLy, 2.0 * s, 1.6 * s, C_GK_SHIRT);
  drawLimb(_sk.elLx, _sk.elLy, _sk.haLx, _sk.haLy, 1.5 * s, 1.3 * s, C_GK_SKIN);
  gFillCircle(_sk.haLx, _sk.haLy, Math.max(2, Math.round(3.1 * s)), C_GK_GLOVE_DK);
  gFillCircle(_sk.haLx, _sk.haLy, Math.max(2, Math.round(2.4 * s)), C_GK_GLOVE);

  drawLimb(_sk.shRx, _sk.shRy, _sk.elRx, _sk.elRy, 2.0 * s, 1.6 * s, C_GK_SHIRT);
  drawLimb(_sk.elRx, _sk.elRy, _sk.haRx, _sk.haRy, 1.5 * s, 1.3 * s, C_GK_SKIN);
  gFillCircle(_sk.haRx, _sk.haRy, Math.max(2, Math.round(3.1 * s)), C_GK_GLOVE_DK);
  gFillCircle(_sk.haRx, _sk.haRy, Math.max(2, Math.round(2.4 * s)), C_GK_GLOVE);
}

function drawStrikerPlayer() {
  projectWorld(striker.wx, striker.wy, 0.0, _p0);
  var s = _p0.scale * (SCREEN_H / 240);
  var gx = _p0.x;
  var gy = _p0.groundY;

  var bodyRot = 0;
  var thLAng, shLAng, thRAng, shRAng;
  var uArmLAng, fArmLAng, uArmRAng, fArmRAng;
  var pelvLift = 0;
  var downAng = 1.5707963;

  if (gameState === STATE_RUNUP) {
    var rp = 1.0 - clamp(striker.runTimer / 0.32, 0, 1);
    var stride = FM.sin(rp * 9.42);
    pelvLift = Math.abs(stride) * 2.2 * s;
    bodyRot = striker.aimDir * 0.16;
    downAng = bodyRot + 1.5707963;

    if (rp > 0.72) {
      var back = (rp - 0.72) / 0.28;
      thLAng = downAng + 0.12; shLAng = downAng + 0.15;
      thRAng = downAng + 0.55 * back; shRAng = downAng + 1.25 * back;
      uArmLAng = downAng + 0.75 * back; fArmLAng = uArmLAng - 0.55;
      uArmRAng = downAng - 0.35; fArmRAng = uArmRAng - 0.45;
    } else {
      thLAng = downAng - stride * 0.48; shLAng = thLAng + 0.35;
      thRAng = downAng + stride * 0.48; shRAng = thRAng + 0.35;
      uArmLAng = downAng + stride * 0.55 + 0.25; fArmLAng = uArmLAng - 0.65;
      uArmRAng = downAng - stride * 0.55 - 0.25; fArmRAng = uArmRAng - 0.65;
    }
  } else if (striker.kickTimer > 0) {
    var kp = 1.0 - (striker.kickTimer / 0.42);
    var whip = FM.sin(kp * 3.14159);
    bodyRot = -0.22 + striker.aimDir * 0.18;
    downAng = bodyRot + 1.5707963;
    pelvLift = whip * 1.5 * s;

    thLAng = downAng + 0.18; shLAng = downAng + 0.08;
    thRAng = downAng - 0.85 * whip;
    shRAng = thRAng + 0.22 * (1.0 - whip);

    uArmLAng = downAng + 0.95 * whip + 0.35; fArmLAng = uArmLAng - 0.25;
    uArmRAng = downAng - 0.45; fArmRAng = uArmRAng - 0.55;
  } else {
    bodyRot = striker.aimDir * 0.06;
    downAng = bodyRot + 1.5707963;
    thLAng = downAng + 0.22; shLAng = downAng - 0.08;
    thRAng = downAng - 0.22; shRAng = downAng + 0.08;
    uArmLAng = downAng + 0.32; fArmLAng = uArmLAng - 0.35;
    uArmRAng = downAng - 0.32; fArmRAng = uArmRAng - 0.35;
  }

  var spAng = bodyRot - 1.5707963;
  var ux = FM.cos(spAng), uy = FM.sin(spAng);
  var rx = -uy, ry = ux;

  var legHeight = 13.5 * s;
  _sk.px = gx;
  _sk.py = gy - legHeight - pelvLift;

  var spineLen = 14.5 * s;
  _sk.nx = _sk.px + ux * spineLen;
  _sk.ny = _sk.py + uy * spineLen;
  _sk.hx = _sk.nx + ux * (5.4 * s);
  _sk.hy = _sk.ny + uy * (5.4 * s);

  var shHalf = 6.2 * s;
  var hpHalf = 3.8 * s;
  _sk.shLx = _sk.nx - rx * shHalf; _sk.shLy = _sk.ny - ry * shHalf;
  _sk.shRx = _sk.nx + rx * shHalf; _sk.shRy = _sk.ny + ry * shHalf;
  _sk.hpLx = _sk.px - rx * hpHalf; _sk.hpLy = _sk.py - ry * hpHalf;
  _sk.hpRx = _sk.px + rx * hpHalf; _sk.hpRy = _sk.py + ry * hpHalf;

  var thighLen = 7.4 * s;
  var shinLen  = 7.2 * s;
  _sk.knLx = _sk.hpLx + FM.cos(thLAng) * thighLen;
  _sk.knLy = _sk.hpLy + FM.sin(thLAng) * thighLen;
  _sk.ftLx = _sk.knLx + FM.cos(shLAng) * shinLen;
  _sk.ftLy = _sk.knLy + FM.sin(shLAng) * shinLen;

  _sk.knRx = _sk.hpRx + FM.cos(thRAng) * thighLen;
  _sk.knRy = _sk.hpRy + FM.sin(thRAng) * thighLen;
  _sk.ftRx = _sk.knRx + FM.cos(shRAng) * shinLen;
  _sk.ftRy = _sk.knRy + FM.sin(shRAng) * shinLen;

  var uArmLen = 7.0 * s;
  var fArmLen = 6.6 * s;
  _sk.elLx = _sk.shLx + FM.cos(uArmLAng) * uArmLen;
  _sk.elLy = _sk.shLy + FM.sin(uArmLAng) * uArmLen;
  _sk.haLx = _sk.elLx + FM.cos(fArmLAng) * fArmLen;
  _sk.haLy = _sk.elLy + FM.sin(fArmLAng) * fArmLen;

  _sk.elRx = _sk.shRx + FM.cos(uArmRAng) * uArmLen;
  _sk.elRy = _sk.shRy + FM.sin(uArmRAng) * uArmLen;
  _sk.haRx = _sk.elRx + FM.cos(fArmRAng) * fArmLen;
  _sk.haRy = _sk.elRy + FM.sin(fArmRAng) * fArmLen;

  fillEllipse(gx, gy + 1, Math.max(5, Math.round(10 * s)), Math.max(2, Math.round(3.2 * s)), C_SHADOW);

  drawLimb(_sk.hpLx, _sk.hpLy, _sk.knLx, _sk.knLy, 2.5 * s, 2.0 * s, C_STR_SHORT);
  drawLimb(_sk.knLx, _sk.knLy, _sk.ftLx, _sk.ftLy, 1.8 * s, 1.4 * s, C_STR_SOCK);
  gFillCircle(_sk.knLx, _sk.knLy, Math.max(1, Math.round(1.9 * s)), C_STR_SKIN);
  gFillCircle(_sk.ftLx, _sk.ftLy, Math.max(2, Math.round(2.1 * s)), C_CLEAT);

  drawLimb(_sk.hpRx, _sk.hpLy, _sk.knRx, _sk.knRy, 2.5 * s, 2.0 * s, C_STR_SHORT);
  drawLimb(_sk.knRx, _sk.knRy, _sk.ftRx, _sk.ftRy, 1.8 * s, 1.4 * s, C_STR_SOCK);
  gFillCircle(_sk.knRx, _sk.knRy, Math.max(1, Math.round(1.9 * s)), C_STR_SKIN);
  gFillCircle(_sk.ftRx, _sk.ftRy, Math.max(2, Math.round(2.1 * s)), C_CLEAT);

  drawLimb(_sk.shLx, _sk.shLy, _sk.elLx, _sk.elLy, 2.0 * s, 1.6 * s, C_STR_SHIRT);
  drawLimb(_sk.elLx, _sk.elLy, _sk.haLx, _sk.haLy, 1.5 * s, 1.3 * s, C_STR_SKIN);

  drawLimb(_sk.shRx, _sk.shRy, _sk.elRx, _sk.elRy, 2.0 * s, 1.6 * s, C_STR_SHIRT);
  drawLimb(_sk.elRx, _sk.elRy, _sk.haRx, _sk.haRy, 1.5 * s, 1.3 * s, C_STR_SKIN);

  fillQuad(_sk.shLx, _sk.shLy, _sk.shRx, _sk.shRy, _sk.hpRx, _sk.hpRy, _sk.hpLx, _sk.hpLy, C_STR_SHIRT);
  gDrawLine(_sk.shRx, _sk.shRy, _sk.hpRx, _sk.hpRy, C_STR_SHIRT2);
  var midTx = (_sk.nx + _sk.px) * 0.5;
  var midTy = (_sk.ny + _sk.py) * 0.5;
  gFillRect(midTx - 2, midTy - 3, 4, 6, C_WHITE);

  drawLimb(_sk.nx, _sk.ny, _sk.hx, _sk.hy, 1.9 * s, 1.9 * s, C_STR_SKIN);
  var headR = Math.max(3, Math.round(4.8 * s));
  gFillCircle(_sk.hx, _sk.hy, headR, C_STR_SKIN);
  gFillCircle(_sk.hx, _sk.hy - Math.max(1, (headR * 0.15) | 0), headR, C_STR_HAIR);
}

function drawSoccerBall() {
  var i, tr, trR;
  if (gameState === STATE_FLIGHT) {
    for (i = MAX_TRAIL - 1; i >= 0; i--) {
      tr = trailPool[i];
      if (!tr.active) continue;
      projectWorld(tr.wx, tr.wy, tr.wz, _p0);
      trR = Math.max(1, Math.round((8 - i) * _p0.scale));
      gFillCircle(_p0.x, _p0.y, trR, ball.fire ? C_FIRE : C_RING_BG);
    }
  }

  projectWorld(ball.wx, ball.wy, ball.wz, _p0);
  var s = _p0.scale;
  var r = Math.max(3, Math.round(9.5 * s));

  var shS = clamp(1.0 - ball.wz * 0.45, 0.32, 1.0);
  fillEllipse(_p0.x + 2, _p0.groundY + 1, Math.max(2, r * 1.05 * shS), Math.max(2, r * 0.45 * shS), C_SHADOW);

  if (ball.fire && gameState === STATE_FLIGHT) {
    gFillCircle(_p0.x, _p0.y, r + 3, C_FIRE);
  }

  gFillCircle(_p0.x, _p0.y, r, C_BALL_SHD);
  gFillCircle(_p0.x - r * 0.10, _p0.y - r * 0.10, Math.max(2, r * 0.86), C_BALL_MID);
  gFillCircle(_p0.x - r * 0.22, _p0.y - r * 0.22, Math.max(1, r * 0.60), C_BALL_W);

  var spX = _p0.x + FM.cos(ball.spin) * (r * 0.34);
  var spY = _p0.y + FM.sin(ball.spin) * (r * 0.34);
  gFillCircle(spX, spY, Math.max(1, (r * 0.28) | 0), C_BALL_PENTA);
  if (r >= 5) {
    var sp2X = _p0.x + FM.cos(ball.spin + 2.1) * (r * 0.56);
    var sp2Y = _p0.y + FM.sin(ball.spin + 2.1) * (r * 0.56);
    var sp3X = _p0.x + FM.cos(ball.spin - 2.1) * (r * 0.56);
    var sp3Y = _p0.y + FM.sin(ball.spin - 2.1) * (r * 0.56);
    gDrawLine(spX, spY, sp2X, sp2Y, C_BALL_PENTA);
    gDrawLine(spX, spY, sp3X, sp3Y, C_BALL_PENTA);
    gFillCircle(sp2X, sp2Y, Math.max(1, (r * 0.18) | 0), C_BALL_PENTA);
    gFillCircle(sp3X, sp3Y, Math.max(1, (r * 0.18) | 0), C_BALL_PENTA);
  }
}

function drawAimReticle() {
  if (gameState !== STATE_AIM && gameState !== STATE_RUNUP) return;
  projectWorld(aim.wx, 0.0, aim.wz, _p0);
  var r = 8;
  var col = (gameState === STATE_RUNUP || powerGauge.charging) ? C_GOLD : C_CYAN;
  drawCircleOutline(_p0.x, _p0.y, r, col);
  gDrawLine(_p0.x - r - 3, _p0.y, _p0.x + r + 3, _p0.y, col);
  gDrawLine(_p0.x, _p0.y - r - 3, _p0.x, _p0.y + r + 3, col);
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

  var i, mc;
  for (i = 0; i < 5; i++) {
    mc = (shotMarks[i] === 1) ? C_GREEN : ((shotMarks[i] === -1) ? C_RED : C_HUD_BDR);
    gFillCircle(76 + i * 10, 10, 3, mc);
  }

  gDrawText("R" + roundNum, 128, 7, C_CYAN, C_HUD_BG, 1);

  var scTxt = "S:" + score + " B:" + bestScore;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 5, 7, C_WHITE, C_HUD_BG, 1);

  if (Math.abs(windX) >= 0.1) {
    var wStr = (windX > 0 ? "W>" : "<W") + Math.round(Math.abs(windX) * 9);
    gDrawText(wStr, 6, HUD_H + 4, C_WHITE, -1, 1);
  }

  if (lastShotKmh > 0 && (gameState === STATE_FLIGHT || gameState === STATE_RESULT)) {
    var kmTxt = lastShotKmh + "km/h";
    gDrawText(kmTxt, SCREEN_W - kmTxt.length * 6 - 6, HUD_H + 4, C_GOLD, -1, 1);
  }

  if (modeToastText && now < modeToastUntil) {
    gFillRoundRect(25, HUD_H + 4, 56, 16, 6, C_HUD_BG);
    gDrawText(modeToastText, 32, HUD_H + 8, C_GOLD, C_HUD_BG, 1);
  }

  if (gameState === STATE_AIM) {
    var pwX = 8, pwY = SCREEN_H - 22, pwW = 64, pwH = 12;
    gFillRect(pwX, pwY, pwW, pwH, C_HUD_BG);
    gDrawRect(pwX, pwY, pwW, pwH, C_WHITE);
    var fillW = Math.round((pwW - 2) * powerGauge.val);
    var barC = (powerGauge.val > 0.88) ? C_RED : ((powerGauge.val > 0.65) ? C_GOLD : C_GREEN);
    if (fillW > 0) gFillRect(pwX + 1, pwY + 1, fillW, pwH - 2, barC);
    gDrawText("PWR", pwX + 2, pwY - 10, C_WHITE, -1, 1);

    var sbCol = powerGauge.charging ? C_GOLD : C_RED;
    gFillRoundRect(SCREEN_W - 58, SCREEN_H - 26, 52, 20, 6, sbCol);
    gDrawRoundRect(SCREEN_W - 58, SCREEN_H - 26, 52, 20, 6, C_WHITE);
    gDrawText("SHOOT", SCREEN_W - 47, SCREEN_H - 20, powerGauge.charging ? C_BLACK : C_WHITE, sbCol, 1);
  }
}

var lastRawTouch = { down: false, x: 0, y: 0 };

function drawScene(now) {
  beginFrame(SKY_BANDS[0]);
  drawStadiumBackdrop(now);
  drawPitchAndMarkings(now);
  drawGoalCage(now);

  if (ball.wy < 0.04) {
    drawSoccerBall();
    drawGoalkeeper(now);
  } else {
    drawGoalkeeper(now);
    drawSoccerBall();
  }

  drawStrikerPlayer();
  drawAimReticle();

  var i, pt;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (pt.active) gFillCircle(pt.x, pt.y, Math.max(1, (pt.life * 2.5) | 0), pt.color);
  }

  drawHUD(now);
  drawHoldIndicator(now);

  if (gameState === STATE_TITLE) {
    var tw = Math.min(SCREEN_W - 20, 234);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 96) >> 1;
    gFillRoundRect(tx, ty, tw, 96, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 96, 10, C_GOLD);
    gDrawText("PENALTY STRIKE PRO", tx + ((tw - 144) >> 1), ty + 10, C_GOLD, C_HUD_BG, 2);
    gDrawText("Tap Goal or Flick to Shoot!", tx + ((tw - 168) >> 1), ty + 34, C_WHITE, C_HUD_BG, 1);
    gDrawText("Keys/Trackball + 5/Space to Kick", tx + ((tw - 192) >> 1), ty + 48, C_CYAN, C_HUD_BG, 1);
    gDrawText("Press 0 / Hold for 2D or 3D Mode", tx + ((tw - 192) >> 1), ty + 62, C_GOLD, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 80, C_NET_BACK, C_HUD_BG, 1);
  } else if (gameState === STATE_RESULT || gameState === STATE_ROUND_CLEAR) {
    var rw = Math.min(SCREEN_W - 18, 214);
    var rx = (SCREEN_W - rw) >> 1;
    var ry = (SCREEN_H - 36) >> 1;
    gFillRoundRect(rx, ry, rw, 36, 8, C_HUD_BG);
    gDrawRoundRect(rx, ry, rw, 36, 8, resultColor);
    gDrawText(resultText, rx + Math.max(8, ((rw - resultText.length * 8) >> 1)), ry + 11, resultColor, C_HUD_BG, 2);
  } else if (isPaused) {
    var pw = 110;
    var px = (SCREEN_W - pw) >> 1;
    var py = (SCREEN_H - 34) >> 1;
    gFillRoundRect(px, py, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(px, py, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", px + 30, py + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 214);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 70) >> 1;
    gFillRoundRect(gx2, gy2, gw, 70, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 70, 10, C_RED);
    gDrawText("NEEDED " + goalTarget + " GOALS! SCORE: " + score, gx2 + ((gw - 168) >> 1), gy2 + 14, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(gx2 + ((gw - 96) >> 1), gy2 + 36, 96, 22, 6, C_GOLD);
    gDrawText("PLAY AGAIN", gx2 + ((gw - 60) >> 1), gy2 + 43, C_BLACK, C_GOLD, 1);
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
var touchConsumed = false;
var lastTouchDownTime = 0;
var touchStartX = 0, touchStartY = 0;
var touchDownTime = 0;
var touchOnShootBtn = false;
var touchFlicked = false;
var keyMoveTimer = 0;

var isHolding = false;
var holdTriggered = false;
var holdStartTime = 0;
var holdX = 0, holdY = 0;
var HOLD_DURATION = 1200;

function screenTapToGoalAim(tx, ty) {
  projectWorld(-0.95, 0.0, 0.0, _p0);
  projectWorld( 0.95, 0.0, 1.0, _p1);
  var goalLeft = _p0.x;
  var goalRight = _p1.x;
  var goalBot = _p0.groundY;
  var goalTop = _p1.y;

  var wx = ((tx - (goalLeft + goalRight) * 0.5) / Math.max(20, (goalRight - goalLeft) * 0.5)) * 0.95;
  var wz = (goalBot - ty) / Math.max(16, goalBot - goalTop);
  aim.wx = clamp(wx, -1.08, 1.08);
  aim.wz = clamp(wz, 0.08, 1.08);
}

function handleInput(now, dt) {
  if (keyMoveTimer > 0) {
    keyMoveTimer -= dt;
    if (keyMoveTimer <= 0) { aim.dx = 0; aim.dz = 0; }
  }

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

    var tx = ts.x;
    var ty = ts.y;

    if (!touchWasDown) {
      touchWasDown = true;
      touchConsumed = false;
      touchStartX = tx;
      touchStartY = ty;
      touchDownTime = now;
      touchOnShootBtn = false;
      touchFlicked = false;

      isHolding = true;
      holdTriggered = false;
      holdStartTime = now;
      holdX = tx;
      holdY = ty;

      if (ty <= HUD_H + 4) {
        isHolding = false;
        touchConsumed = true;
        if (tx <= 23) { shouldExit = true; return; }
        if (tx <= 50) { toggle2D3D(now); return; }
        if (tx <= 69) { showTouchDebug = !showTouchDebug; return; }
        if (gameState === STATE_AIM || gameState === STATE_RUNUP || gameState === STATE_FLIGHT) {
          isPaused = !isPaused;
          if (!isPaused) shootLockUntil = now + 260;
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
        shootLockUntil = now + 260;
        return;
      }
      if (gameState !== STATE_AIM) {
        touchConsumed = true;
        return;
      }

      if (tx >= SCREEN_W - 62 && ty >= SCREEN_H - 30) {
        isHolding = false;
        if (now < shootLockUntil) { touchConsumed = true; return; }
        touchOnShootBtn = true;
        powerGauge.charging = true;
        powerGauge.val = 0.55;
        return;
      }
    }

    if (isHolding && (Math.abs(tx - holdX) > 10 || Math.abs(ty - holdY) > 10)) {
      isHolding = false;
    }

    if (!touchConsumed && gameState === STATE_AIM && !isPaused && !touchOnShootBtn &&
        now >= shootLockUntil && ty > HUD_H + 4 && ty < SCREEN_H - 30) {
      if (touchStartY - ty >= 26 && !touchFlicked) {
        touchFlicked = true;
        var dx = tx - touchStartX;
        var dy = touchStartY - ty;
        var flickWx = clamp(dx / (SCREEN_W * 0.30), -1.05, 1.05);
        var flickWz = clamp((dy - 18) / (SCREEN_H * 0.36), 0.12, 1.04);
        var flickPwr = clamp(0.55 + dy / (SCREEN_H * 0.45), 0.55, 0.96);
        aim.wx = flickWx;
        aim.wz = flickWz;
        startRunUp(flickWx, flickWz, flickPwr, clamp(dx * 0.005, -0.9, 0.9));
        return;
      }
      if (ty < SCREEN_H * 0.65) {
        screenTapToGoalAim(tx, ty);
      }
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    var heldMs = now - touchDownTime;
    if (!touchConsumed && gameState === STATE_AIM && !isPaused && !holdTriggered && now >= shootLockUntil) {
      if (touchOnShootBtn) {
        startRunUp(aim.wx, aim.wz, powerGauge.val, 0);
      } else if (!touchFlicked && heldMs < 550 && lastRawTouch.y > HUD_H + 6 && lastRawTouch.y < SCREEN_H * 0.65) {
        screenTapToGoalAim(lastRawTouch.x, lastRawTouch.y);
        startRunUp(aim.wx, aim.wz, 0.80, 0);
      }
    }
    touchWasDown = false;
    touchConsumed = false;
    isHolding = false;
    touchOnShootBtn = false;
  }

  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (tb.dx !== 0 || tb.dy !== 0) {
      aim.dx = tb.dx;
      aim.dz = -tb.dy;
      keyMoveTimer = 0.12;
    }
    if (tb.click) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) { isPaused = false; shootLockUntil = now + 260; }
      else if (gameState === STATE_AIM && now >= shootLockUntil) startRunUp(aim.wx, aim.wz, powerGauge.val, 0);
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
      if (gameState === STATE_AIM || gameState === STATE_RUNUP || gameState === STATE_FLIGHT) {
        isPaused = !isPaused;
        if (!isPaused) shootLockUntil = now + 260;
      }
      return;
    }

    if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") {
      aim.dx = -1; keyMoveTimer = 0.14;
    } else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") {
      aim.dx = 1; keyMoveTimer = 0.14;
    } else if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") {
      aim.dz = 1; keyMoveTimer = 0.14;
    } else if (key === "8" || key === "s" || key === "S" || key === "DOWN" || key === "ArrowDown") {
      aim.dz = -1; keyMoveTimer = 0.14;
    } else if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) { isPaused = false; shootLockUntil = now + 260; }
      else if (gameState === STATE_AIM && now >= shootLockUntil) startRunUp(aim.wx, aim.wz, 0.82, 0);
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
  loadBestScore();
  initDoubleBuffer();
  setupRound(1);

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