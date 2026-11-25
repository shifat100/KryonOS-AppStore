/* =========================================================
   OrbSnake (2D / 3D) for KryonOS (Duktape ES5.1)
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
  if (!res) return false;
  if (typeof res !== "object") return false;

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

  // Also register callback listener if exposed
  var cbAttached = false;
  for (i = 0; i < candidates.length; i++) {
    if (tryBindTouchCallback(candidates[i].obj, candidates[i].name)) {
      cbAttached = true;
      break;
    }
  }

  // Scan property names for diagnostics if needed
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
      if (_touchReaderFn(_touchState)) {
        return _touchState;
      }
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
   2. COLOR & DOUBLE-BUFFER GRAPHICS HELPERS (RGB565)
   --------------------------------------------------------- */
function rgb565(r, g, b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerp565(r1, g1, b1, r2, g2, b2, t) {
  var r = (r1 + (r2 - r1) * t) | 0;
  var g = (g1 + (g2 - g1) * t) | 0;
  var b = (b1 + (b2 - b1) * t) | 0;
  return rgb565(r, g, b);
}

var C_WHITE      = rgb565(255, 255, 255);
var C_PILL_BG    = rgb565(250, 250, 250);
var C_PILL_BDR   = rgb565(230, 231, 235);
var C_TEXT_MUTED = rgb565(130, 131, 138);
var C_TEXT_DARK  = rgb565(17, 24, 39);
var C_BLACK      = rgb565(17, 17, 17);

var C_BLUE       = rgb565(41, 98, 255);
var C_BLUE_DARK  = rgb565(13, 41, 133);
var C_BLUE_LIGHT = rgb565(81, 130, 255);
var C_BLUE_SPEC  = rgb565(148, 184, 255);

var C_DEAD       = rgb565(165, 165, 170);
var C_DEAD_LIGHT = rgb565(225, 225, 232);
var C_DEAD_DARK  = rgb565(110, 110, 118);

var C_DOT_2D     = rgb565(233, 233, 233);
var C_DOT_3D     = rgb565(222, 228, 242);

var C_BOARD_TOP  = rgb565(249, 251, 255);
var C_BOARD_BDR  = rgb565(198, 212, 242);
var C_BOARD_FRONT= rgb565(212, 223, 246);
var C_BOARD_SIDE = rgb565(202, 215, 242);
var C_BOARD_SHD  = rgb565(232, 237, 247);

var C_SHD_ORB    = rgb565(216, 221, 233);
var C_SHD_FOOD   = rgb565(212, 224, 252);
var C_FOOD_RING  = rgb565(190, 210, 252);
var C_RING_BG    = rgb565(220, 230, 255);

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
  if (renderMode === "k3d") {
    Kryon3D.clear(bgColor);
  } else {
    G.fillScreen(bgColor);
  }
}

function endFrame() {
  if (renderMode === "k3d") {
    Kryon3D.render(0, 0);
  } else if (renderMode === "sprite" && typeof G.pushSprite === "function") {
    G.pushSprite(0, 0);
  }
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

function gDrawRoundRect(x, y, w, h, r, c) {
  if (typeof G.drawRoundRect === "function") {
    G.drawRoundRect(x | 0, y | 0, w | 0, h | 0, r | 0, c);
  } else if (typeof G.drawRect === "function") {
    G.drawRect(x | 0, y | 0, w | 0, h | 0, c);
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
  if (r <= 0) {
    gDrawPixel(x, y, c);
    return;
  }
  G.fillCircle(x | 0, y | 0, r, c);
}

function gDrawText(txt, x, y, fg, bg, font) {
  if (typeof G.setTextColor === "function") {
    if (typeof bg === "number") G.setTextColor(fg, bg);
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

  var minY = y0, maxY = y0;
  var i;
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
      yA = _qy[i];
      yB = _qy[j];
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

function drawEllipseOutline(cx, cy, rx, ry, color) {
  var steps = 16;
  var step = 6.2831853 / steps;
  var prevX = cx + rx;
  var prevY = cy;
  var i, a, nx, ny;
  for (i = 1; i <= steps; i++) {
    a = i * step;
    nx = cx + rx * FM.cos(a);
    ny = cy + ry * FM.sin(a);
    gDrawLine(prevX, prevY, nx, ny, color);
    prevX = nx;
    prevY = ny;
  }
}

function drawPill(x, y, w, h, bg, bdr, text, fg, font) {
  var r = (h >> 1);
  gFillRoundRect(x, y, w, h, r, bg);
  if (bdr >= 0) gDrawRoundRect(x, y, w, h, r, bdr);
  if (text) {
    var charW = (font === 2) ? 8 : 6;
    var charH = (font === 2) ? 14 : 8;
    var tx = x + Math.max(4, ((w - text.length * charW) >> 1));
    var ty = y + ((h - charH) >> 1);
    gDrawText(text, tx, ty, fg, bg, font || 1);
  }
}

/* ---------------------------------------------------------
   3. PERSISTENT BEST SCORE
   --------------------------------------------------------- */
var BEST_FILE = "best.txt";
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
    if (typeof FS !== "undefined") {
      FS.writeTextFile(BEST_FILE, String(bestScore));
    }
  } catch (e) {}
}

/* ---------------------------------------------------------
   4. LOADING SCREEN
   --------------------------------------------------------- */
var lCols = 0, lRows = 0, lSpacing = 18;
var lOffsetX = 0, lOffsetY = 0;
var loadTime = 0;
var loadProgress = 0;
var isLoadingDone = false;

var EXP_LUT_SIZE = 64;
var expLut = [];
var loadColorRamp = [];

function initLoadingTables() {
  var i, t;
  for (i = 0; i <= EXP_LUT_SIZE; i++) {
    expLut[i] = Math.exp(-(i * 0.0625));
  }
  for (i = 0; i < 16; i++) {
    t = i / 15;
    loadColorRamp[i] = lerp565(216, 224, 242, 45, 88, 185, t);
  }
}

function setupLoadingGrid() {
  var minDim = Math.min(SCREEN_W, SCREEN_H);
  lSpacing = Math.max(10, Math.min(20, Math.floor(minDim / 13)));
  lCols = Math.max(10, Math.floor(SCREEN_W / lSpacing) + 1);
  lRows = Math.max(10, Math.floor(SCREEN_H / lSpacing) + 1);
  lOffsetX = (SCREEN_W - (lCols - 1) * lSpacing) / 2;
  lOffsetY = (SCREEN_H - (lRows - 1) * lSpacing) / 2;
}

function drawLoadingFrame() {
  beginFrame(C_WHITE);

  var period = 0.52;
  var phase = (loadTime * 0.36) % period;
  var invCols = lCols > 1 ? 1 / (lCols - 1) : 1;
  var invRows = lRows > 1 ? 1 / (lRows - 1) : 1;
  var baseRadius = Math.max(1, lSpacing * 0.065);
  var maxRadius = Math.max(2, lSpacing * 0.16);

  var r, c, k, x, y, nx, ny, intensity, center, waveX, waveY, dx, dy, distNorm, lutIdx, wVal, rad, cIdx;
  for (r = 0; r < lRows; r++) {
    ny = lRows > 1 ? r * invRows : 0.5;
    y = lOffsetY + r * lSpacing;
    for (c = 0; c < lCols; c++) {
      nx = lCols > 1 ? c * invCols : 0.5;
      x = lOffsetX + c * lSpacing;

      intensity = 0;
      for (k = -1; k <= 3; k++) {
        center = phase + k * period;
        waveX = center + ((k & 1) === 0 ? -0.04 : 0.03);
        waveY = center + ((k & 1) === 0 ? 0.03 : -0.03);
        dx = nx - waveX;
        dy = ny - waveY;
        distNorm = (dx * dx + dy * dy) / 0.026;
        if (distNorm < 4.0) {
          lutIdx = (distNorm * 16) | 0;
          if (lutIdx > EXP_LUT_SIZE) lutIdx = EXP_LUT_SIZE;
          wVal = expLut[lutIdx];
          if (wVal > intensity) intensity = wVal;
        }
      }

      rad = Math.round(lerp(baseRadius, maxRadius, intensity));
      cIdx = Math.min(15, (intensity * 15) | 0);
      if (rad <= 1) gDrawPixel(x, y, loadColorRamp[cIdx]);
      else gFillCircle(x, y, rad, loadColorRamp[cIdx]);
    }
  }

  gDrawText(touchModeLabel, 8, SCREEN_H - 18, C_TEXT_MUTED, C_WHITE, 1);
  var pctStr = String(Math.floor(loadProgress)) + "%";
  drawPill(SCREEN_W - 68, SCREEN_H - 34, 56, 24, C_PILL_BG, C_PILL_BDR, pctStr, C_TEXT_MUTED, 1);

  endFrame();

  loadTime += 0.022;
  if (loadProgress < 100) {
    loadProgress = Math.min(100, loadProgress + 0.9);
  } else {
    isLoadingDone = true;
    resetGame();
  }
}

/* ---------------------------------------------------------
   5. GAME STATE & POOLS
   --------------------------------------------------------- */
var gridCols = 16, gridRows = 12, cellSize = 18;
var gOffsetX = 0, gOffsetY = 0;

var snake = [];
var prevSnake = [];
var food = { x: 0, y: 0 };
var dir = { x: 0, y: 1 };
var dirQueue = [];

var score = 0;
var isGameOver = false;
var isPaused = false;
var pauseProgress = 0;
var hasMoved = false;
var ateFoodLastTick = false;
var shouldExit = false;
var showTouchDebug = false;

var is3DMode = false;
var camTilt = 0;
var camYaw = 0;
var camPitchDrift = 0;
var camPanX = 0;
var camPanY = 0;
var fitScale3D = 0.78;
var maxYaw3D = 0.14;
var toastText = "";
var toastUntil = 0;

var isHolding = false;
var holdTriggered = false;
var holdStartTime = 0;
var holdX = 0, holdY = 0;
var HOLD_DURATION = 1500;
var touchWasDown = false;
var lastTouchDownTime = 0;
var touchStartX = 0, touchStartY = 0;
var lastRawTouch = { down: false, x: 0, y: 0 };

var lastTick = 0;
var tickInterval = 155;

var MAX_PARTICLES = 10;
var particles = [];
(function initPools() {
  var i;
  for (i = 0; i < MAX_PARTICLES; i++) {
    particles.push({ active: false, gx: 0, gy: 0, lz: 0, vx: 0, vy: 0, vz: 0, r: 0, life: 0 });
  }
})();

var drawItems = [];
var drawCount = 0;

function pushDrawItem(gx, gy, lz, radius, isHead, isFood, wrapped, depth) {
  if (drawCount >= drawItems.length) {
    drawItems.push({ gx: 0, gy: 0, lz: 0, radius: 0, isHead: false, isFood: false, wrapped: false, depth: 0 });
  }
  var it = drawItems[drawCount++];
  it.gx = gx;
  it.gy = gy;
  it.lz = lz;
  it.radius = radius;
  it.isHead = isHead;
  it.isFood = isFood;
  it.wrapped = wrapped;
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

function copySnakeToPrev() {
  var i;
  while (prevSnake.length < snake.length) prevSnake.push({ x: 0, y: 0 });
  while (prevSnake.length > snake.length) prevSnake.pop();
  for (i = 0; i < snake.length; i++) {
    prevSnake[i].x = snake[i].x;
    prevSnake[i].y = snake[i].y;
  }
}

function isSnakeAt(x, y, limit) {
  var i;
  for (i = 0; i < limit; i++) {
    if (snake[i].x === x && snake[i].y === y) return true;
  }
  return false;
}

function randInt(max) {
  if (typeof FastMath !== "undefined" && typeof FastMath.randomRange === "function") {
    return FastMath.randomRange(0, max - 1) | 0;
  }
  return Math.floor(FM.random() * max);
}

/* ---------------------------------------------------------
   6. GRID & GAMEPLAY LOGIC
   --------------------------------------------------------- */
function setupGameGrid() {
  var minDim = Math.min(SCREEN_W, SCREEN_H);
  var targetCell = Math.max(14, Math.min(26, Math.floor(minDim / 12)));
  var baseCols = Math.max(10, Math.round(SCREEN_W / targetCell));

  var bestCols = baseCols;
  var bestScoreFit = 999999;
  var c, cs, r, remY, diff;

  for (c = Math.max(10, baseCols - 1); c <= baseCols + 2; c++) {
    cs = SCREEN_W / c;
    r = Math.floor(SCREEN_H / cs);
    if (r < 10) continue;
    remY = SCREEN_H - (r - 1) * cs;
    diff = Math.abs(remY - cs);
    if (diff < bestScoreFit) {
      bestScoreFit = diff;
      bestCols = c;
    }
  }

  gridCols = bestCols;
  cellSize = SCREEN_W / gridCols;
  gridRows = Math.max(10, Math.floor(SCREEN_H / cellSize));

  gOffsetX = (SCREEN_W - (gridCols - 1) * cellSize) / 2;
  gOffsetY = (SCREEN_H - (gridRows - 1) * cellSize) / 2;

  var aspect = gridCols / gridRows;
  maxYaw3D = aspect < 0.85 ? 0.13 : 0.19;
  var rotHalfW = (gridCols * 0.5) * FM.cos(maxYaw3D) + (gridRows * 0.5) * FM.sin(maxYaw3D);
  fitScale3D = Math.min(0.82, (gridCols * 0.43) / Math.max(1, rotHalfW));
}

function spawnFood() {
  var count = 0;
  var fx = -1, fy = -1;
  var x, y;
  for (x = 0; x < gridCols; x++) {
    for (y = 0; y < gridRows; y++) {
      if (!isSnakeAt(x, y, snake.length)) {
        count++;
        if (randInt(count) === 0) {
          fx = x; fy = y;
        }
      }
    }
  }
  if (fx < 0) {
    triggerGameOver();
    return;
  }
  food.x = fx;
  food.y = fy;
}

function spawnEatParticles(fx, fy) {
  var p, angle, speed, pt;
  for (p = 0; p < MAX_PARTICLES; p++) {
    pt = particles[p];
    angle = (6.2831853 * p) / MAX_PARTICLES + FM.random() * 0.45;
    speed = 0.045 + FM.random() * 0.065;
    pt.active = true;
    pt.gx = fx;
    pt.gy = fy;
    pt.lz = cellSize * 0.38;
    pt.vx = FM.cos(angle) * speed;
    pt.vy = FM.sin(angle) * speed;
    pt.vz = cellSize * (0.08 + FM.random() * 0.09);
    pt.r = Math.max(1.5, cellSize * (0.08 + FM.random() * 0.05));
    pt.life = 1.0;
  }
}

function resetGame() {
  setupGameGrid();

  var startX = Math.floor(gridCols / 3);
  var startY = Math.floor(gridRows / 3);

  snake = [
    { x: startX, y: startY },
    { x: startX, y: startY - 1 },
    { x: startX, y: startY - 2 },
    { x: startX, y: startY - 3 }
  ];
  copySnakeToPrev();

  var i;
  for (i = 0; i < MAX_PARTICLES; i++) particles[i].active = false;

  dir.x = 0; dir.y = 1;
  dirQueue.length = 0;
  score = 0;
  isGameOver = false;
  isPaused = false;
  pauseProgress = 0;
  ateFoodLastTick = false;
  tickInterval = 155;

  spawnFood();
  lastTick = nowMs();
}

function toggle3DMode(now) {
  is3DMode = !is3DMode;
  toastText = is3DMode ? "3D Mode" : "2D Mode";
  toastUntil = now + 1600;
}

function togglePause(now) {
  if (isGameOver || !isLoadingDone) return;
  isPaused = !isPaused;
  if (isPaused) {
    pauseProgress = Math.min(1, Math.max(0, (now - lastTick) / tickInterval));
  } else {
    lastTick = now - pauseProgress * tickInterval;
  }
}

function queueDirection(nx, ny) {
  if (isGameOver || isPaused) return;
  if (!hasMoved) hasMoved = true;

  var lastDir = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : dir;
  if (lastDir.x + nx === 0 && lastDir.y + ny === 0) return;
  if (lastDir.x === nx && lastDir.y === ny) return;

  if (dirQueue.length < 2) {
    dirQueue.push({ x: nx, y: ny });
  }
}

function triggerGameOver() {
  isGameOver = true;
  isPaused = false;
}

function stepSnake() {
  if (dirQueue.length > 0) {
    var nextD = dirQueue.shift();
    dir.x = nextD.x;
    dir.y = nextD.y;
  }

  copySnakeToPrev();

  var nx = snake[0].x + dir.x;
  var ny = snake[0].y + dir.y;

  if (nx < 0) nx = gridCols - 1;
  else if (nx >= gridCols) nx = 0;

  if (ny < 0) ny = gridRows - 1;
  else if (ny >= gridRows) ny = 0;

  var willEat = (nx === food.x && ny === food.y);
  var checkLimit = willEat ? snake.length : snake.length - 1;

  if (isSnakeAt(nx, ny, checkLimit)) {
    triggerGameOver();
    return;
  }

  snake.unshift({ x: nx, y: ny });

  if (willEat) {
    ateFoodLastTick = true;
    spawnEatParticles(food.x, food.y);
    score += 1;
    if (score > bestScore) {
      bestScore = score;
      saveBestScore();
    }
    tickInterval = Math.max(92, 155 - score * 2.2);
    spawnFood();
  } else {
    ateFoodLastTick = false;
    snake.pop();
  }
}

/* ---------------------------------------------------------
   7. 3D PROJECTION & SCENE RENDERER
   --------------------------------------------------------- */
var _pOut = { x: 0, y: 0, scale: 1, depth: 0 };

function project3D(gx, gy, lzPx, out) {
  var cx = (gridCols - 1) * 0.5;
  var cy = (gridRows - 1) * 0.5;
  var lx = (gx - cx) * cellSize;
  var ly = (gy - cy) * cellSize;

  var centerX = gOffsetX + cx * cellSize;
  var centerY = gOffsetY + cy * cellSize;

  if (camTilt <= 0.001) {
    out.x = centerX + lx;
    out.y = centerY + ly;
    out.scale = 1;
    out.depth = ly + lzPx;
    return out;
  }

  var yawRad = camYaw * camTilt;
  var cosY = FM.cos(yawRad);
  var sinY = FM.sin(yawRad);

  var rx = lx * cosY - ly * sinY;
  var ry = lx * sinY + ly * cosY;

  var tiltRad = camTilt * (0.78539816 + camPitchDrift);
  var cosT = FM.cos(tiltRad);
  var sinT = FM.sin(tiltRad);

  var camY = ry * cosT - lzPx * sinT;
  var camZOffset = ry * sinT + lzPx * cosT;

  var boardSpan = Math.max(gridCols * cellSize, gridRows * cellSize);
  var camDist = boardSpan * 1.85;

  var perspScale = camDist / Math.max(70, camDist - camZOffset);
  var scale = lerp(1, perspScale, camTilt);
  var fitScale = lerp(1, fitScale3D, camTilt);
  var yShift = lerp(0, cellSize * 0.2, camTilt);

  out.x = centerX + (rx * scale * fitScale) + camPanX * camTilt;
  out.y = centerY + (camY * scale * fitScale) + yShift + camPanY * camTilt;
  out.scale = scale * fitScale;
  out.depth = camZOffset;
  return out;
}

var _t1 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t2 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t3 = { x: 0, y: 0, scale: 1, depth: 0 };
var _t4 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b1 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b2 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b3 = { x: 0, y: 0, scale: 1, depth: 0 };
var _b4 = { x: 0, y: 0, scale: 1, depth: 0 };

function draw3DBoardBase() {
  if (camTilt <= 0.01) return;

  var m = 0.62;
  var maxX = gridCols - 1 + m;
  var maxY = gridRows - 1 + m;
  var thick = cellSize * 0.42 * camTilt;

  project3D(-m, -m, 0, _t1);
  project3D(maxX, -m, 0, _t2);
  project3D(maxX, maxY, 0, _t3);
  project3D(-m, maxY, 0, _t4);

  project3D(-m, -m, -thick, _b1);
  project3D(maxX, -m, -thick, _b2);
  project3D(maxX, maxY, -thick, _b3);
  project3D(-m, maxY, -thick, _b4);

  var shDrop = cellSize * 0.36 * camTilt;
  fillQuad(_b1.x, _b1.y + shDrop, _b2.x, _b2.y + shDrop, _b3.x + 3 * camTilt, _b3.y + shDrop, _b4.x - 3 * camTilt, _b4.y + shDrop, C_BOARD_SHD);

  if (camYaw * camTilt > 0.002) {
    fillQuad(_t1.x, _t1.y, _t4.x, _t4.y, _b4.x, _b4.y, _b1.x, _b1.y, C_BOARD_SIDE);
  } else if (camYaw * camTilt < -0.002) {
    fillQuad(_t2.x, _t2.y, _t3.x, _t3.y, _b3.x, _b3.y, _b2.x, _b2.y, C_BOARD_SIDE);
  }

  fillQuad(_t4.x, _t4.y, _t3.x, _t3.y, _b3.x, _b3.y, _b4.x, _b4.y, C_BOARD_FRONT);
  fillQuad(_t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, _t4.x, _t4.y, C_BOARD_TOP);
  strokeQuad(_t1.x, _t1.y, _t2.x, _t2.y, _t3.x, _t3.y, _t4.x, _t4.y, C_BOARD_BDR);
}

function drawFloorShadow(gx, gy, baseRadius, isFood) {
  if (camTilt <= 0.02) return;
  if (gx < -0.5 || gx > gridCols - 0.5 || gy < -0.5 || gy > gridRows - 0.5) return;
  project3D(gx, gy, 0, _pOut);
  var r = baseRadius * _pOut.scale;
  var ry = r * lerp(1, 0.56, camTilt);
  fillEllipse(_pOut.x + r * 0.1 * camTilt, _pOut.y + r * 0.1 * camTilt, r * 0.92, ry * 0.92, isFood ? C_SHD_FOOD : C_SHD_ORB);
}

function drawFoodTargetRing(gx, gy, baseRadius, now) {
  if (camTilt <= 0.12) return;
  project3D(gx, gy, 0, _pOut);
  var pulse = 0.95 + 0.22 * FM.sin(now * 0.0055);
  var r = baseRadius * _pOut.scale * pulse * 1.15;
  var ry = r * lerp(1, 0.56, camTilt);
  drawEllipseOutline(_pOut.x, _pOut.y, r, ry, C_FOOD_RING);
}

var _e1 = { x: 0, y: 0, scale: 1, depth: 0 };
var _e2 = { x: 0, y: 0, scale: 1, depth: 0 };

function drawEyes3D(gx, gy, baseRadius, isDead) {
  var rGrid = baseRadius / cellSize;
  var perpX = -dir.y;
  var perpY = dir.x;

  var eyeFwd = rGrid * 0.25;
  var eyeSep = rGrid * 0.36;
  var eyeZ = baseRadius * 0.55;

  if (camTilt > 0.05) {
    if (dir.y > 0) {
      eyeFwd = rGrid * lerp(0.25, 0.46, camTilt);
      eyeZ = baseRadius * lerp(0.55, 0.22, camTilt);
    } else if (dir.y < 0) {
      eyeFwd = rGrid * lerp(0.25, 0.18, camTilt);
      eyeZ = baseRadius * lerp(0.55, 0.88, camTilt);
    } else {
      eyeFwd = rGrid * lerp(0.25, 0.36, camTilt);
      eyeZ = baseRadius * lerp(0.55, 0.58, camTilt);
    }
  }

  project3D(gx + dir.x * eyeFwd + perpX * eyeSep, gy + dir.y * eyeFwd + perpY * eyeSep, eyeZ, _e1);
  project3D(gx + dir.x * eyeFwd - perpX * eyeSep, gy + dir.y * eyeFwd - perpY * eyeSep, eyeZ, _e2);

  if (!isDead) {
    var eyeR = Math.max(1, Math.round(baseRadius * 0.15 * _e1.scale));
    gFillCircle(_e1.x, _e1.y, eyeR, C_WHITE);
    gFillCircle(_e2.x, _e2.y, eyeR, C_WHITE);
  } else {
    var s = Math.max(2, Math.round(baseRadius * 0.2 * _e1.scale));
    gDrawLine(_e1.x - s, _e1.y - s, _e1.x + s, _e1.y + s, C_BLACK);
    gDrawLine(_e1.x + s, _e1.y - s, _e1.x - s, _e1.y + s, C_BLACK);
    gDrawLine(_e2.x - s, _e2.y - s, _e2.x + s, _e2.y + s, C_BLACK);
    gDrawLine(_e2.x + s, _e2.y - s, _e2.x - s, _e2.y + s, C_BLACK);
  }
}

function drawSphereOrCircle(gx, gy, lz, baseRadius, isHead, isDead) {
  project3D(gx, gy, lz, _pOut);
  var px = _pOut.x;
  var py = _pOut.y;
  var r = Math.max(1, Math.round(baseRadius * _pOut.scale));

  if (camTilt <= 0.03) {
    gFillCircle(px, py, r, isDead ? C_DEAD : C_BLUE);
  } else if (!isDead) {
    gFillCircle(px, py, r, C_BLUE_DARK);
    gFillCircle(px - r * 0.08, py - r * 0.08, Math.max(1, r * 0.85), C_BLUE);
    gFillCircle(px - r * 0.2, py - r * 0.22, Math.max(1, r * 0.52), C_BLUE_LIGHT);
    if (camTilt > 0.25 && r >= 4) {
      gFillCircle(px - r * 0.34, py - r * 0.34, Math.max(1, r * 0.22), C_BLUE_SPEC);
    }
  } else {
    gFillCircle(px, py, r, C_DEAD_DARK);
    gFillCircle(px - r * 0.08, py - r * 0.08, Math.max(1, r * 0.85), C_DEAD);
    gFillCircle(px - r * 0.22, py - r * 0.24, Math.max(1, r * 0.45), C_DEAD_LIGHT);
  }

  if (isHead) {
    drawEyes3D(gx, gy, baseRadius, isDead);
  }
}

function drawHoldIndicator(now) {
  if (!isHolding || holdTriggered) return;
  var elapsed = now - holdStartTime;
  if (elapsed < 350) return;

  var progress = Math.min(1, elapsed / HOLD_DURATION);
  var r = Math.max(14, Math.min(22, Math.floor(SCREEN_W * 0.06)));
  var segs = 14;
  var step = 6.2831853 / segs;
  var activeSegs = Math.floor(segs * progress);
  var i, a0, a1;

  for (i = 0; i < segs; i++) {
    a0 = -1.5707963 + i * step;
    a1 = a0 + step;
    gDrawLine(
      holdX + r * FM.cos(a0),
      holdY + r * FM.sin(a0),
      holdX + r * FM.cos(a1),
      holdY + r * FM.sin(a1),
      i < activeSegs ? C_BLUE : C_RING_BG
    );
  }
}

function drawHUD(now) {
  drawPill(6, 6, 22, 18, C_PILL_BG, C_PILL_BDR, "X", C_TEXT_MUTED, 1);
  drawPill(32, 6, 34, 18, C_PILL_BG, C_PILL_BDR, is3DMode ? "3D" : "2D", C_BLUE, 1);
  drawPill(70, 6, 20, 18, showTouchDebug ? C_BLUE : C_PILL_BG, C_PILL_BDR, "?", showTouchDebug ? C_WHITE : C_TEXT_MUTED, 1);

  if (toastText && now < toastUntil) {
    drawPill(6, 28, 60, 18, C_PILL_BG, C_PILL_BDR, toastText, C_BLUE, 1);
  }

  var scoreTxt = "S:" + score + " B:" + bestScore;
  var scoreW = Math.max(76, scoreTxt.length * 6 + 14);
  drawPill(SCREEN_W - scoreW - 6, 6, scoreW, 18, C_PILL_BG, C_PILL_BDR, scoreTxt, C_TEXT_DARK, 1);

  if (showTouchDebug) {
    gFillRect(6, 28, SCREEN_W - 12, 30, C_PILL_BG);
    gDrawRoundRect(6, 28, SCREEN_W - 12, 30, 4, C_PILL_BDR);
    gDrawText(SCREEN_W + "x" + SCREEN_H + " " + renderMode + " " + touchModeLabel, 10, 32, C_TEXT_DARK, C_PILL_BG, 1);
    var rawTxt = "D:" + (lastRawTouch.down ? 1 : 0) + " X:" + lastRawTouch.x + " Y:" + lastRawTouch.y + (touchDiscoveredKeys ? (" " + touchDiscoveredKeys) : "");
    gDrawText(rawTxt.slice(0, 46), 10, 44, C_BLUE, C_PILL_BG, 1);
  }

  if (!hasMoved && !isGameOver) {
    var hintW = Math.min(SCREEN_W - 20, 148);
    drawPill((SCREEN_W - hintW) >> 1, SCREEN_H - 24, hintW, 18, C_PILL_BG, C_PILL_BDR, "Hold or 0 for 3D", C_TEXT_MUTED, 1);
  }

  if (isPaused && !isGameOver) {
    drawPill((SCREEN_W - 86) >> 1, (SCREEN_H - 26) >> 1, 86, 26, C_PILL_BG, C_PILL_BDR, "Paused", C_TEXT_DARK, 2);
  }

  if (isGameOver) {
    var goW = Math.min(SCREEN_W - 16, 198);
    var goX = (SCREEN_W - goW) >> 1;
    var goY = SCREEN_H - 34;
    gFillRoundRect(goX, goY, goW, 26, 13, C_PILL_BG);
    gDrawRoundRect(goX, goY, goW, 26, 13, C_PILL_BDR);
    gDrawText("Over:" + score, goX + 10, goY + 9, C_TEXT_DARK, C_PILL_BG, 1);
    drawPill(goX + goW - 76, goY + 3, 72, 20, C_BLUE, -1, "Play Again", C_WHITE, 1);
  }
}

function drawGameFrame(now) {
  beginFrame(C_WHITE);

  if (isHolding && !holdTriggered && (now - holdStartTime >= HOLD_DURATION)) {
    holdTriggered = true;
    isHolding = false;
    toggle3DMode(now);
  }

  var targetTilt = is3DMode ? 1 : 0;
  camTilt += (targetTilt - camTilt) * 0.14;
  if (Math.abs(targetTilt - camTilt) < 0.004) camTilt = targetTilt;

  var t = 1;
  if (isPaused) {
    t = pauseProgress;
  } else if (!isGameOver) {
    var elapsed = now - lastTick;
    if (elapsed < 0) elapsed = 0;
    if (elapsed >= tickInterval) {
      lastTick = now - (elapsed % tickInterval);
      stepSnake();
    }
    t = isGameOver ? 0 : Math.min(1, Math.max(0, (now - lastTick) / tickInterval));
  }

  var headCurr = snake.length > 0 ? snake[0] : { x: gridCols * 0.5, y: gridRows * 0.5 };
  var headPrev = prevSnake.length > 0 ? prevSnake[0] : headCurr;
  var hx = (!isGameOver && Math.abs(headCurr.x - headPrev.x) <= 1) ? lerp(headPrev.x, headCurr.x, t) : headCurr.x;
  var hy = (!isGameOver && Math.abs(headCurr.y - headPrev.y) <= 1) ? lerp(headPrev.y, headCurr.y, t) : headCurr.y;

  var normHeadX = (hx / Math.max(1, gridCols - 1)) - 0.5;
  var normHeadY = (hy / Math.max(1, gridRows - 1)) - 0.5;

  var idleYaw = FM.sin(now * 0.00075) * (maxYaw3D * 0.35);
  var steerYaw = -normHeadX * (maxYaw3D * 0.65) - dir.x * (maxYaw3D * 0.28);
  var targetYaw = is3DMode ? Math.max(-maxYaw3D, Math.min(maxYaw3D, idleYaw + steerYaw)) : 0;

  var idlePitch = FM.sin(now * 0.001) * 0.035;
  var steerPitch = normHeadY * 0.09 + dir.y * 0.04;
  var targetPitchDrift = is3DMode ? idlePitch + steerPitch : 0;

  var targetPanX = is3DMode ? (-normHeadX * cellSize * 0.75 - dir.x * cellSize * 0.3) : 0;
  var targetPanY = is3DMode ? (-normHeadY * cellSize * 0.55 - dir.y * cellSize * 0.25) : 0;

  camYaw += (targetYaw - camYaw) * 0.08;
  camPitchDrift += (targetPitchDrift - camPitchDrift) * 0.08;
  camPanX += (targetPanX - camPanX) * 0.08;
  camPanY += (targetPanY - camPanY) * 0.08;

  draw3DBoardBase();

  var dotColor = camTilt > 0.2 ? C_DOT_3D : C_DOT_2D;
  var baseDotR = Math.round(cellSize * 0.055);
  var r, c, dotR;
  for (r = 0; r < gridRows; r++) {
    for (c = 0; c < gridCols; c++) {
      project3D(c, r, 0, _pOut);
      dotR = Math.round(baseDotR * _pOut.scale);
      if (dotR <= 1) gDrawPixel(_pOut.x, _pOut.y, dotColor);
      else gFillCircle(_pOut.x, _pOut.y, dotR, dotColor);
    }
  }

  var foodBaseR = cellSize * 0.36;
  drawFoodTargetRing(food.x, food.y, foodBaseR, now);

  drawCount = 0;
  var foodFloat = camTilt * (FM.sin(now * 0.0045) * cellSize * 0.11 + cellSize * 0.16);
  var foodLz = foodBaseR * camTilt + foodFloat;
  pushDrawItem(food.x, food.y, foodLz, foodBaseR, false, true, false, project3D(food.x, food.y, foodLz, _pOut).depth);

  var totalSegs = snake.length;
  var i, curr, prev, ratio, radius, segLz, dx, dy, wrappedX, wrappedY, gx, gy, stepX, stepY, outX, outY, inX, inY;
  for (i = totalSegs - 1; i >= 0; i--) {
    curr = snake[i];
    prev = prevSnake[Math.min(i, prevSnake.length - 1)] || curr;
    ratio = totalSegs > 1 ? i / (totalSegs - 1) : 0;
    radius = (i === 0) ? cellSize * 0.44 : lerp(cellSize * 0.36, cellSize * 0.23, ratio);
    segLz = radius * camTilt;

    if (isGameOver) {
      pushDrawItem(curr.x, curr.y, segLz, radius, i === 0, false, false, project3D(curr.x, curr.y, segLz, _pOut).depth);
      continue;
    }

    dx = curr.x - prev.x;
    dy = curr.y - prev.y;
    wrappedX = Math.abs(dx) > 1;
    wrappedY = Math.abs(dy) > 1;

    if (!wrappedX && !wrappedY) {
      gx = lerp(prev.x, curr.x, t);
      gy = lerp(prev.y, curr.y, t);
      pushDrawItem(gx, gy, segLz, radius, i === 0, false, false, project3D(gx, gy, segLz, _pOut).depth);
    } else {
      stepX = wrappedX ? (dx < 0 ? 1 : -1) : dx;
      stepY = wrappedY ? (dy < 0 ? 1 : -1) : dy;

      outX = prev.x + stepX * t;
      outY = prev.y + stepY * t;
      if (outX >= -0.4 && outX <= gridCols - 0.6 && outY >= -0.4 && outY <= gridRows - 0.6) {
        pushDrawItem(outX, outY, segLz, radius, i === 0, false, true, project3D(outX, outY, segLz, _pOut).depth);
      }

      inX = curr.x - stepX * (1 - t);
      inY = curr.y - stepY * (1 - t);
      if (inX >= -0.4 && inX <= gridCols - 0.6 && inY >= -0.4 && inY <= gridRows - 0.6) {
        pushDrawItem(inX, inY, segLz, radius, i === 0, false, true, project3D(inX, inY, segLz, _pOut).depth);
      }
    }
  }

  if (!isGameOver && !ateFoodLastTick && prevSnake.length > 0) {
    var vacated = prevSnake[prevSnake.length - 1];
    var fadeR = cellSize * 0.2 * (1 - t);
    if (fadeR > 0.7) {
      var fadeLz = fadeR * camTilt;
      pushDrawItem(vacated.x, vacated.y, fadeLz, fadeR, false, false, false, project3D(vacated.x, vacated.y, fadeLz, _pOut).depth);
    }
  }

  if (camTilt > 0.02) {
    for (i = 0; i < drawCount; i++) {
      drawFloorShadow(drawItems[i].gx, drawItems[i].gy, drawItems[i].radius, drawItems[i].isFood);
    }
  }

  sortDrawItems(drawCount);
  for (i = 0; i < drawCount; i++) {
    var item = drawItems[i];
    drawSphereOrCircle(item.gx, item.gy, item.lz, item.radius, item.isHead, isGameOver);
  }

  var pt, pr;
  for (i = 0; i < MAX_PARTICLES; i++) {
    pt = particles[i];
    if (!pt.active) continue;
    if (!isPaused) {
      pt.gx += pt.vx;
      pt.gy += pt.vy;
      pt.vz -= cellSize * 0.008;
      pt.lz += pt.vz;
      if (pt.lz < pt.r) {
        pt.lz = pt.r;
        pt.vz = -pt.vz * 0.45;
      }
      pt.life -= 0.032;
    }
    if (pt.life <= 0) {
      pt.active = false;
      continue;
    }
    project3D(pt.gx, pt.gy, pt.lz * camTilt, _pOut);
    pr = Math.round(pt.r * _pOut.scale * pt.life);
    if (pr <= 1) gDrawPixel(_pOut.x, _pOut.y, C_BLUE);
    else gFillCircle(_pOut.x, _pOut.y, pr, C_BLUE);
  }

  drawHUD(now);
  drawHoldIndicator(now);
  endFrame();
}

/* ---------------------------------------------------------
   8. INPUT HANDLING
   --------------------------------------------------------- */
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

      if (!isLoadingDone) {
        isLoadingDone = true;
        resetGame();
        return;
      }

      if (tx <= 29 && ty <= 26) {
        shouldExit = true;
        return;
      }
      if (tx > 29 && tx <= 68 && ty <= 26) {
        toggle3DMode(now);
        return;
      }
      if (tx > 68 && tx <= 92 && ty <= 26) {
        showTouchDebug = !showTouchDebug;
        return;
      }
      if (isGameOver && ty >= SCREEN_H - 40) {
        resetGame();
        return;
      }

      touchStartX = tx;
      touchStartY = ty;
      isHolding = true;
      holdTriggered = false;
      holdStartTime = now;
      holdX = tx;
      holdY = ty;
    } else if (isLoadingDone) {
      if (isHolding && FM.hypot(tx - holdX, ty - holdY) > 12) {
        isHolding = false;
      }
      var dx = tx - touchStartX;
      var dy = ty - touchStartY;
      var threshold = 16;
      if (Math.abs(dx) > threshold || Math.abs(dy) > threshold) {
        if (Math.abs(dx) > Math.abs(dy)) {
          queueDirection(dx > 0 ? 1 : -1, 0);
        } else {
          queueDirection(0, dy > 0 ? 1 : -1);
        }
        touchStartX = tx;
        touchStartY = ty;
      }
    }
  } else if (touchWasDown && (now - lastTouchDownTime > 45)) {
    touchWasDown = false;
    isHolding = false;
  }

  var tb = halReadTrackball();
  if (tb.dx !== 0 || tb.dy !== 0 || tb.click) {
    if (!isLoadingDone) {
      isLoadingDone = true;
      resetGame();
      return;
    }
    if (Math.abs(tb.dx) > Math.abs(tb.dy)) {
      queueDirection(tb.dx > 0 ? 1 : -1, 0);
    } else if (tb.dy !== 0) {
      queueDirection(0, tb.dy > 0 ? 1 : -1);
    }
    if (tb.click) {
      if (isGameOver) resetGame();
      else togglePause(now);
    }
  }

  var key = halReadKey();
  if (key) {
    if (key === "q" || key === "Q" || key === "Escape" || key === "ESC") {
      shouldExit = true;
      return;
    }
    if (key === "i" || key === "I") {
      showTouchDebug = !showTouchDebug;
      return;
    }
    if (key === "0" || key === "m" || key === "M") {
      toggle3DMode(now);
      return;
    }
    if (!isLoadingDone) {
      if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === "*" || key === " ") {
        isLoadingDone = true;
        resetGame();
      }
      return;
    }
    if (key === "2" || key === "w" || key === "W" || key === "UP" || key === "ArrowUp") {
      queueDirection(0, -1);
    } else if (key === "8" || key === "s" || key === "S" || key === "DOWN" || key === "ArrowDown") {
      queueDirection(0, 1);
    } else if (key === "4" || key === "a" || key === "A" || key === "LEFT" || key === "ArrowLeft") {
      queueDirection(-1, 0);
    } else if (key === "6" || key === "d" || key === "D" || key === "RIGHT" || key === "ArrowRight") {
      queueDirection(1, 0);
    } else if (key === "5" || key === "Enter" || key === "\n" || key === "\r" || key === " " || key === "*") {
      if (isGameOver) resetGame();
      else togglePause(now);
    } else if (key === "#" || key === "r" || key === "R") {
      resetGame();
    }
  }
}

/* ---------------------------------------------------------
   9. MAIN ENTRY POINT
   --------------------------------------------------------- */
function main() {
  discoverHAL();
  loadBestScore();
  initLoadingTables();
  setupLoadingGrid();
  initDoubleBuffer();

  var now;
  while (!shouldExit) {
    now = nowMs();
    handleInput(now);
    if (shouldExit) break;

    if (!isLoadingDone) {
      drawLoadingFrame();
    } else {
      drawGameFrame(now);
    }

    System.delay(16);
  }

  releaseDoubleBuffer();
}

main();
