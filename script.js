// ------------- CONFIG -------------
// Change this to your real Excel file name if different
const EXCEL_URL = "./book1.xlsx";
// ----------------------------------

let rowsRaw = []; // [ [LOCATION_ID, ITEM], ... ]
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchOn = false;

// Missing locations tracking (physically not present)
let missingSet = new Set();

// Restore missing locations from localStorage
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

/* ---------- Load Excel (all bins) ---------- */
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
    const hasHeader =
      a0 === "ID" ||
      a0 === "LOCATION_ID" ||
      b0 === "DETAILS" ||
      b0 === "STATUS";

    rowsRaw = all.slice(hasHeader ? 1 : 0).map(r => [
      (r[0] ?? "").toString().trim(), // LOCATION_ID
      (r[1] ?? "").toString().trim()  // ITEM / STATUS / DETAILS
    ]);

    console.log("Excel loaded. Rows:", rowsRaw.length);
  } catch (err) {
    console.error("Error in loadExcel:", err);
    const msgDiv = document.getElementById("message");
    if (msgDiv) {
      msgDiv.textContent = "⚠️ Could not load Excel file.";
    }
  }
}

/* ---------- Helpers ---------- */
function isEMPTY(val) {
  const v = (val ?? "").trim().toUpperCase();
  // Adjust to your Python output: here EMPTY / Y / blank all count as empty bin
  return v === "EMPTY" || v === "Y" || v === "";
}

function cleanId(text) {
  if (!text) return "";
  return String(text)
    .replace(/^\][A-Z0-9]{2}/i, "")               // strip leading ]XX if present
    .replace(/[\u0000-\u001F\u007F]/g, "")        // control chars
    .trim();
}

// Optional: support ?id=... in URL to auto-run
function runFromURL() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (id) {
    document.getElementById("id").value = cleanId(id);
    document.getElementById("searchForm").requestSubmit();
  }
}

/* ---------- Core search using full data ---------- */
function findNextEmptyLocations(startId) {
  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if (idx === -1) return { foundIndex: -1, locations: [] };

  const out = [];
  const prefix = (startId ?? "").substring(0, 5).toUpperCase();

  for (let i = idx; i < rowsRaw.length; i++) {
    const id = (rowsRaw[i][0] ?? "").toString().trim();
    const detail = rowsRaw[i][1];

    if (!id) break;

    // stop when we leave this 5-char “zone”
    if (id.substring(0, 5).toUpperCase() !== prefix) break;

    if (isEMPTY(detail)) {
      out.push(id);
    }
  }

  return { foundIndex: idx, locations: out };
}

/* ---------- Render results (clickable + missing mark) ---------- */
function renderGroupedLocations(locations) {
  const frag = document.createDocumentFragment();
  let currentGroup = null;
  let colorIndex = -1;
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

/* ---------- Search form handler ---------- */
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const searchId = cleanId(document.getElementById("id").value);
  const msg = document.getElementById("message");
  const grid = document.getElementById("binsGrid");

  if (msg) msg.innerHTML = "";
  if (grid) grid.innerHTML = "";

  if (!searchId) {
    if (msg) msg.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  if (!rowsRaw.length) {
    if (msg) msg.innerHTML = `<p style="color:red">Data not loaded yet. Please refresh in a moment.</p>`;
    return;
  }

  const { foundIndex, locations } = findNextEmptyLocations(searchId);

  if (foundIndex === -1) {
    if (msg) msg.innerHTML = `<p style="color:red">ID not found in data.</p>`;
    return;
  }

  if (!locations.length) {
    if (msg) msg.innerHTML = `<p class="muted">No empty bins found after this ID in the same area.</p>`;
    return;
  }

  if (grid) {
    grid.appendChild(renderGroupedLocations(locations));
  }
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
    console.error("Scanner error:", err);
    alert("Could not start camera. Check permission and HTTPS.");
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
    if (btn) {
      btn.textContent = on ? "🔦 Turn OFF Flashlight" : "💡 Turn ON Flashlight";
    }
  } catch (err) {
    console.warn("Torch not supported:", err);
  }
}

/* ---------- Missing locations download ---------- */
function downloadMissingLocations() {
  if (!missingSet.size) {
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

/* ---------- Wire buttons & init ---------- */
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);
document.getElementById("torchToggleBtn").addEventListener("click", () => {
  enableTorch(!torchOn);
});
document.getElementById("downloadMissingBtn").addEventListener("click", downloadMissingLocations);

document.addEventListener("DOMContentLoaded", async () => {
  await loadExcel();
  runFromURL();
});
