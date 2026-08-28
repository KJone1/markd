import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Captions,
  Check,
  ChevronDown,
  ChevronRight,
  Code,
  Copy,
  createElement,
  Dot,
  EyeOff,
  FolderTree,
  GripHorizontal,
  type IconNode,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListCollapse,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Minus,
  Pencil,
  Plus,
  Quote,
  Search,
  Sigma,
  Square,
  SquareCheckBig,
  SquareTerminal,
  Strikethrough,
  Table,
  Trash2,
  X,
} from "lucide";

function lucideIcon(icon: IconNode): string {
  return createElement(icon, {
    "aria-hidden": "true",
    class: "lucide-icon",
    focusable: "false",
  }).outerHTML;
}

const boldIcon = lucideIcon(Bold);
const italicIcon = lucideIcon(Italic);
const strikethroughIcon = lucideIcon(Strikethrough);
const inlineCodeIcon = lucideIcon(Code);
const linkIcon = lucideIcon(Link);
const imageIcon = lucideIcon(Image);
const tableIcon = lucideIcon(Table);
const terminalIcon = lucideIcon(SquareTerminal);
const mathIcon = lucideIcon(Sigma);
const quoteIcon = lucideIcon(Quote);
const dividerIcon = lucideIcon(Minus);
const bulletListIcon = lucideIcon(List);
const orderedListIcon = lucideIcon(ListOrdered);
const taskListIcon = lucideIcon(ListChecks);

export const indentIcon = lucideIcon(ListIndentIncrease);
export const outdentIcon = lucideIcon(ListIndentDecrease);
export const detailsIcon = lucideIcon(ListCollapse);
export const fileTreeIcon = lucideIcon(FolderTree);
const copyIcon = lucideIcon(Copy);
export const copyPathIcon = copyIcon;

const confirmIcon = lucideIcon(Check);
const captionIcon = lucideIcon(Captions);
const editIcon = lucideIcon(Pencil);
const removeIcon = lucideIcon(Trash2);
const bulletIcon = lucideIcon(Dot);
const checkBoxCheckedIcon = lucideIcon(SquareCheckBig);
const checkBoxUncheckedIcon = lucideIcon(Square);
const alignLeftIcon = lucideIcon(AlignLeft);
const alignCenterIcon = lucideIcon(AlignCenter);
const alignRightIcon = lucideIcon(AlignRight);
const dragHandleIcon = lucideIcon(GripHorizontal);
const plusIcon = lucideIcon(Plus);
const searchIcon = lucideIcon(Search);
const clearIcon = lucideIcon(X);
const visibilityOffIcon = lucideIcon(EyeOff);

const chevronRightIcon = lucideIcon(ChevronRight);
const chevronDownIcon = lucideIcon(ChevronDown);

function svgMask(icon: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(icon.trim())}")`;
}

export const chevronRightMask = svgMask(chevronRightIcon);
export const chevronDownMask = svgMask(chevronDownIcon);

export const topBarIcons = {
  boldIcon,
  italicIcon,
  strikethroughIcon,
  codeIcon: inlineCodeIcon,
  linkIcon,
  imageIcon,
  tableIcon,
  codeBlockIcon: terminalIcon,
  mathIcon,
  quoteIcon,
  hrIcon: dividerIcon,
  bulletListIcon,
  orderedListIcon,
  taskListIcon,
  chevronDownIcon,
};

export const imageBlockIcons = {
  inlineImageIcon: imageIcon,
  inlineConfirmButton: confirmIcon,
  blockImageIcon: imageIcon,
  blockCaptionIcon: captionIcon,
};

export const linkTooltipIcons = {
  linkIcon: copyIcon,
  editButton: editIcon,
  removeButton: removeIcon,
  confirmButton: confirmIcon,
};

export const listItemIcons = {
  bulletIcon,
  checkBoxCheckedIcon,
  checkBoxUncheckedIcon,
};

export const tableIcons = {
  addRowIcon: plusIcon,
  addColIcon: plusIcon,
  deleteRowIcon: removeIcon,
  deleteColIcon: removeIcon,
  alignLeftIcon,
  alignCenterIcon,
  alignRightIcon,
  colDragHandleIcon: dragHandleIcon,
  rowDragHandleIcon: dragHandleIcon,
};

export const codeMirrorIcons = {
  expandIcon: chevronDownIcon,
  searchIcon,
  clearSearchIcon: clearIcon,
  copyIcon,
  previewToggleIcon: (previewOnlyMode: boolean) =>
    previewOnlyMode ? editIcon : visibilityOffIcon,
};

export const latexIcons = {
  inlineEditConfirm: confirmIcon,
};

export const zedIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
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
