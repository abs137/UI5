// HOW MANY empty bins to return by default
const EMPTY_COUNT = 20;

// Full sheet rows (array of arrays) to preserve order
let rowsRaw = [];

/* ------------ Excel loading (keeps order; works with/without header) ------------ */
async function loadExcel() {
  try {
    const res = await fetch("./book1.xlsx");
    if (!res.ok) throw new Error(`Could not fetch Excel: ${res.status} ${res.statusText}`);

    const data = await res.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
    if (!all || all.length === 0) throw new Error("Sheet is empty");

    const first = all[0] || [];
    const a0 = (first[0] ?? "").toString().trim().toUpperCase();
    const b0 = (first[1] ?? "").toString().trim().toUpperCase();
    const hasHeader = (a0 === "ID") || (b0 === "DETAILS") || (b0 === "STATUS");

    rowsRaw = all.slice(hasHeader ? 1 : 0).map(r => [
      (r[0] ?? "").toString().trim(),
      (r[1] ?? "").toString().trim()
    ]);

    console.log("Excel loaded. Rows:", rowsRaw.length);
  } catch (err) {
    console.error(err);
    document.getElementById("output").textContent =
      "⚠️ Could not load Excel file. Check file name/path and that it sits next to index.html.";
  }
}

/* ------------ Utilities ------------ */
function isEMPTY(val) {
  const v = (val ?? "").trim().toUpperCase();
  return v === "" || v === "Y" || v === "EMPTY";
}

// Make the typed/scanned ID safe for comparison
function cleanId(text) {
  if (!text) return "";
  return String(text)
    .replace(/^\][A-Z0-9]{2}/i, "")         // removes barcode prefix like ]C1
    .replace(/[\u0000-\u001F\u007F]/g, "") // remove control characters
    .trim();
}

/* ------------ Find next empty locations ------------ */
function findNextEmptyLocations(startId, count = EMPTY_COUNT) {
  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if (idx === -1) return { foundIndex: -1, locations: [] };

  const out = [];
  for (let i = idx; i < rowsRaw.length && out.length < count; i++) {
    const colA = rowsRaw[i][0];
    const colB = rowsRaw[i][1];
    if (isEMPTY(colB)) out.push(colA);
  }
  return { foundIndex: idx, locations: out };
}

/* ------------ Render grouped locations with color ------------ */
function renderGroupedLocations(locations) {
  const outputDiv = document.createDocumentFragment();

  let currentGroup = null;
  let colorIndex = -1;
  const colors = ["#f0f8ff", "#ffdddd", "#ddffdd"]; // 3 colors

  locations.forEach(loc => {
    const groupKey = loc.substring(0, 8);
    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      colorIndex = (colorIndex + 1) % colors.length;
    }

    const locDiv = document.createElement("div");
    locDiv.className = "bin-card";
    locDiv.textContent = loc;
    locDiv.style.backgroundColor = colors[colorIndex];

    outputDiv.appendChild(locDiv);
  });

  return outputDiv;
}

/* ------------ Search form ------------ */
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const searchId = cleanId(document.getElementById("id").value);
  const output = document.getElementById("output");
  output.innerHTML = "";

  if (!searchId) {
    output.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  const { foundIndex, locations } = findNextEmptyLocations(searchId, EMPTY_COUNT);

  if (foundIndex === -1) {
    output.innerHTML = `<p style="color:red">ID not found in the first column.</p>`;
    return;
  }

  if (locations.length === 0) {
    output.innerHTML = `<p class="muted">No empty bins found after the given ID.</p>`;
    return;
  }

  output.appendChild(renderGroupedLocations(locations));
});

/* ------------ Camera scanning with auto-flash & better focus ------------ */
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchTimeout = null;

async function startScanner() {
  const cameras = await Html5Qrcode.getCameras();
  if (!cameras || cameras.length === 0) {
    alert("No camera found!");
    return;
  }

  const cameraId = cameras[0].id; // rear camera ideally
  html5QrCode = new Html5Qrcode("qr-reader");

  isScanning = true;
  document.getElementById("scannerWrap").style.display = "block";

  await html5QrCode.start(
    cameraId,
    {
      fps: 10,
      qrbox: 250,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      videoConstraints: { facingMode: "environment", focusMode: "continuous" }
    },
    (decodedText) => {
      clearTimeout(torchTimeout);
      document.getElementById("id").value = cleanId(decodedText);
      stopScanner();
      document.getElementById("searchForm").requestSubmit();
    },
    (errorMessage) => {
      // called on decode failure
    }
  );

  // Grab the internal video element and track
  const video = document.querySelector("#qr-reader video");
  if (video && video.srcObject) {
    videoTrack = video.srcObject.getVideoTracks()[0];

    // Auto torch after 5 seconds if barcode not detected
    torchTimeout = setTimeout(() => {
      if (videoTrack && videoTrack.getCapabilities().torch) {
        videoTrack.applyConstraints({ advanced: [{ torch: true }] });
      }
    }, 5000);
  }
}

async function stopScanner() {
  clearTimeout(torchTimeout);
  if (html5QrCode && isScanning) {
    await html5QrCode.stop();
  }
  isScanning = false;
  document.getElementById("scannerWrap").style.display = "none";

  // turn off torch
  if (videoTrack) {
    try { await videoTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
  }
}

// Example: button
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);

const scanBtn = document.getElementById("scanBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const scannerWrap = document.getElementById("scannerWrap");
const idInput = document.getElementById("id");
const torchBtn = document.getElementById("torchToggleBtn");
const torchWrap = document.getElementById("torchControls");

scanBtn.addEventListener("click", async () => {
  if (isScanning) return;

  try {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");
    scannerWrap.style.display = "block";
    torchWrap.style.display = "block";
    isScanning = true;

    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: 250,
        aspectRatio: 1.777,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        videoConstraints: {
          focusMode: "continuous",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      },
      (decodedText) => {
        clearTimeout(torchTimeout);
        const clean = cleanId(decodedText);
        idInput.value = clean;
        stopScanning();
        document.getElementById("searchForm").requestSubmit();
      }
    );

    // get track for torch control
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    videoTrack = stream.getVideoTracks()[0];

    // Auto torch if no scan after 5 seconds
    torchTimeout = setTimeout(() => enableTorch(true), 5000);

  } catch (err) {
    console.error(err);
    isScanning = false;
    alert("Could not start camera. Ensure permission is allowed and HTTPS is used.");
    scannerWrap.style.display = "none";
    torchWrap.style.display = "none";
  }
});

// Torch toggle button
torchBtn.addEventListener("click", async () => {
  if (!videoTrack) return;
  try {
    const capabilities = videoTrack.getCapabilities();
    if (capabilities.torch) {
      const isOn = torchBtn.dataset.torchOn === "true";
      await videoTrack.applyConstraints({ advanced: [{ torch: !isOn }] });
      torchBtn.dataset.torchOn = (!isOn).toString();
      torchBtn.textContent = isOn ? "💡 Turn ON Flashlight" : "🔦 Turn OFF Flashlight";
    } else {
      alert("Flashlight not supported on this device/browser.");
    }
  } catch (err) {
    console.error("Torch error:", err);
  }
});

// Stop scanning
stopScanBtn.addEventListener("click", stopScanning);

async function stopScanning() {
  clearTimeout(torchTimeout);
  if (html5QrCode && isScanning) {
    try { await html5QrCode.stop(); } catch (_) {}
  }
  isScanning = false;
  scannerWrap.style.display = "none";
  torchWrap.style.display = "none";
  enableTorch(false);
}

// Auto torch helper
async function enableTorch(enable) {
  if (!videoTrack) return;
  try {
    await videoTrack.applyConstraints({ advanced: [{ torch: enable }] });
    torchBtn.dataset.torchOn = enable.toString();
    torchBtn.textContent = enable ? "🔦 Turn OFF Flashlight" : "💡 Turn ON Flashlight";
  } catch (err) {
    console.warn("Torch not supported:", err);
  }
}

/* ------------ Init ------------ */
loadExcel();
