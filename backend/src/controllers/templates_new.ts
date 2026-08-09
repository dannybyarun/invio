import { getDatabase } from "../database/init.ts";
import { Template } from "../types/index.ts";
import { generateUUID } from "../utils/uuid.ts";

export const getTemplates = () => {
  const db = getDatabase();
  const results = db.query(
    "SELECT id, name, html, is_default, created_at FROM templates",
  );
  return results.map((row: unknown[]) => ({
    id: row[0] as string,
    name: row[1] as string,
    html: row[2] as string,
    isDefault: Boolean(row[3]),
    createdAt: new Date(row[4] as string),
  }));
};

export const createTemplate = (data: Partial<Template>) => {
  const db = getDatabase();
  const templateId = generateUUID();

  const template: Template = {
    id: templateId,
    name: data.name!,
    html: data.html!,
    isDefault: data.isDefault || false,
    templateType: "builtin",
    createdAt: new Date(),
  };

  db.query(
    "INSERT INTO templates (id, name, html, is_default, created_at) VALUES (?, ?, ?, ?, ?)",
    [
      template.id,
      template.name,
      template.html,
      template.isDefault,
      template.createdAt,
    ],
  );

  return template;
};

export const updateTemplate = (id: string, data: Partial<Template>) => {
  const db = getDatabase();
  db.query(
    "UPDATE templates SET name = ?, html = ?, is_default = ? WHERE id = ?",
    [data.name, data.html, data.isDefault, id],
  );

  const result = db.query(
    "SELECT id, name, html, is_default, created_at FROM templates WHERE id = ?",
    [id],
  );
  if (result.length > 0) {
    const row = result[0] as unknown[];
    return {
      id: row[0] as string,
      name: row[1] as string,
      html: row[2] as string,
      isDefault: Boolean(row[3]),
      createdAt: new Date(row[4] as string),
    };
  }
  return null;
};

export const deleteTemplate = (id: string) => {
  const db = getDatabase();
  db.query("DELETE FROM templates WHERE id = ?", [id]);
  return true;
};
