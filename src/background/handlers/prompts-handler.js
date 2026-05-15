import { putPrompt, getPrompt, getAllPrompts, deletePrompt, updatePrompt } from "../../lib/db.js";
import { ok, fail as error } from "../response.js";

export async function handleSavePrompt({ message }) {
  try {
    const { prompt } = message;
    if (!prompt || !prompt.content) {
      return error("Prompt content is required");
    }
    const saved = await putPrompt({
      ...prompt,
      id: prompt.id || crypto.randomUUID(),
      createdAt: prompt.createdAt || Date.now(),
      updatedAt: Date.now()
    });
    return ok({ prompt: saved });
  } catch (err) {
    return error(err.message);
  }
}

export async function handleGetPrompts({ message }) {
  try {
    const prompts = await getAllPrompts();
    return ok({ prompts });
  } catch (err) {
    return error(err.message);
  }
}

export async function handleGetPrompt({ message }) {
  try {
    const { id } = message;
    if (!id) {
      return error("Prompt id is required");
    }
    const prompt = await getPrompt(id);
    return ok({ prompt });
  } catch (err) {
    return error(err.message);
  }
}

export async function handleDeletePrompt({ message }) {
  try {
    const { id } = message;
    if (!id) {
      return error("Prompt id is required");
    }
    await deletePrompt(id);
    return ok({ success: true });
  } catch (err) {
    return error(err.message);
  }
}

export async function handleUpdatePrompt({ message }) {
  try {
    const { id, updates } = message;
    if (!id) {
      return error("Prompt id is required");
    }
    const updated = await updatePrompt(id, updates);
    return ok({ prompt: updated });
  } catch (err) {
    return error(err.message);
  }
}
