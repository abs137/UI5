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

    // header:1 => arrays; raw:false => keep formatted strings; blankrows:false => skip fully blank
    const all = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });

    if (!all || all.length === 0) throw new Error("Sheet is empty");

    // Auto-detect header: if first row looks like headers (ID/DETAILS/STATUS), skip it; else keep it
    const first = all[0] || [];
    const a0 = (first[0] ?? "").toString().trim().toUpperCase();
    const b0 = (first[1] ?? "").toString().trim().toUpperCase();
    const hasHeader = (a0 === "ID") || (b0 === "DETAILS") || (b0 === "STATUS");

    rowsRaw = all.slice(hasHeader ? 1 : 0).map(r => [
      (r[0] ?? "").toString().trim(),   // Column A (ID / location)
      (r[1] ?? "").toString().trim()    // Column B (status or target)
    ]);

    // Optional quick peek:
    // console.log("First few rows:", rowsRaw.slice(0,5));

  } catch (err) {
    console.error(err);
    document.getElementById("output").textContent =
      "⚠️ Could not load Excel file. Check file name/path and that it sits next to index.html.";
  }
}

/* ------------ Utilities ------------ */
function isEMPTY(val) {
  const v = (val ?? "").trim().toUpperCase();
  return v === "Y" || v === "EMPTY";
}

// Make the typed/scanned ID safe for comparison
function cleanId(text) {
  if (!text) return "";
  return text
    .replace(/^\].{2}/, "")                // strips symbology ]C1 / ]E0 / ]A0... at start
    .replace(/[\u0000-\u001F\u007F]/g, "") // remove hidden control chars
    .trim();
}

/**
 * Find next N locations (column A values) AFTER the row where column A === startId
 * such that column B === 'EMPTY' (case-insensitive).
 */
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

/* ------------ Render helpers ------------ */
function renderList(title, items) {
  const li = items.map(x => `<li><code>${x}</code></li>`).join("");
  return `
    <h3>${title}</h3>
    ${items.length ? `<ol>${li}</ol>` : `<p class="muted">No results.</p>`}
  `;
}

/* ------------ Search form ------------ */
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();

  let searchId = cleanId(document.getElementById("id").value);
  const output = document.getElementById("output");
  output.innerHTML = "";

  if (!searchId) {
    output.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  const { foundIndex, locations } = findNextEmptyLocations(searchId, EMPTY_COUNT);

  if (foundIndex === -1) {
    // Debug tip (uncomment if needed):
    // console.log("Searching for:", JSON.stringify(searchId));
    // console.log("Sample A-col values:", rowsRaw.slice(0,10).map(r => r[0]));
    output.innerHTML = `<p style="color:red">ID not found in the first column.</p>`;
    return;
  }

  output.innerHTML =
    '<p><strong>Start ID:</strong> <code>' + searchId + '</code></p>' +
    renderList('Next ' + EMPTY_COUNT + ' locations with EMPTY Bins', locations);
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
      {
        fps: 10,
        qrbox: 250,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF
        ]
      },
      (decodedText) => {
        const clean = cleanId(decodedText);
        idInput.value = clean;
        stopScanning();
        document.getElementById("searchForm").requestSubmit();
      },
      () => { /* ignore per-frame scan errors */ }
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
