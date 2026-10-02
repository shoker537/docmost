import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import useUserRole from "@/hooks/use-user-role";
import { isCloud } from "@/lib/config";
import {
  deleteOidcProvider,
  getOidcProviders,
  OidcProvider,
  OidcProviderInput,
  saveOidcProvider,
} from "./oidc-service";

const empty: OidcProviderInput = {
  providerId: undefined,
  name: "",
  oidcIssuer: "",
  oidcClientId: "",
  oidcClientSecret: "",
  isEnabled: false,
  allowSignup: false,
};

export default function OidcSettings() {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ["sso-providers"],
    queryFn: getOidcProviders,
    enabled: isAdmin && !isCloud(),
  });
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<OidcProvider | null>(null);
  const form = useForm<OidcProviderInput>({
    initialValues: empty,
    validate: {
      name: (value) => (value.trim() ? null : t("Name is required")),
      oidcIssuer: (value) => {
        try {
          return new URL(value).protocol === "https:"
            ? null
            : t("Issuer must use HTTPS");
        } catch {
          return t("Enter a valid issuer URL");
        }
      },
      oidcClientId: (value) =>
        value.trim() ? null : t("Client ID is required"),
      oidcClientSecret: (value, values) =>
        values.providerId || value ? null : t("Client secret is required"),
    },
  });

  if (!isAdmin || isCloud())
    return (
      <Alert>
        {t("Only self-hosted workspace administrators can manage OIDC.")}
      </Alert>
    );

  function edit(provider?: OidcProvider) {
    form.setValues(
      provider
        ? {
            providerId: provider.id,
            name: provider.name,
            oidcIssuer: provider.oidcIssuer,
            oidcClientId: provider.oidcClientId,
            oidcClientSecret: "",
            isEnabled: provider.isEnabled,
            allowSignup: provider.allowSignup,
          }
        : { ...empty },
    );
    form.clearErrors();
    setError("");
    setOpened(true);
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sso-providers"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-public"] }),
    ]);
  }

  async function save(values: OidcProviderInput) {
    setBusy(true);
    setError("");
    try {
      await saveOidcProvider({
        ...values,
        oidcClientSecret: values.oidcClientSecret || undefined,
      });
      await refresh();
      setOpened(false);
    } catch (err: any) {
      setError(
        err.response?.data?.message || t("Could not save OIDC provider"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await deleteOidcProvider(deleting.id);
      await refresh();
      setDeleting(null);
    } catch (err: any) {
      setError(
        err.response?.data?.message || t("Could not delete OIDC provider"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack>
      <SettingsTitle title={t("OpenID Connect")} />
      <Text c="dimmed">
        {t(
          "Connect your identity provider to let members sign in with OIDC. The provider must supply a verified email to link or create accounts.",
        )}
      </Text>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {providers.isError && (
        <Alert color="red">{t("Could not load OIDC providers")}</Alert>
      )}
      <Button onClick={() => edit()} disabled={busy}>
        {t("Add OIDC provider")}
      </Button>
      {providers.data?.map((provider) => (
        <Paper key={provider.id} withBorder p="md">
          <Stack gap="xs">
            <Text fw={500}>
              {provider.name} —{" "}
              {provider.isEnabled ? t("Enabled") : t("Disabled")}
            </Text>
            <Text size="sm">{provider.oidcIssuer}</Text>
            <Text size="sm">
              {t("Register this callback URL with your identity provider:")}
            </Text>
            <Code style={{ overflowWrap: "anywhere" }}>
              {provider.callbackUrl}
            </Code>
            <Group>
              <Button
                variant="light"
                onClick={() => edit(provider)}
                disabled={busy}
              >
                {t("Edit")}
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={() => {
                  setError("");
                  setDeleting(provider);
                }}
                disabled={busy}
              >
                {t("Delete")}
              </Button>
            </Group>
          </Stack>
        </Paper>
      ))}
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title={t("OIDC provider")}
      >
        <form onSubmit={form.onSubmit(save)}>
          <Stack>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <TextInput
              label={t("Name")}
              required
              maxLength={100}
              {...form.getInputProps("name")}
            />
            <TextInput
              label={t("Issuer URL")}
              placeholder="https://id.example.com/realms/wiki"
              required
              {...form.getInputProps("oidcIssuer")}
            />
            <TextInput
              label={t("Client ID")}
              required
              {...form.getInputProps("oidcClientId")}
            />
            <PasswordInput
              label={t("Client secret")}
              required={!form.values.providerId}
              description={
                form.values.providerId
                  ? t("Leave blank to keep the current secret")
                  : undefined
              }
              autoComplete="new-password"
              {...form.getInputProps("oidcClientSecret")}
            />
            <Checkbox
              label={t("Enabled")}
              {...form.getInputProps("isEnabled", { type: "checkbox" })}
            />
            <Checkbox
              label={t("Allow new accounts")}
              description={t(
                "New users join as members. Workspace email domain restrictions apply.",
              )}
              {...form.getInputProps("allowSignup", { type: "checkbox" })}
            />
            <Button type="submit" loading={busy}>
              {t("Save")}
            </Button>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={!!deleting}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
        title={t("Delete OIDC provider")}
      >
        <Stack>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Text>
            {t(
              "Delete {{provider}} and its account links? Members will need another way to sign in.",
              { provider: deleting?.name },
            )}
          </Text>
          <Button color="red" loading={busy} onClick={remove}>
            {t("Delete")}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
