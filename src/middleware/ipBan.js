const db = require("../db");
const { getClientIp } = require("../utils/security");

function banCheckMiddleware(req, res, next) {
  const ipAddress = getClientIp(req);
  const ban = db
    .prepare(
      `
        SELECT id, reason
        FROM ip_bans
        WHERE ip_address = ? AND is_active = 1
        LIMIT 1
      `
    )
    .get(ipAddress);

  if (!ban) {
    return next();
  }

  return res.status(403).render("banned", {
    pageTitle: "Acces bloque",
    reason: ban.reason
  });
}

module.exports = {
  banCheckMiddleware
};
