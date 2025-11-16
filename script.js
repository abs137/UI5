/* ---------- Find all empty locations with same first-5 prefix, starting at scanned row (wrap-around) ---------- */
function findAllEmptyByPrefixStartingFrom(searchId) {
  if (!searchId || searchId.length < 1) return [];
  const prefix = searchId.substring(0, 5).toUpperCase();
  const out = [];

  // find index of the exact scanned row (match full cleaned ID)
  const idx = rowsRaw.findIndex(r => (r[0] ?? "").toString().trim() === searchId);

  if (idx === -1) {
    // scanned ID not found — scan entire file top to bottom
    for (let i = 0; i < rowsRaw.length; i++) {
      const id = (rowsRaw[i][0] ?? "").toString().trim();
      const detail = rowsRaw[i][1];
      if (!id) continue;
      if (id.substring(0, 5).toUpperCase() === prefix && isEMPTY(detail)) out.push(id);
    }
    return out;
  }

  // start from idx -> end
  for (let i = idx; i < rowsRaw.length; i++) {
    const id = (rowsRaw[i][0] ?? "").toString().trim();
    const detail = rowsRaw[i][1];
    if (!id) continue;
    if (id.substring(0, 5).toUpperCase() === prefix && isEMPTY(detail)) out.push(id);
  }

  // then wrap: 0 -> idx-1
  for (let i = 0; i < idx; i++) {
    const id = (rowsRaw[i][0] ?? "").toString().trim();
    const detail = rowsRaw[i][1];
    if (!id) continue;
    if (id.substring(0, 5).toUpperCase() === prefix && isEMPTY(detail)) out.push(id);
  }

  return out;
}

/* ---------- Search Form (start from scanned row) ---------- */
document.getElementById("searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const searchId = cleanId(document.getElementById("id").value);
  const output = document.getElementById("output");
  output.innerHTML = "";

  if (!searchId) {
    output.innerHTML = `<p style="color:red">Please enter a valid ID.</p>`;
    return;
  }

  const locations = findAllEmptyByPrefixStartingFrom(searchId);

  if (locations.length === 0) {
    output.innerHTML = `<p class="muted">No empty bins found matching the first 5 characters of the given ID.</p>`;
    return;
  }

  output.appendChild(renderGroupedLocations(locations));
});
