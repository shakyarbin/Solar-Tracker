// Import Firebase JS SDK modules from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, set, push, limitToLast, query } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAYqCJVluZkW4BXrXbOHZvFIbiK4hEH71Y",
    authDomain: "solar-tracker-36ba3.firebaseapp.com",
    databaseURL: "https://solar-tracker-36ba3-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "solar-tracker-36ba3"
};

// Initialize App, Auth, and DB
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Authenticate silently using provided credentials
signInWithEmailAndPassword(auth, "notarbin99@gmail.com", "Testing")
    .then(() => {
        console.log("Logged in successfully to Firebase!");
        addAlertLog("Authenticated database link active", "green");
    })
    .catch((error) => {
        console.warn("Authentication skipped or failed:", error.message);
        addAlertLog("Database link running in public mode", "yellow");
    });

// DOM Elements
const currentModeBadge = document.getElementById("current-mode-badge");
const currentModeDesc = document.getElementById("current-mode-desc");
const voltageVal = document.getElementById("voltage-val");
const currentVal = document.getElementById("current-val");
const powerVal = document.getElementById("power-val");
const energyVal = document.getElementById("energy-val");
const efficiencyVal = document.getElementById("efficiency-val");
const efficiencyStatus = document.getElementById("efficiency-status");

const voltageTime = document.getElementById("voltage-time");
const currentTimeUpdated = document.getElementById("current-time-updated");
const powerTime = document.getElementById("power-time");

const azimuthVal = document.getElementById("azimuth-val");
const elevationVal = document.getElementById("elevation-val");
const azimuthDirection = document.getElementById("azimuth-direction");
const elevationDirection = document.getElementById("elevation-direction");
const solarPanelMesh = document.getElementById("solar-panel-mesh");
const sunElementNode = document.getElementById("sun-element-node");

const batteryPercentageVal = document.getElementById("battery-percentage-val");
const batteryRing = document.getElementById("battery-ring");
const batteryVoltageVal = document.getElementById("battery-voltage-val");
const batteryHealthVal = document.getElementById("battery-health-val");

const btnStorm = document.getElementById("btn-storm");
const btnClean = document.getElementById("btn-clean");

const alertsContainer = document.getElementById("alerts-container");
const syncBtn = document.getElementById("sync-btn");

// Application State
let systemMode = "tracking"; // tracking, storm, clean, park, manual
let liveAzimuth = 132;
let liveElevation = 46;
let energyAccumulated = 0;
let batteryCharge = 76;
let batteryVoltage = 13.1;
let lastUpdateTime = null; // null = never received data yet
let esp32IsOnline = false;

// ESP32 Staleness Detection
// If no new push arrives within 30s, mark as offline
const ESP32_TIMEOUT_MS = 30000;

const esp32StatusDot   = document.getElementById("esp32-status-dot");
const esp32StatusLabel = document.getElementById("esp32-status-label");
const esp32StatusText  = document.getElementById("esp32-status-text");

function setESP32Online() {
    if (!esp32IsOnline) {
        addAlertLog("ESP32 came online", "green");
    }
    esp32IsOnline = true;
    esp32StatusDot.className = "status-dot online";
    esp32StatusLabel.textContent = "Online";
    esp32StatusText.textContent = "ESP32 Connected";
}

function setESP32Offline() {
    if (esp32IsOnline) {
        addAlertLog("ESP32 went offline — no data for 30s", "yellow");
    }
    esp32IsOnline = false;
    esp32StatusDot.className = "status-dot offline";
    esp32StatusLabel.textContent = "Offline";
    esp32StatusText.textContent = "ESP32 Not Responding";
}

function getRecordTime(record) {
    const raw = record?.timestamp ?? record?.time ?? record?.ts ?? record?.createdAt;
    if (raw == null) return null;

    let ms = typeof raw === "number" ? raw : new Date(raw).getTime();
    if (Number.isNaN(ms)) return null;

    // ESP32 often sends Unix seconds; JavaScript Date expects milliseconds
    if (ms > 0 && ms < 1e12) ms *= 1000;

    const t = new Date(ms);
    return Number.isNaN(t.getTime()) ? null : t;
}

function refreshEsp32ConnectionStatus() {
    if (lastUpdateTime === null) {
        setESP32Offline();
        return;
    }
    const elapsed = Date.now() - lastUpdateTime.getTime();
    if (elapsed > ESP32_TIMEOUT_MS) {
        setESP32Offline();
    } else {
        setESP32Online();
    }
}

// Poll every 5 seconds against the Firebase record timestamp
setInterval(refreshEsp32ConnectionStatus, 5000);

// Chart instances
let powerChartInstance = null;
let weeklyChartInstance = null;
let sparklines = {};

// Helper for relative timestamps
function getRelativeTimeString(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 5) return "Just now";
    if (seconds < 60) return `${seconds} sec ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ago`;
}

// Update clock in header
function updateClock() {
    const now = new Date();
    const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    
    document.getElementById("current-date").textContent = now.toLocaleDateString('en-US', dateOptions);
    document.getElementById("current-time").textContent = now.toLocaleTimeString('en-US', timeOptions);
    
    // Update live indicators timestamps
    if (lastUpdateTime) {
        const relativeStr = getRelativeTimeString(lastUpdateTime);
        voltageTime.textContent = `Last update: ${relativeStr}`;
        currentTimeUpdated.textContent = `Last update: ${relativeStr}`;
        powerTime.textContent = `Last update: ${relativeStr}`;
    }
}
setInterval(updateClock, 1000);
updateClock();

// Initialize Lucide Icons
lucide.createIcons();

// --- Real Weather via Open-Meteo (no API key needed) ---
// Location: Kathmandu, Nepal
const WEATHER_LAT = 27.7172;
const WEATHER_LON = 85.3240;

// WMO weather code → { label, icon (Lucide name), colorClass }
function decodeWMO(code) {
    if (code === 0)                       return { label: "Clear Sky",        icon: "sun",            cls: "yellow" };
    if (code <= 2)                        return { label: "Partly Cloudy",    icon: "cloud-sun",      cls: "yellow" };
    if (code === 3)                       return { label: "Overcast",         icon: "cloud",          cls: "muted"  };
    if (code <= 49)                       return { label: "Foggy",            icon: "cloud-fog",      cls: "muted"  };
    if (code <= 57)                       return { label: "Drizzle",          icon: "cloud-drizzle",  cls: "blue"   };
    if (code <= 67)                       return { label: "Rainy",            icon: "cloud-rain",     cls: "blue"   };
    if (code <= 77)                       return { label: "Snowy",            icon: "cloud-snow",     cls: "muted"  };
    if (code <= 82)                       return { label: "Rain Showers",     icon: "cloud-rain",     cls: "blue"   };
    if (code <= 86)                       return { label: "Snow Showers",     icon: "cloud-snow",     cls: "muted"  };
    if (code === 95)                      return { label: "Thunderstorm",     icon: "cloud-lightning", cls: "yellow" };
    if (code >= 96)                       return { label: "Hail Storm",       icon: "cloud-lightning", cls: "yellow" };
    return { label: "Unknown", icon: "cloud", cls: "muted" };
}

async function fetchRealWeather() {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}&current=temperature_2m,weather_code&temperature_unit=celsius&timezone=Asia%2FKathmandu`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        const tempC   = Math.round(data.current.temperature_2m);
        const code    = data.current.weather_code;
        const decoded = decodeWMO(code);

        // Update DOM
        const iconContainer = document.getElementById("weather-icon-container");
        if (iconContainer) {
            iconContainer.innerHTML = `<i data-lucide="${decoded.icon}" class="weather-icon ${decoded.cls}"></i>`;
        }

        document.getElementById("weather-temp").textContent      = `${tempC}°C`;
        document.getElementById("weather-condition").textContent = decoded.label;

        // Re-run Lucide so the new icon renders
        lucide.createIcons();
        console.log(`Weather updated: ${decoded.label}, ${tempC}°C`);
    } catch (err) {
        console.warn("Weather fetch failed:", err.message);
        document.getElementById("weather-condition").textContent = "Unavailable";
    }
}

// Fetch on load and refresh every 10 minutes
fetchRealWeather();
setInterval(fetchRealWeather, 10 * 60 * 1000);


function update3DModel(azimuth, elevation) {
    // We tilt the panel based on elevation and rotate it based on azimuth
    // Center elevation around 45deg base tilt. Center azimuth around 180deg (South)
    const rotX = 35 + (elevation - 45) * 0.5; // limit tilt visually
    const rotY = (azimuth - 180) * 0.4; // limit rotation visually
    
    solarPanelMesh.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) rotateZ(0deg)`;
    
    // Move the glowing sun along an arc path (0 deg azimuth is East, 180 is South, 360 is West)
    // Map azimuth [0-360] to X coordinate [-80px to 80px]
    // Map elevation [0-90] to Y coordinate [10px to -55px]
    const sunX = ((azimuth - 180) / 180) * 80;
    const sunY = 40 - (elevation / 90) * 65;
    
    sunElementNode.style.transform = `translate(calc(-50% + ${sunX}px), calc(-50% + ${sunY}px))`;
}

// Update Gauges
function updateGauges(azimuth, elevation) {
    azimuthVal.textContent = `${Math.round(azimuth)}°`;
    elevationVal.textContent = `${Math.round(elevation)}°`;
    
    // Convert azimuth to Cardinal direction
    let dir = "South";
    if (azimuth >= 337.5 || azimuth < 22.5) dir = "North";
    else if (azimuth >= 22.5 && azimuth < 67.5) dir = "Northeast";
    else if (azimuth >= 67.5 && azimuth < 112.5) dir = "East";
    else if (azimuth >= 112.5 && azimuth < 157.5) dir = "Southeast";
    else if (azimuth >= 157.5 && azimuth < 202.5) dir = "South";
    else if (azimuth >= 202.5 && azimuth < 247.5) dir = "Southwest";
    else if (azimuth >= 247.5 && azimuth < 292.5) dir = "West";
    else if (azimuth >= 292.5 && azimuth < 337.5) dir = "Northwest";
    azimuthDirection.textContent = dir;
    
    // Convert elevation to textual description
    let elevText = "Flat";
    if (elevation > 80) elevText = "Zenith";
    else if (elevation > 45) elevText = "Upward";
    else if (elevation > 15) elevText = "Midway";
    else if (elevation > 0) elevText = "Low Horizon";
    elevationDirection.textContent = elevText;
    
    // Update SVG progress rings (dasharray = 251.2 corresponds to r=40)
    const azimuthProg = document.querySelector(".azimuth-prog");
    const elevationProg = document.querySelector(".elevation-prog");
    
    const azimuthOffset = 251.2 - (azimuth / 360) * 251.2;
    const elevationOffset = 251.2 - (elevation / 90) * 251.2;
    
    azimuthProg.style.strokeDashoffset = azimuthOffset;
    elevationProg.style.strokeDashoffset = elevationOffset;
    
    // Update the 3D model orientation
    update3DModel(azimuth, elevation);
}

// Update Battery Ring
function updateBatteryDisplay(percentage, voltage, health) {
    batteryPercentageVal.textContent = `${Math.round(percentage)}%`;
    batteryVoltageVal.textContent = `${voltage.toFixed(1)} V`;
    batteryHealthVal.textContent = health;
    
    if (health === "Good Health") {
        batteryHealthVal.className = "green-text";
    } else {
        batteryHealthVal.className = "yellow-text";
    }
    
    // dasharray = 314.16 (r=50)
    const offset = 314.16 - (percentage / 100) * 314.16;
    batteryRing.style.strokeDashoffset = offset;
    
    // Dynamic color change based on charge level
    if (percentage > 50) {
        batteryRing.style.stroke = "var(--color-success)";
    } else if (percentage > 20) {
        batteryRing.style.stroke = "var(--color-warning)";
    } else {
        batteryRing.style.stroke = "var(--color-error)";
    }
}

// --- Push dynamic logs to Recent Alerts Banner ---
function addAlertLog(message, type = "blue") {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    
    const alertDiv = document.createElement("div");
    alertDiv.className = "alert-item";
    
    let dotClass = "blue-dot";
    if (type === "green") dotClass = "green-dot";
    else if (type === "yellow") dotClass = "yellow-dot";
    else if (type === "red") dotClass = "red-dot";
    
    alertDiv.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    // Map dot colors to CSS variables for inline style fallback
    let dotColor = "var(--color-primary)";
    if (type === "green") dotColor = "var(--color-success)";
    else if (type === "yellow") dotColor = "var(--color-warning)";
    else if (type === "red") dotColor = "var(--color-error)";

    alertDiv.innerHTML = `
        <span class="alert-time" style="color: var(--text-muted); font-size: 0.85rem; min-width: 60px;">${timeStr}</span>
        <span class="alert-dot ${dotClass}" style="width: 8px; height: 8px; border-radius: 50%; background: ${dotColor};"></span>
        <span class="alert-content" style="color: var(--text-light); font-size: 0.9rem;">${message}</span>
    `;
    
    // Insert at the beginning of the list
    if (alertsContainer.firstChild) {
        alertsContainer.insertBefore(alertDiv, alertsContainer.firstChild);
    } else {
        alertsContainer.appendChild(alertDiv);
    }
    
    // Keep only the last 5 logs visible to avoid overflow
    const logs = alertsContainer.querySelectorAll(".alert-item");
    if (logs.length > 5) {
        alertsContainer.removeChild(logs[logs.length - 1]);
    }
}

// --- Chart Setup & Sparklines ---
function initializeSparkline(canvasId, lineColor, dataPoints) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    // Destroy previous instance if it exists
    if (sparklines[canvasId]) {
        sparklines[canvasId].destroy();
    }
    
    // Create soft gradient under sparkline
    const gradient = ctx.createLinearGradient(0, 0, 0, 36);
    gradient.addColorStop(0, lineColor + "33");
    gradient.addColorStop(1, lineColor + "00");
    
    sparklines[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: new Array(dataPoints.length).fill(''),
            datasets: [{
                data: dataPoints,
                borderColor: lineColor,
                borderWidth: 1.5,
                fill: true,
                backgroundColor: gradient,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false }
            }
        }
    });
}

function updateSparklineData(canvasId, newValue) {
    const chart = sparklines[canvasId];
    if (chart) {
        chart.data.datasets[0].data.shift();
        chart.data.datasets[0].data.push(newValue);
        chart.update('none'); // silent update
    }
}

function initializeCharts(powerDataHistory, weeklyData) {
    // Power generation area chart
    const powerCtx = document.getElementById('power-generation-chart').getContext('2d');
    
    // Power Gradient (White Glow)
    const powerGlowGrad = powerCtx.createLinearGradient(0, 0, 0, 250);
    powerGlowGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    powerGlowGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.08)');
    powerGlowGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

    powerChartInstance = new Chart(powerCtx, {
        type: 'line',
        data: {
            labels: powerDataHistory.map(d => d.time),
            datasets: [{
                label: 'Power Output (W)',
                data: powerDataHistory.map(d => d.value),
                borderColor: '#ffffff',
                borderWidth: 3,
                backgroundColor: powerGlowGrad,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: 'rgba(255, 255, 255, 0.8)',
                pointHoverRadius: 6,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#111928',
                    titleColor: '#9ca3af',
                    bodyColor: '#f3f4f6',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 10
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: 'var(--text-secondary)', font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: 'var(--text-secondary)', font: { size: 10 } },
                    beginAtZero: true,
                    suggestedMax: 10
                }
            }
        }
    });


}

// Generate base arrays for sparklines
const defaultSparkHistory = () => {
    return new Array(15).fill(0);
};

// --- Firebase Operations & Syncing ---
function updateLiveStats(latest, { isDemo = false } = {}) {
    if (!latest) return;
    
    const v = parseFloat(latest.voltage ?? 0);
    const c = parseFloat(latest.current ?? 0);
    // Use the power field from Firebase directly.
    // Only fall back to v * (c in Amps) if 'power' key is genuinely absent.
    const p = (latest.power !== undefined && latest.power !== null)
        ? parseFloat(latest.power)
        : v * (c / 1000);
    
    voltageVal.textContent = `${v.toFixed(2)} V`;
    currentVal.textContent = `${c.toFixed(2)} mA`;
    powerVal.textContent  = `${p.toFixed(2)} W`;
    
    if (!isDemo) {
        const recordTime = getRecordTime(latest);
        // Prefer the record timestamp; if ESP32 omits it, a live Firebase push still means online
        lastUpdateTime = recordTime ?? new Date();
        refreshEsp32ConnectionStatus();
    }
    
    // Sparklines live updates
    updateSparklineData("voltage-sparkline", v);
    updateSparklineData("current-sparkline", c);
    updateSparklineData("power-sparkline", p);
    
    // Calculate derived values
    calculateSystemOutputs(v, c, p);
    
    // Trigger visual highlight effects
    pulseCardBorder(v, c, p);
}

function calculateSystemOutputs(v, c, p) {
    // Energy Integration: Add power to today's cumulative count
    // Real formula: Energy (Wh) = Power (W) * deltaT (hours)
    // Assume updates arrive roughly every 3-5 seconds.
    // For demonstration, let's accumulate it incrementally:
    const deltaTSeconds = 3; 
    const deltaHours = deltaTSeconds / 3600;
    const addedWh = p * deltaHours;
    const addedKwh = addedWh / 1000;
    
    energyAccumulated = parseFloat(energyAccumulated) + addedKwh;
    energyVal.textContent = `${energyAccumulated.toFixed(3)} kWh`;
    updateSparklineData("energy-sparkline", energyAccumulated);

    // Efficiency computation
    // Efficiency is optimized around target panel placement.
    // Let's compute a realistic efficiency value:
    // MPPT / solar conversion efficiency peaks around 85-92%
    let baseEff = 87;
    let text = "Optimal";
    
    if (systemMode === "tracking") {
        baseEff = 85 + Math.sin(Date.now() / 10000) * 3; // oscillation around optimal tracking
        text = "Optimal";
    } else if (systemMode === "storm") {
        baseEff = 25 + Math.random() * 5; // flattened, bad angle
        text = "Sub-optimal (Storm Safe)";
    } else if (systemMode === "clean") {
        baseEff = 15 + Math.random() * 5; // steep wash angle
        text = "Washing";
    } else if (systemMode === "park") {
        baseEff = 20 + Math.random() * 5; // folded, poor absorption
        text = "Standby";
    } else if (systemMode === "manual") {
        // Efficiency drops as alignment offsets from direct solar vector
        const sunAzimuth = getSimulatedSunPosition().azimuth;
        const sunElevation = getSimulatedSunPosition().elevation;
        
        const azDiff = Math.abs(liveAzimuth - sunAzimuth);
        const elDiff = Math.abs(liveElevation - sunElevation);
        const alignmentPenalty = (Math.cos(azDiff * Math.PI / 180) * Math.cos(elDiff * Math.PI / 180));
        
        baseEff = Math.max(10, Math.round(92 * Math.max(0.1, alignmentPenalty)));
        text = baseEff > 80 ? "Optimal" : baseEff > 50 ? "Moderate" : "Low Alignment";
    }

    efficiencyVal.textContent = `${Math.round(baseEff)}%`;
    efficiencyStatus.textContent = text;
    updateSparklineData("efficiency-sparkline", baseEff);
    
    // Battery Status Integration: charging battery with solar power
    // If power > 0, charge battery level
    if (p > 5) {
        batteryCharge = Math.min(100, batteryCharge + (p * 0.00005));
        batteryVoltage = 12.8 + (batteryCharge - 50) * 0.03 + (p * 0.01); // rises during high power charging
    } else {
        // Slow natural discharge
        batteryCharge = Math.max(10, batteryCharge - 0.0001);
        batteryVoltage = 12.6 + (batteryCharge - 50) * 0.01;
    }
    
    let batteryHealth = "Good Health";
    if (batteryVoltage > 14.5 || batteryVoltage < 11.5) {
        batteryHealth = "Check Battery";
    }
    
    updateBatteryDisplay(batteryCharge, batteryVoltage, batteryHealth);
}

// Spark flash effect on card border when updates land
function pulseCardBorder(v, c, p) {
    const cards = [
        document.querySelector(".voltage-card"),
        document.querySelector(".current-card"),
        document.querySelector(".power-card")
    ];
    
    cards.forEach(card => {
        card.style.borderColor = "rgba(255,255,255,0.18)";
        setTimeout(() => {
            card.style.borderColor = "var(--border-color)";
        }, 300);
    });
    
    // Flash sync cloud green
    syncBtn.innerHTML = `<i data-lucide="cloud-lightning" class="sync-active"></i>`;
    lucide.createIcons();
    setTimeout(() => {
        syncBtn.innerHTML = `<i data-lucide="cloud" style="color: var(--text-muted)"></i>`;
        lucide.createIcons();
    }, 800);
}

// Get standard sun positions based on current time
function getSimulatedSunPosition() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60;
    
    // Simulate sun trajectory (Sunrise at 6am (az=90, el=0), Noon at 12pm (az=180, el=60), Sunset at 6pm (az=270, el=0))
    let azimuth = 180;
    let elevation = 0;
    
    if (hours >= 6 && hours <= 18) {
        // Day time
        const progress = (hours - 6) / 12; // 0 to 1
        azimuth = 90 + progress * 180; // 90 to 270
        elevation = Math.sin(progress * Math.PI) * 65; // peaks at 65 deg at noon
    } else {
        // Night time
        azimuth = 0; // facing north / ready for next morning
        elevation = 0;
    }
    
    return { azimuth, elevation };
}


// Populate charts with history
function updateCharts(records) {
    if (!records || records.length === 0) return;
    
    // Parse time/power generation details safely from database pushes
    const powerData = records.map((rec, index) => {
        let timeLabel = `T-${records.length - index}`;
        if (rec.timestamp) {
            const dateObj = new Date(rec.timestamp);
            if (!isNaN(dateObj.getTime())) {
                timeLabel = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
        }
        return {
            time: timeLabel,
            value: parseFloat(rec.power || rec.voltage * rec.current || 0)
        };
    });
    
    // Update live area chart
    if (powerChartInstance) {
        powerChartInstance.data.labels = powerData.map(d => d.time);
        powerChartInstance.data.datasets[0].data = powerData.map(d => d.value);
        powerChartInstance.update('none');
    }
}

// Generate beautiful fallback static graphics when Firebase is silent or loading
function useDemoData() {
    console.log("Rendering default dashboard data...");
    
    // Simulate current state — demo data must not affect ESP32 connection status
    const demoLatest = { voltage: 18.64, current: 1.23, power: 22.86 };
    updateLiveStats(demoLatest, { isDemo: true });
    setESP32Offline();
    
    // Generate power history line chart elements
    const demoPowerHistory = [];
    const now = new Date();
    for (let i = 12; i >= 0; i--) {
        const d = new Date(now - i * 30 * 60 * 1000); // 30 mins intervals
        const hours = d.getHours() + d.getMinutes() / 60;
        let powerVal = 0;
        if (hours >= 6 && hours <= 18) {
            const prog = (hours - 6) / 12;
            powerVal = Math.sin(prog * Math.PI) * (35 + Math.random() * 5); // curve peaks around 38W
        }
        demoPowerHistory.push({
            time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            value: powerVal
        });
    }
    updateCharts(demoPowerHistory);
}

// Seed Database if empty, to give the user a fully functional out-of-the-box system
function seedDatabaseIfEmpty() {
    const testRef = ref(db, "SolarTracker");
    onValue(testRef, (snapshot) => {
        if (!snapshot.exists()) {
            console.log("Firebase Database is empty. Seeding historical metrics...");
            const now = Date.now();
            // Create points going back 4 hours, spaced by 5 minutes
            for (let i = 48; i >= 0; i--) {
                const timestamp = now - i * 5 * 60 * 1000;
                const d = new Date(timestamp);
                const hr = d.getHours() + d.getMinutes() / 60;
                
                let voltage = 0;
                let current = 0;
                let power = 0;
                
                if (hr >= 6 && hr <= 18) {
                    const prog = (hr - 6) / 12;
                    voltage = 15 + Math.sin(prog * Math.PI) * 4.2 + (Math.random() * 0.3); // peaks at ~19.5V
                    current = 0.5 + Math.sin(prog * Math.PI) * 1.5 + (Math.random() * 0.1); // peaks at ~2.1A
                    power = voltage * current;
                } else {
                    voltage = 0.5 + Math.random() * 0.2; // slight night panel leakage
                    current = 0;
                    power = 0;
                }
                
                push(testRef, {
                    voltage: parseFloat(voltage.toFixed(2)),
                    current: parseFloat(current.toFixed(2)),
                    power: parseFloat(power.toFixed(2)),
                    timestamp: timestamp
                });
            }
            addAlertLog("Database seeded with historical test data", "green");
        }
    }, { onlyOnce: true });
}

// --- Quick Actions Controls Handoff ---
function updateSystemMode(mode) {
    systemMode = mode;
    
    // Toggle active classes on UI buttons
    btnStorm.classList.remove("active");
    btnClean.classList.remove("active");
    
    if (mode === "storm") {
        btnStorm.classList.add("active");
        currentModeBadge.textContent = "STORM SAFE";
        currentModeBadge.className = "mode-badge storm";
        currentModeDesc.textContent = "Panel flattened for wind safety";
        addAlertLog("Storm mode activated", "yellow");
    } else if (mode === "clean") {
        btnClean.classList.add("active");
        currentModeBadge.textContent = "CLEANING";
        currentModeBadge.className = "mode-badge clean";
        currentModeDesc.textContent = "Panel tilting up for dusting/wash";
        addAlertLog("Clean mode activated", "yellow");
    } else {
        // Default Tracking
        currentModeBadge.textContent = "TRACKING";
        currentModeBadge.className = "mode-badge tracking";
        currentModeDesc.textContent = "System is tracking the sun";
        addAlertLog("Sun tracking resume", "green");
    }
}

// Wire up Quick Action Click events
btnStorm.addEventListener("click", () => {
    const newMode = (systemMode === "storm") ? "tracking" : "storm";
    set(ref(db, "SolarTrackerControls"), {
        command: newMode,
        timestamp: Date.now()
    });
});

btnClean.addEventListener("click", () => {
    const newMode = (systemMode === "clean") ? "tracking" : "clean";
    set(ref(db, "SolarTrackerControls"), {
        command: newMode,
        timestamp: Date.now()
    });
});

// Listen to Remote Controls in real time so other browser sessions or the ESP32 updates sync back instantly
onValue(ref(db, "SolarTrackerControls"), (snapshot) => {
    if (snapshot.exists()) {
        const ctrl = snapshot.val();
        
        // Use the command if it exists, otherwise default to tracking
        updateSystemMode(ctrl.command || "tracking");
        
        // Read azimuth and elevation unconditionally from the RTDB
        if (ctrl.azimuth !== undefined && ctrl.elevation !== undefined) {
            liveAzimuth = parseFloat(ctrl.azimuth);
            liveElevation = parseFloat(ctrl.elevation);
            
            // Update gauges and 3D panel rendering
            updateGauges(liveAzimuth, liveElevation);
        }
    } else {
        updateSystemMode("tracking");
    }
});

// Sparkline setups (dummy history initialization, which then gets real-time peaks)
const sparkData = defaultSparkHistory();
initializeSparkline("voltage-sparkline", "#10b981", sparkData);
initializeSparkline("current-sparkline", "#3b82f6", sparkData);
initializeSparkline("power-sparkline", "#f59e0b", sparkData);
initializeSparkline("energy-sparkline", "#8b5cf6", sparkData);
initializeSparkline("efficiency-sparkline", "#06b6d4", sparkData);

// Initialize charts with mockup layout datasets
const weeklyDummyData = [0.4, 0.75, 0.65, 0.88, 0.95, 0.42, 0.28];
initializeCharts([], weeklyDummyData);

// Listen to Real-Time pushes from ESP32
const trackerRef = ref(db, "SolarTracker");
const trackerQuery = query(trackerRef, limitToLast(24)); // Pull recent history logs to populate charts

let sparklinesSeeded = false;

onValue(trackerQuery, (snapshot) => {
    if (snapshot.exists()) {
        const rawData = snapshot.val();
        const sortedKeys = Object.keys(rawData).sort();
        const records = sortedKeys.map(key => rawData[key]);
        
        // Pre-fill sparklines with historical data on first load
        if (!sparklinesSeeded && records.length > 0) {
            const hist = records.slice(-16, -1); // take up to 15 items BEFORE the latest
            if (hist.length > 0) {
                const vHist = hist.map(r => parseFloat(r.voltage ?? 0));
                const cHist = hist.map(r => parseFloat(r.current ?? 0));
                const pHist = hist.map(r => (r.power !== undefined && r.power !== null) ? parseFloat(r.power) : (parseFloat(r.voltage ?? 0) * parseFloat(r.current ?? 0)));
                
                // Pad left with zeros if we have less than 15
                while (vHist.length < 15) { vHist.unshift(0); cHist.unshift(0); pHist.unshift(0); }
                
                if (sparklines["voltage-sparkline"]) sparklines["voltage-sparkline"].data.datasets[0].data = vHist;
                if (sparklines["current-sparkline"]) sparklines["current-sparkline"].data.datasets[0].data = cHist;
                if (sparklines["power-sparkline"]) sparklines["power-sparkline"].data.datasets[0].data = pHist;
            }
            sparklinesSeeded = true;
        }

        // Grab newest database metrics
        const latest = records[records.length - 1];
        updateLiveStats(latest);
        
        // Feed power generation line chart
        updateCharts(records);
    } else {
        useDemoData();
        // Seed if first time running system
        seedDatabaseIfEmpty();
    }
});
