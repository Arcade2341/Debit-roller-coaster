function attachLocals(req, res, next) {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.currentPath = req.path;
  res.locals.lastCalculation = req.session.lastCalculation || null;

  delete req.session.flash;

  next();
}

module.exports = {
  attachLocals
};
