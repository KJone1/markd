const LANGUAGES: Record<string, string> = {
  bash: "shell",
  c: "c",
  cfg: "ini",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  csv: "plaintext",
  env: "ini",
  fish: "shell",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  log: "plaintext",
  mjs: "javascript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "shell",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const FILENAMES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

export function monacoLanguageForPath(path: string): string {
  const filename = path.split("/").at(-1)?.toLowerCase() ?? "";
  const knownFilename = FILENAMES[filename];
  if (knownFilename !== undefined) return knownFilename;
  const extension = filename.includes(".") ? filename.split(".").at(-1)! : "";
  return LANGUAGES[extension] ?? "plaintext";
}
