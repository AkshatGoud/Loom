// Vite-style asset imports for the main process.

declare module '*.sql?raw' {
  const content: string;
  export default content;
}
