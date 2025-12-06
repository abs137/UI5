// DATA
let rowsRaw = [];
const selectedMissingBins = new Set();
let html5QrCode = null;

// ---------- LOAD EXCEL ----------
async function loadExcel(){
  try{
    const res = await fetch("./book1.xlsx");
    const data = await res.arrayBuffer();

    const wb = XLSX.read(data,{type:"array"});
    const sheet = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet,{header:1});

    rowsRaw = rows.slice(1).map(r => [
      (r[0] || "").toString().trim(),
      (r[1] || "").toString().trim()
    ]);

    console.log("Loaded rows:", rowsRaw.length);

  }catch(err){
    alert("Cannot load book1.xlsx");
    console.error(err);
  }
}

// ---------- HELPERS ----------
function cleanId(val){
  return (val || "")
    .replace(/^\][A-Z0-9]{2}/i,"")
    .replace(/[\u0000-\u001F\u007F]/g,"")
    .trim();
}

function isEMPTY(status){
  const v = (status||"").toUpperCase();
  return v==="" || v==="EMPTY" || v==="Y";
}

// ---------- FIND EMPTY BINS ----------
function findEmptyBins(startId){

  const idx = rowsRaw.findIndex(r => r[0] === startId);
  if(idx<0) return [];

  const prefix = startId.substring(0,5);
  let out = [];

  for(let i=idx;i<rowsRaw.length;i++){

    const id = rowsRaw[i][0];
    const st = rowsRaw[i][1];

    if(!id || id.substring(0,5)!==prefix) break;

    if(isEMPTY(st)) out.push(id);
  }

  return out;
}

// ---------- RENDER BIN LIST ----------
function renderBins(list){

  const grid = document.getElementById("binsGrid");
  const msg = document.getElementById("message");

  grid.innerHTML="";
  msg.innerHTML="";

  if(!list.length){
    msg.innerHTML="No empty bins found.";
    return;
  }

  msg.innerHTML = `Selected: <strong>${selectedMissingBins.size}</strong>`;

  list.forEach(id=>{

    const div = document.createElement("div");
    div.className="bin-card";
    div.textContent = id;

    if(selectedMissingBins.has(id))
      div.classList.add("selected");

    div.onclick = () => {

      if(selectedMissingBins.has(id)){
        selectedMissingBins.delete(id);
      } else {
        selectedMissingBins.add(id);
      }

      renderBins(list);
    };

    grid.appendChild(div);
  });
}

// ---------- SEARCH ----------
let currentList=[];

document.getElementById("searchForm").addEventListener("submit",e=>{
  e.preventDefault();

  const val = cleanId(document.getElementById("id").value);
  if(!val) return;

  selectedMissingBins.clear();

  currentList = findEmptyBins(val);
  renderBins(currentList);
});

// ---------- CLEAR ALL ----------
document.getElementById("clearAllBtn").onclick = () => {

  if(!selectedMissingBins.size){
    alert("Nothing selected yet.");
    return;
  }

  const ok = confirm("Clear all selected bins?");
  if(!ok) return;

  selectedMissingBins.clear();
  renderBins(currentList);
};

// ---------- PDF DOWNLOAD ----------
function downloadPDF(){

  if(!selectedMissingBins.size){
    alert("No bins selected!");
    return;
  }

  const JsPDF = window.jspdf.jsPDF;
  const doc = new JsPDF();

  let y=20;
  doc.setFontSize(14);
  doc.text("Missing Bin Report",10,y);
  y+=10;

  doc.setFontSize(10);
  doc.text("Generated: "+new Date().toLocaleString(),10,y);
  y+=12;

  doc.text("Total Missing: "+selectedMissingBins.size,10,y);
  y+=12;

  selectedMissingBins
    .forEach(id=>{
      if(y>270){
        doc.addPage();
        y=15;
      }
      doc.text(id,10,y);
      y+=7;
    });

  const ts =
    new Date().toISOString().replace(/[-:]/g,"").slice(0,15);

  doc.save(`missing_bins_${ts}.pdf`);
}

document.getElementById("downloadBtn").onclick = downloadPDF;


// ---------- SCANNER ----------
document.getElementById("scanBtn").onclick = async () => {

  const cams = await Html5Qrcode.getCameras();
  if(!cams.length){
    alert("Camera not found!");
    return;
  }

  html5QrCode = new Html5Qrcode("qr-reader");

  html5QrCode.start(
    cams[0].id,
    { fps:10, qrbox:250 },
    qr => {

      html5QrCode.stop();

      document.getElementById("id").value = qr;
      document.getElementById("searchForm").requestSubmit();
    }
  );
};

// ---------- INIT ----------
loadExcel();
