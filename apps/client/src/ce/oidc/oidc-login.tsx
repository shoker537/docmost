import { Alert, Button, Divider, Stack } from "@mantine/core";
import { useWorkspacePublicDataQuery } from "@/features/workspace/queries/workspace-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function OidcLogin() {
  const { data } = useWorkspacePublicDataQuery();
  const [params] = useSearchParams();
  const { t } = useTranslation();
  const providers =
    data?.authProviders?.filter((provider) => provider.type === "oidc") ?? [];
  const redirect = params.get("redirect");
  return (
    <>
      {params.has("oidcError") && (
        <Alert color="red" mb="md" role="alert">
          {t("Single sign-on failed. Try again or contact your administrator.")}
        </Alert>
      )}
      {providers.length > 0 && (
        <Stack mb="md" gap="sm">
          {providers.map((provider) => (
            <Button
              key={provider.id}
              component="a"
              fullWidth
              href={`/api/sso/oidc/${encodeURIComponent(provider.id)}/login${redirect ? `?${new URLSearchParams({ redirect })}` : ""}`}
            >
              {t("Continue with {{provider}}", { provider: provider.name })}
            </Button>
          ))}
          {!data?.enforceSso && <Divider label={t("or")} />}
        </Stack>
      )}
    </>
  );
}
