/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html"],
  theme: {
    extend: {
      colors: {
        surface: "#121318",
        surfaceContainer: "#1e1f25",
        primary: "#d0bcff",
        onPrimary: "#381e72",
        outline: "#938f99",
      },
      boxShadow: { md3: "0 2px 8px rgb(0 0 0 / .24)" },
    },
  },
};
