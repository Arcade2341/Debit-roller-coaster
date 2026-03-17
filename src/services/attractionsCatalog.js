const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const workbookPath = path.join(__dirname, "..", "..", "data", "attractions.xlsx");

let cachedCatalog = [];
let cachedMtimeMs = 0;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findColumnKey(headers, candidates) {
  const normalizedCandidates = candidates.map((candidate) => normalizeText(candidate));
  return headers.find((header) => normalizedCandidates.includes(normalizeText(header)));
}

function loadCatalog() {
  if (!fs.existsSync(workbookPath)) {
    cachedCatalog = [];
    cachedMtimeMs = 0;
    return cachedCatalog;
  }

  const stats = fs.statSync(workbookPath);

  if (stats.mtimeMs === cachedMtimeMs && cachedCatalog.length > 0) {
    return cachedCatalog;
  }

  const workbook = XLSX.readFile(workbookPath);
  const [firstSheetName] = workbook.SheetNames;

  if (!firstSheetName) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "" });

  if (rows.length === 0) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  const headers = Object.keys(rows[0]);
  const attractionKey = findColumnKey(headers, [
    "attraction",
    "nom",
    "nom attraction",
    "nom_attraction",
    "ride",
    "name"
  ]);
  const peopleKey = findColumnKey(headers, [
    "nombre de personnes par train",
    "people per train",
    "people_per_train",
    "personnes par train",
    "personnes_par_train",
    "capacite",
    "capacity",
    "places"
  ]);
  const parkKey = findColumnKey(headers, ["parc", "park"]);
  const countryKey = findColumnKey(headers, ["pays", "country"]);

  if (!attractionKey || !peopleKey) {
    cachedCatalog = [];
    cachedMtimeMs = stats.mtimeMs;
    return cachedCatalog;
  }

  cachedCatalog = rows
    .map((row, index) => {
      const attractionName = String(row[attractionKey] || "").trim();
      const peoplePerTrain = Number(row[peopleKey]);
      const parkName = parkKey ? String(row[parkKey] || "").trim() : "";
      const countryName = countryKey ? String(row[countryKey] || "").trim() : "";

      if (!attractionName || !Number.isInteger(peoplePerTrain) || peoplePerTrain <= 0) {
        return null;
      }

      const locationParts = [parkName, countryName].filter(Boolean);
      const displayName = locationParts.length > 0
        ? `${attractionName} - ${locationParts.join(" / ")}`
        : attractionName;

      return {
        id: String(index + 1),
        attractionName,
        parkName,
        countryName,
        displayName,
        normalizedName: normalizeText(attractionName),
        peoplePerTrain
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.attractionName.localeCompare(right.attractionName, "fr"));

  cachedMtimeMs = stats.mtimeMs;
  return cachedCatalog;
}

function searchAttractions(query, limit = 8) {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return [];
  }

  return loadCatalog()
    .filter((entry) => entry.normalizedName.includes(normalizedQuery))
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      displayName: entry.displayName,
      attractionName: entry.attractionName,
      parkName: entry.parkName,
      countryName: entry.countryName,
      peoplePerTrain: entry.peoplePerTrain
    }));
}

function findAttractionById(id) {
  const stringId = String(id || "").trim();

  if (!stringId) {
    return null;
  }

  return loadCatalog().find((entry) => entry.id === stringId) || null;
}

function getCatalogInfo() {
  const catalog = loadCatalog();

  return {
    available: catalog.length > 0,
    total: catalog.length,
    workbookPath
  };
}

function appendAttractionToCatalog({ countryName, parkName, attractionName, peoplePerTrain }) {
  const workbook = fs.existsSync(workbookPath)
    ? XLSX.readFile(workbookPath)
    : XLSX.utils.book_new();
  const firstSheetName = workbook.SheetNames[0] || "Sheet1";
  const worksheet = workbook.Sheets[firstSheetName]
    || XLSX.utils.aoa_to_sheet([["Pays", "Parc", "Attraction", "Nombre de personnes par train"]]);

  if (!workbook.Sheets[firstSheetName]) {
    XLSX.utils.book_append_sheet(workbook, worksheet, firstSheetName);
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  if (rows.length === 0) {
    rows.push(["Pays", "Parc", "Attraction", "Nombre de personnes par train"]);
  }

  rows.push([countryName, parkName, attractionName, peoplePerTrain]);

  const nextWorksheet = XLSX.utils.aoa_to_sheet(rows);
  workbook.Sheets[firstSheetName] = nextWorksheet;
  XLSX.writeFile(workbook, workbookPath);

  cachedCatalog = [];
  cachedMtimeMs = 0;
}

module.exports = {
  appendAttractionToCatalog,
  findAttractionById,
  getCatalogInfo,
  searchAttractions
};
