// Vite 风格的资源导入声明（vitest 走同一套 transform）
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.css';
