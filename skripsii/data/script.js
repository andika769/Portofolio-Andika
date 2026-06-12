// ================= CONFIG =================
const cols = 32;
const rows = 24;
let latestFrame = null;
let needsUpdate = false;

// ================= ALARM =================
let audioCtx = null;
let alarmTimeout = null;
let lastAlarmState = null;
let isAlarmMuted = false;

function getThermalColor(t) {
    const colors = [
        { r: 0,   g: 0,   b: 255 },
        { r: 0,   g: 255, b: 255 },
        { r: 255, g: 255, b: 255 },
        { r: 255, g: 165, b: 0   },
        { r: 255, g: 0,   b: 0   }
    ];

    const idx = t * (colors.length - 1);
    const i = Math.floor(idx);
    const f = idx - i;

    if (i >= colors.length - 1) return colors[colors.length - 1];

    return {
        r: colors[i].r + f * (colors[i + 1].r - colors[i].r),
        g: colors[i].g + f * (colors[i + 1].g - colors[i].g),
        b: colors[i].b + f * (colors[i + 1].b - colors[i].b)
    };
}

// ================= CANVAS =================
const displayCanvas = document.getElementById("thermalCanvas");
const displayCtx = displayCanvas.getContext("2d");
displayCanvas.width = 640;
displayCanvas.height = 480;

const rawCanvas = document.createElement("canvas");
rawCanvas.width = cols;
rawCanvas.height = rows;
const rawCtx = rawCanvas.getContext("2d");
let imageData = rawCtx.createImageData(cols, rows);

// ================= UI =================
const minTempEl = document.getElementById("minTemp");
const maxTempEl = document.getElementById("maxTemp");
const centerTempEl = document.getElementById("centerTemp");
const legendMinEl = document.getElementById("legendMin");
const legendMaxEl = document.getElementById("legendMax");
const tempStatusEl = document.getElementById("tempStatus");
const statusCardEl = document.getElementById("statusCard");
const muteAlarmBtn = document.getElementById("muteAlarmBtn");
const saveImageBtn = document.getElementById("saveImageBtn");

// ================= HELPER =================
function getCenterRow() {
    return 12;
}

function getCenterCol() {
    return 16;
}

function getCenterIndex() {
    return getCenterRow() * cols + getCenterCol();
}

function getCenterAvg3x3(data) {
    const centerRow = getCenterRow();
    const centerCol = getCenterCol();

    let sum = 0;
    let count = 0;

    for (let r = centerRow - 1; r <= centerRow + 1; r++) {
        for (let c = centerCol - 1; c <= centerCol + 1; c++) {
            if (r >= 0 && r < rows && c >= 0 && c < cols) {
                sum += data[r * cols + c];
                count++;
            }
        }
    }

    return count > 0 ? sum / count : data[getCenterIndex()];
}

function classifyTemperature(temp) {
    if (temp <= 35) {
        return {
            label: "Hipotermia",
            className: "hypothermia",
            alarm: true
        };
    }

    if (temp >= 36 && temp <= 37) {
        return {
            label: "Normal",
            className: "normal",
            alarm: false
        };
    }

    if (temp >= 38) {
        return {
            label: "Demam",
            className: "fever",
            alarm: true
        };
    }

    return {
        label: "Perlu Observasi",
        className: "warning",
        alarm: false
    };
}

function updateStatus(temp) {
    const result = classifyTemperature(temp);

    // Hanya tampilkan status, tanpa suhu
    tempStatusEl.innerText = result.label;
    statusCardEl.className = `status-card ${result.className}`;

    if (result.alarm && !isAlarmMuted) {
        triggerAlarm(result.className);
    } else {
        stopAlarm();
        lastAlarmState = null;
    }
}

function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === "suspended") {
        audioCtx.resume();
    }
}

function beep(duration = 250, frequency = 880) {
    ensureAudioContext();

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.15;

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();

    setTimeout(() => {
        oscillator.stop();
    }, duration);
}

function triggerAlarm(state) {
    if (isAlarmMuted) return;
    if (lastAlarmState === state && alarmTimeout) return;

    stopAlarm();
    lastAlarmState = state;

    const freq = state === "hypothermia" ? 500 : 1000;

    const playPattern = () => {
        if (isAlarmMuted) {
            stopAlarm();
            return;
        }

        beep(250, freq);
        setTimeout(() => {
            if (!isAlarmMuted) beep(250, freq);
        }, 350);

        alarmTimeout = setTimeout(playPattern, 1500);
    };

    playPattern();
}

function stopAlarm() {
    if (alarmTimeout) {
        clearTimeout(alarmTimeout);
        alarmTimeout = null;
    }
}


function saveThermalImage() {
    const now = new Date();

    const timestamp =
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + "_" +
        String(now.getHours()).padStart(2, "0") + "-" +
        String(now.getMinutes()).padStart(2, "0") + "-" +
        String(now.getSeconds()).padStart(2, "0");

    const link = document.createElement("a");
    link.download = `thermal_${timestamp}.png`;

    link.href = displayCanvas.toDataURL("image/png");
    link.click();
}

// ================= BUTTON EVENT =================
if (muteAlarmBtn) {
    muteAlarmBtn.addEventListener("click", () => {
        isAlarmMuted = !isAlarmMuted;

        if (isAlarmMuted) {
            stopAlarm();
            muteAlarmBtn.innerText = "Aktifkan Alarm";
        } else {
            muteAlarmBtn.innerText = "Matikan Alarm";
            lastAlarmState = null;

            if (latestFrame && latestFrame.length >= 768) {
                const currentTemp = getCenterAvg3x3(latestFrame);
                const result = classifyTemperature(currentTemp);
                if (result.alarm) {
                    triggerAlarm(result.className);
                }
            }
        }
    });
}


if (saveImageBtn) {
    saveImageBtn.addEventListener("click", () => {
        saveThermalImage();
    });
}

// ================= RENDER FUNCTION =================
function drawThermal(data) {
    if (!data || data.length < 768) return;

    const colorMin = 24;
    const colorMax = 39;

    // Statistik suhu asli
    const centerTemp = getCenterAvg3x3(data);
    const minTemp = Math.min(...data);
    const maxTemp = Math.max(...data);

    centerTempEl.innerText = centerTemp.toFixed(1) + " °C";
    minTempEl.innerText = minTemp.toFixed(1) + " °C";
    maxTempEl.innerText = maxTemp.toFixed(1) + " °C";

    // Legend tetap
    legendMinEl.innerText = colorMin.toFixed(1) + " °C";
    legendMaxEl.innerText = colorMax.toFixed(1) + " °C";

    updateStatus(centerTemp);

    const pixels = imageData.data;

    for (let i = 0; i < data.length; i++) {

        let t = (data[i] - colorMin) / (colorMax - colorMin);
        t = Math.max(0, Math.min(1, t));

        const color = getThermalColor(t);

        const idx = i * 4;

        pixels[idx]     = color.r;
        pixels[idx + 1] = color.g;
        pixels[idx + 2] = color.b;
        pixels[idx + 3] = 255;
    }

    rawCtx.putImageData(imageData, 0, 0);

    displayCtx.imageSmoothingEnabled = true;
    displayCtx.imageSmoothingQuality = "high";

    displayCtx.clearRect(0, 0, 640, 480);
    displayCtx.drawImage(rawCanvas, 0, 0, 640, 480);
}

// ================= LOOP & SOCKET =================
function renderLoop() {
    if (needsUpdate && latestFrame) {
        drawThermal(latestFrame);
        needsUpdate = false;
    }
    requestAnimationFrame(renderLoop);
}
renderLoop();

const socket = new WebSocket(`ws://${location.host}/ws`);
socket.binaryType = "arraybuffer";

socket.onmessage = (event) => {
    latestFrame = new Float32Array(event.data);
    needsUpdate = true;
};

socket.onopen = () => {
    console.log("WebSocket connected");
};

socket.onclose = () => {
    console.log("WebSocket disconnected");
};

socket.onerror = (err) => {
    console.error("WebSocket error:", err);
};