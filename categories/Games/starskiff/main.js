/* =========================================================
   Star Skiff: Void Rift (2D / 3D) for KryonOS (Duktape ES5.1)
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
   2. MATH, COLORS & DOUBLE-BUFFER GRAPHICS (RGB565)
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

// Sector color themes (0: Cobalt Canyon, 1: Amber Sun-Forge, 2: Crimson Void-Core)
var SECTOR_THEMES = [
  {
    name: "COBALT CANYON",
    sky: rgb565(12, 18, 38),
    deck: rgb565(24, 38, 72),
    deckEdge: rgb565(42, 74, 134),
    deckSide: rgb565(18, 28, 54),
    rail: rgb565(74, 146, 255),
    grid: rgb565(40, 62, 108),
    pillarTop: rgb565(126, 152, 204),
    pillarFront: rgb565(72, 92, 138),
    pillarSide: rgb565(50, 66, 102)
  },
  {
    name: "AMBER SUN-FORGE",
    sky: rgb565(28, 16, 22),
    deck: rgb565(54, 34, 42),
    deckEdge: rgb565(156, 94, 48),
    deckSide: rgb565(38, 22, 30),
    rail: rgb565(255, 168, 56),
    grid: rgb565(88, 54, 52),
    pillarTop: rgb565(212, 148, 92),
    pillarFront: rgb565(144, 84, 52),
    pillarSide: rgb565(98, 56, 38)
  },
  {
    name: "CRIMSON VOID-CORE",
    sky: rgb565(22, 10, 32),
    deck: rgb565(42, 20, 56),
    deckEdge: rgb565(168, 48, 128),
    deckSide: rgb565(28, 12, 38),
    rail: rgb565(244, 72, 168),
    grid: rgb565(76, 34, 92),
    pillarTop: rgb565(188, 102, 198),
    pillarFront: rgb565(122, 54, 136),
    pillarSide: rgb565(84, 34, 96)
  }
];

var C_WHITE      = rgb565(255, 255, 255);
var C_BLACK      = rgb565(10, 12, 18);
var C_HUD_BG     = rgb565(18, 24, 44);
var C_HUD_BDR    = rgb565(68, 96, 160);
var C_SHADOW     = rgb565(10, 14, 26);

var C_SHIP_BODY  = rgb565(234, 244, 255);
var C_SHIP_WING  = rgb565(64, 154, 255);
var C_SHIP_COCK  = rgb565(74, 236, 255);
var C_SHIP_SHD   = rgb565(38, 112, 210);
var C_SHIP_WARP  = rgb565(255, 216, 72);

var C_BOLT       = rgb565(92, 246, 255);
var C_BOLT_CORE  = rgb565(255, 255, 255);
var C_SPARK      = rgb565(255, 86, 62);

var C_CRYS_TOP   = rgb565(132, 244, 255);
var C_CRYS_FRONT = rgb565(48, 186, 224);
var C_CRYS_SIDE  = rgb565(28, 126, 168);

var C_DRONE      = rgb565(236, 48, 68);
var C_DRONE_DARK = rgb565(142, 22, 42);
var C_DRONE_HI   = rgb565(255, 138, 148);
var C_DRONE_EYE  = rgb565(255, 232, 74);

var C_SHARD_GOLD = rgb565(255, 212, 48);
var C_SHARD_HI   = rgb565(255, 248, 186);
var C_SHIELD_ORB = rgb565(72, 238, 206);
var C_RED_HEART  = rgb565(255, 68, 88);

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

function strokeQuad(x0, y0, x1, y1, x2, y2, x3, y3, color) {
  gDrawLine(x0, y0, x1, y1, color);
  gDrawLine(x1, y1, x2, y2, color);
  gDrawLine(x2, y2, x3, y3, color);
  gDrawLine(x3, y3, x0, y0, color);
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

/* ---------------------------------------------------------
   3. PERSISTENT BEST SCORE
   --------------------------------------------------------- */
var BEST_FILE = "skiff_best.txt";
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
   4. 2D <-> 3D PROJECTION & CAMERA
   --------------------------------------------------------- */
var HUD_H = 22;
var WORLD_HALF_W = 100;
var WORLD_HALF_H = 90;

var scaleBase = 1.0;
var centerX = 160;
var centerY = 130;

var is3DMode = false;
var camTilt = 0;
var camYaw = 0;
var camPanX = 0;
var modeToastText = "";
var modeToastUntil = 0;

function computeLayout() {
  var availH = SCREEN_H - HUD_H - 4;
  scaleBase = Math.min(SCREEN_W / 230, availH / 196);
  centerX = SCREEN_W * 0.5;
  centerY = HUD_H + 4 + availH * 0.5;
}

var _pOut = { x: 0, y: 0, scale: 1, depth: 0 };

function project3D(wx, wy, wz, out) {
  if (camTilt <= 0.001) {
    out.x = centerX + wx * scaleBase;
    out.y = centerY + wy * scaleBase;
    out.scale = scaleBase;
    out.depth = wy + wz;
    return out;
  }

  var yawRad = camYaw * camTilt;
  var cosY = FM.cos(yawRad);
  var sinY = FM.sin(yawRad);

  var rx = wx * cosY - wy * sinY;
  var ry = wx * sinY + wy * cosY;

  var tiltRad = camTilt * 0.84; // ~48 degrees perspective tilt
  var cosT = FM.cos(tiltRad);
  var sinT = FM.sin(tiltRad);

  var camY = ry * cosT - wz * sinT;
  var camZ = ry * sinT + wz * cosT;

  var camDist = 310;
  var persp = camDist / Math.max(85, camDist - camZ);
  var sc = scaleBase * lerp(1, persp, camTilt) * lerp(1, 0.88, camTilt);

  out.x = centerX + rx * sc + camPanX * camTilt;
  out.y = centerY + camY * sc + lerp(0, 6, camTilt);
  out.scale = sc;
  out.depth = camZ;
  return out;
}

function toggle3DMode(now) {
  is3DMode = !is3DMode;
  modeToastText = is3DMode ? "3D MODE" : "2D MODE";
  modeToastUntil = now + 1500;
}

/* ---------------------------------------------------------
   5. GAME STATE & PRE-ALLOCATED POOLS
   --------------------------------------------------------- */
var STATE_TITLE = 0;
var STATE_PLAY = 1;
var STATE_GAME_OVER = 2;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;
var autoFire = true;

var sector = 1;
var score = 0;
var hulls = 3;
var hasShieldBubble = false;
var shardsInSector = 0;
var SHARD_GOAL = 10;
var warpTimer = 0;
var scrollOffset = 0;
var sectorToastUntil = 0;

var skiff = {
  x: 0, y: 55, z: 7,
  bank: 0, fireCool: 0, invuln: 0
};

// Obstacle types: 0 = Obsidian Pillar, 1 = Crystal Barrier, 2 = Hunter Drone
var MAX_OBS = 10;
var obstacles = [];
(function initObs() {
  var i;
  for (i = 0; i < MAX_OBS; i++) {
    obstacles.push({
      active: false, type: 0, x: 0, y: 0, z: 0,
      hw: 12, hd: 12, hz: 28, hp: 1, flash: 0,
      phase: 0, fireCool: 1.5, speedMul: 1.0
    });
  }
})();

// Player plasma bolts & drone sparks
var MAX_BOLTS = 12;
var bolts = [];
(function initBolts() {
  var i;
  for (i = 0; i < MAX_BOLTS; i++) {
    bolts.push({ active: false, isEnemy: false, x: 0, y: 0, z: 10, vx: 0, vy: 0 });
  }
})();

// Collectible Sun Shards & Shield Orbs (type 0 = shard, 1 = shield)
var MAX_SHARDS = 10;
var shards = [];
(function initShards() {
  var i;
  for (i = 0; i < MAX_SHARDS; i++) {
    shards.push({ active: false, kind: 0, x: 0, y: 0, phase: 0 });
  }
})();

// Particle & popup pools
var MAX_FX = 24;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, z: 6, vx: 0, vy: 0, vz: 0, life: 0, color: C_SHARD_GOLD });
  }
})();

var popups = [
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_SHARD_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_SHARD_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_SHARD_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_SHARD_GOLD }
];

// Depth-sort pool (kinds: 0=skiff, 1=obs, 2=shard, 3=bolt)
var DRAW_OBS = 1, DRAW_SHARD = 2, DRAW_BOLT = 3, DRAW_SKIFF = 0;
var drawItems = [];
var drawCount = 0;
(function initDrawPool() {
  var i;
  for (i = 0; i < 36; i++) {
    drawItems.push({ kind: 0, ref: null, depth: 0 });
  }
})();

function pushDraw(kind, ref, depth) {
  if (drawCount >= drawItems.length) {
    drawItems.push({ kind: 0, ref: null, depth: 0 });
  }
  var it = drawItems[drawCount++];
  it.kind = kind;
  it.ref = ref;
  it.depth = depth;
}

function sortDrawItems(count) {
  var i, j, key;
  for (i = 1; i < count; i++) {
    key = drawItems[i];
    j = i - 1;
    while (j >= 0 && drawItems[j].depth > key.depth) {
      drawItems[j + 1] = drawItems[j];
      j--;
    }
    drawItems[j + 1] = key;
  }
}

function spawnFx(wx, wy, wz, color, count) {
  var i, s = 0, a, sp, pt;
  for (i = 0; i < MAX_FX && s < count; i++) {
    pt = fxPool[i];
    if (!pt.active) {
      a = (6.2831853 * s) / count + FM.random() * 0.5;
      sp = 32 + FM.random() * 55;
      pt.active = true;
      pt.x = wx; pt.y = wy; pt.z = wz;
      pt.vx = FM.cos(a) * sp;
      pt.vy = FM.sin(a) * sp;
      pt.vz = 15 + FM.random() * 35;
      pt.life = 1.0;
      pt.color = color;
      s++;
    }
  }
}

function spawnPopup(wx, wy, txt, color) {
  project3D(wx, wy, 16, _pOut);
  var i, p;
  for (i = 0; i < popups.length; i++) {
    p = popups[i];
    if (!p.active) {
      p.active = true;
      p.x = clamp(_pOut.x - 16, 4, SCREEN_W - 68);
      p.y = clamp(_pOut.y - 10, HUD_H + 6, SCREEN_H - 18);
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
   6. WAVE SPAWNERS & SIMULATION
   --------------------------------------------------------- */
var obsSpawnTimer = 0.6;
var shardSpawnTimer = 0.9;

function clearPools() {
  var i;
  for (i = 0; i < MAX_OBS; i++) obstacles[i].active = false;
  for (i = 0; i < MAX_BOLTS; i++) bolts[i].active = false;
  for (i = 0; i < MAX_SHARDS; i++) shards[i].active = false;
  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;
  for (i = 0; i < popups.length; i++) popups[i].active = false;
}

function startNewGame(now) {
  sector = 1;
  score = 0;
  hulls = 3;
  hasShieldBubble = false;
  shardsInSector = 0;
  warpTimer = 0;
  isPaused = false;
  gameState = STATE_PLAY;
  sectorToastUntil = now + 1800;

  skiff.x = 0;
  skiff.y = 52;
  skiff.z = 7;
  skiff.bank = 0;
  skiff.fireCool = 0;
  skiff.invuln = 1.2;

  obsSpawnTimer = 0.5;
  shardSpawnTimer = 0.7;
  clearPools();
}

function spawnObstacle() {
  var i, o = null;
  for (i = 0; i < MAX_OBS; i++) {
    if (!obstacles[i].active) { o = obstacles[i]; break; }
  }
  if (!o) return;

  var roll = FM.random();
  var t = 0;
  if (roll > 0.62) t = 2;       // Hunter Drone
  else if (roll > 0.30) t = 1;  // Crystal Barrier

  o.active = true;
  o.type = t;
  o.x = -78 + FM.random() * 156;
  o.y = -WORLD_HALF_H - 18;
  o.flash = 0;
  o.phase = FM.random() * 6.28;
  o.fireCool = 1.0 + FM.random() * 1.4;

  if (t === 0) { // Obsidian Pillar
    o.hw = 11; o.hd = 11; o.hz = 32; o.z = 0; o.hp = 99; o.speedMul = 1.0;
  } else if (t === 1) { // Destructible Crystal
    o.hw = 13; o.hd = 9; o.hz = 20; o.z = 0; o.hp = 2; o.speedMul = 1.0;
  } else { // Floating Hunter Drone
    o.hw = 9; o.hd = 9; o.hz = 16; o.z = 11; o.hp = (sector >= 3) ? 2 : 1; o.speedMul = 0.78;
  }
}

function spawnShard(kind, wx, wy) {
  var i, s;
  for (i = 0; i < MAX_SHARDS; i++) {
    s = shards[i];
    if (!s.active) {
      s.active = true;
      s.kind = kind;
      s.x = wx;
      s.y = wy;
      s.phase = FM.random() * 6.28;
      return;
    }
  }
}

function fireBolt(isEnemy, x, y, z, vx, vy) {
  var i, b;
  for (i = 0; i < MAX_BOLTS; i++) {
    b = bolts[i];
    if (!b.active) {
      b.active = true;
      b.isEnemy = isEnemy;
      b.x = x; b.y = y; b.z = z;
      b.vx = vx; b.vy = vy;
      return;
    }
  }
}

function firePlayerVolley() {
  if (gameState !== STATE_PLAY || isPaused) return;
  if (skiff.fireCool > 0) return;
  skiff.fireCool = (warpTimer > 0) ? 0.14 : 0.24;
  fireBolt(false, skiff.x - 6, skiff.y - 10, 8, 0, -240);
  fireBolt(false, skiff.x + 6, skiff.y - 10, 8, 0, -240);
}

function damageSkiff() {
  if (skiff.invuln > 0 || warpTimer > 0) return;
  if (hasShieldBubble) {
    hasShieldBubble = false;
    skiff.invuln = 1.4;
    spawnFx(skiff.x, skiff.y, 10, C_SHIELD_ORB, 12);
    spawnPopup(skiff.x, skiff.y, "SHIELD!", C_SHIELD_ORB);
    return;
  }
  hulls--;
  skiff.invuln = 1.8;
  spawnFx(skiff.x, skiff.y, 10, C_RED_HEART, 14);
  if (hulls <= 0) {
    gameState = STATE_GAME_OVER;
  }
}

var inputMove = { dx: 0, dy: 0 };
var dragDelta = { dx: 0, dy: 0 };

function updateSimulation(dt, now) {
  var i, pt, pp;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (!pt.active) continue;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.z = Math.max(0, pt.z + pt.vz * dt);
    pt.vz -= 65 * dt;
    pt.life -= dt * 2.1;
    if (pt.life <= 0) pt.active = false;
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (!pp.active) continue;
    pp.y -= dt * 18;
    pp.life -= dt * 1.3;
    if (pp.life <= 0) pp.active = false;
  }

  // Smooth camera tilt animation (always active even on Title/GameOver!)
  var targetTilt = is3DMode ? 1 : 0;
  camTilt += (targetTilt - camTilt) * 0.14;
  if (Math.abs(targetTilt - camTilt) < 0.004) camTilt = targetTilt;

  var targetYaw = is3DMode ? clamp(-skiff.x * 0.0021, -0.20, 0.20) : 0;
  var targetPanX = is3DMode ? (-skiff.x * 0.16) : 0;
  camYaw += (targetYaw - camYaw) * 0.08;
  camPanX += (targetPanX - camPanX) * 0.08;

  if (gameState !== STATE_PLAY || isPaused) {
    if (gameState === STATE_TITLE) {
      scrollOffset = (scrollOffset + 45 * dt) % 30;
      skiff.x = FM.sin(now * 0.0018) * 32;
      skiff.bank = -FM.cos(now * 0.0018) * 0.4;
    }
    return;
  }

  var baseSpeed = (warpTimer > 0) ? 145 : Math.min(115, 62 + (sector - 1) * 12);
  scrollOffset = (scrollOffset + baseSpeed * dt) % 30;

  if (warpTimer > 0) warpTimer = Math.max(0, warpTimer - dt);
  if (skiff.fireCool > 0) skiff.fireCool = Math.max(0, skiff.fireCool - dt);
  if (skiff.invuln > 0) skiff.invuln = Math.max(0, skiff.invuln - dt);

  // Move Skiff from keyboard/trackball + 1:1 touch drag
  var speed = 135;
  var vx = inputMove.dx * speed;
  var vy = inputMove.dy * speed;
  skiff.x += vx * dt + dragDelta.dx;
  skiff.y += vy * dt + dragDelta.dy;
  dragDelta.dx = 0; dragDelta.dy = 0;

  skiff.x = clamp(skiff.x, -WORLD_HALF_W + 14, WORLD_HALF_W - 14);
  skiff.y = clamp(skiff.y, -WORLD_HALF_H + 22, WORLD_HALF_H - 14);

  var targetBank = clamp((vx / speed) * 0.65, -0.7, 0.7);
  skiff.bank += (targetBank - skiff.bank) * 0.2;

  if (autoFire && skiff.fireCool <= 0) {
    skiff.fireCool = (warpTimer > 0) ? 0.18 : 0.38;
    fireBolt(false, skiff.x - 6, skiff.y - 10, 8, 0, -240);
    fireBolt(false, skiff.x + 6, skiff.y - 10, 8, 0, -240);
  }

  // Spawn canyon obstacles & Sun Shards
  obsSpawnTimer -= dt;
  if (obsSpawnTimer <= 0) {
    spawnObstacle();
    obsSpawnTimer = Math.max(0.42, 1.05 - sector * 0.11);
  }

  shardSpawnTimer -= dt;
  if (shardSpawnTimer <= 0) {
    spawnShard(0, -72 + FM.random() * 144, -WORLD_HALF_H - 12);
    shardSpawnTimer = 1.15;
  }

  // Update bolts & check hits
  var j, b, o;
  for (i = 0; i < MAX_BOLTS; i++) {
    b = bolts[i];
    if (!b.active) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.y < -WORLD_HALF_H - 16 || b.y > WORLD_HALF_H + 16 || Math.abs(b.x) > WORLD_HALF_W + 10) {
      b.active = false;
      continue;
    }

    if (b.isEnemy) {
      if (Math.abs(b.x - skiff.x) < 11 && Math.abs(b.y - skiff.y) < 11) {
        b.active = false;
        damageSkiff();
      }
    } else {
      for (j = 0; j < MAX_OBS; j++) {
        o = obstacles[j];
        if (!o.active) continue;
        if (Math.abs(b.x - o.x) <= o.hw + 3 && Math.abs(b.y - o.y) <= o.hd + 5) {
          b.active = false;
          if (o.type === 0) {
            spawnFx(b.x, b.y, 10, C_WHITE, 4); // Sparks off obsidian pillar
          } else {
            o.hp--;
            o.flash = 0.12;
            if (o.hp <= 0) {
              o.active = false;
              var pts = (o.type === 2) ? 40 : 25;
              addScore(pts);
              spawnFx(o.x, o.y, o.type === 2 ? C_DRONE : C_CRYS_TOP, 10);
              spawnPopup(o.x, o.y, "+" + pts, o.type === 2 ? C_DRONE_EYE : C_CRYS_TOP);
              if (FM.random() < 0.22) spawnShard(1, o.x, o.y); // Drop shield orb!
            } else {
              spawnFx(b.x, b.y, C_CRYS_TOP, 4);
            }
          }
          break;
        }
      }
    }
  }

  // Update obstacles
  for (i = 0; i < MAX_OBS; i++) {
    o = obstacles[i];
    if (!o.active) continue;
    if (o.flash > 0) o.flash = Math.max(0, o.flash - dt);

    o.y += baseSpeed * o.speedMul * dt;
    if (o.type === 2) {
      o.phase += dt * 3.2;
      o.x = clamp(o.x + FM.sin(o.phase) * 46 * dt, -WORLD_HALF_W + 14, WORLD_HALF_W - 14);
      o.z = 11 + FM.sin(o.phase * 1.4) * 3;
      o.fireCool -= dt;
      if (o.fireCool <= 0 && o.y < skiff.y - 24 && o.y > -WORLD_HALF_H + 10) {
        o.fireCool = Math.max(1.2, 2.2 - sector * 0.18);
        var fdx = skiff.x - o.x;
        var fdy = skiff.y - o.y;
        var fd = Math.max(1, FM.sqrt(fdx * fdx + fdy * fdy));
        fireBolt(true, o.x, o.y + 8, o.z, (fdx / fd) * 95, (fdy / fd) * 95);
      }
    }

    if (o.y > WORLD_HALF_H + 22) {
      o.active = false;
      continue;
    }

    // Skiff collision
    if (Math.abs(o.x - skiff.x) < o.hw + 8 && Math.abs(o.y - skiff.y) < o.hd + 8) {
      if (warpTimer > 0) {
        o.active = false;
        addScore(35);
        spawnFx(o.x, o.y, C_SHIP_WARP, 10);
      } else {
        if (o.type !== 0) o.active = false;
        damageSkiff();
      }
    }
  }

  // Update Sun Shards & Shields
  var s;
  for (i = 0; i < MAX_SHARDS; i++) {
    s = shards[i];
    if (!s.active) continue;
    s.y += baseSpeed * dt;
    s.phase += dt * 5.0;
    if (s.y > WORLD_HALF_H + 18) {
      s.active = false;
      continue;
    }
    if (Math.abs(s.x - skiff.x) < 15 && Math.abs(s.y - skiff.y) < 15) {
      s.active = false;
      if (s.kind === 1) {
        if (!hasShieldBubble) hasShieldBubble = true;
        else if (hulls < 3) hulls++;
        addScore(30);
        spawnFx(s.x, s.y, C_SHIELD_ORB, 10);
        spawnPopup(s.x, s.y, "SHIELD!", C_SHIELD_ORB);
      } else {
        addScore(15);
        shardsInSector++;
        spawnFx(s.x, s.y, C_SHARD_GOLD, 7);
        spawnPopup(s.x, s.y, "+15", C_SHARD_GOLD);

        if (shardsInSector >= SHARD_GOAL) {
          shardsInSector = 0;
          sector++;
          warpTimer = 2.6;
          if (hulls < 3) hulls++;
          addScore(150);
          sectorToastUntil = now + 2000;
          spawnFx(skiff.x, skiff.y, C_SHIP_WARP, 16);
          spawnPopup(skiff.x, skiff.y, "WARP +150", C_SHIP_WARP);
        }
      }
    }
  }
}

/* ---------------------------------------------------------
   7. 2D + 3D WORLD & ENTITY RENDERERS
   --------------------------------------------------------- */
var _t0 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t1 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t2 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t3 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b0 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b1 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b2 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b3 = { x: 0, y: 0, scale: 1, depth: 0 };
var _p2 = { x: 0, y: 0, scale: 1, depth: 0 };
var _p3 = { x: 0, y: 0, scale: 1, depth: 0 };

function drawCanyonDeck(theme) {
  var hw = WORLD_HALF_W + 4;
  var hh = WORLD_HALF_H + 4;
  var slabThick = 14 * camTilt;

  project3D(-hw, -hh, 0, _t0);
  project3D(hw, -hh, 0, _t1);
  project3D(hw, hh, 0, _t2);
  project3D(-hw, hh, 0, _t3);

  if (camTilt > 0.02) {
    project3D(-hw, -hh, -slabThick, _b0);
    project3D(hw, -hh, -slabThick, _b1);
    project3D(hw, hh, -slabThick, _b2);
    project3D(-hw, hh, -slabThick, _b3);

    if (camYaw * camTilt > 0.005) {
      fillQuad(_t0.x, _t0.y, _t3.x, _t3.y, _b3.x, _b3.y, _b0.x, _b0.y, theme.deckSide);
    } else if (camYaw * camTilt < -0.005) {
      fillQuad(_t1.x, _t1.y, _t2.x, _t2.y, _b2.x, _b2.y, _b1.x, _b1.y, theme.deckSide);
    }
    fillQuad(_t3.x, _t3.y, _t2.x, _t2.y, _b2.x, _b2.y, _b3.x, _b3.y, theme.deckEdge);
  }

  fillQuad(_t0.x, _t0.y, _t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, theme.deck);

  // Scrolling canyon grid lines
  var gy, gx;
  for (gy = -hh + scrollOffset; gy <= hh; gy += 30) {
    project3D(-hw, gy, 0, _pOut);
    project3D(hw, gy, 0, _p2);
    gDrawLine(_pOut.x, _pOut.y, _p2.x, _p2.y, theme.grid);
  }
  for (gx = -60; gx <= 60; gx += 40) {
    project3D(gx, -hh, 0, _pOut);
    project3D(gx, hh, 0, _p2);
    gDrawLine(_pOut.x, _pOut.y, _p2.x, _p2.y, theme.grid);
  }

  // Glowing side canyon rails
  gDrawLine(_t0.x, _t0.y, _t3.x, _t3.y, warpTimer > 0 ? C_SHIP_WARP : theme.rail);
  gDrawLine(_t1.x, _t1.y, _t2.x, _t2.y, warpTimer > 0 ? C_SHIP_WARP : theme.rail);
}

function draw3DBox(wx, wy, hw, hd, hz, topC, frontC, sideC) {
  var hZ = hz * camTilt;
  project3D(wx - hw, wy - hd, hZ, _t0);
  project3D(wx + hw, wy - hd, hZ, _t1);
  project3D(wx + hw, wy + hd, hZ, _t2);
  project3D(wx - hw, wy + hd, hZ, _t3);

  if (camTilt <= 0.03) {
    fillQuad(_t0.x, _t0.y, _t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, topC);
    strokeQuad(_t0.x, _t0.y, _t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, sideC);
    return;
  }

  project3D(wx - hw, wy - hd, 0, _b0);
  project3D(wx + hw, wy - hd, 0, _b1);
  project3D(wx + hw, wy + hd, 0, _b2);
  project3D(wx - hw, wy + hd, 0, _b3);

  if (wx >= 0) {
    fillQuad(_t0.x, _t0.y, _t3.x, _t3.y, _b3.x, _b3.y, _b0.x, _b0.y, sideC);
  } else {
    fillQuad(_t1.x, _t1.y, _t2.x, _t2.y, _b2.x, _b2.y, _b1.x, _b1.y, sideC);
  }
  fillQuad(_t3.x, _t3.y, _t2.x, _t2.y, _b2.x, _b2.y, _b3.x, _b3.y, frontC);
  fillQuad(_t0.x, _t0.y, _t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, topC);
  strokeQuad(_t0.x, _t0.y, _t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, sideC);
}

function drawDroneEntity(o) {
  var lz = o.z * camTilt;
  project3D(o.x, o.y, lz, _pOut);
  var r = Math.max(4, Math.round(9 * _pOut.scale));
  if (o.flash > 0) {
    gFillCircle(_pOut.x, _pOut.y, r, C_WHITE);
  } else if (camTilt <= 0.03) {
    gFillCircle(_pOut.x, _pOut.y, r, C_DRONE);
    gFillCircle(_pOut.x, _pOut.y, Math.max(2, (r * 0.45) | 0), C_DRONE_EYE);
  } else {
    gFillCircle(_pOut.x, _pOut.y, r, C_DRONE_DARK);
    gFillCircle(_pOut.x - r * 0.1, _pOut.y - r * 0.1, Math.max(2, (r * 0.82) | 0), C_DRONE);
    gFillCircle(_pOut.x - r * 0.25, _pOut.y - r * 0.25, Math.max(1, (r * 0.35) | 0), C_DRONE_HI);
    gFillCircle(_pOut.x, _pOut.y + r * 0.15, Math.max(1, (r * 0.28) | 0), C_DRONE_EYE);
  }
}

function drawShardEntity(s) {
  var bob = FM.sin(s.phase) * 3.0;
  var lz = (6 + bob) * camTilt;
  project3D(s.x, s.y, lz, _pOut);
  var r = Math.max(3, Math.round(6 * _pOut.scale));
  if (s.kind === 1) {
    gFillCircle(_pOut.x, _pOut.y, r, C_SHIELD_ORB);
    gFillCircle(_pOut.x - r * 0.25, _pOut.y - r * 0.25, Math.max(1, (r * 0.4) | 0), C_WHITE);
  } else {
    // Rotating golden Sun Shard diamond
    fillQuad(_pOut.x, _pOut.y - r, _pOut.x + r * 0.8, _pOut.y, _pOut.x, _pOut.y + r, _pOut.x - r * 0.8, _pOut.y, C_SHARD_GOLD);
    gFillCircle(_pOut.x, _pOut.y - r * 0.2, Math.max(1, (r * 0.28) | 0), C_SHARD_HI);
  }
}

function drawBoltEntity(b) {
  project3D(b.x, b.y, b.z * camTilt, _pOut);
  var r = Math.max(2, Math.round((b.isEnemy ? 3.5 : 3.0) * _pOut.scale));
  if (b.isEnemy) {
    gFillCircle(_pOut.x, _pOut.y, r, C_SPARK);
    gFillCircle(_pOut.x, _pOut.y, Math.max(1, r - 1), C_SHARD_GOLD);
  } else {
    gFillCircle(_pOut.x, _pOut.y, r + 1, C_BOLT);
    gFillCircle(_pOut.x, _pOut.y, Math.max(1, r - 1), C_BOLT_CORE);
  }
}

function drawSkiffEntity(now) {
  if (skiff.invuln > 0 && (((now / 80) | 0) & 1) === 1) return;

  var lz = skiff.z * camTilt;
  var bankZ = skiff.bank * 4.5 * camTilt;

  // Nose, left wingtip, right wingtip, tail core
  project3D(skiff.x, skiff.y - 12, lz, _pOut);
  project3D(skiff.x - 11, skiff.y + 8, lz - bankZ, _p2);
  project3D(skiff.x + 11, skiff.y + 8, lz + bankZ, _p3);
  project3D(skiff.x, skiff.y + 4, lz + 3 * camTilt, _t0);

  var bodyC = (warpTimer > 0) ? C_SHIP_WARP : C_SHIP_BODY;
  var wingC = (warpTimer > 0) ? C_SHARD_GOLD : C_SHIP_WING;

  // Thruster exhaust flame
  var flame = 5 + (((now / 50) | 0) & 1) * 4;
  project3D(skiff.x, skiff.y + 8 + flame, lz, _t1);
  gDrawLine(_t0.x, _t0.y, _t1.x, _t1.y, C_BOLT);
  gFillCircle(_t0.x, _t0.y + 2, 2, C_SHARD_GOLD);

  // Wings & Nose hull
  fillTri(_pOut.x, _pOut.y, _p2.x, _p2.y, _t0.x, _t0.y, wingC);
  fillTri(_pOut.x, _pOut.y, _p3.x, _p3.y, _t0.x, _t0.y, C_SHIP_SHD);
  fillTri(_pOut.x, _pOut.y, (_p2.x + _t0.x) * 0.5, (_p2.y + _t0.y) * 0.5, (_p3.x + _t0.x) * 0.5, (_p3.y + _t0.y) * 0.5, bodyC);

  // Cockpit canopy
  gFillCircle((_pOut.x + _t0.x) * 0.5, (_pOut.y + _t0.y) * 0.5, Math.max(2, Math.round(2.5 * _pOut.scale)), C_SHIP_COCK);

  // Protective Shield Bubble
  if (hasShieldBubble || warpTimer > 0) {
    var sr = Math.max(10, Math.round(14 * _pOut.scale));
    gDrawRoundRect(_t0.x - sr, _t0.y - sr - 2, sr * 2, sr * 2, sr, warpTimer > 0 ? C_SHIP_WARP : C_SHIELD_ORB);
  }
}

function drawFloorShadow(wx, wy, rad) {
  if (camTilt <= 0.03) return;
  project3D(wx, wy, 0, _pOut);
  var r = rad * _pOut.scale;
  fillEllipse(_pOut.x, _pOut.y, r, r * lerp(1, 0.52, camTilt), C_SHADOW);
}

function drawHUD(now) {
  gFillRect(0, 0, SCREEN_W, HUD_H, C_HUD_BG);
  gDrawLine(0, HUD_H - 1, SCREEN_W, HUD_H - 1, C_HUD_BDR);

  gFillRoundRect(4, 3, 20, 16, 4, C_HUD_BDR);
  gDrawText("X", 11, 7, C_WHITE, C_HUD_BDR, 1);

  gFillRoundRect(27, 3, 24, 16, 4, is3DMode ? C_SHIP_WING : C_HUD_BDR);
  gDrawText(is3DMode ? "3D" : "2D", 33, 7, C_WHITE, is3DMode ? C_SHIP_WING : C_HUD_BDR, 1);

  gFillRoundRect(54, 3, 18, 16, 4, autoFire ? C_SHIELD_ORB : C_HUD_BDR);
  gDrawText("A", 60, 7, autoFire ? C_BLACK : C_WHITE, autoFire ? C_SHIELD_ORB : C_HUD_BDR, 1);

  gFillRoundRect(75, 3, 16, 16, 4, showTouchDebug ? C_DRONE : C_HUD_BDR);
  gDrawText("?", 80, 7, C_WHITE, showTouchDebug ? C_DRONE : C_HUD_BDR, 1);

  // Hull hearts
  var i;
  for (i = 0; i < 3; i++) {
    gFillCircle(99 + i * 10, 10, 3, i < hulls ? C_RED_HEART : C_HUD_BDR);
  }

  // Warp Shards & Score
  gDrawText("W:" + shardsInSector + "/10", 130, 7, C_SHARD_GOLD, C_HUD_BG, 1);
  var scTxt = "S:" + score + " B:" + bestScore;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 5, 7, C_WHITE, C_HUD_BG, 1);

  // Bottom-right manual FIRE button
  if (gameState === STATE_PLAY) {
    var fbX = SCREEN_W - 56;
    var fbY = SCREEN_H - 26;
    gFillRoundRect(fbX, fbY, 50, 20, 6, C_SHIP_WING);
    gDrawRoundRect(fbX, fbY, 50, 20, 6, C_WHITE);
    gDrawText("FIRE", fbX + 13, fbY + 6, C_WHITE, C_SHIP_WING, 1);
  }

  if (modeToastText && now < modeToastUntil) {
    gFillRoundRect(4, HUD_H + 4, 58, 16, 4, C_HUD_BG);
    gDrawText(modeToastText, 10, HUD_H + 8, C_SHIP_COCK, C_HUD_BG, 1);
  }
  if (gameState === STATE_PLAY && now < sectorToastUntil) {
    var th = SECTOR_THEMES[(sector - 1) % SECTOR_THEMES.length];
    var stxt = "S" + sector + ": " + th.name;
    var sw = stxt.length * 6 + 14;
    gFillRoundRect((SCREEN_W - sw) >> 1, HUD_H + 6, sw, 18, 6, C_HUD_BG);
    gDrawRoundRect((SCREEN_W - sw) >> 1, HUD_H + 6, sw, 18, 6, C_SHARD_GOLD);
    gDrawText(stxt, ((SCREEN_W - sw) >> 1) + 7, HUD_H + 11, C_SHARD_GOLD, C_HUD_BG, 1);
  }
}

var isHolding = false, holdTriggered = false, holdStartTime = 0, holdX = 0, holdY = 0;
var HOLD_DURATION = 1500;
var lastRawTouch = { down: false, x: 0, y: 0 };

function drawHoldIndicator(now) {
  if (!isHolding || holdTriggered) return;
  var elapsed = now - holdStartTime;
  if (elapsed < 350) return;

  var progress = Math.min(1, elapsed / HOLD_DURATION);
  var r = 18;
  var segs = 12;
  var step = 6.2831853 / segs;
  var activeSegs = Math.floor(segs * progress);
  var i, a0, a1;
  for (i = 0; i < segs; i++) {
    a0 = -1.5707963 + i * step;
    a1 = a0 + step;
    gDrawLine(
      holdX + r * FM.cos(a0), holdY + r * FM.sin(a0),
      holdX + r * FM.cos(a1), holdY + r * FM.sin(a1),
      i < activeSegs ? C_SHIP_COCK : C_HUD_BDR
    );
  }
}

function drawScene(now) {
  var theme = SECTOR_THEMES[(sector - 1) % SECTOR_THEMES.length];
  beginFrame(theme.sky);

  if (isHolding && !holdTriggered && (now - holdStartTime >= HOLD_DURATION)) {
    holdTriggered = true;
    isHolding = false;
    toggle3DMode(now);
  }

  // 1. Canyon Deck (2D flat track / 3D floating slab)
  drawCanyonDeck(theme);

  // 2. Floor Shadows in 3D mode
  var i, o, s, b;
  if (camTilt > 0.03) {
    drawFloorShadow(skiff.x, skiff.y, 10);
    for (i = 0; i < MAX_OBS; i++) {
      o = obstacles[i];
      if (o.active && o.type === 2) drawFloorShadow(o.x, o.y, 8);
    }
    for (i = 0; i < MAX_SHARDS; i++) {
      s = shards[i];
      if (s.active) drawFloorShadow(s.x, s.y, 5);
    }
  }

  // 3. Collect & depth-sort all entities
  drawCount = 0;
  pushDraw(DRAW_SKIFF, skiff, project3D(skiff.x, skiff.y, skiff.z * camTilt, _pOut).depth);

  for (i = 0; i < MAX_OBS; i++) {
    o = obstacles[i];
    if (o.active) {
      pushDraw(DRAW_OBS, o, project3D(o.x, o.y, (o.z + o.hz * 0.5) * camTilt, _pOut).depth);
    }
  }
  for (i = 0; i < MAX_SHARDS; i++) {
    s = shards[i];
    if (s.active) pushDraw(DRAW_SHARD, s, project3D(s.x, s.y, 6 * camTilt, _pOut).depth);
  }
  for (i = 0; i < MAX_BOLTS; i++) {
    b = bolts[i];
    if (b.active) pushDraw(DRAW_BOLT, b, project3D(b.x, b.y, b.z * camTilt, _pOut).depth);
  }

  sortDrawItems(drawCount);

  var it;
  for (i = 0; i < drawCount; i++) {
    it = drawItems[i];
    if (it.kind === DRAW_SKIFF) {
      drawSkiffEntity(now);
    } else if (it.kind === DRAW_SHARD) {
      drawShardEntity(it.ref);
    } else if (it.kind === DRAW_BOLT) {
      drawBoltEntity(it.ref);
    } else {
      o = it.ref;
      if (o.type === 0) {
        draw3DBox(o.x, o.y, o.hw, o.hd, o.hz, theme.pillarTop, theme.pillarFront, theme.pillarSide);
      } else if (o.type === 1) {
        draw3DBox(o.x, o.y, o.hw, o.hd, o.hz,
          o.flash > 0 ? C_WHITE : C_CRYS_TOP,
          o.flash > 0 ? C_WHITE : C_CRYS_FRONT,
          C_CRYS_SIDE);
      } else {
        drawDroneEntity(o);
      }
    }
  }

  // 4. Particles & Popups
  var pt, pp, pr;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (!pt.active) continue;
    project3D(pt.x, pt.y, pt.z * camTilt, _pOut);
    pr = Math.max(1, Math.round(2.5 * _pOut.scale * pt.life));
    gFillCircle(_pOut.x, _pOut.y, pr, pt.color);
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (pp.active) gDrawText(pp.txt, pp.x, pp.y, pp.color, -1, 1);
  }

  drawHUD(now);

  if (gameState === STATE_TITLE) {
    var tw = Math.min(SCREEN_W - 20, 232);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 102) >> 1;
    gFillRoundRect(tx, ty, tw, 102, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 102, 10, C_SHIP_COCK);
    gDrawText("STAR SKIFF: VOID RIFT", tx + ((tw - 168) >> 1), ty + 10, C_SHIP_COCK, C_HUD_BG, 2);
    gDrawText("2490: Sky Vaults are collapsing!", tx + 16, ty + 32, C_WHITE, C_HUD_BG, 1);
    gDrawText("Grab 10 Shards to Warp Sectors.", tx + 16, ty + 45, C_SHARD_GOLD, C_HUD_BG, 1);
    gDrawText("Hold or Press 0 for 3D anytime!", tx + 16, ty + 58, C_SHIP_WING, C_HUD_BG, 1);
    gDrawText("Tap or Press 5 to Launch", tx + ((tw - 144) >> 1), ty + 73, C_SHIELD_ORB, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 88, C_HUD_BDR, C_HUD_BG, 1);
  } else if (isPaused && gameState === STATE_PLAY) {
    var pw = 110;
    var pxx = (SCREEN_W - pw) >> 1;
    var pyy = (SCREEN_H - 34) >> 1;
    gFillRoundRect(pxx, pyy, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(pxx, pyy, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", pxx + 30, pyy + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 214);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 72) >> 1;
    gFillRoundRect(gx2, gy2, gw, 72, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 72, 10, C_RED_HEART);
    gDrawText("SKIFF LOST - SECTOR " + sector, gx2 + ((gw - 126) >> 1), gy2 + 12, C_RED_HEART, C_HUD_BG, 1);
    gDrawText("SCORE: " + score + "  BEST: " + bestScore, gx2 + ((gw - 126) >> 1), gy2 + 26, C_WHITE, C_HUD_BG, 1);
    gFillRoundRect(gx2 + ((gw - 96) >> 1), gy2 + 42, 96, 22, 6, C_SHIP_WING);
    gDrawText("PLAY AGAIN", gx2 + ((gw - 60) >> 1), gy2 + 49, C_WHITE, C_SHIP_WING, 1);
  }

  if (showTouchDebug) {
    gFillRect(4, HUD_H + 2, SCREEN_W - 8, 28, C_HUD_BG);
    gDrawRect(4, HUD_H + 2, SCREEN_W - 8, 28, C_SHARD_GOLD);
    gDrawText(SCREEN_W + "x" + SCREEN_H + " " + renderMode + " " + touchModeLabel, 8, HUD_H + 5, C_WHITE, C_HUD_BG, 1);
    var dbg = "D:" + (lastRawTouch.down ? 1 : 0) + " X:" + lastRawTouch.x + " Y:" + lastRawTouch.y + " " + touchDiscoveredKeys;
    gDrawText(dbg.slice(0, 48), 8, HUD_H + 17, C_SHIP_COCK, C_HUD_BG, 1);
  }

  drawHoldIndicator(now);
  endFrame();
}

/* ---------------------------------------------------------
   8. INPUT HANDLING (1:1 Touch Drag + Hold-3D + Keys + Trackball)
   --------------------------------------------------------- */
var touchWasDown = false;
var lastTouchDownTime = 0;
var prevTouchX = 0, prevTouchY = 0;
var keyHoldTimer = 0;

function handleInput(now, dt) {
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
      prevTouchX = tx;
      prevTouchY = ty;

      // Top HUD buttons (always accessible)
      if (ty <= HUD_H + 4) {
        if (tx <= 26) { shouldExit = true; return; }
        if (tx <= 52) { toggle3DMode(now); return; }
        if (tx <= 73) { autoFire = !autoFire; return; }
        if (tx <= 94) { showTouchDebug = !showTouchDebug; return; }
        if (gameState === STATE_PLAY) { isPaused = !isPaused; return; }
      }

      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
        startNewGame(now);
        return;
      }
      if (isPaused) {
        isPaused = false;
        return;
      }

      // Bottom-right manual FIRE button
      if (gameState === STATE_PLAY && tx >= SCREEN_W - 60 && ty >= SCREEN_H - 30) {
        firePlayerVolley();
        return;
      }

      isHolding = true;
      holdTriggered = false;
      holdStartTime = now;
      holdX = tx;
      holdY = ty;
    } else if (gameState === STATE_PLAY && !isPaused) {
      if (isHolding && (Math.abs(tx - holdX) > 10 || Math.abs(ty - holdY) > 10)) {
        isHolding = false;
      }
      var ddx = tx - prevTouchX;
      var ddy = ty - prevTouchY;
      if (Math.abs(ddx) <= 45 && Math.abs(ddy) <= 45) {
        dragDelta.dx += ddx * 1.15;
        dragDelta.dy += ddy * 1.15;
      }
      prevTouchX = tx;
      prevTouchY = ty;
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    touchWasDown = false;
    isHolding = false;
  }

  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (tb.dx !== 0 || tb.dy !== 0) {
      inputMove.dx = tb.dx;
      inputMove.dy = tb.dy;
      keyHoldTimer = 0.14;
    }
    if (tb.click) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame(now);
      else if (isPaused) isPaused = false;
      else firePlayerVolley();
    }
  }

  var key = halReadKey();
  if (key) {
    if (key === "q" || key === "Q" || key === "Escape" || key === "ESC") {
      shouldExit = true; return;
    }
    if (key === "0" || key === "m" || key === "M") {
      toggle3DMode(now); return;
    }
    if (key === "f" || key === "F") {
      autoFire = !autoFire; return;
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
      if (gameState === STATE_TITLE) startNewGame(now);
      inputMove.dx = kdx;
      inputMove.dy = kdy;
      keyHoldTimer = 0.16;
      return;
    }

    if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame(now);
      else if (isPaused) isPaused = false;
      else firePlayerVolley();
    } else if (key === "r" || key === "R" || key === "#") {
      startNewGame(now);
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