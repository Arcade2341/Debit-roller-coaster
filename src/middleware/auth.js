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

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect("/dashboard");
  }

  next();
}

module.exports = {
  requireAuth,
  redirectIfAuthenticated
};
