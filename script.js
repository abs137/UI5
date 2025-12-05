// ---------------- Global state ----------------
let rowsRaw = [];             // [ [LOCATION_ID], ... ]
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchOn = false;

// Missing locations (physically not present)
let missingSet = new Set();

(function initMissingFromStorage() {
  try {
    const raw = localStorage.getItem("missingLocations");
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      arr.forEach(id => missingSet.add(String(id)));
    }
  } catch (e) {
    console.warn("Could not load missingLocations from storage:", e);
  }
})();

function saveMissingToStorage() {
  try {
    localStorage.setItem("missingLocations", JSON.stringify(Array.from(missingSet)));
  } catch (e) {
    console.warn("Could not save missingLocations to storage:", e);
  }
}

// ---------------- Helpers ----------------
function cleanId(text) {
  if (!text) return "";
  return String(text)
    .replace(/^\][A-Z0-9]{2}/i, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

// Read ?id=... from URL and auto-run search
function runFromURL() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) {
    const input = document.getElementById("id");
    input.value = cleanId(id);
    document.getElementById("searchForm").requestSubmit();
  }
}

// ---------------- Load CSV (empty-only) ----------------
async function loadCsv() {
  try {
    // cache-buster query to avoid stale file
    const res = await fetch(`./book1_web.csv?ts=${Date.now()}`);
    if (!res.ok) throw new Error(`Could not fetch CSV: ${res.status}`);

    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length <= 1) {
      console.warn("CSV has header only or is empty.");
      rowsRaw = [];
      return;
    }

    // first line is header: LOCATION_ID
    rowsRaw = lines.slice(1).map(line => {
      const id = line.split(",")[0] ?? "";
      return [id.trim()];
    });

    console.log("CSV loaded, rows:", rowsRaw.length);
  } catch (err) {
    console.error(err);
    document.getElementById("output").textContent = "⚠️ Could not load locations file.";
  }
}

// ---------------- Core search logic (empty-only) ----------------
function findNextEmptyLocations(startId) {
  const start = (startId ?? "").trim();
  if (!start) return { foundIndex: -1, locations: [] };

  const prefix = start.substring(0, 5).toUpperCase();

  const locations = rowsRaw
    .map(r => (r[0] ?? "").trim())
    .filter(id =>
      id &&
      id.toUpperCase().startsWith(prefix) &&
      id >= start
    );

  return {
    foundIndex: locations.length ? 0 : -1,
    locations
  };
}

// ---------------- Render results ----------------
function renderGroupedLocations(locations) {
  const frag = document.createDocumentFragment();
  let currentGroup = null, colorIndex = -1;
  const colors = ["#f0f8ff", "#ffdddd", "#ddffdd"];

  locations.forEach(loc => {
    const groupKey = loc.substring(0, 8);
    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      colorIndex = (colorIndex + 1) % colors.length;
    }

    const div = document.createElement("div");
    div.className = "bin-card";
    div.textContent = loc;
    div.style.backgroundColor = colors[colorIndex];

    // If already marked missing, show it
    if (missingSet.has(loc)) {
      div.classList.add("missing");
    }

    // Click to toggle missing status
    div.addEventListener("click", () => {
      if (missingSet.has(loc)) {
        missingSet.delete(loc);
        div.classList.remove("missing");
      } else {
        missingSet.add(loc);
        div.classList.add("missing");
      }
      saveMissingToStorage();
    });

    frag.appendChild(div);
  });

  return frag;
}

// ---------------- Search form ----------------
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const searchId = cleanId(document.getElementById("id").value);
  const output = document.getElementById("output");
  const grid = document.getElementById("binsGrid");
  grid.innerHTML = "";

  if (!searchId) {
    output.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  if (!rowsRaw.length) {
    output.innerHTML = `<p style="color:red">Data not loaded yet. Please try again in a moment.</p>`;
    return;
  }

  const { foundIndex, locations } = findNextEmptyLocations(searchId);

  if (foundIndex === -1) {
    output.innerHTML = `<p style="color:red">No empty bins found after this ID in the same area.</p>`;
    return;
  }

  if (locations.length === 0) {
    output.innerHTML = `<p class="muted">No empty bins found after the given ID.</p>`;
    return;
  }

  // Clear any text and insert grid
  output.innerHTML = "";
  grid.appendChild(renderGroupedLocations(locations));
});

// ---------------- Scanner ----------------
async function startScanner() {
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) {
      alert("No camera found!");
      return;
    }

    const cameraId = cameras[0].id;
    html5QrCode = new Html5Qrcode("qr-reader");
    isScanning = true;

    document.getElementById("scannerWrap").style.display = "block";
    document.getElementById("torchControls").style.display = "block";

    await html5QrCode.start(
      cameraId,
      {
        fps: 10,
        qrbox: 250,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: {
          facingMode: "environment",
          focusMode: "continuous"
        }
      },
      (decodedText) => {
        document.getElementById("id").value = cleanId(decodedText);
        stopScanner();
        document.getElementById("searchForm").requestSubmit();
      }
    );

    const video = document.querySelector("#qr-reader video");
    if (video && video.srcObject) {
      videoTrack = video.srcObject.getVideoTracks()[0];
    }

  } catch (err) {
    console.error(err);
    alert("Could not start camera. Ensure permission is allowed and HTTPS is used.");
    stopScanner();
  }
}

async function stopScanner() {
  if (html5QrCode && isScanning) {
    try {
      await html5QrCode.stop();
    } catch (e) {
      console.warn("Error stopping scanner:", e);
    }
  }
  isScanning = false;
  document.getElementById("scannerWrap").style.display = "none";
  document.getElementById("torchControls").style.display = "none";
  enableTorch(false);
}

async function enableTorch(on) {
  if (!videoTrack) return;
  try {
    await videoTrack.applyConstraints({ advanced: [{ torch: on }] });
    torchOn = on;
    const btn = document.getElementById("torchToggleBtn");
    btn.textContent = on ? "🔦 Turn OFF Flashlight" : "💡 Turn ON Flashlight";
  } catch (err) {
    console.warn("Torch not supported:", err);
  }
}

// ---------------- Missing locations download ----------------
function downloadMissingLocations() {
  if (missingSet.size === 0) {
    alert("No missing locations have been marked yet.");
    return;
  }

  const rows = ["LOCATION_ID"];
  missingSet.forEach(id => {
    rows.push(id);
  });

  const csvContent = rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });

  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const fileName = `missing_locations_${ts}.csv`;

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------- Button wiring & init ----------------
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);
document.getElementById("torchToggleBtn").addEventListener("click", () => {
  enableTorch(!torchOn);
});
document.getElementById("downloadMissingBtn").addEventListener("click", downloadMissingLocations);

document.addEventListener("DOMContentLoaded", async () => {
  await loadCsv();
  runFromURL(); // supports ?id=... in the link
});
