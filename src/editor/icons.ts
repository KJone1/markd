export const zedIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      fill-rule="evenodd"
      d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v16h16V4H4z"
    />
    <path
      d="M7 6.5h10v2.19l-5.66 5.81H17v2.19H7v-2.19l5.66-5.81H7V6.5z"
    />
  </svg>
`;

export const indentIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M3 3h18v2H3V3zm8 4h10v2H11V7zm0 4h10v2H11v-2zm0 4h10v2H11v-2zM3 19h18v2H3v-2zM3 8l4 4-4 4V8z"
    />
  </svg>
`;

export const outdentIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M3 3h18v2H3V3zm8 4h10v2H11V7zm0 4h10v2H11v-2zm0 4h10v2H11v-2zM3 19h18v2H3v-2zM7 8v8l-4-4 4-4z"
    />
  </svg>
`;

export const detailsIcon = `
  <svg
    class="outline-icon lucide lucide-list-collapse-icon lucide-list-collapse"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M10 5h11" />
    <path d="M10 12h11" />
    <path d="M10 19h11" />
    <path d="m3 10 3-3-3-3" />
    <path d="m3 20 3-3-3-3" />
  </svg>
`;

export const terminalIcon = `
  <svg
    class="outline-icon lucide lucide-square-terminal-icon lucide-square-terminal"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m7 11 2-2-2-2" />
    <path d="M11 13h4" />
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
  </svg>
`;

export const chevronRightIcon = `
  <svg
    class="lucide lucide-chevron-right-icon lucide-chevron-right"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
`;

export const chevronDownIcon = `
  <svg
    class="lucide lucide-chevron-down-icon lucide-chevron-down"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
`;

function svgMask(icon: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(icon.trim())}")`;
}

export const chevronRightMask = svgMask(chevronRightIcon);
export const chevronDownMask = svgMask(chevronDownIcon);

export const fileTreeIcon = `
  <svg
    class="outline-icon"
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path
      d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"
    />
    <path
      d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"
    />
    <path d="M3 5a2 2 0 0 0 2 2h3" />
    <path d="M3 3v13a2 2 0 0 0 2 2h3" />
  </svg>
`;

export const copyPathIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
    />
  </svg>
`;
