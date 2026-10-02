import api from "@/lib/api-client";

export interface OidcProvider {
  id: string;
  name: string;
  type: string;
  oidcIssuer: string;
  oidcClientId: string;
  isEnabled: boolean;
  allowSignup: boolean;
  callbackUrl: string;
}

export type OidcProviderInput = Omit<
  OidcProvider,
  "id" | "type" | "callbackUrl"
> & {
  providerId?: string;
  oidcClientSecret?: string;
};

export async function getOidcProviders(): Promise<OidcProvider[]> {
  const response = await api.post<OidcProvider[]>("/sso/oidc/providers");
  return response.data;
}

export async function saveOidcProvider(input: OidcProviderInput) {
  const response = await api.post<OidcProvider>("/sso/oidc/save", input);
  return response.data;
}

export async function deleteOidcProvider(providerId: string) {
  await api.post("/sso/oidc/delete", { providerId });
}
