function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string" && forwarded.length > 0
      ? forwarded.split(",")[0].trim()
      : req.ip || req.socket.remoteAddress || "unknown";

  return rawIp.replace(/^::ffff:/, "");
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function createTimestampParts(timeZone = "Europe/Paris") {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  return {
    iso: now.toISOString(),
    date: dateFormatter.format(now),
    time: timeFormatter.format(now)
  };
}

module.exports = {
  getClientIp,
  setFlash,
  createTimestampParts
};
