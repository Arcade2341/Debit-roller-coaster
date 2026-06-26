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

function requireSuperAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isSuperAdmin) {
    req.session.flash = {
      type: "error",
      message: "Acces reserve au super admin."
    };
    return res.redirect("/dashboard");
  }

  next();
}

function requireHelperOrAdmin(req, res, next) {
  if (!req.session.user || (!req.session.user.isAdmin && !req.session.user.isHelper)) {
    req.session.flash = {
      type: "error",
      message: "Acces reserve aux helpers et aux admins."
    };
    return res.redirect("/dashboard");
  }

  next();
}

function requirePublicationOrAdmin(req, res, next) {
  if (!req.session.user || (!req.session.user.isAdmin && !req.session.user.isPublication)) {
    req.session.flash = {
      type: "error",
      message: "Acces reserve a la publication et aux admins."
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
  requireAdmin,
  requireSuperAdmin,
  requireHelperOrAdmin,
  requirePublicationOrAdmin,
  redirectIfAuthenticated
};
