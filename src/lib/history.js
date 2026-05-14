export function createHistoryManager(maxHistory = 50) {
  let undoStack = [];
  let redoStack = [];
  let listeners = [];

  function notify() {
    listeners.forEach(fn => fn({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      undoCount: undoStack.length,
      redoCount: redoStack.length
    }));
  }

  return {
    push(action) {
      undoStack.push(action);
      if (undoStack.length > maxHistory) {
        undoStack.shift();
      }
      redoStack = [];
      notify();
    },

    async undo() {
      if (undoStack.length === 0) return null;
      const action = undoStack.pop();
      redoStack.push(action);
      notify();
      if (action.undo) {
        await action.undo();
      }
      return action;
    },

    async redo() {
      if (redoStack.length === 0) return null;
      const action = redoStack.pop();
      undoStack.push(action);
      notify();
      if (action.redo) {
        await action.redo();
      }
      return action;
    },

    clear() {
      undoStack = [];
      redoStack = [];
      notify();
    },

    onChange(listener) {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter(l => l !== listener);
      };
    },

    getState() {
      return {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        undoCount: undoStack.length,
        redoCount: redoStack.length
      };
    }
  };
}

export function createBatchAction(type, data, undoFn, redoFn) {
  return {
    type,
    data,
    undo: undoFn,
    redo: redoFn,
    timestamp: Date.now()
  };
}
