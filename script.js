/* ========================= 
   DATA STORAGE
========================= */
let prices = JSON.parse(localStorage.getItem('prices')) || [];
const MAX_CANDLES = 500;

// ---- 5 MIN CANDLES ----
let candles5m = JSON.parse(localStorage.getItem('candles5m')) || [];
let current5m = JSON.parse(localStorage.getItem('current5m')) || null;
const FIVE_MIN = 5 * 60 * 1000;

// ---- 1 MIN CANDLES ----
let candles1m = JSON.parse(localStorage.getItem('candles1m')) || [];
let current1m = JSON.parse(localStorage.getItem('current1m')) || null;
const ONE_MIN = 60 * 1000;

/* =========================
   STATE
========================= */
let trend = null;
let ma200Value = null;
let currentStatus = 'waiting';
let shortScalpSignal = 'Neutral';
let lastPrice = null;
let entryPrice = null;

/* =========================
   SOUND SYSTEM
========================= */
const tradeSound = document.getElementById('tradeSound');
const muteBtn = document.getElementById('muteBtn');

let soundEnabled = true;

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    muteBtn.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
  });
}

function playTradeSound() {
  if (!soundEnabled) return;
  if (!tradeSound) return;

  tradeSound.currentTime = 0;
  tradeSound.play().catch(() => {});
}

/* =========================
   UI ELEMENTS
========================= */
const priceLine = document.getElementById('priceLine');
const biasLine = document.getElementById('biasLine');
const overallStatusEl = document.getElementById('overallStatus');
const pullbackStatusEl = document.getElementById('pullbackStatus');
const statusEl = document.getElementById('status');

const rsiEl = document.getElementById('rsiValue');
const macdEl = document.getElementById('macdValue');
const bbUpperEl = document.getElementById('bbUpper');
const bbLowerEl = document.getElementById('bbLower');
const rsiFill = document.getElementById('rsiFill'); // ✅ horizontal bar

/* =========================
   HELPERS
========================= */
function format(n) {
  return '$' + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function SMA(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function EMA(values, period) {
  const k = 2 / (period + 1);
  let emaArray = [];
  values.forEach((v, i) => {
    if (i === 0) emaArray.push(v);
    else emaArray.push(v * k + emaArray[i - 1] * (1 - k));
  });
  return emaArray;
}

function DEMA(values, period = 9) {
  if (values.length < period * 2) return null;
  const ema1 = EMA(values, period);
  const ema2 = EMA(ema1, period);
  return 2 * ema1[ema1.length - 1] - ema2[ema2.length - 1];
}

function TEMA(values, period = 9) {
  if (values.length < period * 3) return null;
  const ema1 = EMA(values, period);
  const ema2 = EMA(ema1, period);
  const ema3 = EMA(ema2, period);
  return 3 * ema1[ema1.length - 1]
       - 3 * ema2[ema2.length - 1]
       + ema3[ema3.length - 1];
}

/* =========================
   INDICATORS
========================= */
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(closes) {
  if (closes.length < 26) return null;

  const ema12 = EMA(closes, 12);
  const ema26 = EMA(closes, 26);

  const macdArray = [];
  for (let i = 0; i < ema12.length; i++) {
    if (ema26[i] !== undefined) {
      macdArray.push(ema12[i] - ema26[i]);
    }
  }

  const signal = EMA(macdArray, 9);
  const histogram =
    macdArray[macdArray.length - 1] -
    signal[signal.length - 1];

  return histogram;
}

function calculateBollinger(closes, period = 20) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: mean + (2 * stdDev),
    lower: mean - (2 * stdDev)
  };
}

function updateIndicators() {
  if (candles1m.length < 30) return;

  const closes = candles1m.map(c => c.close);

  const rsi = calculateRSI(closes);
  const macd = calculateMACD(closes);
  const bb = calculateBollinger(closes);

  // ===== RSI =====
  if (rsiEl && rsi !== null) {
    rsiEl.textContent = rsi.toFixed(2);

    rsiEl.style.color =
      rsi < 30 ? '#00ff66' :
      rsi > 70 ? '#ff4d4d' : 'white';

    // ✅ Horizontal progress bar
    if (rsiFill) {
      rsiFill.style.width = rsi + "%"; // left-to-right fill
      rsiFill.style.height = "100%"; // full bar height

      if (rsi < 30) rsiFill.style.background = '#00ff66';
      else if (rsi > 70) rsiFill.style.background = '#ff4d4d';
      else rsiFill.style.background = 'yellow';
    }
  }

  // ===== MACD =====
  if (macdEl && macd !== null) {
    macdEl.textContent = macd.toFixed(2);
    macdEl.style.color = macd >= 0 ? '#00ff66' : '#ff4d4d';
  }

  // ===== Bollinger =====
  if (bb && bbUpperEl && bbLowerEl) {
    bbUpperEl.textContent = format(bb.upper);
    bbLowerEl.textContent = format(bb.lower);
  }
}

/* =========================
   MARKET DATA (BTC)
========================= */
async function fetchBTC() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const data = await res.json();
    return parseFloat(data.price);
  } catch (err) {
    console.error('BTC fetch error:', err);
    return null;
  }
}

/* =========================
   BUILD CANDLES
========================= */
function update5mCandle(price) {
  const now = Date.now();
  if (!current5m) {
    current5m = { start: now, open: price, high: price, low: price, close: price };
    return;
  }

  if (now - current5m.start < FIVE_MIN) {
    current5m.high = Math.max(current5m.high, price);
    current5m.low = Math.min(current5m.low, price);
    current5m.close = price;
  } else {
    candles5m.push(current5m);
    if (candles5m.length > MAX_CANDLES) candles5m.shift();
    current5m = { start: now, open: price, high: price, low: price, close: price };
  }
}

function update1mCandle(price) {
  const now = Date.now();
  if (!current1m) {
    current1m = { start: now, open: price, high: price, low: price, close: price };
    return;
  }

  if (now - current1m.start < ONE_MIN) {
    current1m.high = Math.max(current1m.high, price);
    current1m.low = Math.min(current1m.low, price);
    current1m.close = price;
  } else {
    candles1m.push(current1m);
    if (candles1m.length > MAX_CANDLES) candles1m.shift();
    current1m = { start: now, open: price, high: price, low: price, close: price };
  }
}

/* =========================
   ANALYSIS + TREND + SCALP + STATUS
========================= */
function analyze5m() {
  if (candles5m.length < 200) {
    overallStatusEl.textContent = 'Overall Status: Waiting...';
    overallStatusEl.style.color = 'yellow';
    ma200Value = null;
    return;
  }

  const closes = candles5m.map(c => c.close);
  ma200Value = SMA(closes, 200);

  const bias = closes[closes.length - 1] < ma200Value ? 'Bearish' : 'Bullish';

  overallStatusEl.textContent =
    `Overall Status: ${bias} MA200 ${format(ma200Value)}`;

  overallStatusEl.style.color =
    bias === 'Bullish' ? '#00ff66' : '#ff4d4d';
}

function updateTrend(price) {
  if (!ma200Value) return;

  trend = price >= ma200Value ? 'up' : 'down';
  biasLine.textContent =
    trend === 'up' ? 'BTC/USDT - BUY' : 'BTC/USDT - Paused';

  if (lastPrice !== null) {
    if (price > lastPrice) priceLine.style.color = '#00ff66';
    else if (price < lastPrice) priceLine.style.color = '#ff4d4d';
    else priceLine.style.color = 'yellow';
  }

  lastPrice = price;
}

function updateShortScalp(livePrice) {
  if (candles1m.length < 30) return;

  const closes = candles1m.map(c => c.close);
  const tema = TEMA(closes, 9);
  const dema = DEMA(closes, 9);

  if (!tema || !dema) return;

  if (tema > dema) {
    if (shortScalpSignal !== 'BUY') {
      entryPrice = livePrice;
      playTradeSound();
    }
    shortScalpSignal = 'BUY';
    pullbackStatusEl.style.color = '#00ff66';
  } else if (tema < dema) {
    if (shortScalpSignal !== 'SELL') {
      entryPrice = livePrice;
      playTradeSound();
    }
    shortScalpSignal = 'SELL';
    pullbackStatusEl.style.color = '#ff4d4d';
  } else {
    shortScalpSignal = 'Neutral';
    entryPrice = null;
    pullbackStatusEl.style.color = 'yellow';
  }

  pullbackStatusEl.textContent = shortScalpSignal;
  if (entryPrice && shortScalpSignal !== 'Neutral') {
    pullbackStatusEl.textContent += ` | Entry: ${format(entryPrice)}`;
  }
}

function updateOverallStatus() {
  currentStatus = 'waiting';

  if (
    (trend === 'up' && shortScalpSignal === 'BUY') ||
    (trend === 'down' && shortScalpSignal === 'SELL')
  ) {
    currentStatus = 'active';
  }

  statusEl.textContent = currentStatus.toUpperCase();
  statusEl.className = `status status-${currentStatus}`;
}

/* =========================
   MAIN LOOP
========================= */
async function updateMarket() {
  const price = await fetchBTC();
  if (!price) return;

  priceLine.textContent = `BTC Price: ${format(price)}`;

  update5mCandle(price);
  update1mCandle(price);
  analyze5m();
  updateTrend(price);
  updateShortScalp(price);
  updateIndicators();
  updateOverallStatus();
}

updateMarket();
setInterval(updateMarket, 5000);