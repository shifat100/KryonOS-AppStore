/* =========================================================
   Oggy: Rocket Chase (2D / 3D) for KryonOS (Duktape ES5.1)
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

// Stage 1: Backyard, Stage 2: Street, Stage 3: Rooftops
var C_SKY_DAY    = rgb565(138, 214, 248);
var C_SKY_DUSK   = rgb565(246, 174, 136);
var C_SKY_NIGHT  = rgb565(56, 62, 118);

var C_GRASS_A    = rgb565(114, 198, 88);
var C_GRASS_B    = rgb565(96, 178, 72);
var C_DIRT_A     = rgb565(222, 186, 134);
var C_DIRT_B     = rgb565(204, 166, 114);

var C_ROAD_A     = rgb565(92, 98, 112);
var C_ROAD_B     = rgb565(78, 84, 98);
var C_CURB_A     = rgb565(234, 74, 74);
var C_CURB_B     = rgb565(244, 244, 248);

var C_ROOF_A     = rgb565(216, 114, 152);
var C_ROOF_B     = rgb565(194, 94, 132);
var C_ROOF_TRIM  = rgb565(146, 62, 96);

var C_SHADOW     = rgb565(54, 62, 74);
var C_HUD_BG     = rgb565(34, 28, 56);
var C_HUD_BDR    = rgb565(98, 84, 146);

var C_OGGY_BLUE  = rgb565(68, 166, 238);
var C_OGGY_DARK  = rgb565(36, 118, 186);
var C_OGGY_NOSE  = rgb565(236, 44, 56);
var C_OGGY_EYE   = rgb565(82, 198, 92);

var C_WAGON_RED  = rgb565(226, 48, 58);
var C_WAGON_GOLD = rgb565(255, 206, 48);
var C_FLAME      = rgb565(255, 132, 34);

var C_JOEY       = rgb565(168, 74, 178);
var C_DEEDEE     = rgb565(78, 146, 224);
var C_MARKY      = rgb565(114, 198, 84);

var C_CAN_TOP    = rgb565(208, 216, 226);
var C_CAN_SIDE   = rgb565(146, 158, 172);
var C_CAN_DARK   = rgb565(104, 114, 128);

var C_TNT_TOP    = rgb565(242, 82, 68);
var C_TNT_FRONT  = rgb565(198, 42, 38);
var C_TNT_BAND   = rgb565(248, 220, 74);

var C_BANANA     = rgb565(255, 222, 46);
var C_BANANA_DK  = rgb565(172, 124, 18);
var C_FISH_GOLD  = rgb565(255, 198, 38);
var C_MILK       = rgb565(238, 248, 255);
var C_HEART      = rgb565(238, 54, 68);
var C_PINK       = rgb565(248, 112, 176);
var C_GOLD       = rgb565(255, 212, 46);
var C_CYAN       = rgb565(90, 226, 255);
var C_WHITE      = rgb565(255, 255, 255);
var C_BLACK      = rgb565(18, 18, 18);
var C_RING_BG    = rgb565(190, 210, 255);

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
var BEST_FILE = "oggy_chase_best.txt";
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
var is3DMode = true;   // Start in 3D or toggle to 2D anytime!
var camTilt = 1.0;
var camSway = 0;
var modeToastText = "";
var modeToastUntil = 0;

function toggle2D3D(now) {
  is3DMode = !is3DMode;
  modeToastText = is3DMode ? "3D Mode" : "2D Mode";
  modeToastUntil = now + 1500;
}

// Projects world track coords:
//   wx in [-1.2 .. +1.2] (track interior [-0.88 .. +0.88])
//   wy in [0.0 .. 1.0] (0=horizon/wagon, 1=bottom/near)
//   wz = pixels height above ground
function projectWorld(wx, wy, wz, out) {
  var top2D = HUD_H + 6;
  var top3D = HUD_H + 30;
  var botY = SCREEN_H - 12;

  var topY = lerp(top2D, top3D, camTilt);
  var spanY = botY - topY;

  var wyClamped = clamp(wy, -0.05, 1.15);
  var depthT = 1.0 - wyClamped; // 0 near bottom, 1 at horizon
  var perspS = 1.08 / (1.0 + depthT * 1.55);
  var scale = lerp(1.0, perspS, camTilt);

  var wyPersp = wyClamped * 0.36 + wyClamped * wyClamped * 0.64;
  var wyMapped = lerp(wyClamped, wyPersp, camTilt);

  var roadHalfW = SCREEN_W * 0.36;
  var horizonShift = camSway * (1.0 - wyMapped) * SCREEN_W * 0.25 * camTilt;
  var cx = (SCREEN_W * 0.5) + horizonShift;

  out.x = cx + wx * roadHalfW * scale * lerp(1.0, 1.12, camTilt);
  out.y = topY + wyMapped * spanY;
  out.groundY = out.y;
  out.y -= wz * scale * lerp(0.55, 1.0, camTilt);
  out.scale = scale;
  return out;
}

/* ---------------------------------------------------------
   5. GAME STATE & POOLS
   --------------------------------------------------------- */
var STATE_TITLE = 0;
var STATE_PLAY = 1;
var STATE_STAGE_CLEAR = 2;
var STATE_GAME_OVER = 3;

var gameState = STATE_TITLE;
var isPaused = false;
var shouldExit = false;
var showTouchDebug = false;

var stage = 1; // 1=Backyard, 2=Street, 3=Rooftops
var score = 0;
var lives = 3;
var nitro = 0; // 0..100
var roachesLeftInWagon = 3; // Marky -> Dee Dee -> Joey
var scrollDist = 0;
var stageBannerTimer = 0;

var oggy = {
  wx: 0,
  wy: 0.85,
  wz: 0,
  vz: 0,
  invuln: 0,
  turboTimer: 0,
  steerVx: 0
};

var wagon = {
  wx: 0,
  wy: 0.08,
  dir: 1,
  throwTimer: 1.0,
  hitFlash: 0
};

// Obstacle types:
// 0 = Trash Can (tall, dodge left/right)
// 1 = Banana Peel (flat, jump wz>8 or dodge)
// 2 = TNT Crate (medium-high, dodge or jump high wz>14)
// 3 = Fish Snack (+25% Nitro, +20 pts)
// 4 = Milk/Heart (+1 life if hurt)
var MAX_OBS = 14;
var obsPool = [];
(function initObs() {
  var i;
  for (i = 0; i < MAX_OBS; i++) {
    obsPool.push({ active: false, type: 0, wx: 0, wy: 0, vx: 0, hit: false });
  }
})();

var obsSpawnTimer = 0.7;
var fishSpawnTimer = 1.4;

var MAX_FX = 18;
var fxPool = [];
(function initFx() {
  var i;
  for (i = 0; i < MAX_FX; i++) {
    fxPool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, color: C_GOLD });
  }
})();

var popups = [
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD },
  { active: false, x: 0, y: 0, txt: "", life: 0, color: C_GOLD }
];

var _pA = { x: 0, y: 0, groundY: 0, scale: 1 };
var _pB = { x: 0, y: 0, groundY: 0, scale: 1 };
var _pC = { x: 0, y: 0, groundY: 0, scale: 1 };
var _pD = { x: 0, y: 0, groundY: 0, scale: 1 };
var _pItem = { x: 0, y: 0, groundY: 0, scale: 1 };

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
      p.x = clamp(x - 18, 4, SCREEN_W - 68);
      p.y = clamp(y - 12, HUD_H + 6, SCREEN_H - 18);
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

function clearEntities() {
  var i;
  for (i = 0; i < MAX_OBS; i++) obsPool[i].active = false;
  for (i = 0; i < MAX_FX; i++) fxPool[i].active = false;
  for (i = 0; i < popups.length; i++) popups[i].active = false;
}

function setupStage(st) {
  stage = st;
  clearEntities();
  oggy.wx = 0;
  oggy.wy = 0.85;
  oggy.wz = 0;
  oggy.vz = 0;
  oggy.invuln = 1.2;
  oggy.turboTimer = 0;
  wagon.wx = 0;
  wagon.throwTimer = 0.8;
  wagon.hitFlash = 0;
  obsSpawnTimer = 0.6;
  fishSpawnTimer = 1.1;
}

function startNewGame() {
  score = 0;
  lives = 3;
  nitro = 25;
  roachesLeftInWagon = 3;
  isPaused = false;
  gameState = STATE_PLAY;
  setupStage(1);
}

function spawnObs(type, wx, wy, vx) {
  var i, o;
  for (i = 0; i < MAX_OBS; i++) {
    o = obsPool[i];
    if (!o.active) {
      o.active = true;
      o.type = type;
      o.wx = wx;
      o.wy = wy;
      o.vx = vx || 0;
      o.hit = false;
      return;
    }
  }
}

function triggerJump() {
  if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
    startNewGame();
    return;
  }
  if (gameState !== STATE_PLAY || isPaused) return;
  if (oggy.wz <= 0.5) {
    oggy.vz = 152;
  }
}

function triggerTurbo() {
  if (gameState !== STATE_PLAY || isPaused) return;
  if (nitro >= 100 && oggy.turboTimer <= 0) {
    nitro = 0;
    oggy.turboTimer = 2.4;
    projectWorld(oggy.wx, oggy.wy, oggy.wz, _pItem);
    spawnFx(_pItem.x, _pItem.y, C_FLAME, 12);
    spawnPopup(_pItem.x, _pItem.y, "TURBO RAM!", C_GOLD);
  }
}

/* ---------------------------------------------------------
   6. SIMULATION STEP
   --------------------------------------------------------- */
var steerInput = 0; // -1..+1 from keys/trackball
var tapSteerX = null;

function sortObsPool() {
  var i, j, key;
  for (i = 1; i < MAX_OBS; i++) {
    key = obsPool[i];
    j = i - 1;
    while (j >= 0 && obsPool[j].wy > key.wy) {
      obsPool[j + 1] = obsPool[j];
      j--;
    }
    obsPool[j + 1] = key;
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

  // Smooth camera tilt transition (2D <-> 3D)
  var targetTilt = is3DMode ? 1.0 : 0.0;
  camTilt += (targetTilt - camTilt) * Math.min(1, dt * 8.0);
  if (Math.abs(targetTilt - camTilt) < 0.005) camTilt = targetTilt;

  if (gameState === STATE_STAGE_CLEAR) {
    stageBannerTimer -= dt;
    scrollDist += dt * 0.9;
    if (stageBannerTimer <= 0) {
      gameState = STATE_PLAY;
      setupStage(stage + 1);
    }
    return;
  }

  if (gameState !== STATE_PLAY || isPaused) return;

  var baseTrackSpeed = 0.42 + (stage - 1) * 0.055;
  var curSpeed = (oggy.turboTimer > 0) ? (baseTrackSpeed * 1.75) : baseTrackSpeed;
  scrollDist += curSpeed * dt;

  // Oggy timers & Jump gravity
  if (oggy.invuln > 0) oggy.invuln = Math.max(0, oggy.invuln - dt);

  if (oggy.wz > 0 || oggy.vz > 0) {
    oggy.wz += oggy.vz * dt;
    oggy.vz -= 430 * dt;
    if (oggy.wz <= 0) {
      oggy.wz = 0;
      oggy.vz = 0;
    }
  }

  // Horizontal steering
  var steerSpeed = (oggy.turboTimer > 0) ? 1.75 : 1.45;
  if (steerInput !== 0) {
    oggy.wx += steerInput * steerSpeed * dt;
  } else if (tapSteerX !== null) {
    var diffW = tapSteerX - oggy.wx;
    if (Math.abs(diffW) > 0.04) {
      oggy.wx += clamp(diffW * 6.5, -steerSpeed, steerSpeed) * dt;
    } else {
      oggy.wx = tapSteerX;
      tapSteerX = null;
    }
  }
  oggy.wx = clamp(oggy.wx, -0.82, 0.82);
  camSway += (-oggy.wx * 0.45 - camSway) * Math.min(1, dt * 6.0);

  // Turbo Ram forward surge & Wagon Whack!
  if (oggy.turboTimer > 0) {
    oggy.turboTimer -= dt;
    var phase = 1.0 - (oggy.turboTimer / 2.4); // 0..1
    var surge = FM.sin(phase * 3.14159);
    oggy.wy = 0.85 - surge * 0.68; // reaches 0.17 right at the wagon!

    if (surge > 0.92 && wagon.hitFlash <= 0) {
      // Whack a roach off the wagon!
      wagon.hitFlash = 0.8;
      roachesLeftInWagon--;
      addScore(150);
      projectWorld(wagon.wx, wagon.wy, 12, _pItem);
      spawnFx(_pItem.x, _pItem.y, C_GOLD, 16);
      spawnPopup(_pItem.x, _pItem.y, "ROACH DOWN +150", C_GOLD);

      if (roachesLeftInWagon <= 0) {
        roachesLeftInWagon = 3;
        addScore(250);
      }
      gameState = STATE_STAGE_CLEAR;
      stageBannerTimer = 1.6;
      return;
    }
  } else {
    oggy.wy += (0.85 - oggy.wy) * Math.min(1, dt * 8.0);
  }

  // Move Roaches' Rocket Wagon at horizon & throw hazards
  if (wagon.hitFlash > 0) wagon.hitFlash = Math.max(0, wagon.hitFlash - dt);
  var wSpeed = 0.45 + stage * 0.06;
  wagon.wx += wagon.dir * wSpeed * dt;
  if (wagon.wx > 0.68) { wagon.wx = 0.68; wagon.dir = -1; }
  else if (wagon.wx < -0.68) { wagon.wx = -0.68; wagon.dir = 1; }

  wagon.throwTimer -= dt;
  if (wagon.throwTimer <= 0) {
    wagon.throwTimer = Math.max(0.62, 1.35 - stage * 0.12);
    var roll = FM.random();
    var hType = (roll < 0.35) ? 1 : ((roll < 0.72) ? 2 : 0); // Banana / TNT / Trash Can
    var aimBias = (FM.random() < 0.55) ? clamp(oggy.wx + (FM.random() - 0.5) * 0.35, -0.78, 0.78) : wagon.wx;
    spawnObs(hType, aimBias, wagon.wy + 0.03, (hType === 2) ? (FM.random() - 0.5) * 0.16 : 0);
  }

  // Spawn Fish Snacks (and rare Milk Heart)
  fishSpawnTimer -= dt;
  if (fishSpawnTimer <= 0) {
    fishSpawnTimer = 1.55;
    var fType = (lives < 3 && FM.random() < 0.18) ? 4 : 3;
    spawnObs(fType, (FM.random() * 1.5 - 0.75), 0.08, 0);
  }

  // Update obstacles & collisions
  var o, clearH;
  for (i = 0; i < MAX_OBS; i++) {
    o = obsPool[i];
    if (!o.active) continue;
    o.wy += curSpeed * dt;
    o.wx = clamp(o.wx + o.vx * dt, -0.82, 0.82);

    if (o.wy > 1.12) {
      o.active = false;
      continue;
    }

    if (!o.hit && Math.abs(o.wy - oggy.wy) < 0.075 && Math.abs(o.wx - oggy.wx) < 0.24) {
      if (o.type === 3) {
        // Fish Snack!
        o.active = false;
        nitro = Math.min(100, nitro + 25);
        addScore(20);
        projectWorld(o.wx, o.wy, 10, _pItem);
        spawnFx(_pItem.x, _pItem.y, C_FISH_GOLD, 8);
        spawnPopup(_pItem.x, _pItem.y, nitro >= 100 ? "TURBO READY!" : "+20 FISH", C_GOLD);
      } else if (o.type === 4) {
        // Milk Heart!
        o.active = false;
        if (lives < 3) lives++;
        addScore(30);
        projectWorld(o.wx, o.wy, 10, _pItem);
        spawnFx(_pItem.x, _pItem.y, C_HEART, 8);
        spawnPopup(_pItem.x, _pItem.y, "+1 HEART", C_HEART);
      } else {
        // Hazard! Check jump clearance or Turbo Smash
        clearH = (o.type === 1) ? 7 : ((o.type === 2) ? 14 : 24);
        if (oggy.wz >= clearH) {
          o.hit = true; // jumped cleanly over!
          addScore(15);
          projectWorld(o.wx, o.wy, oggy.wz, _pItem);
          spawnPopup(_pItem.x, _pItem.y, "JUMP +15", C_CYAN);
        } else if (oggy.turboTimer > 0) {
          o.active = false;
          addScore(25);
          projectWorld(o.wx, o.wy, 8, _pItem);
          spawnFx(_pItem.x, _pItem.y, C_FLAME, 8);
          spawnPopup(_pItem.x, _pItem.y, "SMASH +25", C_GOLD);
        } else if (oggy.invuln <= 0) {
          o.hit = true;
          o.active = false;
          lives--;
          oggy.invuln = 1.6;
          projectWorld(oggy.wx, oggy.wy, 8, _pItem);
          spawnFx(_pItem.x, _pItem.y, C_OGGY_NOSE, 10);
          spawnPopup(_pItem.x, _pItem.y, "OUCH!", C_OGGY_NOSE);
          if (lives <= 0) {
            gameState = STATE_GAME_OVER;
            return;
          }
        }
      }
    }
  }

  sortObsPool();
}

/* ---------------------------------------------------------
   7. 2D / 3D CARTOON RENDERING
   --------------------------------------------------------- */
function drawTrack(now) {
  var zone = (stage - 1) % 3;
  var skyC  = (zone === 0) ? C_SKY_DAY : ((zone === 1) ? C_SKY_DUSK : C_SKY_NIGHT);
  var outA  = (zone === 0) ? C_GRASS_A : ((zone === 1) ? C_GRASS_B  : C_ROOF_TRIM);
  var outB  = (zone === 0) ? C_GRASS_B : ((zone === 1) ? C_GRASS_A  : C_ROOF_TRIM);
  var rdA   = (zone === 0) ? C_DIRT_A  : ((zone === 1) ? C_ROAD_A   : C_ROOF_A);
  var rdB   = (zone === 0) ? C_DIRT_B  : ((zone === 1) ? C_ROAD_B   : C_ROOF_B);

  var top2D = HUD_H + 6;
  var top3D = HUD_H + 30;
  var horizonY = lerp(top2D, top3D, camTilt) | 0;

  // Sky / Horizon backdrop in 3D mode
  if (camTilt > 0.04) {
    gFillRect(0, HUD_H, SCREEN_W, Math.max(0, horizonY - HUD_H), skyC);
  }
  gFillRect(0, horizonY, SCREEN_W, SCREEN_H - horizonY, outA);

  // Scrolling ground strips (6 bands from wy=0 to 1)
  var bands = 6;
  var phase = (scrollDist * 3.0) % 1.0;
  var b, y0, y1, bandIdx, colOut, colRd, colCurb;

  for (b = -1; b < bands; b++) {
    y0 = clamp((b + phase) / bands, 0, 1);
    y1 = clamp((b + 1 + phase) / bands, 0, 1);
    if (y1 <= y0) continue;

    bandIdx = Math.floor(scrollDist * 3.0) - b;
    colOut  = (bandIdx & 1) ? outA : outB;
    colRd   = (bandIdx & 1) ? rdA : rdB;
    colCurb = (bandIdx & 1) ? C_CURB_A : C_CURB_B;

    // Outer shoulder stripe
    projectWorld(-2.4, y0, 0, _pA);
    projectWorld( 2.4, y0, 0, _pB);
    projectWorld( 2.4, y1, 0, _pC);
    projectWorld(-2.4, y1, 0, _pD);
    fillQuad(_pA.x, _pA.y, _pB.x, _pB.y, _pC.x, _pC.y, _pD.x, _pD.y, colOut);

    // Road / Track surface
    projectWorld(-0.96, y0, 0, _pA);
    projectWorld( 0.96, y0, 0, _pB);
    projectWorld( 0.96, y1, 0, _pC);
    projectWorld(-0.96, y1, 0, _pD);
    fillQuad(_pA.x, _pA.y, _pB.x, _pB.y, _pC.x, _pC.y, _pD.x, _pD.y, colRd);

    // Left & right alternating curbs
    projectWorld(-1.05, y0, 0, _pA);
    projectWorld(-0.96, y0, 0, _pB);
    projectWorld(-0.96, y1, 0, _pC);
    projectWorld(-1.05, y1, 0, _pD);
    fillQuad(_pA.x, _pA.y, _pB.x, _pB.y, _pC.x, _pC.y, _pD.x, _pD.y, colCurb);

    projectWorld(0.96, y0, 0, _pA);
    projectWorld(1.05, y0, 0, _pB);
    projectWorld(1.05, y1, 0, _pC);
    projectWorld(0.96, y1, 0, _pD);
    fillQuad(_pA.x, _pA.y, _pB.x, _pB.y, _pC.x, _pC.y, _pD.x, _pD.y, colCurb);

    // Center dashed line
    if ((bandIdx & 1) === 0) {
      projectWorld(-0.03, y0, 0, _pA);
      projectWorld( 0.03, y0, 0, _pB);
      projectWorld( 0.03, y1, 0, _pC);
      projectWorld(-0.03, y1, 0, _pD);
      fillQuad(_pA.x, _pA.y, _pB.x, _pB.y, _pC.x, _pC.y, _pD.x, _pD.y, C_WHITE);
    }
  }
}

function drawBox3D(wx, wy, halfW, heightPx, topC, frontC, trimC) {
  projectWorld(wx, wy, 0, _pItem);
  var s = _pItem.scale;
  var hw = Math.max(3, Math.round(halfW * s));
  var gx = _pItem.x | 0;
  var gy = _pItem.groundY | 0;

  // Ground shadow
  fillEllipse(gx + 2, gy + 1, hw * 1.1, Math.max(2, hw * 0.45), C_SHADOW);

  if (camTilt < 0.08) {
    // 2D top-down crate
    gFillRect(gx - hw, gy - hw, hw * 2, hw * 2, topC);
    gDrawRect(gx - hw, gy - hw, hw * 2, hw * 2, frontC);
    gDrawLine(gx - hw, gy, gx + hw, gy, trimC);
    return;
  }

  // 3D front face + sloped top face
  var h3d = Math.max(4, Math.round(heightPx * s * camTilt));
  var topDepth = Math.max(3, Math.round(hw * 0.55));
  var hwBack = Math.max(2, Math.round(hw * 0.84));

  gFillRect(gx - hw, gy - h3d, hw * 2, h3d, frontC);
  fillQuad(
    gx - hwBack, gy - h3d - topDepth,
    gx + hwBack, gy - h3d - topDepth,
    gx + hw, gy - h3d,
    gx - hw, gy - h3d,
    topC
  );
  gFillRect(gx - hw, gy - (h3d >> 1), hw * 2, Math.max(2, (h3d * 0.24) | 0), trimC);
}

function drawObstacle(o, now) {
  if (o.type === 0) {
    // Tall silver Trash Can
    drawBox3D(o.wx, o.wy, 11, 18, C_CAN_TOP, C_CAN_SIDE, C_CAN_DARK);
  } else if (o.type === 2) {
    // Red TNT Crate
    drawBox3D(o.wx, o.wy, 10, 14, C_TNT_TOP, C_TNT_FRONT, C_TNT_BAND);
  } else if (o.type === 1) {
    // Flat Banana Peel
    projectWorld(o.wx, o.wy, 0, _pItem);
    var r = Math.max(3, Math.round(9 * _pItem.scale));
    fillEllipse(_pItem.x, _pItem.groundY + 1, r, Math.max(2, (r * 0.45) | 0), C_SHADOW);
    fillTri(_pItem.x - r, _pItem.y + 2, _pItem.x + r, _pItem.y + 2, _pItem.x, _pItem.y - r * 0.8, C_BANANA);
    gDrawPixel(_pItem.x, _pItem.y - r * 0.8, C_BANANA_DK);
  } else if (o.type === 3) {
    // Floating Golden Fish Snack
    var bob = 6 + FM.sin(now * 0.008 + o.wx * 3) * 3;
    projectWorld(o.wx, o.wy, bob, _pItem);
    var fr = Math.max(3, Math.round(7 * _pItem.scale));
    fillEllipse(_pItem.x, _pItem.groundY + 1, fr, Math.max(2, (fr * 0.4) | 0), C_SHADOW);
    gFillCircle(_pItem.x, _pItem.y, fr, C_FISH_GOLD);
    fillTri(_pItem.x - fr, _pItem.y, _pItem.x - fr - 4, _pItem.y - 4, _pItem.x - fr - 4, _pItem.y + 4, C_FISH_GOLD);
    gDrawPixel(_pItem.x + (fr >> 1), _pItem.y - 1, C_BLACK);
  } else {
    // Milk / Heart Heal
    var hbob = 6 + FM.sin(now * 0.008) * 3;
    projectWorld(o.wx, o.wy, hbob, _pItem);
    var hr = Math.max(3, Math.round(7 * _pItem.scale));
    fillEllipse(_pItem.x, _pItem.groundY + 1, hr, Math.max(2, (hr * 0.4) | 0), C_SHADOW);
    gFillRoundRect(_pItem.x - hr + 1, _pItem.y - hr, hr * 2 - 2, hr * 2, 2, C_MILK);
    gFillCircle(_pItem.x, _pItem.y, Math.max(2, hr >> 1), C_HEART);
  }
}

function drawRoachWagon(now) {
  projectWorld(wagon.wx, wagon.wy, 0, _pItem);
  var s = _pItem.scale;
  var gx = _pItem.x | 0;
  var gy = _pItem.groundY | 0;
  var w = Math.max(12, Math.round(24 * s));
  var h = Math.max(5, Math.round(9 * s));

  fillEllipse(gx, gy + 2, w * 1.1, Math.max(2, h * 0.5), C_SHADOW);

  // Rocket flames behind wagon
  var fl = Math.max(3, Math.round((6 + FM.sin(now * 0.03) * 3) * s));
  fillTri(gx - 5, gy - 2, gx + 5, gy - 2, gx, gy - fl - 4, C_FLAME);

  var bodyC = (wagon.hitFlash > 0 && (((now / 70) | 0) & 1)) ? C_WHITE : C_WAGON_RED;
  gFillRoundRect(gx - w, gy - h - 2, w * 2, h + 2, 3, bodyC);
  gDrawRoundRect(gx - w, gy - h - 2, w * 2, h + 2, 3, C_WAGON_GOLD);

  // Wheels
  gFillCircle(gx - w + 4, gy, Math.max(2, (4 * s) | 0), C_BLACK);
  gFillCircle(gx + w - 4, gy, Math.max(2, (4 * s) | 0), C_BLACK);

  // Roaches riding on wagon (remaining out of 3: Marky, Dee Dee, Joey)
  var rColors = [C_JOEY, C_DEEDEE, C_MARKY];
  var rOffsets = [0, -10, 10];
  var i, rx, ry, rr = Math.max(2, Math.round(4 * s));
  for (i = 0; i < roachesLeftInWagon; i++) {
    rx = gx + rOffsets[i] * s;
    ry = gy - h - 4 - Math.abs(FM.sin(now * 0.015 + i)) * 2;
    gFillCircle(rx, ry, rr, rColors[i]);
    gDrawLine(rx - 2, ry - rr, rx - 4, ry - rr - 4, C_BLACK);
    gDrawLine(rx + 2, ry - rr, rx + 4, ry - rr - 4, C_BLACK);
  }
}

function drawOggyRunner(now) {
  if (oggy.invuln > 0 && (((now / 85) | 0) & 1) === 1) return;

  projectWorld(oggy.wx, oggy.wy, oggy.wz, _pItem);
  var s = _pItem.scale;
  var cx = _pItem.x | 0;
  var cy = _pItem.y | 0;
  var gy = _pItem.groundY | 0;
  var r = Math.max(6, Math.round(12 * s));

  // Ground shadow shrinks as Oggy jumps higher
  var shScale = clamp(1.0 - oggy.wz * 0.015, 0.4, 1.0);
  fillEllipse(cx, gy + 2, r * 1.05 * shScale, Math.max(2, r * 0.45 * shScale), C_SHADOW);

  // Turbo flames behind Oggy
  if (oggy.turboTimer > 0) {
    fillTri(cx - r * 0.7, cy + r * 0.6, cx + r * 0.7, cy + r * 0.6, cx, cy + r + 10 + FM.sin(now * 0.04) * 4, C_FLAME);
  }

  // Tall pointy ears
  fillTri(cx - r * 0.85, cy - r * 0.3, cx - r * 0.25, cy - r * 0.8, cx - r * 0.75, cy - r * 1.65, C_OGGY_DARK);
  fillTri(cx + r * 0.85, cy - r * 0.3, cx + r * 0.25, cy - r * 0.8, cx + r * 0.75, cy - r * 1.65, C_OGGY_DARK);

  // Body / Head
  var bodyC = (oggy.turboTimer > 0 && (((now / 70) | 0) & 1)) ? C_WAGON_GOLD : C_OGGY_BLUE;
  gFillCircle(cx, cy - r * 0.35, r, bodyC);
  gFillCircle(cx, cy - r * 0.05, Math.max(3, (r * 0.52) | 0), C_WHITE);

  // In 3D mode we look from behind Oggy (show ears, blue back, white tail & paws);
  // In 2D mode show Oggy's iconic eyes & red nose!
  if (camTilt < 0.5) {
    gFillCircle(cx - r * 0.35, cy - r * 0.55, Math.max(2, (r * 0.24) | 0), C_WHITE);
    gFillCircle(cx + r * 0.35, cy - r * 0.55, Math.max(2, (r * 0.24) | 0), C_WHITE);
    gFillCircle(cx - r * 0.35, cy - r * 0.55, 1, C_OGGY_EYE);
    gFillCircle(cx + r * 0.35, cy - r * 0.55, 1, C_OGGY_EYE);
    gFillCircle(cx, cy - r * 0.25, Math.max(2, (r * 0.28) | 0), C_OGGY_NOSE);
  } else {
    // 3D rear paws running animation + red nose peeking on turns
    var stride = FM.sin(now * 0.022) * 3 * s;
    gFillCircle(cx - r * 0.45, cy + r * 0.45 + stride, Math.max(2, (r * 0.26) | 0), C_WHITE);
    gFillCircle(cx + r * 0.45, cy + r * 0.45 - stride, Math.max(2, (r * 0.26) | 0), C_WHITE);
    gFillCircle(cx, cy + r * 0.4, Math.max(1, (r * 0.18) | 0), C_OGGY_DARK);
  }
}

function drawHoldIndicator(now) {
  if (!isHolding || holdTriggered) return;
  var elapsed = now - holdStartTime;
  if (elapsed < 300) return;
  var progress = Math.min(1, elapsed / HOLD_DURATION);
  var rad = 16;
  var segs = 12, i, a0, a1;
  var active = Math.floor(segs * progress);
  for (i = 0; i < segs; i++) {
    a0 = -1.5708 + (i * 6.2832) / segs;
    a1 = a0 + 6.2832 / segs;
    gDrawLine(holdX + rad * FM.cos(a0), holdY + rad * FM.sin(a0), holdX + rad * FM.cos(a1), holdY + rad * FM.sin(a1), i < active ? C_GOLD : C_RING_BG);
  }
}

function drawHUD(now) {
  gFillRect(0, 0, SCREEN_W, HUD_H, C_HUD_BG);
  gDrawLine(0, HUD_H - 1, SCREEN_W, HUD_H - 1, C_HUD_BDR);

  gFillRoundRect(4, 3, 18, 16, 4, C_HUD_BDR);
  gDrawText("X", 10, 7, C_WHITE, C_HUD_BDR, 1);

  gFillRoundRect(25, 3, 24, 16, 4, C_HUD_BDR);
  gDrawText(is3DMode ? "3D" : "2D", 31, 7, C_GOLD, C_HUD_BDR, 1);

  gFillRoundRect(52, 3, 16, 16, 4, showTouchDebug ? C_OGGY_NOSE : C_HUD_BDR);
  gDrawText("?", 57, 7, C_WHITE, showTouchDebug ? C_OGGY_NOSE : C_HUD_BDR, 1);

  // Hearts
  var i;
  for (i = 0; i < 3; i++) {
    gFillCircle(78 + i * 11, 10, 4, i < lives ? C_HEART : C_HUD_BDR);
  }

  // Nitro bar
  var nbX = 114;
  var nbW = 46;
  gDrawRect(nbX, 6, nbW, 9, C_WHITE);
  var fillW = Math.round(((nbW - 2) * nitro) / 100);
  if (fillW > 0) gFillRect(nbX + 1, 7, fillW, 7, nitro >= 100 ? C_GOLD : C_CYAN);

  var scTxt = "S:" + score + " B:" + bestScore;
  gDrawText(scTxt, SCREEN_W - scTxt.length * 6 - 5, 7, C_WHITE, C_HUD_BG, 1);

  if (modeToastText && now < modeToastUntil) {
    gFillRoundRect(25, HUD_H + 4, 56, 16, 6, C_HUD_BG);
    gDrawText(modeToastText, 32, HUD_H + 8, C_GOLD, C_HUD_BG, 1);
  }

  // Bottom Touch Action Buttons during play
  if (gameState === STATE_PLAY) {
    gFillRoundRect(6, SCREEN_H - 26, 46, 20, 6, C_HUD_BG);
    gDrawRoundRect(6, SCREEN_H - 26, 46, 20, 6, C_CYAN);
    gDrawText("JUMP", 17, SCREEN_H - 20, C_WHITE, C_HUD_BG, 1);

    var tbCol = (nitro >= 100) ? C_GOLD : C_HUD_BG;
    gFillRoundRect(SCREEN_W - 56, SCREEN_H - 26, 50, 20, 6, tbCol);
    gDrawRoundRect(SCREEN_W - 56, SCREEN_H - 26, 50, 20, 6, C_WHITE);
    gDrawText("TURBO", SCREEN_W - 46, SCREEN_H - 20, nitro >= 100 ? C_BLACK : C_HUD_BDR, tbCol, 1);
  }
}

var lastRawTouch = { down: false, x: 0, y: 0 };

function drawScene(now) {
  beginFrame(C_GRASS_A);
  drawTrack(now);
  drawRoachWagon(now);

  // Back-to-front draw order with Oggy inserted at oggy.wy
  var i, o, oggyDrawn = false;
  for (i = 0; i < MAX_OBS; i++) {
    o = obsPool[i];
    if (!o.active) continue;
    if (!oggyDrawn && o.wy > oggy.wy) {
      drawOggyRunner(now);
      oggyDrawn = true;
    }
    drawObstacle(o, now);
  }
  if (!oggyDrawn) drawOggyRunner(now);

  var pt, pp;
  for (i = 0; i < MAX_FX; i++) {
    pt = fxPool[i];
    if (pt.active) gFillCircle(pt.x, pt.y, Math.max(1, (pt.life * 2.5) | 0), pt.color);
  }
  for (i = 0; i < popups.length; i++) {
    pp = popups[i];
    if (pp.active) gDrawText(pp.txt, pp.x, pp.y, pp.color, -1, 1);
  }

  drawHUD(now);
  drawHoldIndicator(now);

  if (gameState === STATE_TITLE) {
    var tw = Math.min(SCREEN_W - 20, 234);
    var tx = (SCREEN_W - tw) >> 1;
    var ty = (SCREEN_H - 96) >> 1;
    gFillRoundRect(tx, ty, tw, 96, 10, C_HUD_BG);
    gDrawRoundRect(tx, ty, tw, 96, 10, C_GOLD);
    gDrawText("OGGY: ROCKET CHASE", tx + ((tw - 144) >> 1), ty + 10, C_GOLD, C_HUD_BG, 2);
    gDrawText("Steer & Jump! Grab Fish for TURBO", tx + ((tw - 204) >> 1), ty + 34, C_WHITE, C_HUD_BG, 1);
    gDrawText("Press 0 / Hold / Tap 2D-3D Anytime", tx + ((tw - 204) >> 1), ty + 48, C_CYAN, C_HUD_BG, 1);
    gDrawText("Tap or Press 5 to Start", tx + ((tw - 138) >> 1), ty + 64, C_BANANA, C_HUD_BG, 1);
    gDrawText(touchModeLabel, tx + 10, ty + 80, C_CAN_TOP, C_HUD_BG, 1);
  } else if (gameState === STATE_STAGE_CLEAR) {
    var cw = 180;
    var cx = (SCREEN_W - cw) >> 1;
    var cy = (SCREEN_H - 42) >> 1;
    gFillRoundRect(cx, cy, cw, 42, 8, C_HUD_BG);
    gDrawRoundRect(cx, cy, cw, 42, 8, C_GOLD);
    gDrawText("STAGE " + stage + " CLEAR!", cx + 30, cy + 14, C_GOLD, C_HUD_BG, 2);
  } else if (isPaused && gameState === STATE_PLAY) {
    var pw = 110;
    var pxx = (SCREEN_W - pw) >> 1;
    var pyy = (SCREEN_H - 34) >> 1;
    gFillRoundRect(pxx, pyy, pw, 34, 8, C_HUD_BG);
    gDrawRoundRect(pxx, pyy, pw, 34, 8, C_WHITE);
    gDrawText("PAUSED", pxx + 30, pyy + 10, C_WHITE, C_HUD_BG, 2);
  } else if (gameState === STATE_GAME_OVER) {
    var gw = Math.min(SCREEN_W - 24, 208);
    var gx2 = (SCREEN_W - gw) >> 1;
    var gy2 = (SCREEN_H - 68) >> 1;
    gFillRoundRect(gx2, gy2, gw, 68, 10, C_HUD_BG);
    gDrawRoundRect(gx2, gy2, gw, 68, 10, C_OGGY_NOSE);
    gDrawText("CRASHED! SCORE: " + score, gx2 + ((gw - 126) >> 1), gy2 + 14, C_WHITE, C_HUD_BG, 1);
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
   8. INPUT HANDLING (2D/3D Toggle + Jump/Turbo/Steer)
   --------------------------------------------------------- */
var touchWasDown = false;
var lastTouchDownTime = 0;
var touchStartX = 0, touchStartY = 0;
var keyHoldTimer = 0;

var isHolding = false;
var holdTriggered = false;
var holdStartTime = 0;
var holdX = 0, holdY = 0;
var HOLD_DURATION = 1200;

function handleInput(now, dt) {
  if (keyHoldTimer > 0) {
    keyHoldTimer -= dt;
    if (keyHoldTimer <= 0) steerInput = 0;
  }

  if (isHolding && !holdTriggered && (now - holdStartTime >= HOLD_DURATION)) {
    holdTriggered = true;
    isHolding = false;
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
      touchStartX = tx;
      touchStartY = ty;
      isHolding = true;
      holdTriggered = false;
      holdStartTime = now;
      holdX = tx;
      holdY = ty;

      if (ty <= HUD_H + 4) {
        isHolding = false;
        if (tx <= 23) { shouldExit = true; return; }
        if (tx <= 50) { toggle2D3D(now); return; }
        if (tx <= 69) { showTouchDebug = !showTouchDebug; return; }
        if (gameState === STATE_PLAY) { isPaused = !isPaused; return; }
      }

      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) {
        isHolding = false;
        startNewGame();
        return;
      }
      if (isPaused) {
        isHolding = false;
        isPaused = false;
        return;
      }

      if (gameState === STATE_PLAY && ty >= SCREEN_H - 30) {
        isHolding = false;
        if (tx <= 58) { triggerJump(); return; }
        if (tx >= SCREEN_W - 60) { triggerTurbo(); return; }
      }
    }

    if (isHolding && (Math.abs(tx - holdX) > 10 || Math.abs(ty - holdY) > 10)) {
      isHolding = false;
    }

    if (gameState === STATE_PLAY && !isPaused && ty > HUD_H + 4 && ty < SCREEN_H - 30) {
      // Swipe up triggers jump
      if (touchStartY - ty >= 22) {
        triggerJump();
        touchStartY = ty;
      }
      // Map screen X smoothly to world X (-0.82 .. +0.82)
      tapSteerX = clamp(((tx / SCREEN_W) - 0.5) * 2.1, -0.82, 0.82);
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    touchWasDown = false;
    isHolding = false;
  }

  // Trackball
  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (tb.dx !== 0) {
      tapSteerX = null;
      steerInput = (tb.dx > 0) ? 1 : -1;
      keyHoldTimer = 0.14;
    }
    if (tb.dy < 0) triggerJump();
    if (tb.click) {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) isPaused = false;
      else if (nitro >= 100) triggerTurbo();
      else triggerJump();
    }
  }

  // Keyboard / T9
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
      if (gameState === STATE_PLAY) isPaused = !isPaused;
      return;
    }
    if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") {
      tapSteerX = null;
      steerInput = -1;
      keyHoldTimer = 0.16;
    } else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") {
      tapSteerX = null;
      steerInput = 1;
      keyHoldTimer = 0.16;
    } else if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") {
      triggerJump();
    } else if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (gameState === STATE_TITLE || gameState === STATE_GAME_OVER) startNewGame();
      else if (isPaused) isPaused = false;
      else if (nitro >= 100) triggerTurbo();
      else triggerJump();
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
  setupStage(1);

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