export const SHORTCUTS = {
  NAVIGATE_UP: "ArrowUp",
  NAVIGATE_DOWN: "ArrowDown",
  NAVIGATE_LEFT: "ArrowLeft",
  NAVIGATE_RIGHT: "ArrowRight",
  PREVIEW: " ",
  EXPORT: "e",
  DELETE: "Delete",
  CATEGORY: "t",
  FOCUS_SEARCH: "/",
  ESCAPE: "Escape",
  SELECT_ALL: "a",
  INVERT_SELECTION: "i",
  COMMAND_PALETTE: "k"
};

export function isModifierKey(event) {
  return event.ctrlKey || event.metaKey || event.altKey;
}

export function getShortcutKey(event) {
  if (event.ctrlKey || event.metaKey) {
    return `ctrl+${event.key.toLowerCase()}`;
  }
  if (event.altKey) {
    return `alt+${event.key.toLowerCase()}`;
  }
  return event.key;
}

export function matchesShortcut(event, shortcut) {
  const isCtrl = event.ctrlKey || event.metaKey;
  const parts = shortcut.toLowerCase().split("+");
  const hasCtrl = parts.includes("ctrl") || parts.includes("cmd");
  const keyPart = parts[parts.length - 1];
  return hasCtrl === isCtrl && event.key.toLowerCase() === keyPart;
}

export function createShortcutHandler(handlers) {
  return function handleShortcut(event) {
    const target = event.target;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      if (event.key === "Escape") {
        event.target.blur();
        handlers["Escape"]?.();
        return;
      }
      if (matchesShortcut(event, "ctrl+k") || matchesShortcut(event, "cmd+k")) {
        event.preventDefault();
        handlers["CommandPalette"]?.();
        return;
      }
      if (matchesShortcut(event, "ctrl+a") || matchesShortcut(event, "cmd+a")) {
        return;
      }
      return;
    }

    if (matchesShortcut(event, "ctrl+k") || matchesShortcut(event, "cmd+k")) {
      event.preventDefault();
      handlers["CommandPalette"]?.();
      return;
    }
    if (matchesShortcut(event, "ctrl+s") || matchesShortcut(event, "cmd+s")) {
      event.preventDefault();
      handlers["Save"]?.();
      return;
    }
    if (matchesShortcut(event, "ctrl+shift+m") || matchesShortcut(event, "cmd+shift+m")) {
      event.preventDefault();
      handlers["OpenLibrary"]?.();
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        handlers["NavigateUp"]?.();
        break;
      case "ArrowDown":
        event.preventDefault();
        handlers["NavigateDown"]?.();
        break;
      case "ArrowLeft":
        event.preventDefault();
        handlers["NavigateLeft"]?.();
        break;
      case "ArrowRight":
        event.preventDefault();
        handlers["NavigateRight"]?.();
        break;
      case " ":
        event.preventDefault();
        handlers["Preview"]?.();
        break;
      case "e":
      case "E":
        if (!isModifierKey(event)) {
          event.preventDefault();
          handlers["Export"]?.();
        }
        break;
      case "Delete":
      case "Backspace":
        if (!isModifierKey(event)) {
          event.preventDefault();
          handlers["Delete"]?.();
        }
        break;
      case "t":
      case "T":
        if (!isModifierKey(event)) {
          event.preventDefault();
          handlers["Category"]?.();
        }
        break;
      case "/":
        event.preventDefault();
        handlers["FocusSearch"]?.();
        break;
      case "Escape":
        event.preventDefault();
        handlers["Escape"]?.();
        break;
      case "a":
      case "A":
        if (!isModifierKey(event)) {
          event.preventDefault();
          handlers["SelectAll"]?.();
        }
        break;
      case "i":
      case "I":
        if (!isModifierKey(event)) {
          event.preventDefault();
          handlers["InvertSelection"]?.();
        }
        break;
    }
  };
}

export function getShortcutLabel(shortcut) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const parts = shortcut.toLowerCase().split("+");
  const labels = parts.map((part) => {
    switch (part) {
      case "ctrl":
        return isMac ? "⌃" : "Ctrl";
      case "cmd":
        return "⌘";
      case "shift":
        return isMac ? "⇧" : "Shift";
      case "alt":
        return isMac ? "⌥" : "Alt";
      default:
        return part.toUpperCase();
    }
  });
  return labels.join(isMac ? "" : "+");
}

export function formatShortcut(shortcut) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  if (shortcut.includes("ctrl+") || shortcut.includes("cmd+")) {
    return isMac ? shortcut.replace(/ctrl\+|cmd\+/g, "⌘") : shortcut.replace(/ctrl\+|cmd\+/gi, "Ctrl+");
  }
  return shortcut;
}
