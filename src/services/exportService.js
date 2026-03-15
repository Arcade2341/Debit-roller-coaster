const XLSX = require("xlsx");

function buildEntriesWorkbook(calculations) {
  const workbook = XLSX.utils.book_new();
  const rows = calculations.map((entry) => ({
    Attraction: entry.attraction_name,
    "Personnes / train": entry.people_per_train,
    "Trains en 2 min": entry.trains_in_two_minutes,
    "Debit / heure": entry.throughput_per_hour,
    Date: entry.recorded_date,
    Heure: entry.recorded_time,
    Auteur: entry.username || "Visiteur",
    IP: entry.ip_address
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);

  XLSX.utils.book_append_sheet(workbook, sheet, "Calculs");

  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx"
  });
}

module.exports = {
  buildEntriesWorkbook
};
