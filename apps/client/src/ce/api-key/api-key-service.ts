import api from "@/lib/api-client";
import type { IPagination, QueryParams } from "@/lib/types";

export interface IApiKey {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  creatorId: string;
  workspaceId: string;
  creator?: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export async function getApiKeys(
  params: QueryParams = {},
): Promise<IPagination<IApiKey>> {
  return (await api.post<IPagination<IApiKey>>("/api-keys", params)).data;
}

export async function createApiKey(input: {
  name: string;
  expiresAt?: string;
}): Promise<IApiKey & { token: string }> {
  return (
    await api.post<IApiKey & { token: string }>("/api-keys/create", input)
  ).data;
}

export async function renameApiKey(apiKeyId: string, name: string) {
  return (await api.post<IApiKey>("/api-keys/update", { apiKeyId, name })).data;
}

export async function revokeApiKey(apiKeyId: string) {
  await api.post("/api-keys/revoke", { apiKeyId });
}

export async function setApiRestriction(restrictApiToAdmins: boolean) {
  await api.post("/workspace/update", { restrictApiToAdmins });
}
