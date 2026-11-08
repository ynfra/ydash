// Imported `with { type: "text" }` and embedded by `bun build --compile`.
declare module "*.css" { const text: string; export default text; }
declare module "*.md" { const text: string; export default text; }
