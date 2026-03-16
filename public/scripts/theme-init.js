(() => {
  const storedTheme = localStorage.getItem("roller-theme");
  const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = storedTheme || preferredTheme;
})();
