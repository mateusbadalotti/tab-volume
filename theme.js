let initialTheme = localStorage.getItem("theme");
if (initialTheme !== "dark" && initialTheme !== "light") {
  initialTheme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
document.documentElement.dataset.theme = initialTheme;

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("theme-toggle");
  function updateToggle() {
    const dark = document.documentElement.dataset.theme === "dark";
    toggle.setAttribute("aria-checked", String(dark));
    toggle.title = dark ? "Switch to light mode" : "Switch to dark mode";
  }
  updateToggle();
  toggle.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
    updateToggle();
  });
});
