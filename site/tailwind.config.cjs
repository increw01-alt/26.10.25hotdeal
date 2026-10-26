// 디자인 토큰(shared/design-tokens.json)을 단일 출처로 사용 (D-08)
const tokens = require("../shared/design-tokens.json");
module.exports = {
  content: ["./templates/**/*.html", "./scripts/**/*.mjs", "./src/js/**/*.js"],
  theme: {
    container: { center: true, padding: tokens.space.gutter, screens: { "2xl": tokens.container.max } },
    extend: {
      colors: { brand: tokens.color.brand, accent: tokens.color.accent, ink: tokens.color.ink, surface: tokens.color.surface, status: tokens.color.status },
      fontFamily: { sans: tokens.font.sans, mono: tokens.font.mono },
      borderRadius: { sm: tokens.radius.sm, md: tokens.radius.md, lg: tokens.radius.lg, xl: tokens.radius.xl },
      boxShadow: { card: tokens.shadow.card, pop: tokens.shadow.pop },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
