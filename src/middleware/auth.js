const db = require("../db");
const { getClientIp } = require("../utils/security");

function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.flash = {
      type: "error",
      message: "Connectez-vous pour acceder a cette page."
    };
    return res.redirect("/login");
  }

  next();
}

function requireBoundIp(req, res, next) {
  if (!req.session.user) {
    return next();
  }

  const user = db
    .prepare("SELECT locked_ip FROM users WHERE id = ? LIMIT 1")
    .get(req.session.user.id);

  if (!user || !user.locked_ip) {
    return next();
  }

  const currentIp = getClientIp(req);

  if (user.locked_ip !== currentIp) {
    req.session.destroy(() => {
      res.redirect("/login");
    });
    return;
  }

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    req.session.flash = {
      type: "error",
      message: "Acces reserve aux admins."
    };
    return res.redirect("/dashboard");
  }

  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }

  next();
}

module.exports = {
  requireAuth,
  requireBoundIp,
  requireAdmin,
  redirectIfAuthenticated
};
