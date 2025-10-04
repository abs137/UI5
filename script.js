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
    .replace(/^\].{2}/, "")                // removes any barcode prefix like ]C1, ]D2, etc.
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
  const colors = ["#f0f8ff", "#ffdddd", "#ddffdd", "#fff3cd", "#e0bbff"]; // 5 colors

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

/* ------------ Camera scanning (html5-qrcode) ------------ */
let html5QrCode = null;
let isScanning = false;
const scanBtn = document.getElementById("scanBtn");
const stopScanBtn = document.getElementById("stopScanBtn");
const scannerWrap = document.getElementById("scannerWrap");
const idInput = document.getElementById("id");

scanBtn.addEventListener("click", async () => {
  if (isScanning) return;
  try {
    if (!html5QrCode) html5QrCode = new Html5Qrcode("qr-reader");
    scannerWrap.style.display = "block";
    isScanning = true;

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decodedText) => {
        const clean = cleanId(decodedText);
        idInput.value = clean;
        stopScanning();
        document.getElementById("searchForm").requestSubmit();
      }
    );
  } catch (err) {
    isScanning = false;
    console.error(err);
    alert("Could not start camera. Ensure permission is allowed and you're on HTTPS.");
    scannerWrap.style.display = "none";
  }
});

stopScanBtn.addEventListener("click", stopScanning);

async function stopScanning() {
  if (html5QrCode && isScanning) {
    try { await html5QrCode.stop(); } catch (_) {}
  }
  isScanning = false;
  scannerWrap.style.display = "none";
}

/* ------------ Init ------------ */
loadExcel();
