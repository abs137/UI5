// ------------- CONFIG -------------
const EXCEL_URL = "./book1.xlsx";
// ----------------------------------

let rowsRaw = []; // [ [LOCATION_ID, ITEM], ... ]
let html5QrCode = null;
let isScanning = false;
let videoTrack = null;
let torchOn = false;

// Missing (selected) bins across ALL scans
let missingSet = new Set();

/* ---------- Load Excel ---------- */
async function loadExcel() {
  try {
    const res = await fetch(`${EXCEL_URL}?ts=${Date.now()}`);
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
      (r[0] ?? "").toString().trim(),
      (r[1] ?? "").toString().trim()
    ]);

    console.log("Excel loaded, rows:", rowsRaw.length);
  } catch (err) {
    console.error("Excel load failed:", err);
    document.getElementById("message").innerHTML = "⚠️ Unable to load bin data.";
  }
}

/* ---------- Helpers ---------- */
function cleanId(text) {
  if (!text) return "";
  return String(text)
    .replace(/^\][A-Z0-9]{2}/i, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

function isEMPTY(v) {
  const val = (v ?? "").toUpperCase().trim();
  return val === "" || val === "EMPTY" || val === "Y";
}

function updateSelectedCount() {
  const msg = document.getElementById("message");
  if (!msg) return;

  if (!missingSet.size) {
    msg.innerHTML = `<span class="muted">No bins selected</span>`;
  } else {
    msg.innerHTML = `Selected bins: <b>${missingSet.size}</b>`;
  }
}

/* ---------- Search logic ---------- */
function findNextEmptyLocations(startId) {
  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if (idx === -1) return { foundIndex: -1, locations: [] };

  const prefix = startId.substring(0, 5).toUpperCase();
  const found = [];

  for (let i = idx; i < rowsRaw.length; i++) {
    const id = rowsRaw[i][0];
    const det = rowsRaw[i][1];

    if (!id) break;
    if (id.substring(0,5).toUpperCase() !== prefix) break;

    if (isEMPTY(det)) found.push(id);
  }

  return { foundIndex: idx, locations: found };
}

/* ---------- UI render ---------- */
function renderGroupedLocations(locations) {
  const grid = document.getElementById("binsGrid");
  grid.innerHTML = "";

  // colors per group of first 8 chars
  const colors = ["#f0f8ff", "#ffdddd", "#ddffdd", "#fef9c3"];
  let currentGroup = null;
  let colorIndex = -1;

  locations.forEach(loc => {
    const groupKey = loc.substring(0, 8);  // first 8 characters

    if (groupKey !== currentGroup) {
      currentGroup = groupKey;
      colorIndex = (colorIndex + 1) % colors.length;
    }

    const card = document.createElement("div");
    card.className = "bin-card";
    card.textContent = loc;

    // set group background color
    card.style.backgroundColor = colors[colorIndex];

    // keep red outline for selected (missing) bins
    if (missingSet.has(loc)) {
      card.classList.add("missing");
    }

    card.addEventListener("click", () => {
      if (missingSet.has(loc)) {
        missingSet.delete(loc);
        card.classList.remove("missing");
      } else {
        missingSet.add(loc);
        card.classList.add("missing");
      }
      updateSelectedCount();
    });

    grid.appendChild(card);
  });

  updateSelectedCount();
}



/* ---------- FORM ---------- */
document.getElementById("searchForm").addEventListener("submit", e => {
  e.preventDefault();

  const searchId = cleanId(document.getElementById("id").value);
  const msg = document.getElementById("message");
  const grid = document.getElementById("binsGrid");

  msg.innerHTML = "";
  grid.innerHTML = "";

  if (!searchId) {
    msg.innerHTML = "<p style='color:red'>Enter ID</p>";
    return;
  }

  if (!rowsRaw.length) {
    msg.innerHTML = "<p style='color:red'>Data not loaded.</p>";
    return;
  }

  const {foundIndex, locations} = findNextEmptyLocations(searchId);

  if (foundIndex === -1) {
    msg.innerHTML = "<p style='color:red'>ID not found.</p>";
    return;
  }

  if (!locations.length) {
    msg.innerHTML = "<span class='muted'>No empty bins here.</span>";
    return;
  }

  renderGroupedLocations(locations);

  // ✅ Critical fix:
  // document.getElementById("id").value = "";
});

/* ---------- Scanner ---------- */
async function startScanner() {
  try {
    html5QrCode = new Html5Qrcode("qr-reader");
    isScanning = true;

    document.getElementById("scannerWrap").style.display = "block";
    document.getElementById("torchControls").style.display = "block";

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250, experimentalFeatures:{useBarCodeDetectorIfSupported:true} },
      decoded => {
        document.getElementById("id").value = cleanId(decoded);
        stopScanner();
        document.getElementById("searchForm").requestSubmit();
      }
    );

    const vid = document.querySelector("#qr-reader video");
    if (vid && vid.srcObject)
      videoTrack = vid.srcObject.getVideoTracks()[0];

  } catch (err) {
    console.error("Scanner error", err);
    alert("Camera/Scanner error.");
    stopScanner();
  }
}

async function stopScanner() {
  if (html5QrCode && isScanning)
    try { await html5QrCode.stop(); } catch {}

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
    document.getElementById("torchToggleBtn").textContent =
      on ? "🔦 Turn OFF Flashlight" : "💡 Turn ON Flashlight";
  } catch {
    console.warn("Torch not supported.");
  }
}

/* ---------- DOWNLOAD PDF ---------- */
function downloadMissingLocations() {
  if (!missingSet.size) return alert("No bins selected.");

  const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
  if (!JsPDF) return alert("jsPDF not loaded.");

  const doc = new JsPDF({unit:"pt"});
  let y = 40;
  const h = doc.internal.pageSize.height - 30;

  doc.setFont("helvetica","bold");
  doc.setFontSize(14);
  doc.text("Missing Locations", 40, y);
  y += 22;

  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 40, y);
  y += 20;

  doc.text(`Total: ${missingSet.size}`, 40, y);
  y += 20;

  doc.setFont("helvetica","normal");

  [...missingSet].sort().forEach(id => {
    if (y > h) {
      doc.addPage();
      y = 40;
    }
    doc.text(id, 40, y);
    y += 18;
  });

  const ts = new Date().toISOString().replace(/[:\-T]/g,"").slice(0,12);
  doc.save(`missing_locations_${ts}.pdf`);
}

/* ---------- CLEAR ---------- */
function clearAllMissingLocations() {
  if (!missingSet.size) return alert("Nothing selected.");

  if (!confirm("Clear all selected bins?")) return;

  missingSet.clear();
  document.querySelectorAll(".bin-card.missing").forEach(el=>el.classList.remove("missing"));
  updateSelectedCount();
}

/* ---------- EVENTS ---------- */
document.getElementById("scanBtn").addEventListener("click", startScanner);
document.getElementById("stopScanBtn").addEventListener("click", stopScanner);
document.getElementById("torchToggleBtn").addEventListener("click", ()=> enableTorch(!torchOn));
document.getElementById("downloadMissingBtn").addEventListener("click", downloadMissingLocations);
document.getElementById("clearAllBtn").addEventListener("click", clearAllMissingLocations);

/* ---------- INIT ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  await loadExcel();
  updateSelectedCount();
});
