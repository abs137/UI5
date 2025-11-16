const EMPTY_COUNT = 20;
let rowsRaw = [];
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchOn = false;

/* ---------- Load Excel ---------- */
async function loadExcel() {
  try {
    const res = await fetch("./book1.xlsx");
    if (!res.ok) throw new Error(`Could not fetch Excel: ${res.status}`);

    const data = await res.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });

    const first = all[0] || [];
    const a0 = (first[0] ?? "").toString().trim().toUpperCase();
    const b0 = (first[1] ?? "").toString().trim().toUpperCase();
    const hasHeader = a0 === "ID" || b0 === "DETAILS" || b0 === "STATUS";

    rowsRaw = all.slice(hasHeader ? 1 : 0).map(r => [
      (r[0] ?? "").toString().trim(),
      (r[1] ?? "").toString().trim()
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
  return v === "" || v === "Y" || v === "EMPTY";
}

function cleanId(text) {
  if (!text) return "";
  return String(text)
    .replace(/^\][A-Z0-9]{2}/i, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

/* ---------- Find Empty Locations (updated) ---------- */
function findNextEmptyLocations(startId) {
  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if (idx === -1) return { foundIndex: -1, locations: [] };

  const out = [];

  // First 5 characters of the scanned ID
  const prefix = (startId ?? "").toString().substring(0, 5).toUpperCase();

  // Start scanning from the scanned bin row
  for (let i = idx; i < rowsRaw.length; i++) {
    const id = (rowsRaw[i][0] ?? "").toString().trim();
    const detail = rowsRaw[i][1];

    // Stop if prefix changes (or id is empty)
    if (!id || id.substring(0, 5).toUpperCase() !== prefix) break;

    // Add only empty bins
    if (isEMPTY(detail)) {
      out.push(id);
    }
  }

  return { foundIndex: idx, locations: out };
}

/* ---------- Render Results ---------- */
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
    frag.appendChild(div);
  });

  return frag;
}

/* ---------- Search Form ---------- */
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const searchId = cleanId(document.getElementById("id").value);
  const output = document.getElementById("output");
  output.innerHTML = "";

  if (!searchId) {
    output.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  const { foundIndex, locations } = findNextEmptyLocations(searchId);
  if (foundIndex === -1) {
    output.innerHTML = `<p style="color:red">ID not found.</p>`;
    return;
  }

  if (locations.length === 0) {
    output.innerHTML = `<p class="muted">No empty bins found after the given ID.</p>`;
    return;
  }

  output.appendChild(renderGroupedLocations(locations));
});

/* ---------- Scanner ---------- */
async function startScanner() {
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || cameras.length === 0) return alert("No camera found!");

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
    if (video && video.srcObject) videoTrack = video.srcObject.getVideoTracks()[0];

  } catch (err) {
    console.error(err);
    alert("Could not start camera. Ensure permission is allowed and HTTPS is used.");
    stopScanner();
  }
}

/* ---------- Stop Scanner ---------- */
async function stopScanner() {
  if (html5QrCode && isScanning) await html5QrCode.stop();
  isScanning = false;
  document.getElementById("scannerWrap").style.display = "none";
  document.getElementById("torchControls").style.display = "none";
  enableTorch(false);
}

/* ---------- Flashlight (Torch) ---------- */
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

/* ---------- Buttons ---------- */
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);
document.getElementById("torchToggleBtn").addEventListener("click", () => {
  enableTorch(!torchOn);
});

/* ---------- Init ---------- */
loadExcel();
