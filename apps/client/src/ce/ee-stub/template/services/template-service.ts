import type { ITemplate } from "../types/template.types";

export async function getTemplateById(_id: string): Promise<ITemplate> {
  throw new Error("Templates are not available in this edition");
}
