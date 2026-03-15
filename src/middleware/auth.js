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
      message: "Acces reserve a l'administration."
    };
    return res.redirect("/");
  }

  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect(req.session.user.isAdmin ? "/admin" : "/dashboard");
  }

  next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  redirectIfAuthenticated
};
