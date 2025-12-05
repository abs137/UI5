// --------- CONFIG ----------
const EXCEL_URL = "./book1.xlsx";   // change here if your file has different name
const EMPTY_COUNT = 20;             // not strictly used, but kept for future
// ----------------------------

let rowsRaw = [];       // [ [LOCATION_ID, STATUS/ITEM], ... ] from Excel
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchOn = false;

// Missing locations (physically not present)
let missingSet = new Set();

// Load missing IDs from localStorage on startup
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

/* ---------- Load Excel (all bins, 2 columns) ---------- */
async function loadExcel() {
  try {
    const res = await fetch(`${EXCEL_URL}?ts=${Date.now()}`); // cache-buster
    if (!res.ok) throw new Error(`Could not fetch Excel: ${res.status}`);

    const data = await res.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    const first = all[0] || [];
    const a0 = (first[0] ?? "").toString().trim().toUpperCase();
    const b0 = (first[1] ?? "").toString().trim().toUpperCase();
    const hasHeader = a0 === "ID" || b0 === "DETAILS" || b0 === "STATUS" || a0 === "LOCATION_ID";

    rowsRaw = all.slice(hasHeader ? 1 : 0).map(r => [
      (r[0] ?? "").toString().trim(), // LOCATION_ID
      (r[1] ?? "").toString().trim()  // DETAIL / STATUS / ITEM_ID
    ]);

    console.log("Excel loaded:", rowsRaw.length);
  } catch (err) {
    console.error(err);
    document.getElementById("output").textContent = "⚠️ Could not load Excel file.";
  }
}

/* ---------- Helpers ---------- */
function isEMPTY(val) {
  const v = (val ?? "").trim().toUpperCase();
  // treat these as empty: literal EMPTY, Y, or blank
  return v === "" || v === "Y" || v === "EMPTY";
}

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

/* ---------- Find Empty Locations (using full data) ---------- */
function findNextEmptyLocations(startId) {
  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if (idx === -1) return { foundIndex: -1, locations: [] };

  const out = [];

  // First 5 characters of the scanned ID define the "zone"
  const prefix = (startId ?? "").toString().substring(0, 5).toUpperCase();

  // Start scanning from the scanned bin row
  for (let i = idx; i < rowsRaw.length; i++) {
    const id = (rowsRaw[i][0] ?? "").toString().trim();
    const detail = rowsRaw[i][1];

    if (!id) break;

    // Stop if prefix changes
    if (id.substring(0, 5).toUpperCase() !== prefix) break;

    // Add only empty bins
    if (isEMPTY(detail)) {
      out.push(id);
    }
  }

  return { foundIndex: idx, locations: out };
}

/* ---------- Render Results (clickable + missing mark) ---------- */
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

    // Show if already marked missing
    if (missingSet.has(loc)) {
      div.classList.add("missing");
    }

    // Click to toggle missing
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

/* ---------- Search Form ---------- */
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
    output.innerHTML = `<p style="color:red">ID not found in data.</p>`;
    return;
  }

  if (locations.length === 0) {
    output.innerHTML = `<p class="muted">No empty bins found after the given ID in the same area.</p>`;
    return;
  }

  output.innerHTML = "";
  grid.appendChild(renderGroupedLocations(locations));
});

/* ---------- Scanner ---------- */
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

/* ---------- Missing locations download ---------- */
function downloadMissingLocations() {
  if (missingSet.size === 0) {
    alert("No missing locations have been marked yet.");
    return;
  }

  const rows = ["LOCATION_ID"];
  missingSet.forEach(id => rows.push(id));

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

/* ---------- Button wiring & init ---------- */
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);
document.getElementById("torchToggleBtn").addEventListener("click", () => {
  enableTorch(!torchOn);
});
document.getElementById("downloadMissingBtn").addEventListener("click", downloadMissingLocations);

document.addEventListener("DOMContentLoaded", async () => {
  await loadExcel();
  runFromURL();   // allows ?id=... in the link
});
